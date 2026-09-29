import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDeliveryAuditAccounts,
  classifySheetPushResult,
  deliveryAuditCoverage,
  findLinkedSheetStock,
  hasHistoricalDeliveryEvidence,
  hasOnlyHistoricalManagedAssignment,
  isCreditedStockUnavailableOrder,
  isDeliverableManagedAccount,
  isSheetBackedRecord,
} from "../services/sheet-sync-status-service.js";

test("stale Sheet order link is repairable only when its exact prior assignment is terminal", () => {
  const stockId = "stock-reused";
  const oldOrderId = "ORD-OLD";
  assert.equal(hasOnlyHistoricalManagedAssignment([
    {
      stockId,
      orderId: oldOrderId,
      status: "expired",
      hidden: true,
      returnedToStockAt: "2026-07-30 10:00",
    },
  ], stockId, oldOrderId), true);

  assert.equal(hasOnlyHistoricalManagedAssignment([
    {
      stockId,
      orderId: oldOrderId,
      status: "active",
      hidden: false,
    },
  ], stockId, oldOrderId), false);

  assert.equal(hasOnlyHistoricalManagedAssignment([], stockId, oldOrderId), false);
});

test("a skipped write cannot count as synced for Sheets-backed stock", () => {
  assert.deepEqual(
    classifySheetPushResult({ ok: true, skipped: true, reason: "no_sheet_rows" }, { required: true }),
    { status: "failed", error: "no_sheet_rows" },
  );
});

test("a real Sheets update is synced", () => {
  assert.deepEqual(
    classifySheetPushResult({ ok: true, updated: 1 }, { required: true }),
    { status: "synced", error: "" },
  );
});

test("non-Sheets records may legitimately skip a Sheets write", () => {
  assert.deepEqual(
    classifySheetPushResult({ ok: true, skipped: true, reason: "no_sheet_rows" }),
    { status: "skipped", error: "" },
  );
});

test("row mapping identifies a Sheets-backed record even when source metadata is missing", () => {
  assert.equal(isSheetBackedRecord({ sheetStockKey: "Vidio#42", sheetRow: 42 }), true);
  assert.equal(isSheetBackedRecord({ sheetSource: "google_sheets" }), true);
  assert.equal(isSheetBackedRecord({ sheetStockKey: "", sheetRow: 0 }), false);
});

test("empty sheet keys cannot link an account to an unrelated stock", () => {
  const stocks = [
    { id: "wrong-stock" },
    { id: "vidio-stock", sheetStockKey: "VIDIO:4" },
  ];
  assert.equal(findLinkedSheetStock(stocks, { stockId: "vidio-stock" })?.id, "vidio-stock");
  assert.equal(findLinkedSheetStock(stocks, { stockId: "missing", sheetStockKey: "" }), null);
  assert.equal(findLinkedSheetStock(stocks, { sheetStockKey: "VIDIO:4" })?.id, "vidio-stock");
});

test("terminal managed-account records cannot count as delivered accounts", () => {
  assert.equal(isDeliverableManagedAccount({ status: "active" }), true);
  assert.equal(isDeliverableManagedAccount({ status: "replaced" }), false);
  assert.equal(isDeliverableManagedAccount({ status: "expired" }), false);
  assert.equal(isDeliverableManagedAccount({ status: "active", returnedToStockAt: "2026-07-19 06:12" }), false);
  assert.equal(isDeliverableManagedAccount({ status: "active", hidden: true }), false);
});

test("delivery audit keeps historical evidence but only counts active accounts for double-drop checks", () => {
  const result = classifyDeliveryAuditAccounts([
    { id: "old", stockId: "stock-old", status: "replaced", hidden: true },
    { id: "current", stockId: "stock-current", status: "active" },
    { id: "current-copy", stockId: "stock-current", status: "active" },
  ]);

  assert.equal(result.historical.length, 2);
  assert.equal(result.active.length, 1);
  assert.equal(result.historical.some((account) => account.id === "old"), true);
});

test("only a stock-unavailable order with a credit marker is terminal for operational attention", () => {
  assert.equal(isCreditedStockUnavailableOrder({
    deliveryStatus: "stock_unavailable_deposit",
    stockRaceDepositCredited: true,
  }), true);
  assert.equal(isCreditedStockUnavailableOrder({
    deliveryStatus: "stock_unavailable_deposit",
    stockRaceDepositCreditedAt: "2026-07-31T00:00:00.000Z",
  }), true);
  assert.equal(isCreditedStockUnavailableOrder({
    deliveryStatus: "stock_unavailable_deposit",
  }), false);
  assert.equal(isCreditedStockUnavailableOrder({
    deliveryStatus: "sent",
    stockRaceDepositCredited: true,
  }), false);
});

test("historical delivery evidence requires both completion and account-detail audit events", () => {
  const order = {
    id: "ORD-HISTORY",
    fulfillmentText: "stored snapshot",
  };
  const complete = [
    { orderId: order.id, title: `Order ${order.id} selesai` },
    { orderId: order.id, title: "Detail pengiriman dibuka", description: `Akun acc-1; order ${order.id}; versi template 0.` },
  ];

  assert.equal(hasHistoricalDeliveryEvidence(complete, order), true);
  assert.equal(hasHistoricalDeliveryEvidence(complete.slice(0, 1), order), false);
  assert.equal(hasHistoricalDeliveryEvidence(complete, { ...order, fulfillmentText: "" }), false);
});

test("delivery coverage treats exact historical audit evidence as fulfilled without reviving credentials", () => {
  const order = {
    id: "ORD-HISTORY",
    qty: 1,
    fulfillmentText: "stored snapshot",
  };
  const activities = [
    { orderId: order.id, title: `Order ${order.id} selesai` },
    { orderId: order.id, title: "Detail pengiriman dibuka", description: `Akun acc-old; order ${order.id}; versi template 0.` },
  ];

  const result = deliveryAuditCoverage(order, [], activities);

  assert.equal(result.historicalDeliveryVerified, true);
  assert.equal(result.historicalCount, 1);
  assert.equal(result.activeCount, 0);
  assert.equal(result.missingHistoricalCount, 0);
});

test("delivery coverage keeps replaced accounts as history but not as active double-drop evidence", () => {
  const result = deliveryAuditCoverage(
    { id: "ORD-REPLACED", qty: 1 },
    [{ id: "old", stockId: "stock-old", status: "replaced", hidden: true }],
    [],
  );

  assert.equal(result.historicalCount, 1);
  assert.equal(result.activeCount, 0);
  assert.equal(result.missingHistoricalCount, 0);
});
