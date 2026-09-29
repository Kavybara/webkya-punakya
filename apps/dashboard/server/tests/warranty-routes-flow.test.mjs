import assert from "node:assert/strict";
import test from "node:test";

import { registerWarrantyRoutes } from "../routes/warranty-routes.js";
import {
  createWarrantyClaim,
  replaceWarrantyAccount,
  validateWarrantyReplacementState,
} from "../services/warranty-service.js";

function fixture() {
  return {
    products: [{
      id: "prod-netflix",
      name: "Netflix Premium",
      variants: [{ id: "variant-1u", code: "NET-1U", name: "Sharing 1P1U" }],
    }],
    resellers: [{ id: "reseller-a", username: "nadia", whatsapp: "628111111111" }],
    orders: [{
      id: "ORD-WARRANTY-1",
      resellerId: "reseller-a",
      productId: "prod-netflix",
      variantId: "variant-1u",
      whatsapp: "628333333333",
      deliveredStockIds: ["stock-old"],
      duration: "1 Bulan",
      durationDays: 30,
    }],
    stock: [
      {
        id: "stock-old",
        productId: "prod-netflix",
        variantId: "variant-1u",
        stockPoolKey: "prod-netflix::netflix-1p1u",
        sheetPool: "NETFLIX_SHARED",
        sheetName: "Netflix",
        sheetRow: 10,
        email: "old@example.test",
        password: "old-secret",
        profile: "Caramel",
        status: "sold",
        accountCondition: "NORMAL",
      },
      {
        id: "stock-new",
        productId: "prod-netflix",
        variantId: "variant-1u",
        stockPoolKey: "prod-netflix::netflix-1p1u",
        sheetPool: "NETFLIX_SHARED",
        sheetName: "Netflix",
        sheetRow: 11,
        email: "new@example.test",
        password: "new-secret",
        profile: "Pretzel",
        status: "available",
        accountCondition: "NORMAL",
      },
    ],
    managedAccounts: [{
      id: "account-old",
      stockId: "stock-old",
      orderId: "ORD-WARRANTY-1",
      sourceOrderId: "ORD-WARRANTY-1",
      resellerId: "reseller-a",
      whatsapp: "628333333333",
      product: "Netflix Premium",
      productId: "prod-netflix",
      variant: "Sharing 1P1U",
      variantId: "variant-1u",
      stockPoolKey: "prod-netflix::netflix-1p1u",
      email: "old@example.test",
      password: "old-secret",
      profile: "Caramel",
      startedAt: "2026-08-01 10:00",
      expiresAt: "2026-08-31 10:00",
      duration: "1 Bulan",
      durationDays: 30,
      status: "active",
      sheetSource: "google_sheets",
      sheetName: "Netflix",
      sheetPool: "NETFLIX_SHARED",
      sheetRow: 10,
    }],
    warrantyClaims: [],
    activities: [],
  };
}

function routeHarness(options = {}) {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "patch"]) {
    app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
  }
  const db = fixture();
  let id = 0;
  const nowText = () => "2026-08-03 12:00";
  const makeId = (prefix) => `${prefix}-${++id}`;
  createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: nowText,
    makeId,
  });
  const deliveries = [];
  let syncCalls = 0;
  const deps = {
    buildWarrantyOwnerNotification: () => "owner claim",
    buildWarrantyReplacementNotifications: () => ({ reseller: "replacement recipient", owner: "replacement owner" }),
    buildWarrantyStatusNotification: () => "status",
    createWarrantyClaim,
    decodeWarrantyEvidence: () => null,
    makeId,
    markWarrantyReplacementSync(currentDb, input) {
      const claim = currentDb.warrantyClaims.find((item) => item.id === input.claimId);
      claim.replacementSyncStatus = input.status;
      claim.replacementSyncError = input.error || "";
      return claim;
    },
    nowText,
    primaryResellerWhatsapp: (reseller) => reseller.whatsapp || "",
    readDbSnapshot: async () => structuredClone(db),
    refreshOrderDeliveryTemplateSnapshot: () => "",
    replacementCandidatesForClaim: () => [],
    replaceWarrantyAccount,
    replaceWarrantyAccountManually: () => { throw new Error("not used"); },
    requireAuth: () => (_req, _res, next) => next?.(),
    saveWarrantyEvidence: async () => null,
    sendWhatsAppMessage: async (_db, message) => {
      deliveries.push(message);
      return { sent: true, messageKey: `msg-${deliveries.length}` };
    },
    syncAccountReplacementToGoogleSheets: async () => {
      syncCalls += 1;
      if (options.driftAfterSync) {
        db.orders[0].deliveredStockIds = ["stock-old", "stock-new"];
        db.stock.find((item) => item.id === "stock-old").status = "sold";
        db.stock.find((item) => item.id === "stock-old").accountCondition = "NORMAL";
        db.stock.find((item) => item.id === "stock-new").status = "available";
      }
      return options.firstSyncFails && syncCalls === 1
        ? { ok: false, reason: "temporary_sheet_error" }
        : { ok: true, updated: 2 };
    },
    syncWarrantyStockReviewToGoogleSheets: async () => ({ ok: true }),
    syncSheetsForProductOrThrow: async () => undefined,
    updateDb: async (mutator) => mutator(db),
    updateWarrantyClaim: () => { throw new Error("not used"); },
    validateWarrantyReplacementState,
    warrantyClaimsForAuth: () => [],
    warrantyManualClaimOptions: () => [],
    warrantyWhatsAppNumber: () => "6287777655549",
  };
  registerWarrantyRoutes(app, deps);
  return { db, deliveries, get syncCalls() { return syncCalls; }, routes };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function callRoute(harness, path, body = {}) {
  const route = harness.routes.find((item) => item.method === "post" && item.path === path);
  assert.ok(route, `route ${path} must exist`);
  const req = { params: { id: harness.db.warrantyClaims[0].id }, body, auth: { sub: "owner" } };
  const res = responseRecorder();
  await route.handlers.at(-1)(req, res);
  return res;
}

test("replacement notifies the WhatsApp number attached to the warranted account", async () => {
  const harness = routeHarness();
  const response = await callRoute(harness, "/api/warranty-claims/:id/replace", {
    stockId: "stock-new",
    reason: "Ganti akun rusak",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(harness.deliveries[0].to, "628333333333");
  assert.equal(response.body.notifications.recipient.status, "sent");
  assert.equal(response.body.claim.replacementNotificationStatus, "sent");
});

test("replacement retries one transient Sheets failure before reporting failure", async () => {
  const harness = routeHarness({ firstSyncFails: true });
  const response = await callRoute(harness, "/api/warranty-claims/:id/replace", {
    stockId: "stock-new",
    reason: "Ganti akun rusak",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(harness.syncCalls, 2);
  assert.equal(response.body.claim.replacementSyncStatus, "synced");
});

test("successful retry repairs stale order and stock relations before final validation", async () => {
  const harness = routeHarness({ driftAfterSync: true });
  const response = await callRoute(harness, "/api/warranty-claims/:id/replace", {
    stockId: "stock-new",
    reason: "Ganti akun rusak",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(harness.db.orders[0].deliveredStockIds, ["stock-new"]);
  assert.equal(harness.db.stock.find((item) => item.id === "stock-old").status, "blocked");
  assert.equal(harness.db.stock.find((item) => item.id === "stock-old").accountCondition, "REPLACED");
  assert.equal(harness.db.stock.find((item) => item.id === "stock-new").status, "sold");
});

test("failed or missed replacement notification can be sent again without replacing twice", async () => {
  const harness = routeHarness();
  await callRoute(harness, "/api/warranty-claims/:id/replace", {
    stockId: "stock-new",
    reason: "Ganti akun rusak",
  });
  harness.db.warrantyClaims[0].replacementNotificationStatus = "failed";
  harness.db.warrantyClaims[0].replacementNotificationError = "whatsapp_bot_timeout";
  harness.deliveries.length = 0;

  const response = await callRoute(harness, "/api/warranty-claims/:id/retry-notification");

  assert.equal(response.statusCode, 200);
  assert.equal(harness.deliveries[0].to, "628333333333");
  assert.equal(response.body.claim.replacementNotificationStatus, "sent");
  assert.equal(harness.db.managedAccounts.length, 2);
});
