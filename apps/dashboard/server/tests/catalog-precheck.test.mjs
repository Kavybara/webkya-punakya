import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  catalogStockIsStale,
  createCatalogPrecheckLimiter,
  evaluateCatalogPrecheck,
} from "../services/catalog-precheck-service.js";

function helpers(overrides = {}) {
  return {
    getProduct: (db, id) => db.products.find((product) => product.id === id),
    isVariantOrderable: (product, variant) => Boolean(product.isActive !== false && variant.isActive !== false),
    orderLockError: (product, variant) => {
      if (variant.orderLocked) {
        const error = new Error(`${variant.name} sedang dikunci.`);
        error.status = 423;
        return error;
      }
      return null;
    },
    normalizeDurationLabel: (value) => String(value || "").trim().toLowerCase(),
    durationAllowedForVariant: (variant, duration) => (variant.allowedDurations || []).includes(duration),
    availableStockCount: (_db, _product, variant) => variant.stock || 0,
    publicCatalog: (db) => ({ products: db.products.map((product) => product.id) }),
    ...overrides,
  };
}

function dbWith(overrides = {}) {
  return {
    products: [
      {
        id: "netflix",
        isActive: true,
        variants: [
          { id: "netflix-1m", isActive: true, allowedDurations: ["1 bulan", "3 bulan"], stock: 4 },
          { id: "netflix-locked", isActive: true, allowedDurations: ["1 bulan"], orderLocked: true },
        ],
      },
    ],
    settings: {},
    ...overrides,
  };
}

test("a live product and variant pass with a stock count and a catalog", () => {
  const result = evaluateCatalogPrecheck(
    dbWith(),
    { productId: "netflix", variantId: "netflix-1m", duration: "1 bulan" },
    helpers(),
  );

  assert.equal(result.ok, true);
  assert.equal(result.productId, "netflix");
  assert.equal(result.variantId, "netflix-1m");
  assert.equal(result.stockCount, 4);
  assert.deepEqual(result.catalog, { products: ["netflix"] });
});

test("an unknown product is rejected with the catalog attached, so the client can re-render", () => {
  const result = evaluateCatalogPrecheck(
    dbWith(),
    { productId: "does-not-exist", variantId: "netflix-1m" },
    helpers(),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 409);
  assert.equal(result.error.message, "Produk atau varian tidak tersedia untuk order baru");
  assert.deepEqual(result.error.catalog, { products: ["netflix"] });
});

test("an archived or inactive product is rejected the same way as a missing one", () => {
  const db = dbWith();
  db.products[0].isArchived = true;

  for (const mutate of [
    (value) => { value.products[0].isArchived = true; },
    (value) => { value.products[0].isActive = false; },
    (value) => { value.products[0].variants[0].isActive = false; },
  ]) {
    const target = dbWith();
    mutate(target);
    const result = evaluateCatalogPrecheck(target, { productId: "netflix", variantId: "netflix-1m" }, helpers());
    assert.equal(result.ok, false, "an unavailable product must not pass the precheck");
    assert.equal(result.error.status, 409);
  }
  assert.equal(db.products[0].isArchived, true);
});

test("a locked variant keeps its own status and catalog", () => {
  const result = evaluateCatalogPrecheck(
    dbWith(),
    { productId: "netflix", variantId: "netflix-locked", duration: "1 bulan" },
    helpers(),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 423);
  assert.deepEqual(result.error.catalog, { products: ["netflix"] });
});

test("a duration the variant does not offer is rejected by name", () => {
  const result = evaluateCatalogPrecheck(
    dbWith(),
    { productId: "netflix", variantId: "netflix-1m", duration: "12 bulan" },
    helpers(),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 409);
  assert.match(result.error.message, /12 bulan sedang tidak aktif/);
});

test("evaluation never mutates the database it is handed", () => {
  const db = dbWith();
  const before = JSON.stringify(db);

  evaluateCatalogPrecheck(db, { productId: "netflix", variantId: "netflix-1m", duration: "1 bulan" }, helpers());
  evaluateCatalogPrecheck(db, { productId: "nope" }, helpers());
  evaluateCatalogPrecheck(db, { productId: "netflix", variantId: "netflix-locked" }, helpers());

  assert.equal(JSON.stringify(db), before);
});

test("a product with no usable sync is stale and a fresh one is not", () => {
  const product = { id: "netflix" };
  const cooldownMs = 20_000;
  const now = Date.now();

  assert.equal(catalogStockIsStale(dbWith(), product, cooldownMs), true, "no sync recorded at all");

  const fresh = dbWith();
  fresh.settings.googleSheetsProductSyncCache = {
    "dynamic:netflix": { ok: true, syncedAt: new Date(now - 5_000).toISOString() },
  };
  assert.equal(catalogStockIsStale(fresh, product, cooldownMs), false);

  const expired = dbWith();
  expired.settings.googleSheetsProductSyncCache = {
    "dynamic:netflix": { ok: true, syncedAt: new Date(now - 60_000).toISOString() },
  };
  assert.equal(catalogStockIsStale(expired, product, cooldownMs), true);
});

test("staleness only counts this product's sync, and ignores failed ones", () => {
  const product = { id: "netflix" };

  // Another product syncing just now must not make this one look fresh.
  const other = dbWith();
  other.settings.googleSheetsProductSyncCache = {
    "dynamic:spotify": { ok: true, syncedAt: new Date().toISOString() },
  };
  assert.equal(catalogStockIsStale(other, product, 20_000), true);

  const failed = dbWith();
  failed.settings.googleSheetsProductSyncCache = {
    "dynamic:netflix": { ok: false, syncedAt: new Date().toISOString() },
  };
  assert.equal(catalogStockIsStale(failed, product, 20_000), false, "a recent attempt still means the cache is warm");
});

test("the precheck limiter gives every client its own budget", () => {
  const limiter = createCatalogPrecheckLimiter({ maxAttempts: 2, windowMs: 60_000 });

  limiter.recordFailure("198.51.100.1");
  limiter.recordFailure("198.51.100.1");
  assert.equal(limiter.check("198.51.100.1").allowed, false);
  assert.equal(limiter.check("198.51.100.1").retryAfterSeconds, 60);
  assert.equal(limiter.check("198.51.100.2").allowed, true);

  limiter.clear("198.51.100.1");
  assert.equal(limiter.check("198.51.100.1").allowed, true);
});

test("the public precheck route answers rejections without taking the write lock", () => {
  // The endpoint is unauthenticated and runs ahead of every checkout. It used
  // to wrap the whole decision in updateDb, so any probe — including a guess
  // at a product id that does not exist — serialised and rewrote the whole
  // database file just to answer "no". The decision must be reachable from a
  // read-only snapshot; the write lock belongs behind refreshCatalogStock.
  const filePath = path.resolve("server/routes/catalog-routes.js");
  const ast = ts.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

  const calls = new Set();
  let handler = null;
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "post"
      && node.arguments[0]?.text === "/api/public/catalog/precheck"
    ) {
      handler = node.arguments[node.arguments.length - 1];
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);

  assert.ok(handler, "/api/public/catalog/precheck is no longer registered in catalog-routes.js");
  function collect(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.add(node.expression.text);
    ts.forEachChild(node, collect);
  }
  collect(handler);

  assert.ok(!calls.has("updateDb"), "the precheck handler must not call updateDb; that is the write-lock amplification");
  assert.ok(calls.has("readDbSnapshot"), "the precheck handler must read a snapshot");
  assert.ok(calls.has("evaluateCatalogPrecheck"), "the precheck handler must evaluate against the snapshot");
  assert.ok(calls.has("catalogStockIsStale"), "the refresh must be gated on staleness, not taken unconditionally");
  assert.ok(calls.has("refreshCatalogStock"), "the locked refresh must be delegated out of the route");
});
