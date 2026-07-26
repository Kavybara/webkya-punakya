import assert from "node:assert/strict";
import test from "node:test";

import {
  isCopiedSheetAssignment,
  shouldPreserveSheetStockReservation,
} from "../google-sheets.js";

function pendingOrder(overrides = {}) {
  return {
    id: "ORD-RESERVED",
    orderStatus: "pending",
    qrisStatus: "pending",
    paymentExpiresAt: "2099-01-01 00:00",
    ...overrides,
  };
}

test("empty Sheets assignment preserves a live local payment reservation", () => {
  const db = { orders: [pendingOrder()] };
  const stock = { status: "reserved", reservedFor: "ORD-RESERVED" };

  assert.equal(shouldPreserveSheetStockReservation(db, stock, false), true);
});

test("an explicit Sheets assignment overrides a local reservation", () => {
  const db = { orders: [pendingOrder()] };
  const stock = { status: "reserved", reservedFor: "ORD-RESERVED" };

  assert.equal(shouldPreserveSheetStockReservation(db, stock, true), false);
});

test("finished or expired orders no longer lock stock during Sheets sync", () => {
  const stock = { status: "reserved", reservedFor: "ORD-RESERVED" };
  assert.equal(shouldPreserveSheetStockReservation({ orders: [pendingOrder({ orderStatus: "completed" })] }, stock, false), false);
  assert.equal(
    shouldPreserveSheetStockReservation(
      { orders: [pendingOrder({ paymentExpiresAt: "2020-01-01 00:00" })] },
      stock,
      false,
    ),
    false,
  );
});

test("a paid order keeps its reservation while fulfillment is still processing", () => {
  const db = {
    orders: [pendingOrder({
      qrisStatus: "paid",
      orderStatus: "processing",
      deliveryStatus: "paid",
    })],
  };
  const stock = { status: "reserved", reservedFor: "ORD-RESERVED" };

  assert.equal(shouldPreserveSheetStockReservation(db, stock, false), true);
});

test("a sold stock stays locked while its Sheet commit has not succeeded", () => {
  const stock = { id: "STOCK-SOLD", status: "sold" };
  const db = {
    orders: [{
      id: "ORD-SHEET-PENDING",
      orderStatus: "processing",
      deliveryStatus: "sheet_sync_failed",
      googleSheetsSyncStatus: "failed",
      deliveredStockIds: ["STOCK-SOLD"],
    }],
  };

  assert.equal(shouldPreserveSheetStockReservation(db, stock, false), true);
});

test("a sold stock returns to Sheet authority after its commit succeeds", () => {
  const stock = { id: "STOCK-SOLD", status: "sold" };
  const db = {
    orders: [{
      id: "ORD-SHEET-SYNCED",
      orderStatus: "completed",
      deliveryStatus: "sent",
      googleSheetsSyncStatus: "synced",
      deliveredStockIds: ["STOCK-SOLD"],
    }],
  };

  assert.equal(shouldPreserveSheetStockReservation(db, stock, false), false);
});

test("an identical legacy assignment copied to another account is rejected", () => {
  const original = {
    email: "ambercanal@wesaveearth.xyz",
    profile: "Caramel",
    pin: "6172",
    seller: "val",
    purchasedAt: "2026-06-12 00:00",
    durationText: "2b",
    expiresAt: "2026-08-12 00:00",
    device: "redmi 13 c",
    whatsapp: "62895392946989",
    orderId: "",
  };
  const copied = {
    ...original,
    email: "maroko@kya.baby",
  };

  assert.equal(isCopiedSheetAssignment(copied, original), true);
});

test("explicit orders and non-identical assignments are never treated as copied", () => {
  const original = {
    email: "old@kya.baby",
    profile: "Caramel",
    pin: "6172",
    seller: "val",
    purchasedAt: "2026-06-12 00:00",
    durationText: "2 Hari",
    expiresAt: "2026-06-14 00:00",
    device: "phone",
    whatsapp: "628111111111",
    orderId: "",
  };

  assert.equal(isCopiedSheetAssignment({ ...original, email: "new@kya.baby", orderId: "ORD-NEW" }, original), false);
  assert.equal(isCopiedSheetAssignment({ ...original, email: "new@kya.baby", profile: "Mocha" }, original), false);
  assert.equal(isCopiedSheetAssignment({ ...original, email: "new@kya.baby", purchasedAt: "2026-07-24 00:00" }, original), false);
  assert.equal(isCopiedSheetAssignment({ ...original }, original), false);
});
