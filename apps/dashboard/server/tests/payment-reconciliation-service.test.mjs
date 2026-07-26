import assert from "node:assert/strict";
import test from "node:test";

import { createPaymentReconciliationService } from "../services/payment-reconciliation-service.js";

function createFixture(options = {}) {
  const calls = { provider: 0, fulfillment: 0 };
  const db = {
    orders: [{
      id: "ORD-TEST",
      paymentRef: "PAY-TEST",
      qrisStatus: options.qrisStatus || "pending",
      orderStatus: options.orderStatus || "pending",
      deliveryStatus: options.deliveryStatus || "waiting_payment",
      paymentDue: 10_000,
      total: 10_000,
      product: "Netflix",
      variant: "1P1U",
    }],
    payments: [{
      ref: "PAY-TEST",
      orderId: "ORD-TEST",
      provider: "pakasir",
      status: options.paymentStatus || "pending",
      amount: 10_000,
    }],
    activities: [],
    resellers: [],
  };
  const detail = options.detail || { ok: true, paid: false, status: "pending", transaction: {} };
  const service = createPaymentReconciliationService({
    activeResellerByWhatsapp: () => null,
    dateTimeText: (value) => value.toISOString(),
    derivePakasirTotalPayment: (amount, fee, total) => Math.max(Number(total || 0), Number(amount || 0) + Number(fee || 0)),
    fetchPakasirTransactionDetail: async () => {
      calls.provider += 1;
      if (options.providerThrows) throw new Error("raw provider credential should not escape");
      return detail;
    },
    formatRupiah: (value) => `Rp ${value}`,
    fulfillPaidOrderAndNotify: async (currentDb, orderId) => {
      calls.fulfillment += 1;
      const order = currentDb.orders.find((item) => item.id === orderId);
      const payment = currentDb.payments.find((item) => item.orderId === orderId);
      order.orderStatus = "completed";
      order.deliveryStatus = "sent";
      order.notificationStatus = "sent";
      payment.status = "paid";
      return { ok: true, paid: true, order, payment };
    },
    makeId: () => "act-test",
    normalizeWhatsappNumber: (value) => value,
    nowText: () => "2026-07-26T10:00:00.000Z",
    toDateTime: (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    },
  });
  return { calls, db, service };
}

test("pending provider result records bounded retry metadata without fulfillment", async () => {
  const { calls, db, service } = createFixture();
  const result = await service.reconcilePakasirPaymentInDb(db, "PAY-TEST", { source: "scheduled" });

  assert.equal(result.paid, false);
  assert.equal(calls.provider, 1);
  assert.equal(calls.fulfillment, 0);
  assert.equal(db.payments[0].paymentCheckAttempts, 1);
  assert.match(db.payments[0].nextPaymentCheckAt, /^\d{4}-/);
  assert.equal(db.payments[0].lastPaymentCheckError, "");
});

test("paid reconciliation fulfills once and a repeated call skips before provider access", async () => {
  const { calls, db, service } = createFixture({
    detail: {
      ok: true,
      paid: true,
      status: "paid",
      paidAt: "2026-07-26T09:59:00.000Z",
      transaction: { totalPayment: 10_000, fee: 0, paymentMethod: "qris" },
    },
  });

  const first = await service.reconcilePakasirPaymentInDb(db, "PAY-TEST", { source: "webhook" });
  const second = await service.reconcilePakasirPaymentInDb(db, "PAY-TEST", { source: "webhook" });

  assert.equal(first.ok, true);
  assert.equal(second.reason, "already_fulfilled");
  assert.equal(calls.provider, 1);
  assert.equal(calls.fulfillment, 1);
});

test("serialized webhook and scheduled reconciliation cannot fulfill the same order twice", async () => {
  const { calls, db, service } = createFixture({
    detail: {
      ok: true,
      paid: true,
      status: "paid",
      transaction: { totalPayment: 10_000, paymentMethod: "qris" },
    },
  });
  let mutationQueue = Promise.resolve();
  const updateDb = (mutator) => {
    const operation = mutationQueue.then(() => mutator(db));
    mutationQueue = operation.catch(() => undefined);
    return operation;
  };

  const [webhook, scheduled] = await Promise.all([
    updateDb((currentDb) => service.reconcilePakasirPaymentInDb(currentDb, "PAY-TEST", {
      source: "pakasir_webhook",
      allowLatePaymentRecovery: true,
    })),
    updateDb((currentDb) => service.reconcilePakasirPaymentInDb(currentDb, "PAY-TEST", {
      source: "scheduled",
      allowLatePaymentRecovery: false,
    })),
  ]);

  assert.equal(webhook.ok, true);
  assert.equal(scheduled.reason, "already_fulfilled");
  assert.equal(calls.provider, 1);
  assert.equal(calls.fulfillment, 1);
});

test("terminal scheduled payments never call provider or fulfillment", async () => {
  const { calls, db, service } = createFixture({
    orderStatus: "expired",
    qrisStatus: "expired",
    paymentStatus: "expired",
  });
  const result = await service.reconcilePakasirPaymentInDb(db, "PAY-TEST", {
    source: "scheduled",
    allowLatePaymentRecovery: false,
  });

  assert.equal(result.reason, "terminal_expired");
  assert.equal(calls.provider, 0);
  assert.equal(calls.fulfillment, 0);
});

test("webhook may recover an expired payment while the scheduled job may not", async () => {
  const { calls, db, service } = createFixture({
    orderStatus: "expired",
    qrisStatus: "expired",
    paymentStatus: "expired",
    detail: { ok: true, paid: true, status: "paid", transaction: { totalPayment: 10_000 } },
  });
  const result = await service.reconcilePakasirPaymentInDb(db, "PAY-TEST", {
    source: "pakasir_webhook",
    allowLatePaymentRecovery: true,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.provider, 1);
  assert.equal(calls.fulfillment, 1);
  assert.equal(db.orders[0].latePaymentRecovered, true);
});

test("provider failures store a sanitized retry signal", async () => {
  const { calls, db, service } = createFixture({
    detail: {
      ok: false,
      paid: false,
      status: "provider_error",
      error: "secret raw provider response",
      payload: null,
    },
  });
  const result = await service.reconcilePakasirPaymentInDb(db, "PAY-TEST", { source: "scheduled" });

  assert.equal(result.detail.reason, "payment_provider_check_failed");
  assert.equal(JSON.stringify(result).includes("secret raw provider response"), false);
  assert.equal(db.payments[0].lastPaymentCheckError, "payment_provider_check_failed");
  assert.equal(calls.provider, 1);
  assert.equal(calls.fulfillment, 0);
});

test("thrown provider errors are sanitized and still receive retry metadata", async () => {
  const { calls, db, service } = createFixture({ providerThrows: true });
  const result = await service.reconcilePakasirPaymentInDb(db, "PAY-TEST", { source: "scheduled" });

  assert.equal(result.ok, false);
  assert.equal(result.detail.reason, "payment_provider_check_failed");
  assert.equal(JSON.stringify(result).includes("raw provider credential"), false);
  assert.equal(db.payments[0].paymentCheckAttempts, 1);
  assert.match(db.payments[0].nextPaymentCheckAt, /^\d{4}-/);
  assert.equal(calls.provider, 1);
  assert.equal(calls.fulfillment, 0);
});

test("unknown payment references never access provider", async () => {
  const { calls, db, service } = createFixture();
  const result = await service.reconcilePakasirPaymentInDb(db, "PAY-MISSING");

  assert.equal(result.reason, "payment_or_order_missing");
  assert.equal(calls.provider, 0);
  assert.equal(calls.fulfillment, 0);
});
