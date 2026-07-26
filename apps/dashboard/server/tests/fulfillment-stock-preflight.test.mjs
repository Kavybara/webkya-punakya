import assert from "node:assert/strict";
import test from "node:test";

import { createFulfillmentNotificationService } from "../services/fulfillment-notification-service.js";

function service(overrides = {}) {
  return createFulfillmentNotificationService({
    activeResellerByWhatsapp: () => null,
    deleteWhatsAppMessage: async () => {},
    formatRupiah: (value) => String(value),
    fulfillPaidOrder: () => ({ ok: false, reply: "not configured" }),
    getProduct: () => null,
    isSheetBackedRecord: (stock) => stock.sheetSource === "google_sheets",
    isSmokeTestOrder: () => false,
    joinBotMessageLines: (lines) => lines.filter(Boolean).join("\n"),
    makeId: () => "act-test",
    nowText: () => "2026-07-26 12:00",
    pushFulfilledOrderToGoogleSheets: async () => ({ ok: true }),
    resellerDepositPaidMessage: () => "",
    sendWhatsAppMessage: async () => ({ ok: true }),
    syncGoogleSheetsStockSafely: async () => ({ ok: true }),
    syncSheetsForProductOrThrow: null,
    ...overrides,
  });
}

function fixture() {
  return {
    orders: [{
      id: "ORD-PREFLIGHT",
      qty: 1,
      qrisStatus: "paid",
      orderStatus: "processing",
      deliveryStatus: "paid",
      reservedStockIds: ["STOCK-1"],
      deliveredStockIds: [],
    }],
    stock: [{
      id: "STOCK-1",
      status: "reserved",
      reservedFor: "ORD-PREFLIGHT",
      sheetSource: "google_sheets",
    }],
    activities: [],
  };
}

test("force-syncs reserved Sheet stock before fulfillment and flags a changed row", async () => {
  const db = fixture();
  let fulfilled = false;
  const api = service({
    syncGoogleSheetsStockSafely: async (working) => {
      Object.assign(working.stock[0], {
        status: "blocked",
        accountCondition: "BERMASALAH",
      });
      delete working.stock[0].reservedFor;
      return { ok: true };
    },
    fulfillPaidOrder: () => {
      fulfilled = true;
      return { ok: false, order: db.orders[0], reply: "held" };
    },
  });

  await api.fulfillPaidOrderAndNotify(db, "ORD-PREFLIGHT");

  assert.equal(fulfilled, true);
  assert.equal(db.orders[0].holdOnStockUnavailable, true);
  assert.deepEqual(db.orders[0].stockConflictStockIds, ["STOCK-1"]);
});

test("holds delivery when the live Sheet preflight cannot be completed", async () => {
  const db = fixture();
  let fulfilled = false;
  const api = service({
    syncGoogleSheetsStockSafely: async () => ({ ok: false, error: "timeout" }),
    fulfillPaidOrder: () => {
      fulfilled = true;
      return { ok: true };
    },
  });

  const result = await api.fulfillPaidOrderAndNotify(db, "ORD-PREFLIGHT");

  assert.equal(fulfilled, false);
  assert.equal(result.ok, false);
  assert.equal(db.orders[0].deliveryStatus, "stock_recheck_failed");
  assert.equal(db.orders[0].orderStatus, "processing");
});

test("uses product-scoped preflight so unrelated Sheet failures do not block fulfillment", async () => {
  const db = fixture();
  db.orders[0].productId = "prod-viu";
  let fulfilled = false;
  let globalSyncCalled = false;
  const api = service({
    getProduct: () => ({ id: "prod-viu" }),
    syncSheetsForProductOrThrow: async () => ({
      ok: false,
      viu: { ok: true },
      resellers: { ok: false, reason: "duplicate_sheet_username" },
    }),
    syncGoogleSheetsStockSafely: async () => {
      globalSyncCalled = true;
      return { ok: false };
    },
    fulfillPaidOrder: () => {
      fulfilled = true;
      return { ok: false, order: db.orders[0], reply: "held" };
    },
  });

  await api.fulfillPaidOrderAndNotify(db, "ORD-PREFLIGHT");

  assert.equal(globalSyncCalled, false);
  assert.equal(fulfilled, true);
  assert.notEqual(db.orders[0].deliveryStatus, "stock_recheck_failed");
});

test("detects a Sheet condition conflict even when an earlier sync already cleared the reservation", async () => {
  const db = fixture();
  Object.assign(db.stock[0], {
    status: "blocked",
    accountCondition: "DIPERIKSA",
    accountConditionBlocked: true,
  });
  delete db.stock[0].reservedFor;
  let fulfilled = false;
  const api = service({
    syncGoogleSheetsStockSafely: async () => ({ ok: true }),
    fulfillPaidOrder: () => {
      fulfilled = true;
      return { ok: false, order: db.orders[0], reply: "held" };
    },
  });

  await api.fulfillPaidOrderAndNotify(db, "ORD-PREFLIGHT");

  assert.equal(fulfilled, true);
  assert.equal(db.orders[0].holdOnStockUnavailable, true);
  assert.deepEqual(db.orders[0].stockConflictStockIds, ["STOCK-1"]);
});
