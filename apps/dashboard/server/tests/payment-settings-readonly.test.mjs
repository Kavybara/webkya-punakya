import assert from "node:assert/strict";
import test from "node:test";

import { registerPaymentRoutes } from "../routes/payment-routes.js";
import { registerSettingsRoutes } from "../routes/settings-routes.js";

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

function handlerFor(routes, method, routePath) {
  const route = routes.find((item) => item.method === method && item.path === routePath);
  assert.ok(route, `${method.toUpperCase()} ${routePath} must be registered`);
  return route.handlers.at(-1);
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(payload) { this.payload = payload; return payload; },
  };
}

const requireAuth = (roles) => ({ roles });
const forbidden = (name) => () => {
  throw new Error(`${name} must not run during GET`);
};

test("authenticated and public payment GET read local snapshots only", async () => {
  const db = {
    payments: [{
      ref: "PAY-READ",
      orderId: "ORD-READ",
      provider: "pakasir",
      status: "pending",
      amount: 3000,
    }, {
      ref: "PAY-COMPLETED",
      orderId: "ORD-COMPLETED",
      provider: "pakasir",
      status: "paid",
      amount: 3000,
    }, {
      ref: "PAY-EXPIRED",
      orderId: "ORD-EXPIRED",
      provider: "pakasir",
      status: "expired",
      amount: 3000,
    }],
    orders: [{
      id: "ORD-READ",
      paymentRef: "PAY-READ",
      resellerId: "res-1",
      qrisStatus: "pending",
      orderStatus: "waiting_payment",
      deliveryStatus: "waiting_payment",
      reservedStockIds: ["stock-1"],
    }, {
      id: "ORD-COMPLETED",
      paymentRef: "PAY-COMPLETED",
      resellerId: "res-1",
      qrisStatus: "paid",
      orderStatus: "completed",
      deliveryStatus: "sent",
    }, {
      id: "ORD-EXPIRED",
      paymentRef: "PAY-EXPIRED",
      resellerId: "res-1",
      qrisStatus: "expired",
      orderStatus: "expired",
      deliveryStatus: "expired",
    }],
    stock: [{ id: "stock-1", status: "reserved", reservedFor: "ORD-READ" }],
    activities: [],
  };
  const before = JSON.stringify(db);
  const { app, routes } = routeCollector();
  registerPaymentRoutes(app, {
    requireAuth,
    readDbSnapshot: async () => clone(db),
    orderBelongsToReseller: () => true,
    findOrderForPublicTracking: (orders) => orders[0] || null,
    safePublicPayment: (payment, order) => ({ ref: payment.ref, status: payment.status, order }),
    safeTrackingPayment: (payment, order) => ({ ref: payment.ref, status: payment.status, orderId: order.id }),
    updateDb: forbidden("updateDb"),
    reconcilePakasirPaymentInDb: forbidden("provider reconciliation"),
    expirePendingOrders: forbidden("expiry"),
    fulfillPaidOrderAndNotify: forbidden("fulfillment"),
    sendWhatsAppMessage: forbidden("notification"),
    writeDb: forbidden("writeDb"),
  });

  const authenticated = response();
  await handlerFor(routes, "get", "/api/payments/:ref")(
    { auth: { role: "reseller", sub: "res-1" }, params: { ref: "PAY-READ" } },
    authenticated,
  );
  assert.equal(authenticated.statusCode, 200);
  assert.equal(authenticated.payload.status, "pending");

  const publicResult = response();
  await handlerFor(routes, "get", "/api/public/payments/:ref")(
    { params: { ref: "PAY-READ" }, query: { token: "valid-token" } },
    publicResult,
  );
  assert.equal(publicResult.statusCode, 200);
  assert.equal(publicResult.payload.status, "pending");

  const second = response();
  await handlerFor(routes, "get", "/api/payments/:ref")(
    { auth: { role: "reseller", sub: "res-1" }, params: { ref: "PAY-READ" } },
    second,
  );
  assert.deepEqual(second.payload, authenticated.payload);
  for (const [ref, status] of [["PAY-COMPLETED", "paid"], ["PAY-EXPIRED", "expired"]]) {
    const terminal = response();
    await handlerFor(routes, "get", "/api/payments/:ref")(
      { auth: { role: "reseller", sub: "res-1" }, params: { ref } },
      terminal,
    );
    assert.equal(terminal.statusCode, 200);
    assert.equal(terminal.payload.status, status);
  }
  assert.equal(JSON.stringify(db), before);
  assert.deepEqual(db.stock, [{ id: "stock-1", status: "reserved", reservedFor: "ORD-READ" }]);
});

test("Owner Settings GET normalizes its response without migration, provider, or writer calls", async () => {
  const db = {
    settings: {
      ownerName: "Kya",
      ownerEmail: "owner@example.com",
      unknownLegacyField: "preserve-me",
    },
    activities: [{ id: "act-existing" }],
  };
  const before = JSON.stringify(db);
  const { app, routes } = routeCollector();
  registerSettingsRoutes(app, {
    requireAuth,
    readDbSnapshot: async () => clone(db),
    maskedOwnerIntegrationSettings: (snapshot) => ({
      profile: { name: snapshot.settings.ownerName },
      status: { gmail: "disconnected" },
    }),
    updateDb: forbidden("updateDb"),
    validateGmailConnectionForStatus: forbidden("Gmail provider validation"),
    migrateSettings: forbidden("settings migration"),
    writeDb: forbidden("writeDb"),
  });

  const first = response();
  await handlerFor(routes, "get", "/api/owner-settings")(
    { auth: { role: "owner" } },
    first,
  );
  const second = response();
  await handlerFor(routes, "get", "/api/owner-settings")(
    { auth: { role: "owner" } },
    second,
  );

  assert.deepEqual(first.payload, second.payload);
  assert.equal(first.payload.profile.name, "Kya");
  assert.equal(JSON.stringify(db), before);
  assert.deepEqual(db.activities, [{ id: "act-existing" }]);
});

test("manual payment reconciliation remains an Owner-only mutation route", () => {
  const { app, routes } = routeCollector();
  registerPaymentRoutes(app, { requireAuth });
  const route = routes.find((item) => item.path === "/api/operations/payments/:orderId/reconcile");
  assert.ok(route);
  assert.equal(route.method, "post");
  assert.deepEqual(route.handlers[0].roles, ["owner"]);
});

test("normal Owner Settings update remains writable and audits sections without secret values", async () => {
  const db = { settings: { pakasirApiKey: "old-secret" }, activities: [] };
  const { app, routes } = routeCollector();
  registerSettingsRoutes(app, {
    requireAuth,
    nowText: () => "2026-07-26T10:00:00.000Z",
    mergeStoredSecret: (value, previous) => value || previous,
    maskedOwnerIntegrationSettings: (currentDb) => ({
      pakasir: {
        merchantId: currentDb.settings.pakasirMerchantId,
        apiKey: "[stored]",
        webhookSecret: "[stored]",
      },
    }),
    updateDb: async (mutator) => mutator(db),
  });
  const result = response();
  await handlerFor(routes, "put", "/api/owner-settings")({
    auth: { role: "owner", username: "owner" },
    body: {
      pakasir: {
        merchantId: "merchant-updated",
        apiKey: "new-api-secret",
        webhookSecret: "new-webhook-secret",
      },
    },
  }, result);

  assert.equal(result.statusCode, 200);
  assert.equal(db.settings.pakasirMerchantId, "merchant-updated");
  assert.equal(db.activities.length, 1);
  assert.match(db.activities[0].description, /pakasir/);
  assert.equal(JSON.stringify(db.activities[0]).includes("new-api-secret"), false);
  assert.equal(JSON.stringify(db.activities[0]).includes("new-webhook-secret"), false);
});
