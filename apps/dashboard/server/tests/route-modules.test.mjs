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
import { registerWarrantyRoutes } from "../routes/warranty-routes.js";

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

test("warranty routes separate reseller claims from owner replacement actions", () => {
  const { app, routes } = routeCollector();
  registerWarrantyRoutes(app, { requireAuth });

  assert.deepEqual(
    routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    [
      "GET /api/warranty-claims",
      "GET /api/warranty-claims/manual-options",
      "POST /api/warranty-claims",
      "GET /api/warranty-claims/:id/evidence/:evidenceId",
      "PATCH /api/warranty-claims/:id",
      "POST /api/warranty-claims/:id/retry-stock-review-sync",
      "GET /api/warranty-claims/:id/replacement-candidates",
      "POST /api/warranty-claims/:id/retry-notification",
      "POST /api/warranty-claims/:id/replace",
      "POST /api/warranty-claims/:id/replace-manual",
    ],
  );
  assert.deepEqual(routes[0].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[1].handlers[0].roles, ["owner"]);
  assert.deepEqual(routes[2].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[3].handlers[0].roles, ["owner", "reseller"]);
  for (const index of [4, 5, 6, 7, 8, 9]) assert.deepEqual(routes[index].handlers[0].roles, ["owner"]);
});

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
      "GET /api/owner/account-access/accounts",
      "POST /api/owner/account-access/lookup",
      "POST /api/account-access/lookup",
      "DELETE /api/accounts/:id",
    ],
  );
  assert.deepEqual(routes[0].handlers[0].roles, ["reseller"]);
  assert.deepEqual(routes[1].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[2].handlers[0].roles, ["reseller"]);
  assert.deepEqual(routes[3].handlers[0].roles, ["reseller"]);
  assert.deepEqual(routes[5].handlers[0].roles, ["owner", "reseller"]);
  assert.deepEqual(routes[10].handlers[0].roles, ["reseller"]);
  for (const index of [4, 6, 7, 8, 9, 11]) assert.deepEqual(routes[index].handlers[0].roles, ["owner"]);
});

test("owner account access can lookup every visible account without reseller tool permissions", async () => {
  const { app, routes } = routeCollector();
  const db = {
    managedAccounts: [{ id: "acc-owner", email: "owner-access@example.com", product: "Netflix", status: "active" }],
  };
  const refreshCalls = [];
  const activityCalls = [];
  registerAccountRoutes(app, {
    requireAuth,
    readDbSnapshot: async () => db,
    updateDb: async (mutator) => mutator(db),
    visibleManagedAccountsForAuth: () => db.managedAccounts,
    isNetflixManagedAccount: (account) => account.product === "Netflix",
    isDisneyManagedAccount: (account) => account.product === "Disney",
    refreshResellerViewFromGoogleSheets: async (_db, auth, reason, options) => {
      refreshCalls.push({ auth, reason, options });
    },
    findAccountForLookup: (_db, auth, email) => (
      auth.role === "owner" && email === "owner-access@example.com" ? db.managedAccounts[0] : null
    ),
    findDisneyAccountForLookup: () => null,
    accountStatusFromDate: () => "active",
    isTerminalManagedAccountStatus: () => false,
    lookupAccountAccessValue: async () => ({ source: "gmail", kind: "code", value: "123456" }),
    gmailConnectionInfo: () => ({ connected: true }),
    isGmailOAuthInvalidError: () => false,
    appendAccessLookupActivity: (_db, auth, payload) => activityCalls.push({ auth, payload }),
    safeAccountForAccess: (account) => ({ id: account.id, email: account.email, product: account.product, status: account.status }),
    nowText: () => "2026-08-03T12:00:00.000Z",
  });

  const route = routes.find((item) => item.path === "/api/owner/account-access/lookup");
  const handler = route.handlers.at(-1);
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
  let routedError = null;
  await handler({ auth: { role: "owner", sub: "owner" }, body: { type: "verification", email: "owner-access@example.com" } }, res, (error) => { routedError = error; });

  assert.equal(routedError, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.result.value, "123456");
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].reason, "owner_lookup_refresh");
  assert.equal(refreshCalls[0].options.allowOwner, true);
  assert.equal(activityCalls[0].auth.role, "owner");

  const listRoute = routes.find((item) => item.path === "/api/owner/account-access/accounts");
  const listResponse = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
  await listRoute.handlers.at(-1)({ auth: { role: "owner", sub: "owner" }, query: { provider: "netflix" } }, listResponse);
  assert.equal(listResponse.payload.length, 1);
  assert.equal(listResponse.payload[0].email, "owner-access@example.com");
  assert.equal("password" in listResponse.payload[0], false);
  assert.equal("pin" in listResponse.payload[0], false);
});

test("account access reports a failed Gmail connection as disconnected", async () => {
  const { app, routes } = routeCollector();
  const db = {};
  registerAccountRoutes(app, {
    requireAuth,
    updateDb: async (mutator) => mutator(db),
    refreshResellerViewFromGoogleSheets: async () => undefined,
    authReseller: () => ({ id: "res-a", isActive: true }),
    resellerAccessTools: () => ["verification"],
    findAccountForLookup: () => ({ id: "acc-a", email: "buyer@example.com", status: "active" }),
    historicalAccountForLookup: () => null,
    accountStatusFromDate: () => "active",
    isTerminalManagedAccountStatus: () => false,
    lookupAccountAccessValue: async () => ({
      source: "gmail",
      kind: "code",
      value: "",
      reason: "gmail_error",
      error: "Kredensial Gmail ditolak. Perbarui koneksi Gmail melalui panel Owner.",
    }),
    gmailConnectionInfo: () => ({ connected: true, mode: "imap", needsOAuth: false }),
    isGmailOAuthInvalidError: () => false,
    appendAccessLookupActivity: () => undefined,
    safeAccountForAccess: (account) => ({ id: account.id, email: account.email }),
    nowText: () => "2026-08-03T12:00:00.000Z",
  });

  const route = routes.find((item) => item.path === "/api/account-access/lookup");
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
  await route.handlers.at(-1)({
    auth: { role: "reseller", sub: "res-a" },
    body: { type: "verification", email: "buyer@example.com" },
  }, res, () => undefined);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.gmail.connected, false);
  assert.equal(res.payload.gmail.mode, "imap");
  assert.equal(res.payload.gmail.needsOAuth, false);
  assert.match(res.payload.gmail.error, /Kredensial Gmail ditolak/);
});

test("Netflix account access refresh is wired for sign-in, verification, and household", async () => {
  const { app, routes } = routeCollector();
  const refreshCalls = [];
  const db = {};
  registerAccountRoutes(app, {
    requireAuth,
    updateDb: async (mutator) => mutator(db),
    refreshResellerViewFromGoogleSheets: async (_db, _auth, reason, options) => {
      refreshCalls.push({ reason, options });
    },
    authReseller: () => ({ id: "res-a", isActive: true }),
    resellerAccessTools: () => ["signin", "verification", "household"],
    findAccountForLookup: () => ({ id: "acc-a", email: "buyer@example.com", status: "active" }),
    historicalAccountForLookup: () => null,
    accountStatusFromDate: () => "active",
    isTerminalManagedAccountStatus: () => false,
    lookupAccountAccessValue: async (_db, _account, type) => ({
      source: "gmail",
      kind: type === "household" ? "link" : "code",
      value: type === "household" ? "https://www.netflix.com/account/update-primary-location" : type === "signin" ? "1234" : "123456",
    }),
    gmailConnectionInfo: () => ({ connected: true }),
    isGmailOAuthInvalidError: () => false,
    appendAccessLookupActivity: () => undefined,
    safeAccountForAccess: (account) => ({ id: account.id, email: account.email }),
    nowText: () => "2026-07-31T20:00:00.000Z",
  });
  const route = routes.find((item) => item.path === "/api/account-access/lookup");
  const handler = route.handlers.at(-1);

  for (const type of ["signin", "verification", "household"]) {
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return payload; },
    };
    let routedError = null;
    await handler({
      auth: { role: "reseller", sub: "res-a" },
      body: { type, email: "buyer@example.com" },
    }, res, (error) => { routedError = error; });
    assert.equal(routedError, null, type);
    assert.equal(res.statusCode, 200, type);
    assert.equal(res.payload.type, type);
    assert.ok(res.payload.result.value, type);
  }

  assert.equal(refreshCalls.length, 3);
  for (const call of refreshCalls) {
    assert.equal(call.reason, "reseller_lookup_refresh");
    assert.deepEqual(call.options.requiredSections, ["netflix", "resellers"]);
    assert.equal(call.options.throwOnFailure, true);
  }
});

test("account access hides unexpected internal errors", async () => {
  const { app, routes } = routeCollector();
  registerAccountRoutes(app, {
    requireAuth,
    updateDb: async (mutator) => mutator({}),
    refreshResellerViewFromGoogleSheets: async () => {
      throw new ReferenceError("internalFunctionName is not defined");
    },
  });
  const route = routes.find((item) => item.path === "/api/account-access/lookup");
  const handler = route.handlers.at(-1);
  let routedError = null;
  await handler({
    auth: { role: "reseller", sub: "res-a" },
    body: { type: "verification", email: "buyer@example.com" },
  }, {}, (error) => { routedError = error; });
  assert.equal(routedError?.status, 503);
  assert.equal(routedError?.message, "Akses akun sedang tidak dapat diperbarui. Coba lagi.");
  assert.doesNotMatch(routedError?.message || "", /internalFunctionName|not defined/i);
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
        pin: "1111",
        deliveryTemplateSnapshot: { status: "ready", renderedText: "own", templateVersion: 1 },
      },
      {
        id: "acc-expired",
        resellerId: "res-a",
        orderId: "ORD-X",
        email: "expired@example.com",
        password: "expired-secret",
        pin: "2222",
        status: "expired",
        deliveryTemplateSnapshot: { status: "ready", renderedText: "expired-secret", templateVersion: 1 },
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
    accountStatusFromDate: (_expiresAt, _durationDays) => "active",
    isTerminalManagedAccountStatus: (status = "") => ["expired", "replaced", "disabled"].includes(String(status).toLowerCase()),
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

  const expired = response();
  await handler({ auth: { role: "reseller", sub: "res-a" }, params: { id: "acc-expired" } }, expired);
  assert.equal(expired.statusCode, 200);
  assert.equal(expired.payload.account.email, "");
  assert.equal(expired.payload.account.password, "");
  assert.equal(expired.payload.account.pin, "");
  assert.equal(expired.payload.deliveryTemplateSnapshot, null);
  assert.equal(JSON.stringify(expired.payload).includes("expired-secret"), false);

  const listRoute = routes.find((item) => item.path === "/api/accounts");
  const list = response();
  await listRoute.handlers.at(-1)({ auth: { role: "reseller", sub: "res-a" } }, list);
  const listedExpired = list.payload.find((account) => account.id === "acc-expired");
  assert.equal(listedExpired.email, "");
  assert.equal(listedExpired.password, "");
  assert.equal(listedExpired.pin, "");

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
      "GET /api/whatsapp/rentals/:id/list-history",
      "POST /api/whatsapp/groups/sync-now",
      "POST /api/whatsapp/groups/sync",
      "POST /api/whatsapp/rentals",
      "PUT /api/whatsapp/rentals/:id",
      "POST /api/whatsapp/rentals/:id/adjust",
      "POST /api/whatsapp/inbound",
      "POST /api/whatsapp/orders/:id/payment-message",
    ],
  );
  /*
   * Both sync routes appear in the list above, and only one of them is
   * owner-guarded. `sync-now` is the owner asking the bot to go look; `sync` is
   * the bot reporting what it found, authenticating on the inbound token inside
   * its own handler. They are different directions and must stay that way.
   */
  for (const index of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10]) {
    assert.deepEqual(routes[index].handlers[0].roles, ["owner"]);
  }
  for (const index of [7, 11, 12]) assert.equal(routes[index].handlers.length, 1);
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
