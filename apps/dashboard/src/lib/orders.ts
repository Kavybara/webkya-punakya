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
 */

import type { Tone } from "../components/ui/types";
import type { Order } from "./types";

/** Has this order been paid for? A cancelled order never counts, whatever the payment says. */
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

/** The one label and the one tone, decided together so they cannot disagree. */
export function orderStatus(order: Order): { label: string; tone: Tone } {
  if (order.orderStatus === "cancelled") return { label: "Dibatalkan", tone: "danger" };
  if (order.qrisStatus === "expired") return { label: "Kedaluwarsa", tone: "danger" };
  if (order.qrisStatus === "pending") return { label: "Menunggu Pembayaran", tone: "warning" };
  if (orderPaid(order)) return { label: "Sukses", tone: "success" };
  if (order.orderStatus === "processing") return { label: "Diproses", tone: "info" };
  return { label: "Menunggu", tone: "muted" };
}
