import assert from "node:assert/strict";
import test from "node:test";

import { registerOrderRoutes } from "../routes/order-routes.js";
import { registerStockRoutes } from "../routes/stock-routes.js";

/**
 * A write path that cannot resolve what it was asked for must refuse, not guess.
 *
 * Three routes resolved an unresolvable reference by falling back to whatever
 * happened to be first in the catalog array:
 *
 *     const product = getProduct(db, req.body.productId) || db.products[0];
 *     const variant = product?.variants?.find((item) => item.id === req.body.variantId) || product?.variants?.[0];
 *
 * `getProduct` is an exact id lookup (index.js:215), so `|| db.products[0]`
 * only ever fires when the id did not match -- a deleted product, a typo, or a
 * stale client. The guard immediately below cannot catch it, because the
 * fallback product is a real, active, orderable one:
 *
 *     if (!product || product.isArchived || product.isActive === false || !variant || !isVariantOrderable(product, variant))
 *
 * So `POST /api/orders` answered 201 with a live QRIS charge for a Netflix
 * monthly subscription when the caller asked for something else, and reserved
 * real Netflix stock against it. The same substitution on `variantId` silently
 * swapped the plan the customer was quoted for, at the first variant's price.
 *
 * The UI cannot cause this on its own -- `products/page.tsx:847` always sends
 * `selection.product.id` and `selection.variant.id` from a live catalog load,
 * and `owner-v2/stock/page.tsx:97` already blocks an empty selection client
 * side. That is exactly why it is dangerous rather than merely sloppy: the
 * request is well-formed and passes every client-side check, so nothing in the
 * normal path would ever reveal that the server is guessing.
 *
 * These are unit tests against the route handlers rather than booted
 * integration tests, for the reason the rest of this suite is: booting the API
 * writes the real database and sends real WhatsApp messages.
 */
function routeCollector() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
  }
  return { app, routes };
}

function fixture() {
  return {
    products: [
      {
        id: "prod-netflix",
        name: "Netflix",
        isActive: true,
        variants: [
          { id: "var-netflix-monthly", name: "Bulanan", isActive: true, price: 30_000 },
          { id: "var-netflix-yearly", name: "Tahunan", isActive: true, price: 300_000 },
        ],
      },
      {
        id: "prod-spotify",
        name: "Spotify",
        isActive: true,
        variants: [{ id: "var-spotify-monthly", name: "Bulanan", isActive: true, price: 25_000 }],
      },
    ],
    orders: [],
    payments: [],
    stock: [],
    activities: [],
    resellers: [],
  };
}

// Only the deps reached before the guard under test. The handlers reject
// immediately, so the other ~40 injected collaborators are never called.
function minimalDeps(db) {
  return {
    assertOrderIntakeOpen: () => {},
    getProduct: (currentDb, productId) => (currentDb.products || []).find((item) => item.id === productId),
    isVariantOrderable: () => true,
    updateDb: async (mutator) => mutator(db),
  };
}

function handlerFor(routes, method, path) {
  const route = routes.find((item) => item.method === method && item.path === path);
  assert.ok(route, `no ${method} ${path} route is registered`);
  return route.handlers.at(-1);
}

function ownerRequest(body) {
  return { auth: { role: "owner", sub: "owner" }, params: {}, query: {}, body };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
}

// Asserts the handler refused the request with a 4xx rather than answering it.
// The `error.status` check is what keeps this honest: if the guard is ever
// removed and the handler walks on into a collaborator this fixture does not
// stub, the resulting TypeError carries no `status` and still fails here
// instead of quietly passing.
async function assertRefused(routes, path, body, expectedMessage) {
  const res = response();
  const error = await handlerFor(routes, "post", path)(ownerRequest(body), res)
    .then(() => null, (caught) => caught);

  assert.ok(error, `${path} answered ${res.statusCode} for a reference it could not resolve, instead of refusing it`);
  assert.equal(error.status, 400, `${path} refused the request, but not as a client error: ${error.message}`);
  assert.match(error.message, expectedMessage);
  assert.equal(res.payload, null, `${path} wrote a response body while rejecting the request`);
}

test("an order for a productId that no longer exists is refused, not charged for the first product", async () => {
  const { app, routes } = routeCollector();
  const db = fixture();
  registerOrderRoutes(app, { ...minimalDeps(db), requireAuth: () => (req, res, next) => next() });

  await assertRefused(routes, "/api/orders", {
    productId: "prod-yang-dihapus",
    variantId: "var-netflix-monthly",
    qty: 1,
    whatsapp: "628123456789",
  }, /tidak aktif untuk order/i);

  assert.equal(db.orders.length, 0, "an order was created against a product the caller never named");
  assert.equal(db.payments.length, 0, "and a payment record was written for it");
});

test("an order for a variantId that does not belong to the product is refused, not silently repriced", async () => {
  const { app, routes } = routeCollector();
  const db = fixture();
  registerOrderRoutes(app, { ...minimalDeps(db), requireAuth: () => (req, res, next) => next() });

  await assertRefused(routes, "/api/orders", {
    // A real product, but a variant id that was never in it -- the shape a
    // stale client sends after a catalog edit.
    productId: "prod-netflix",
    variantId: "var-spotify-monthly",
    qty: 1,
    whatsapp: "628123456789",
  }, /tidak aktif untuk order/i);

  assert.equal(db.orders.length, 0, "the customer would have been quoted a different plan than the one they picked");
});

test("the smoke test route refuses an unknown product instead of consuming stock for the first one", async () => {
  const { app, routes } = routeCollector();
  const db = fixture();
  registerOrderRoutes(app, { ...minimalDeps(db), requireAuth: () => (req, res, next) => next() });

  await assertRefused(routes, "/api/orders/smoke-test", {
    productId: "prod-yang-dihapus",
    variantId: "var-netflix-monthly",
    qty: 1,
  }, /tidak aktif untuk smoke test/i);

  assert.equal(db.orders.length, 0, "a smoke test consumed real stock from a product nobody asked for");
});

test("adding stock refuses an unknown product instead of filing the credentials under the first one", async () => {
  const { app, routes } = routeCollector();
  const db = fixture();
  registerStockRoutes(app, {
    getProduct: (currentDb, productId) => (currentDb.products || []).find((item) => item.id === productId),
    requireAuth: () => (req, res, next) => next(),
    updateDb: async (mutator) => mutator(db),
  });

  await assertRefused(routes, "/api/stock", {
    productId: "prod-yang-dihapus",
    variantId: "var-netflix-monthly",
    email: "akun@kavya.test",
    password: "rahasia",
  }, /Produk atau varian tidak valid/i);

  assert.equal(db.stock.length, 0, "credentials were filed under a product the owner never named");
});

test("no write route resolves a product or variant by taking the first entry of the array", async () => {
  // The four behavioural tests above each cover one call site. This one fails
  // the moment a fifth is added, including a future route that reintroduces the
  // fallback without anyone re-running this file.
  //
  // Comments are stripped first, because the fix quotes the pattern it removed
  // in order to explain why it is not allowed back.
  const { readFileSync } = await import("node:fs");
  const sources = ["../routes/order-routes.js", "../routes/stock-routes.js"].map((relative) => ({
    path: relative,
    code: readFileSync(new URL(relative, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, ""),
  }));

  for (const { path, code } of sources) {
    assert.doesNotMatch(
      code,
      /db\.products\s*\[\s*0\s*\]/,
      `${path} still resolves a write-path reference by falling back to the first product in the catalog`,
    );
    assert.doesNotMatch(
      code,
      /variants\s*\?\s*\[\s*0\s*\]/,
      `${path} still resolves a write-path reference by falling back to the first variant of the product`,
    );
  }
});
