import assert from "node:assert/strict";
import test from "node:test";

import { registerStockRoutes } from "../routes/stock-routes.js";

function routeCollector() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
  }
  return { app, routes };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
}

/*
 * Only the deps the GET /api/stock handler actually reads are real here. The
 * write routes are registered alongside it, so the rest are inert stubs --
 * registration destructures every dep up front and would throw without them.
 */
function fixture(db, role = "owner") {
  const noop = async () => undefined;
  const { app, routes } = routeCollector();
  const products = db.products || [];
  registerStockRoutes(app, {
    requireAuth: () => (_req, _res, next) => next(),
    readDb: async () => db,
    updateDb: noop,
    getProduct: (source, id) => products.find((item) => item.id === id) || null,
    getVariant: (source, productId, variantId) => (
      products.find((item) => item.id === productId)?.variants?.find((item) => item.id === variantId) || null
    ),
    isCanvaProduct: () => false,
    /*
     * A pool with a quota and nothing claimed against it has every seat free.
     * That is the shape the overview counts, so the stub is the real thing: the
     * bug under test is that the row never carried the number, not that the
     * number was computed wrongly.
     */
    linkPoolAvailableCount: (_source, pool) => Math.max(0, Number(pool.quota || 0)),
    buildDailyStockAssignment: noop,
    createdAtMs: () => 0,
    makeId: () => "id",
    normalizeWhatsappNumber: (value) => String(value || ""),
    notifyResellerAccountChanged: noop,
    nowText: () => "",
    pushAccountsToGoogleSheets: noop,
    syncCredentialsToSheetsSafely: noop,
    syncPasswordByEmail: () => ({ affectedAccounts: [] }),
    todayText: () => "",
  });
  const route = routes.find((item) => item.method === "get" && item.path === "/api/stock");
  assert.ok(route, "GET /api/stock is not registered");
  return route;
}

async function invoke(route, req = {}) {
  const res = response();
  let nextError = null;
  const next = (error) => { nextError = error || null; };
  for (const handler of route.handlers) {
    await handler(req, res, next);
    if (res.payload !== null) return res;
    if (nextError) throw nextError;
  }
  return res;
}

function dbWithPools() {
  return {
    stock: [],
    products: [{
      id: "prd_1",
      name: "Netflix",
      variants: [{ id: "var_1", name: "1 Bulan", code: "NF-1M" }],
    }],
    linkPools: [
      { id: "pool_1", productId: "prd_1", variantId: "var_1", link: "https://a", poolKey: "A", quota: 10 },
      { id: "pool_2", productId: "prd_1", variantId: "var_1", link: "https://b", poolKey: "B", quota: 4 },
    ],
  };
}

/*
 * The overview counts stock with `Math.max(1, Number(item.availableCount || 1))`,
 * so a row that omits `availableCount` silently counts as exactly one account.
 * A pool is one row standing for many accounts, which meant a pool holding ten
 * unclaimed seats undercounted "Stok siap" by nine -- on the one tile whose
 * whole job is that number, and it never looked wrong enough to report.
 */
test("an owner sees each pool's real seat count, not one per row", async () => {
  const route = fixture(dbWithPools());

  const res = await invoke(route, { auth: { role: "owner" }, query: {} });

  assert.equal(res.statusCode, 200);
  const counts = res.payload.map((row) => row.availableCount);
  assert.deepEqual(counts, [10, 4]);
  const total = counts.reduce((sum, value) => sum + Number(value || 1), 0);
  assert.equal(total, 14, "14 free seats must not be reported as 2");
});

test("a pool row carries the count the reseller branch has always sent", async () => {
  const route = fixture(dbWithPools());

  const res = await invoke(route, { auth: { role: "owner" }, query: {} });

  const poolRow = res.payload.find((row) => row.id === "pool_1");
  assert.equal(poolRow.stockType, "link_pool");
  assert.equal(poolRow.availableCount, 10);
  // `Math.max(1, x || 1)` is the overview's floor. A pool only reaches the
  // response when it has a free seat, so the floor never has to rescue it.
  assert.ok(poolRow.availableCount >= 1, "a listed pool row must count for at least one account");
});

/*
 * The empty and full cases are the ones that would hide a regression: a pool
 * with nothing free is filtered out upstream, and one with a single free seat
 * is indistinguishable from the old `1`. Both are pinned so the count cannot
 * quietly fall back to "one row, one account".
 */
test("a pool with one free seat reports one, and a full pool is filtered out", async () => {
  const db = dbWithPools();
  db.linkPools[0].quota = 1;
  db.linkPools[1].quota = 0;

  const res = await invoke(fixture(db), { auth: { role: "owner" }, query: {} });

  assert.equal(res.payload.length, 1);
  assert.equal(res.payload[0].id, "pool_1");
  assert.equal(res.payload[0].availableCount, 1);
});

test("the owner and reseller branches agree on what a pool is worth", async () => {
  const db = dbWithPools();

  const owner = await invoke(fixture(db), { auth: { role: "owner" }, query: {} });
  const reseller = await invoke(fixture(db), { auth: { role: "reseller" }, query: { status: "all" } });

  const ownerTotal = owner.payload.reduce((sum, row) => sum + Number(row.availableCount || 1), 0);
  const resellerTotal = reseller.payload.reduce((sum, row) => sum + Number(row.availableCount || 1), 0);
  assert.equal(
    ownerTotal,
    resellerTotal,
    "the two roles see different stock totals for the same inventory",
  );
});

test("non-pool stock rows keep counting as one account each", async () => {
  const db = dbWithPools();
  db.stock = [{ id: "stk_1", productId: "prd_1", variantId: "var_1", email: "a@b.c", status: "available" }];

  const res = await invoke(fixture(db), { auth: { role: "owner" }, query: {} });

  const stockRow = res.payload.find((row) => row.id === "stk_1");
  assert.equal(stockRow.stockType, undefined);
  assert.ok(Number(stockRow.availableCount || 1) === 1, "a single account must count as one");
});