import assert from "node:assert/strict";
import test from "node:test";

import { createOrderStockService } from "../services/order-stock-service.js";

function service() {
  return createOrderStockService({
    isCanvaProduct: () => false,
    isLinkPoolProduct: () => false,
    isTerminalManagedAccountStatus: (status) => ["expired", "replaced"].includes(String(status || "").toLowerCase()),
    isVariantOrderable: () => true,
    linkPoolAvailableCount: () => 0,
    linkPoolsForVariant: () => [],
    nowText: () => "2026-07-15 12:00",
    stockForVariant: (db) => db.stock.filter((item) => item.status === "available"),
    syncGoogleSheetsStockSafely: async () => ({ ok: true }),
    syncSheetsForProductOrThrow: async () => ({ ok: true }),
  });
}

test("active managed account blocks stale available stock from reservation", () => {
  const db = {
    stock: [
      { id: "stk-active", status: "available" },
      { id: "stk-free", status: "available" },
    ],
    managedAccounts: [
      { stockId: "stk-active", orderId: "ORD-OLD", status: "active", hidden: false },
    ],
  };
  const order = { id: "ORD-NEW", paymentExpiresAt: "2026-07-15 12:15" };
  const { reserveAvailableStocksForOrder } = service();

  const reserved = reserveAvailableStocksForOrder(db, order, {}, {}, 1);

  assert.deepEqual(reserved.map((item) => item.id), ["stk-free"]);
  assert.equal(db.stock[0].status, "available");
  assert.equal(db.stock[1].status, "reserved");
  assert.deepEqual(order.reservedStockIds, ["stk-free"]);
});

test("clearing a reservation removes every lock field", () => {
  const stock = {
    status: "reserved",
    reservedFor: "ORD-1",
    reservedAccountId: "ACC-1",
    reservedUntil: "later",
    reservedAt: "now",
  };
  service().clearReservedStockState(stock);
  assert.deepEqual(stock, { status: "available" });
});

test("clearing a stale reservation never reopens a blocked Sheet account", () => {
  const stock = {
    status: "reserved",
    accountCondition: "REPLACED",
    accountConditionBlocked: true,
    reservedFor: "ORD-1",
    reservedUntil: "later",
  };
  service().clearReservedStockState(stock);
  assert.deepEqual(stock, {
    status: "blocked",
    accountCondition: "REPLACED",
    accountConditionBlocked: true,
  });
});
