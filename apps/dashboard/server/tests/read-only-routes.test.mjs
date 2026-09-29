import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { registerAccountRoutes } from "../routes/account-routes.js";
import { registerCatalogRoutes } from "../routes/catalog-routes.js";
import { registerOperationsRoutes } from "../routes/operations-routes.js";
import { registerOrderRoutes } from "../routes/order-routes.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function routeCollector() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
  }
  return { app, routes };
}

function response() {
  return {
    statusCode: 200,
    payload: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    },
  };
}

function handlerFor(routes, method, routePath) {
  const route = routes.find((item) => item.method === method && item.path === routePath);
  assert.ok(route, `${method.toUpperCase()} ${routePath} must be registered`);
  return route.handlers.at(-1);
}

const requireAuth = (roles) => ({ middleware: "requireAuth", roles });
const forbiddenMutation = () => {
  throw new Error("read route invoked a mutator");
};

test("operations, activities, and owner search use immutable snapshots", async () => {
  const original = {
    activities: [{ id: "act-1", title: "Existing", createdAt: "2026-01-01 00:00" }],
    archivedActivities: [{ id: "act-old", title: "Archived", createdAt: "2025-01-01 00:00" }],
    orders: [{ id: "ORD-1", orderStatus: "completed" }],
    stock: [{ id: "stock-1", status: "available" }],
    managedAccounts: [],
  };
  const before = JSON.stringify(original);
  const { app, routes } = routeCollector();
  registerOperationsRoutes(app, {
    requireAuth,
    readDbSnapshot: async () => clone(original),
    snapshotVersion: () => "snapshot-test",
    activityBelongsToReseller: () => true,
    buildOperationsAudit: async () => ({ checkedAt: "2026-07-26T00:00:00.000Z", manual: { items: [] } }),
    buildOwnerSearch: () => ({ groups: [] }),
    updateDb: forbiddenMutation,
    writeDb: forbiddenMutation,
    archiveOldActivities: forbiddenMutation,
  });

  const activities = response();
  await handlerFor(routes, "get", "/api/activities")({ auth: { role: "owner" }, query: {} }, activities);
  assert.deepEqual(activities.payload, original.activities);

  const archived = response();
  await handlerFor(routes, "get", "/api/activities")({ auth: { role: "owner" }, query: { scope: "archived" } }, archived);
  assert.deepEqual(archived.payload, original.archivedActivities);

  const operations = response();
  await handlerFor(routes, "get", "/api/operations/center")(
    { auth: { role: "owner" } },
    operations,
    (error) => {
      throw error;
    },
  );
  assert.equal(operations.payload.readOnly, true);
  assert.equal(operations.payload.snapshotVersion, "snapshot-test");
  assert.deepEqual(operations.payload.findings, []);

  const search = response();
  await handlerFor(routes, "get", "/api/owner-search")(
    { auth: { role: "owner" }, query: { q: "ORD-1" } },
    search,
  );
  assert.deepEqual(search.payload, { groups: [] });
  assert.equal(JSON.stringify(original), before);
});

test("order list and detail never invoke expiry or self-heal", async () => {
  const original = {
    orders: [{ id: "ORD-1", paymentRef: "PAY-1", resellerId: "res-1", orderStatus: "waiting_payment" }],
  };
  const before = JSON.stringify(original);
  const { app, routes } = routeCollector();
  registerOrderRoutes(app, {
    requireAuth,
    readDbSnapshot: async () => clone(original),
    orderBelongsToReseller: () => true,
    serializeOrderForApi: (_db, order) => ({ ...order }),
    expirePendingOrders: forbiddenMutation,
    updateDb: forbiddenMutation,
  });

  const list = response();
  await handlerFor(routes, "get", "/api/orders")({ auth: { role: "owner" } }, list);
  assert.equal(list.payload.length, 1);

  const detail = response();
  await handlerFor(routes, "get", "/api/orders/:id")(
    { auth: { role: "owner" }, params: { id: "ORD-1" } },
    detail,
  );
  assert.equal(detail.payload.id, "ORD-1");
  assert.equal(JSON.stringify(original), before);
});

test("managed account reads do not refresh Sheets or backfill records", async () => {
  const original = {
    managedAccounts: [{ id: "acc-1", resellerId: "res-1", status: "active" }],
    stock: [],
    orders: [],
    activities: [],
  };
  const before = JSON.stringify(original);
  const { app, routes } = routeCollector();
  registerAccountRoutes(app, {
    requireAuth,
    readDbSnapshot: async () => clone(original),
    visibleManagedAccountsForAuth: (db) => db.managedAccounts,
    accountStatusFromDate: () => "active",
    isTerminalManagedAccountStatus: () => false,
    stockForManagedAccount: () => null,
    orderForManagedAccount: () => null,
    buildAccountAuditTrail: () => [],
    refreshResellerViewFromGoogleSheets: forbiddenMutation,
    backfillManagedAccountsFromCompletedOrders: forbiddenMutation,
    updateDb: forbiddenMutation,
  });

  const list = response();
  await handlerFor(routes, "get", "/api/accounts")(
    { auth: { role: "reseller", sub: "res-1" }, query: {} },
    list,
  );
  assert.equal(list.payload.length, 1);

  const audit = response();
  await handlerFor(routes, "get", "/api/accounts/:id/audit")(
    { auth: { role: "owner" }, params: { id: "acc-1" } },
    audit,
  );
  assert.equal(audit.payload.accountId, "acc-1");
  assert.equal(JSON.stringify(original), before);
});

test("catalog and bootstrap read snapshots without running self-heal", async () => {
  const original = {
    products: [{ id: "product-1", name: "Product" }],
    whatsappRentals: [],
    whatsappGroupLists: [],
  };
  const before = JSON.stringify(original);

  const catalogRoutes = routeCollector();
  registerCatalogRoutes(catalogRoutes.app, {
    requireAuth,
    readDbSnapshot: async () => clone(original),
    publicCatalog: (db) => db.products,
    updateDb: forbiddenMutation,
  });
  const catalog = response();
  await handlerFor(catalogRoutes.routes, "get", "/api/public/catalog")({ query: {} }, catalog);
  assert.equal(catalog.payload[0].id, "product-1");

  const systemRoutes = routeCollector();
  registerSystemRoutes(systemRoutes.app, {
    requireAuth,
    readDbSnapshot: async () => clone(original),
    mergedWhatsappRentals: async () => [],
    readActiveLegacyGroupLists: async () => [],
    updateDb: forbiddenMutation,
  });
  const bootstrap = response();
  await handlerFor(systemRoutes.routes, "get", "/api/bootstrap")(
    { auth: { role: "owner" } },
    bootstrap,
  );
  assert.deepEqual(bootstrap.payload.whatsappRentals, []);
  assert.equal(JSON.stringify(original), before);
});

test("route modules statically keep readDbWithExpiredOrders out of GET read paths", async () => {
  const routeDir = path.resolve("server/routes");
  const files = [
    "operations-routes.js",
    "order-routes.js",
    "account-routes.js",
    "catalog-routes.js",
    "system-routes.js",
  ];
  for (const file of files) {
    const source = await readFile(path.join(routeDir, file), "utf8");
    assert.doesNotMatch(source, /readDbWithExpiredOrders/);
  }

  const operationsSource = await readFile(path.join(routeDir, "operations-routes.js"), "utf8");
  const operationsGetSection = operationsSource.split('app.post("/api/operations/actions/preview"')[0];
  assert.doesNotMatch(
    operationsGetSection,
    /\b(?:updateDb|writeDb|saveDb|archiveOldActivities|backfill|repair|reconcile|syncGoogleSheets)\s*\(/,
  );

  const accountSource = await readFile(path.join(routeDir, "account-routes.js"), "utf8");
  const accountList = accountSource.match(/app\.get\("\/api\/accounts"[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.ok(accountList);
  assert.doesNotMatch(accountList, /\b(?:updateDb|backfill|repair|reconcile|refreshResellerViewFromGoogleSheets)\s*\(/);
});
