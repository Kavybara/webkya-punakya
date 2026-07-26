import assert from "node:assert/strict";
import test from "node:test";

import { registerAuthRoutes } from "../routes/auth-routes.js";
import { registerAccountRoutes } from "../routes/account-routes.js";
import { registerCatalogRoutes } from "../routes/catalog-routes.js";
import { registerOperationsRoutes } from "../routes/operations-routes.js";
import { registerOrderRoutes } from "../routes/order-routes.js";
import { registerPaymentRoutes } from "../routes/payment-routes.js";
import { registerProductAdminRoutes } from "../routes/product-admin-routes.js";
import { registerResellerRoutes } from "../routes/reseller-routes.js";
import { registerSheetsRoutes } from "../routes/sheets-routes.js";
import { registerStockRoutes } from "../routes/stock-routes.js";
import { registerSettingsRoutes } from "../routes/settings-routes.js";
import { registerSystemRoutes } from "../routes/system-routes.js";
import { registerWhatsAppRoutes } from "../routes/whatsapp-routes.js";

function routeCollector() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (path, ...handlers) => {
      routes.push({ method, path, handlers });
    };
  }
  return { app, routes };
}

const requireAuth = (roles) => ({ middleware: "requireAuth", roles });

test("system route module keeps the existing endpoint contract", () => {
  const { app, routes } = routeCollector();
  registerSystemRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/health",
      "GET /api/maintenance",
      "POST /api/maintenance",
      "GET /api/bootstrap",
      "GET /api/events",
    ],
  );
  assert.deepEqual(routes[2].handlers[0].roles, ["owner"]);
  assert.deepEqual(routes[4].handlers[0].roles, ["owner", "reseller"]);
});

test("auth route module keeps the existing endpoint contract", () => {
  const { app, routes } = routeCollector();
  registerAuthRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "POST /api/auth/login",
      "GET /api/auth/session",
      "POST /api/auth/logout",
      "GET /api/auth/register/config",
      "POST /api/auth/register/request",
      "POST /api/auth/register/verify",
      "POST /api/auth/password-reset/request",
      "POST /api/auth/password-reset/verify",
      "POST /api/auth/password-reset/confirm",
      "POST /api/auth/change-password",
    ],
  );
  assert.deepEqual(routes[1].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[9].handlers[0].roles, ["owner", "reseller"]);
});

test("settings route module keeps owner, reseller, and OAuth boundaries", () => {
  const { app, routes } = routeCollector();
  registerSettingsRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/owner-profile",
      "PUT /api/owner-profile",
      "GET /api/owner-settings",
      "POST /api/owner-settings/validate",
      "PUT /api/owner-settings",
      "GET /api/resellers/deposit-instructions",
      "GET /api/gmail/oauth/start",
      "GET /api/gmail/oauth/callback",
    ],
  );
  assert.deepEqual(routes[0].handlers[0].roles, ["owner"]);
  assert.deepEqual(routes[4].handlers[0].roles, ["owner"]);
  assert.deepEqual(routes[5].handlers[0].roles, ["reseller"]);
  assert.equal(routes[7].handlers.length, 1);
});

test("catalog route module preserves public and owner-only endpoints", () => {
  const { app, routes } = routeCollector();
  registerCatalogRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/products",
      "GET /api/products/price-sync/preview",
      "POST /api/products/price-sync/apply",
      "GET /api/public/catalog",
      "POST /api/public/catalog/precheck",
      "GET /api/public/reseller-check",
    ],
  );
  assert.deepEqual(routes[0].handlers[0].roles, ["owner"]);
  assert.deepEqual(routes[2].handlers[0].roles, ["owner"]);
  assert.equal(routes[3].handlers.length, 1);
  assert.equal(routes[5].handlers.length, 1);
});

test("product admin route module remains owner-only", () => {
  const { app, routes } = routeCollector();
  registerProductAdminRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "POST /api/products",
      "PUT /api/products/:id",
      "POST /api/products/:id/lock",
      "POST /api/products/:id/variants/:variantId/lock",
      "GET /api/products/:id/variants/:variantId/delivery-template",
      "POST /api/products/:id/variants/:variantId/delivery-template/preview",
      "PUT /api/products/:id/variants/:variantId/delivery-template",
      "POST /api/products/:id/variants/:variantId/delivery-template/copy",
      "POST /api/products/:id/archive",
      "POST /api/products/:id/unarchive",
      "DELETE /api/products/:id",
    ],
  );
  for (const route of routes) assert.deepEqual(route.handlers[0].roles, ["owner"]);
});

test("reseller route module preserves self-service and owner boundaries", () => {
  const { app, routes } = routeCollector();
  registerResellerRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/resellers",
      "POST /api/resellers",
      "PUT /api/resellers/:id",
      "DELETE /api/resellers/:id",
      "POST /api/resellers/deposit-request",
      "GET /api/resellers/deposit-requests",
      "POST /api/resellers/deposit-requests/archive",
      "POST /api/resellers/deposit-requests/:id/approve",
      "POST /api/resellers/deposit-requests/:id/reject",
    ],
  );
  assert.deepEqual(routes[0].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[2].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[4].handlers[0].roles, ["reseller"]);
  for (const index of [1, 3, 5, 6, 7, 8]) assert.deepEqual(routes[index].handlers[0].roles, ["owner"]);
});

test("deposit request archive keeps reviewed history and rejects pending requests", async () => {
  const { app, routes } = routeCollector();
  const db = { depositRequests: [{ id: "dep-approved", status: "approved" }, { id: "dep-pending", status: "pending" }] };
  registerResellerRoutes(app, {
    requireAuth,
    nowText: () => "2026-07-21T10:00:00.000Z",
    updateDb: async (mutator) => mutator(db),
  });
  const route = routes.find((item) => item.path === "/api/resellers/deposit-requests/archive");
  const handler = route.handlers.at(-1);
  const payloads = [];
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { payloads.push(payload); return payload; } };

  await handler({ body: { ids: ["dep-approved"] } }, res);
  assert.equal(db.depositRequests[0].archivedAt, "2026-07-21T10:00:00.000Z");
  assert.equal(payloads[0].archived, 1);
  await assert.rejects(() => handler({ body: { ids: ["dep-pending"] } }, res), /masih menunggu tindakan/);
  assert.equal(db.depositRequests[1].archivedAt, undefined);
});

test("account route module preserves ownership and lookup permissions", () => {
  const { app, routes } = routeCollector();
  registerAccountRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/accounts/unread-delivery-count",
      "GET /api/accounts/:id/delivery",
      "POST /api/accounts/:id/delivery/opened",
      "POST /api/accounts/:id/delivery/copied",
      "GET /api/accounts/:id/audit",
      "GET /api/accounts",
      "POST /api/accounts",
      "PUT /api/accounts/:id",
      "POST /api/account-access/lookup",
      "DELETE /api/accounts/:id",
    ],
  );
  assert.deepEqual(routes[0].handlers[0].roles, ["reseller"]);
  assert.deepEqual(routes[1].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[2].handlers[0].roles, ["reseller"]);
  assert.deepEqual(routes[3].handlers[0].roles, ["reseller"]);
  assert.deepEqual(routes[5].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[8].handlers[0].roles, ["reseller"]);
  for (const index of [4, 6, 7, 9]) assert.deepEqual(routes[index].handlers[0].roles, ["owner"]);
});

test("account delivery endpoint rejects accounts owned by another reseller", async () => {
  const { app, routes } = routeCollector();
  const db = {
    managedAccounts: [
      {
        id: "acc-own",
        resellerId: "res-a",
        orderId: "ORD-A",
        email: "own@example.com",
        password: "own-secret",
        deliveryTemplateSnapshot: { status: "ready", renderedText: "own", templateVersion: 1 },
      },
      {
        id: "acc-other",
        resellerId: "res-b",
        orderId: "ORD-B",
        email: "other@example.com",
        password: "other-secret",
        deliveryTemplateSnapshot: { status: "ready", renderedText: "other", templateVersion: 1 },
      },
    ],
    activities: [],
  };
  registerAccountRoutes(app, {
    requireAuth,
    makeId: () => "act-test",
    nowText: () => "2026-07-26T10:00:00.000Z",
    readDbSnapshot: async () => JSON.parse(JSON.stringify(db)),
    updateDb: async (mutator) => mutator(db),
    visibleManagedAccountsForAuth: (currentDb, auth) => (
      currentDb.managedAccounts.filter((account) => auth.role === "owner" || account.resellerId === auth.sub)
    ),
  });
  const route = routes.find((item) => item.path === "/api/accounts/:id/delivery");
  const handler = route.handlers.at(-1);
  const response = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  });

  const denied = response();
  await handler({ auth: { role: "reseller", sub: "res-a" }, params: { id: "acc-other" } }, denied);
  assert.equal(denied.statusCode, 404);
  assert.equal(JSON.stringify(denied.payload).includes("other-secret"), false);

  const allowed = response();
  await handler({ auth: { role: "reseller", sub: "res-a" }, params: { id: "acc-own" } }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.payload.account.id, "acc-own");
  assert.equal(db.managedAccounts[0].deliveryTemplateUnreadAt, undefined);

  const openedRoute = routes.find((item) => item.path === "/api/accounts/:id/delivery/opened");
  const opened = response();
  await openedRoute.handlers.at(-1)({ auth: { role: "reseller", sub: "res-a" }, params: { id: "acc-own" } }, opened);
  assert.equal(opened.statusCode, 200);
  assert.equal(db.managedAccounts[0].deliveryTemplateUnreadAt, "");
  assert.equal(db.activities[0].description.includes("own-secret"), false);
});

test("Google Sheets route module remains owner-only", () => {
  const { app, routes } = routeCollector();
  registerSheetsRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/google-sheets/status",
      "GET /api/google-sheets/mapping-preview",
      "POST /api/google-sheets/netflix/template",
      "POST /api/google-sheets/template",
      "POST /api/google-sheets/sync",
      "POST /api/google-sheets/resellers/sync",
      "POST /api/google-sheets/preview",
      "POST /api/google-sheets/netflix/sync",
    ],
  );
  for (const route of routes) assert.deepEqual(route.handlers[0].roles, ["owner"]);
});

test("stock route module exposes only summaries to reseller", () => {
  const { app, routes } = routeCollector();
  registerStockRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/stock",
      "POST /api/stock",
      "PUT /api/stock/:id",
      "POST /api/stock/:id/release-reservation",
      "POST /api/stock/:id/assign-daily",
      "DELETE /api/stock/:id",
    ],
  );
  assert.deepEqual(routes[0].handlers[0].roles, ["owner", "reseller"]);
  for (const route of routes.slice(1)) assert.deepEqual(route.handlers[0].roles, ["owner"]);
});

test("operations route module preserves owner and reseller visibility", () => {
  const { app, routes } = routeCollector();
  registerOperationsRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/activities",
      "GET /api/operations/center",
      "GET /api/owner-search",
      "POST /api/operations/actions/preview",
      "POST /api/operations/actions/apply",
      "POST /api/operations/reseller/repair",
      "GET /api/system/status",
      "POST /api/system/restart",
    ],
  );
  assert.deepEqual(routes[0].handlers[0].roles, ["owner", "reseller"]);
  for (const route of routes.slice(1)) assert.deepEqual(route.handlers[0].roles, ["owner"]);
});

test("WhatsApp route module keeps owner APIs and token-authenticated bot APIs separate", () => {
  const { app, routes } = routeCollector();
  registerWhatsAppRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/whatsapp/status",
      "GET /api/whatsapp/rentals",
      "GET /api/whatsapp/rentals/:id/price-sync/preview",
      "POST /api/whatsapp/rentals/:id/price-sync/apply",
      "GET /api/whatsapp/group-lists",
      "POST /api/whatsapp/groups/sync",
      "POST /api/whatsapp/rentals",
      "PUT /api/whatsapp/rentals/:id",
      "POST /api/whatsapp/rentals/:id/adjust",
      "POST /api/whatsapp/inbound",
      "POST /api/whatsapp/orders/:id/payment-message",
    ],
  );
  for (const index of [0, 1, 2, 3, 4, 6, 7, 8]) {
    assert.deepEqual(routes[index].handlers[0].roles, ["owner"]);
  }
  for (const index of [5, 9, 10]) assert.equal(routes[index].handlers.length, 1);
});

test("payment route module preserves webhook, authenticated, and public boundaries", () => {
  const { app, routes } = routeCollector();
  registerPaymentRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "POST /api/pakasir/webhook",
      "GET /api/payments/:ref",
      "GET /api/public/payments/:ref",
      "POST /api/operations/payments/:orderId/reconcile",
    ],
  );
  assert.equal(routes[0].handlers.length, 1);
  assert.deepEqual(routes[1].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[3].handlers[0].roles, ["owner"]);
});

test("order route module requires verified public tracking and preserves privileged fulfillment actions", () => {
  const { app, routes } = routeCollector();
  registerOrderRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/orders",
      "GET /api/orders/:id",
      "POST /api/public/order-tracking",
      "GET /api/public/orders/:id",
      "POST /api/orders",
      "POST /api/orders/smoke-test",
      "POST /api/orders/:id/mark-paid",
      "POST /api/orders/:id/approve-manual",
      "POST /api/orders/:id/retry-delivery",
      "POST /api/orders/:id/delivery-template/rerender",
      "POST /api/orders/:id/repair-sheets",
    ],
  );
  for (const index of [0, 1, 4]) assert.deepEqual(routes[index].handlers[0].roles, ["owner", "reseller"]);
  assert.equal(routes[2].handlers.length, 1);
  assert.equal(routes[3].handlers.length, 1);
  for (const index of [5, 6, 7, 8, 9, 10]) assert.deepEqual(routes[index].handlers[0].roles, ["owner"]);
});
