import assert from "node:assert/strict";
import test from "node:test";

import {
  accountConditionAvailability,
  findAccountConditionColumn,
  findStockMetadataColumns,
  normalizeAccountCondition,
  stockBlockedByAccountCondition,
  stockStatusAfterReservationRelease,
} from "../google-sheets/account-condition.js";
import { stockForVariant } from "../stock-groups.js";
import { syncManagedAccountCondition } from "../google-sheets.js";

test("normalizes supported account conditions case-insensitively", () => {
  assert.deepEqual(normalizeAccountCondition("  Normal "), {
    value: "NORMAL",
    known: true,
    empty: false,
  });
  assert.equal(normalizeAccountCondition("bermasalah").value, "BERMASALAH");
  assert.equal(normalizeAccountCondition("Diperiksa").value, "DIPERIKSA");
  assert.equal(normalizeAccountCondition("replaced").value, "REPLACED");
  assert.equal(normalizeAccountCondition(" disabled ").value, "DISABLED");
});

test("treats an empty legacy condition as normal-compatible", () => {
  assert.deepEqual(normalizeAccountCondition(""), {
    value: "NORMAL",
    known: true,
    empty: true,
  });
});

test("keeps unknown conditions unavailable and reportable", () => {
  const normalized = normalizeAccountCondition("perlu login ulang");
  assert.equal(normalized.value, "UNKNOWN");
  assert.equal(normalized.known, false);
  assert.equal(normalized.raw, "perlu login ulang");
  assert.equal(accountConditionAvailability({ seller: "", condition: normalized }).available, false);
});

test("finds KONDISI AKUN headers with spacing and line breaks without shifting notes", () => {
  assert.equal(findAccountConditionColumn([
    "ORDER ID /\n ID MANUAL",
    " KONDISI \n AKUN ",
    "CATATAN",
  ]), 1);
  assert.equal(findAccountConditionColumn(["ORDER ID/ID MANUAL", "CATATAN"]), -1);
});

test("maps ORDER ID / ID MANUAL, condition, and notes independently", () => {
  assert.deepEqual(findStockMetadataColumns([
    "NOMOR WA",
    "ORDER ID /\n ID MANUAL",
    "KONDISI AKUN",
    "CATATAN",
  ]), {
    orderId: 1,
    accountCondition: 2,
    notes: 3,
  });
  assert.deepEqual(findStockMetadataColumns(["ORDER ID", "CATATAN"]), {
    orderId: 0,
    accountCondition: -1,
    notes: 1,
  });
});

test("applies the stock availability matrix", () => {
  const cases = [
    { seller: "", condition: "", status: "available" },
    { seller: "", condition: "NORMAL", status: "available" },
    { seller: "", condition: "BERMASALAH", status: "blocked" },
    { seller: "", condition: "DIPERIKSA", status: "blocked" },
    { seller: "", condition: "REPLACED", status: "blocked" },
    { seller: "", condition: "DISABLED", status: "blocked" },
    { seller: "kya", condition: "NORMAL", status: "sold" },
    { seller: "kya", condition: "BERMASALAH", status: "sold" },
    { seller: "kya", condition: "DIPERIKSA", status: "sold" },
  ];

  for (const item of cases) {
    const result = accountConditionAvailability({
      seller: item.seller,
      condition: normalizeAccountCondition(item.condition),
    });
    assert.equal(result.status, item.status, JSON.stringify(item));
  }
});

test("self-heal and reservation release cannot reopen blocked Sheet stock", () => {
  for (const accountCondition of ["BERMASALAH", "DIPERIKSA", "REPLACED", "DISABLED"]) {
    const stock = { accountCondition };
    assert.equal(stockBlockedByAccountCondition(stock), true);
    assert.equal(stockStatusAfterReservationRelease(stock), "blocked");
  }
  assert.equal(stockBlockedByAccountCondition({ accountCondition: "NORMAL" }), false);
  assert.equal(stockStatusAfterReservationRelease({ accountCondition: "NORMAL" }), "available");
  assert.equal(stockStatusAfterReservationRelease({
    accountCondition: "UNKNOWN",
    accountConditionKnown: false,
  }), "blocked");
});

test("catalog and fulfillment stock selection exclude blocked conditions defensively", () => {
  const variant = { id: "variant-safe", code: "SAFE", name: "Safe" };
  const product = { id: "product-safe", name: "Example", variants: [variant] };
  const db = {
    products: [product],
    stock: [
      { id: "normal", productId: product.id, variantId: variant.id, status: "available", accountCondition: "NORMAL" },
      { id: "problem", productId: product.id, variantId: variant.id, status: "available", accountCondition: "BERMASALAH" },
      { id: "unknown", productId: product.id, variantId: variant.id, status: "available", accountConditionKnown: false },
    ],
  };

  assert.deepEqual(
    stockForVariant(db, product, variant, "available").map((stock) => stock.id),
    ["normal"],
  );
});

test("seller removal with REPLACED preserves history and propagates account health", () => {
  const stock = {
    id: "stock-replaced",
    sheetStockKey: "NETFLIX_SHARED:47:account@example.com:profile-1",
    sheetLastSyncedAt: "2026-07-26 12:00",
  };
  const account = {
    id: "account-history",
    stockId: stock.id,
    sheetStockKey: stock.sheetStockKey,
    status: "active",
    hidden: false,
  };
  const db = { managedAccounts: [account] };

  const updated = syncManagedAccountCondition(db, stock, normalizeAccountCondition("REPLACED"));

  assert.equal(updated, 1);
  assert.equal(account.accountCondition, "REPLACED");
  assert.equal(account.status, "active", "historical account status is not destructively rewritten");
  assert.equal(account.hidden, false, "history remains visible to its owner");
});
