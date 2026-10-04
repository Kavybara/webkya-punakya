/**
 * What an order's status means, in one place.
 *
 * These functions lived in `pages/reseller/resellerUi.tsx`, which was a page's
 * private helper file that happened to hold the rules for reading an order's
 * status -- so the owner console and the public order-tracking page could not
 * use them without importing a reseller page. They are not UI: the same
 * question ("has this been paid for?") gets asked by the reseller's history
 * table, the owner's order list, and the bot that decides whether to send
 * credentials.
 *
 * `orderStatus` returns the kit's `Tone` rather than the Tailwind class strings
 * the old `orderStatusClass` returned. The class strings were a second, private
 * colour vocabulary living one layer below the badge that was supposed to own
 * the colour, and a cancelled order rendered in `bg-red-50 text-red-600` was a
 * light-theme colour inside a dark console.
 *
 * `orderStatus` itself no longer lives here. It answered the same question as
 * three other functions in three other files, all four disagreeing -- and this
 * one was the worst of them, labelling a paid-but-undelivered order "Sukses".
 * It now lives in `labels.ts` alongside every other status the product shows,
 * so there is one vocabulary rather than five.
 */

import type { Order } from "./types";

/**
 * Has this order been paid for? A cancelled order never counts, whatever the payment says.
 *
 * Note this is *narrower* than `isPaid` in `labels.ts`, which counts a
 * manually-approved order as paid. That is a real, still-open disagreement
 * rather than an oversight: this one backs the reseller's own "Dibayar" filter
 * and its paid-order counts, and widening it changes numbers a reseller reads
 * as their own balance history. It is called out here, and in `labels.ts`, so
 * that whoever settles it knows it is a decision rather than a typo.
 */
export function orderPaid(order: Order): boolean {
  if (order.orderStatus === "cancelled") return false;
  return order.qrisStatus === "paid" || order.orderStatus === "completed";
}

/** Can this order still be paid? A pending payment with a reference can be reopened. */
export function orderCanReopenQris(order: Order): boolean {
  return order.qrisStatus === "pending" && Boolean(order.paymentRef);
}

/** Have the credentials gone out? */
export function deliveryIsComplete(order: Order): boolean {
  return order.deliveryStatus === "sent" || order.orderStatus === "completed";
}
