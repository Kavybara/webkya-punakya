import assert from "node:assert/strict";
import test from "node:test";

import {
  LATE_PAYMENT_RECHECK_MS,
  LATE_PAYMENT_RECOVERY_WINDOW_MS,
  isLatePaymentRecoveryCandidate,
  paymentAlreadySettled,
} from "../services/late-payment-recovery.js";
import { createPaymentReconciliationService } from "../services/payment-reconciliation-service.js";

/**
 * A payment that lands after its own QRIS deadline used to be unrecoverable.
 *
 * The scheduled sync skipped expired orders outright:
 *
 *     if (deliveryStatus === "sent" || [..., "cancelled", "expired", ...].includes(orderStatus)) continue;
 *     if (!["pending", "created", "waiting_payment", ""].includes(status)) continue;
 *
 * and passed `allowLatePaymentRecovery: false`, so the service's own guard
 * refused them a second time even if something else selected them. Only two
 * callers could recover such a payment: the Pakasir webhook and a manual owner
 * reconcile. Both are push-based. When the webhook was lost -- provider
 * downtime, a deploy restart mid-flight, a dropped connection -- nothing
 * remained that would ever look at the order again, and nothing said so
 * either: the payment record still read `expired`, so it was invisible to the
 * owner as well. The customer had paid, the deposit had already been refunded,
 * and the money sat with the platform.
 *
 * Expired payments are now rechecked for twenty-four hours past their own
 * deadline. The window is the owner's decision; the recheck cadence exists
 * because the overwhelmingly common case is still *no* payment, and polling it
 * on the same ten-minute ceiling as a live order would spend the provider's
 * rate limit on orders that will never be paid.
 */
const HOUR = 60 * 60 * 1000;

function toDateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function candidate({ hoursAfterExpiry = 2, payment: paymentOverrides, order: orderOverrides } = {}) {
  const now = Date.parse("2026-10-04T12:00:00.000Z");
  const payment = {
    ref: "PAY-LATE",
    provider: "pakasir",
    status: "expired",
    ...paymentOverrides,
  };
  const order = {
    id: "ORD-LATE",
    paymentRef: "PAY-LATE",
    paymentExpiresAt: new Date(now - hoursAfterExpiry * HOUR).toISOString(),
    qrisStatus: "expired",
    orderStatus: "cancelled",
    deliveryStatus: "waiting_payment",
    depositUsed: 25_000,
    depositRefunded: true,
    ...orderOverrides,
  };
  return { now, payment, order };
}

test("the recovery window is twenty-four hours", () => {
  // Pinned because it is a business decision, not an implementation detail:
  // anyone shortening or lengthening it changes which customers get their
  // money back automatically and which have to ask.
  assert.equal(LATE_PAYMENT_RECOVERY_WINDOW_MS, 24 * HOUR);
});

test("a payment that arrived after its own deadline is a recovery candidate", () => {
  const { now, payment, order } = candidate();
  assert.equal(
    isLatePaymentRecoveryCandidate(payment, order, { now, toDateTime }),
    true,
  );
});

test("a payment past the window stops being checked", () => {
  const { now, payment, order } = candidate({ hoursAfterExpiry: 25 });
  assert.equal(
    isLatePaymentRecoveryCandidate(payment, order, { now, toDateTime }),
    false,
    "the window has to end, or an expired order is polled forever",
  );
});

test("a payment one minute inside the window is still checked", () => {
  // The boundary is the whole point of the window, so it gets its own case
  // rather than being implied by the two tests above.
  const { now, payment, order } = candidate({ hoursAfterExpiry: 24 - 1 / 60 });
  assert.equal(isLatePaymentRecoveryCandidate(payment, order, { now, toDateTime }), true);
});

test("an order with no recorded deadline is not rechecked", () => {
  // Without a deadline there is nothing to bound the window against, so
  // including it would mean polling forever -- the one outcome worse than the
  // bug being fixed.
  const { now, payment, order } = candidate({ order: { paymentExpiresAt: "" } });
  assert.equal(isLatePaymentRecoveryCandidate(payment, order, { now, toDateTime }), false);
});

test("an order that is not past its deadline is not late-recovery work", () => {
  const { now, payment, order } = candidate({
    hoursAfterExpiry: -2,
    payment: { status: "pending" },
    order: { qrisStatus: "pending", orderStatus: "pending" },
  });
  assert.equal(isLatePaymentRecoveryCandidate(payment, order, { now, toDateTime }), false);
});

test("money that already reached the customer or the reseller is never rechecked", () => {
  const { now, payment, order } = candidate({ order: { deliveryStatus: "sent", orderStatus: "completed" } });
  assert.equal(isLatePaymentRecoveryCandidate(payment, order, { now, toDateTime }), false);

  const credited = candidate();
  credited.order.deliveryStatus = "late_paid_deposit";
  credited.order.latePaidDepositCredited = true;
  assert.equal(
    isLatePaymentRecoveryCandidate(credited.payment, credited.order, { now, toDateTime }),
    false,
    "a late payment already credited to the deposit must not be credited twice",
  );
});

test("paymentAlreadySettled covers the whole terminal set", () => {
  // Named separately so the scheduler's live loop and the recovery loop cannot
  // drift apart on what "already handled" means.
  for (const order of [
    { deliveryStatus: "sent" },
    { deliveryStatus: "late_paid_deposit" },
    { orderStatus: "completed" },
    { orderStatus: "fulfilled" },
    { orderStatus: "refunded" },
    { orderStatus: "failed_permanent" },
    { latePaidDepositCredited: true },
  ]) {
    assert.equal(paymentAlreadySettled(order, {}), true, `${JSON.stringify(order)} should count as settled`);
  }

  assert.equal(paymentAlreadySettled({ deliveryStatus: "waiting_payment", orderStatus: "cancelled" }, {}), false);
});

function reconciliationFixture({ live = false } = {}) {
  const db = {
    orders: [{
      id: "ORD-LATE",
      paymentRef: "PAY-LATE",
      qrisStatus: live ? "pending" : "expired",
      orderStatus: live ? "pending" : "cancelled",
      deliveryStatus: "waiting_payment",
      paymentDue: 50_000,
      total: 75_000,
      depositUsed: 25_000,
      depositRefunded: !live,
      product: "Netflix",
      variant: "1P1U",
    }],
    payments: [{
      ref: "PAY-LATE",
      orderId: "ORD-LATE",
      provider: "pakasir",
      status: live ? "pending" : "expired",
      amount: 50_000,
      totalPayment: 50_000,
    }],
    activities: [],
    resellers: [],
  };
  const service = createPaymentReconciliationService({
    activeResellerByWhatsapp: () => null,
    dateTimeText: (value) => value.toISOString(),
    derivePakasirTotalPayment: (amount, fee, total) => Math.max(Number(total || 0), Number(amount || 0) + Number(fee || 0)),
    fetchPakasirTransactionDetail: async () => ({ ok: true, paid: false, status: "pending", transaction: {} }),
    formatRupiah: (value) => `Rp ${value}`,
    fulfillPaidOrderAndNotify: async () => ({ ok: false, reply: "should not fulfil" }),
    makeId: () => "act-test",
    normalizeWhatsappNumber: (value) => value,
    nowText: () => "2026-10-04T12:00:00.000Z",
    toDateTime,
  });
  return { db, service };
}

function minutesUntil(value) {
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed), `nextPaymentCheckAt is not a timestamp: ${JSON.stringify(value)}`);
  return (parsed - Date.now()) / 60_000;
}

test("an expired order rechecks on its own slower cadence, not the live ten-minute ceiling", async () => {
  const { db, service } = reconciliationFixture();

  await service.reconcilePakasirPaymentInDb(db, "PAY-LATE", { allowLatePaymentRecovery: true });

  const delayMinutes = minutesUntil(db.payments[0].nextPaymentCheckAt);

  assert.ok(
    delayMinutes > 10 && delayMinutes <= LATE_PAYMENT_RECHECK_MS / 60_000,
    `an expired payment rechecks in ${delayMinutes.toFixed(1)} minutes, which is not the ${LATE_PAYMENT_RECHECK_MS / 60_000}-minute late cadence`,
  );
  assert.equal(db.payments[0].paymentProviderStatus, "pending");
  assert.equal(db.payments[0].status, "expired", "a not-yet-paid check must not mark the payment paid");
});

test("a live payment keeps the escalating backoff", async () => {
  const { db, service } = reconciliationFixture({ live: true });

  await service.reconcilePakasirPaymentInDb(db, "PAY-LATE", {});

  const delayMinutes = minutesUntil(db.payments[0].nextPaymentCheckAt);

  assert.ok(
    delayMinutes > 0 && delayMinutes <= 10,
    `a live payment must keep the escalating backoff, but was scheduled ${delayMinutes.toFixed(2)} minutes out`,
  );
});

test("the scheduled sync selects late arrivals and allows their recovery", async () => {
  // `runPakasirPaymentSyncJob` is a module-private timer, so this half is a
  // source inspection -- the same convention this suite uses for anything that
  // cannot be reached without booting the server.
  const { readFileSync } = await import("node:fs");
  const index = readFileSync(new URL("../index.js", import.meta.url), "utf8");

  const start = index.indexOf("async function runPakasirPaymentSyncJob");
  assert.notEqual(start, -1, "the scheduled payment sync is gone");
  const job = index.slice(start, index.indexOf("\n}\n", start));

  assert.match(job, /isLatePaymentRecoveryCandidate\(/, "the scheduled sync never consults the recovery window");
  assert.match(
    job,
    /allowLatePaymentRecovery:\s*true/,
    "late candidates are selected but the service is still told to refuse them on arrival",
  );
  assert.match(
    job,
    /allowLatePaymentRecovery:\s*target\.allowLatePaymentRecovery/,
    "the flag is hard-coded on one path, so the recovery pass cannot actually recover anything",
  );
  assert.match(job, /seen\.has\(payment\.ref\)/, "a payment can be queued twice in one tick, once live and once late");
});

test("a late arrival can never take a slot from a live payment", async () => {
  // The per-tick budget is the provider's rate limit. If late candidates were
  // queued first, a burst of expired orders could starve the payments that are
  // about to actually clear.
  const { readFileSync } = await import("node:fs");
  const index = readFileSync(new URL("../index.js", import.meta.url), "utf8");

  const start = index.indexOf("async function runPakasirPaymentSyncJob");
  const job = index.slice(start, index.indexOf("\n}\n", start));

  const liveLoop = job.indexOf("const status = String(payment.status || order.qrisStatus");
  const lateLoop = job.indexOf("isLatePaymentRecoveryCandidate(payment, order");
  const lateBudget = job.indexOf("PAKASIR_SYNC_CHECK_LIMIT", lateLoop);

  assert.ok(liveLoop > -1 && lateLoop > liveLoop, "the recovery pass runs before the live pass");
  assert.ok(lateBudget > lateLoop, "the recovery pass is not bounded by the shared per-tick budget");
});
