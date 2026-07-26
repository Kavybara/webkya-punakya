import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySheetPushResult,
  findLinkedSheetStock,
  isDeliverableManagedAccount,
  isSheetBackedRecord,
} from "../services/sheet-sync-status-service.js";

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
