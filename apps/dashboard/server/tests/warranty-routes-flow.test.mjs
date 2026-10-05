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
    replaceWarrantyAccount: options.replaceWarrantyAccount || replaceWarrantyAccount,
    replaceWarrantyAccountManually:
      options.replaceWarrantyAccountManually || (() => { throw new Error("not used"); }),
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
    /* The pre-replacement sheet read is the first await of a stock replace, so
     * it is where a test can park a replacement in flight and observe what a
     * second request for the same claim does while it waits. */
    syncSheetsForProductOrThrow: async () => {
      options.onSheetsSyncStart?.();
      if (options.holdSheetsSync) await options.holdSheetsSync;
    },
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
  const { res, done } = startRoute(harness, path, body);
  await done;
  return res;
}

/**
 * Fires a route without waiting for it.
 *
 * The in-flight guard only exists between two overlapping requests, so testing
 * it means holding one open while the other arrives. `await callRoute` cannot
 * express that -- it would wait for the first request to finish, which is the
 * one condition the guard is not about.
 */
function startRoute(harness, path, body = {}) {
  const route = harness.routes.find((item) => item.method === "post" && item.path === path);
  assert.ok(route, `route ${path} must exist`);
  const req = { params: { id: harness.db.warrantyClaims[0].id }, body, auth: { sub: "owner" } };
  const res = responseRecorder();
  return { res, done: route.handlers.at(-1)(req, res) };
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

/*
 * The two cases below are the guard's contract, and they pull in opposite
 * directions. Same mode must coalesce -- a retry of one operation should wait
 * for that operation, not run beside it. Different mode must refuse -- it is
 * not a retry of anything, and answering it with the other request's result
 * returns HTTP 200 and a body that looks right while the credentials the owner
 * just typed go nowhere.
 */

test("a second stock replace for the same claim joins the one already running", async () => {
  let releaseSync;
  let markStockParked;
  const heldSync = new Promise((resolve) => { releaseSync = resolve; });
  const stockParked = new Promise((resolve) => { markStockParked = resolve; });
  const harness = routeHarness({ holdSheetsSync: heldSync, onSheetsSyncStart: markStockParked });

  const first = startRoute(harness, "/api/warranty-claims/:id/replace", {
    stockId: "stock-new",
    reason: "Ganti akun rusak",
  });
  await stockParked;
  const second = startRoute(harness, "/api/warranty-claims/:id/replace", {
    stockId: "stock-new",
    reason: "Ganti akun rusak",
  });

  releaseSync();
  await Promise.all([first.done, second.done]);

  assert.equal(first.res.statusCode, 200);
  assert.equal(second.res.statusCode, 200);
  // One operation, not two: the joiner must not have replaced again.
  assert.equal(harness.db.managedAccounts.length, 2);
  // One replacement notifies twice -- the reseller on the warranted account,
  // then the owner (`warranty-routes.js:330` and `:333`). Asserting the
  // recipients rather than a bare count keeps this test honest if that fan-out
  // ever changes, and two pairs would be the signature of a second replace.
  assert.deepEqual(
    harness.deliveries.map((message) => message.to),
    ["628333333333", "6287777655549"],
  );
});

test("a manual replace arriving mid stock-replace is refused, not answered with the stock result", async () => {
  let releaseSync;
  let markStockParked;
  const heldSync = new Promise((resolve) => { releaseSync = resolve; });
  const stockParked = new Promise((resolve) => { markStockParked = resolve; });
  let manualReachedService = false;
  const harness = routeHarness({
    holdSheetsSync: heldSync,
    onSheetsSyncStart: markStockParked,
    replaceWarrantyAccountManually: () => {
      manualReachedService = true;
      throw new Error("manual replace must not run while a stock replace is in flight");
    },
  });

  const stock = startRoute(harness, "/api/warranty-claims/:id/replace", {
    stockId: "stock-new",
    reason: "Ganti akun rusak",
  });

  /* Wait until the stock replace is demonstrably parked inside its precheck
   * rather than assuming a tick is enough. Firing the manual request early
   * would still pass -- it would just be testing a different thing, and it
   * would stop testing this one the moment the handler gained an await. */
  await stockParked;

  const manual = startRoute(harness, "/api/warranty-claims/:id/replace-manual", {
    account: { email: "typed@example.test", password: "typed-secret" },
    reason: "Pemilik mengetik kredensial baru",
  });

  await assert.rejects(manual.done, (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "replacement_in_flight_other_mode");
    return true;
  });
  assert.equal(manualReachedService, false);

  releaseSync();
  await stock.done;

  // And the stock replace it collided with completed normally, untouched.
  assert.equal(stock.res.statusCode, 200);
  assert.equal(harness.db.managedAccounts.length, 2);
  assert.equal(harness.db.stock.find((item) => item.id === "stock-new").status, "sold");
});
