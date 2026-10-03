/**
 * When a QRIS payment lands after its own deadline.
 *
 * `expirePendingOrders` cancels the order and refunds the deposit the moment
 * the QRIS passes its expiry. That is the right default -- the stock goes back
 * to the pool, the reseller gets their deposit, the order is dead. But a
 * payment can still arrive afterwards: the customer scanned at the boundary, or
 * their bank settled late, or they paid from a screenshot they took a minute
 * before. The money is real and the platform has it.
 *
 * Nothing here decides what to do with that money. `creditLatePaidQrisToDeposit`
 * in the reconciliation service owns that. This module only answers a narrower
 * question: is this payment still worth asking the provider about?
 *
 * The window is twenty-four hours past the order's own `paymentExpiresAt`,
 * which is the owner's decision rather than a technical one -- it sets how long
 * after a cancellation the platform will keep watching for money that is on its
 * way. The window is anchored to `paymentExpiresAt` and not to "now" for the
 * same reason: an order with no recorded deadline has nothing to bound the
 * search against, and polling it forever would be worse than the bug this
 * exists to fix.
 */
export const LATE_PAYMENT_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How often a payment inside that window is rechecked.
 *
 * Separate from the live backoff because the sign of the answer differs. A live
 * payment escalating from 15 seconds toward ten minutes is a payment that is
 * probably on its way. An expired payment rechecked on the same ceiling is a
 * payment that, twenty-three times out of twenty-four, will never arrive -- and
 * every one of those checks is a real call against the provider's rate limit,
 * taken away from the payments that are actually about to clear.
 */
export const LATE_PAYMENT_RECHECK_MS = 15 * 60 * 1000;

const SETTLED_ORDER_STATUSES = ["completed", "fulfilled", "refunded", "failed", "failed_permanent"];

/** Statuses a payment can still legitimately move from, late or not. */
const CHECKABLE_PAYMENT_STATUSES = ["pending", "created", "waiting_payment", "expired", "cancelled", ""];

/**
 * Whether this order's money has already reached its destination -- the
 * customer, the reseller's deposit, or nobody because it was written off.
 *
 * Shared with the scheduler's live loop so the two paths cannot drift apart on
 * what "already handled" means. A late payment that was already credited to the
 * deposit is the case that matters most: reconciling it twice would credit the
 * reseller twice.
 */
export function paymentAlreadySettled(order = {}, payment = {}) {
  const orderStatus = String(order.orderStatus || "").toLowerCase();
  const deliveryStatus = String(order.deliveryStatus || "").toLowerCase();
  return deliveryStatus === "sent"
    || deliveryStatus === "late_paid_deposit"
    || SETTLED_ORDER_STATUSES.includes(orderStatus)
    || Boolean(payment.latePaidDepositCredited || order.latePaidDepositCredited);
}

/**
 * Is this payment one the scheduled sync should keep checking past its order's
 * expiry?
 *
 * Returns false for anything not actually late: a live payment belongs to the
 * existing fast path, and the two share the provider call, not the decision.
 */
export function isLatePaymentRecoveryCandidate(payment = {}, order = {}, options = {}) {
  const {
    now = Date.now(),
    windowMs = LATE_PAYMENT_RECOVERY_WINDOW_MS,
    toDateTime,
  } = options;

  if (paymentAlreadySettled(order, payment)) return false;

  const status = String(payment.status || order.qrisStatus || "").toLowerCase();
  if (!CHECKABLE_PAYMENT_STATUSES.includes(status)) return false;

  const deadline = toDateTime?.(order.paymentExpiresAt || order.expiresAt || "") || null;
  if (!deadline) return false;

  const elapsed = now - deadline.getTime();
  return elapsed >= 0 && elapsed <= windowMs;
}

/**
 * Has this order reached its expiry by its own record, regardless of when?
 *
 * Deliberately narrower than `isLatePaymentRecoveryCandidate`: this one asks
 * about the order's state, with no clock and no window, because it decides the
 * recheck *cadence* rather than whether to look at all. A payment still pending
 * past its deadline has not been expired by the maintenance job yet, and it
 * should keep the live backoff until it actually is.
 */
export function orderIsExpired(order = {}) {
  const qrisStatus = String(order.qrisStatus || "").toLowerCase();
  const orderStatus = String(order.orderStatus || "").toLowerCase();
  return ["expired", "cancelled"].includes(qrisStatus) || ["expired", "cancelled"].includes(orderStatus);
}
