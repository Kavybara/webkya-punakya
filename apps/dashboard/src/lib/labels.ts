/**
 * Every status the product shows, in one place.
 *
 * The database stores these values in English because that is what the code,
 * the API contract and the bot all speak. None of that should reach a reader.
 * A column of `active` / `paused` / `expired` is not a status list, it is a
 * schema dump, and an Indonesian reseller or owner has to decode it while
 * deciding something about money.
 *
 * The rule this file exists to enforce: **no component renders a raw status.**
 * If a status is not here, it is a bug in this file, not a reason for the
 * component to fall back to printing the token.
 *
 * This file was written after the damage was counted. The same "what state is
 * this order in" question had **five** separate answers across the app:
 *
 * | Where | It answered |
 * |---|---|
 * | `lib/orders.ts` | one word: "Sukses" |
 * | `owner-v2/orders/page.tsx` | two columns: payment + fulfillment |
 * | `owner-v2/overview/analytics.ts` | a near-verbatim copy of the above |
 * | `owner-v2/page.tsx` | a fourth inline ternary chain |
 * | `reseller-v2/page.tsx` | "Gagal" for both cancelled *and* failed |
 *
 * The last row is the one that cost money. It labelled a customer-cancelled
 * order and a botched delivery with the same word, so a reseller could not tell
 * "I cancelled this" from "the customer paid and got nothing" -- and only one
 * of those is the reseller's fault.
 *
 * Two consequences worth stating, because they cost something:
 *
 * 1. **Tone lives here next to the label.** These used to be separate lookups.
 *    `owner-v2/orders/page.tsx` had a `badgeTone(label)` that mapped the
 *    *strings* "Dibayar" and "Selesai" to green. Renaming "Expired" to
 *    "Kedaluwarsa" -- the translation the rest of the product already used --
 *    would have silently turned that badge grey, because the lookup would not
 *    have matched. Nothing warned about it. A label you can rename without
 *    having to audit a colour table is the whole point.
 * 2. **An unrecognised value is humanised, not printed.** `pending_review` will
 *    render as "Pending review" rather than the token. That is still English,
 *    and it is the deliberate trade: inventing a translation for a status this
 *    file has never seen would be guessing at its meaning, and a wrong
 *    translation in an ops console is worse than an honest untranslated one.
 *    A raw token leaking through is the only outcome worth engineering away.
 */

import type { Tone } from "../components/ui/types";
import type { Order } from "./types";

/**
 * Sentence case, not Title Case.
 *
 * "Menunggu pembayaran", not "Menunggu Pembayaran". Indonesian capitalises
 * proper nouns, not every word, and a screen full of Title Case reads as a
 * template that nobody edited. The single exception is an acronym the reader
 * needs to recognise as itself -- QRIS, ID, PIN.
 */

/**
 * The last-resort formatter for a value no table below knows.
 *
 * `snake_case`, `kebab-case` and `SCREAMING_CASE` all become "Words" with only
 * the first letter capitalised, which is the shape a sentence-cased label
 * takes. An empty or missing value becomes "Tidak diketahui" rather than an
 * empty cell, because a blank in a status column reads as "nothing to report"
 * and the reader cannot tell it apart from a row that failed to load.
 */
function humanise(value?: string | null): string {
  const text = String(value ?? "").trim();
  if (!text) return "Tidak diketahui";
  const words = text.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A label, and the colour that belongs to it. Always returned together. */
export type Label = { label: string; tone: Tone };

/* -------------------------------------------------------------------------- */
/* Rental                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `expired` is "Berakhir", not "Kedaluwarsa".
 *
 * The order vocabulary already uses "Kedaluwarsa" for a lapsed QRIS payment,
 * which is a deadline that passed. A rental that ran out of days is "Berakhir"
 * -- it ended normally. Using the same word for both makes one of them wrong.
 */
const RENTAL_STATUS: Record<string, Label> = {
  active: { label: "Aktif", tone: "success" },
  paused: { label: "Dijeda", tone: "warning" },
  expired: { label: "Berakhir", tone: "muted" },
};

export function rentalStatus(status?: string | null): Label {
  const key = String(status ?? "").trim().toLowerCase();
  return RENTAL_STATUS[key] ?? { label: humanise(status), tone: "muted" };
}

/* -------------------------------------------------------------------------- */
/* Severity                                                                   */
/* -------------------------------------------------------------------------- */

const SEVERITY: Record<string, Label> = {
  high: { label: "Tinggi", tone: "danger" },
  medium: { label: "Sedang", tone: "warning" },
  low: { label: "Rendah", tone: "info" },
};

export function severity(value?: string | null): Label {
  const key = String(value ?? "").trim().toLowerCase();
  return SEVERITY[key] ?? { label: humanise(value), tone: "muted" };
}

/* -------------------------------------------------------------------------- */
/* System health                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `cek` is a system asking to be looked at, not a broken system. "Perlu dicek"
 * carries that; "Bermasalah" would not.
 */
const HEALTH: Record<string, Label> = {
  sehat: { label: "Sehat", tone: "success" },
  cek: { label: "Perlu dicek", tone: "warning" },
  error: { label: "Bermasalah", tone: "danger" },
};

export function systemHealth(value?: string | null): Label {
  const key = String(value ?? "").trim().toLowerCase();
  return HEALTH[key] ?? { label: humanise(value), tone: "muted" };
};

/* -------------------------------------------------------------------------- */
/* WhatsApp connection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `open` is Baileys' word for a live socket. The owner needs to know whether
 * messages can leave the machine, which is what "Terhubung" says and "Open"
 * does not.
 */
const CONNECTION: Record<string, Label> = {
  connecting: { label: "Menghubungkan", tone: "warning" },
  open: { label: "Terhubung", tone: "success" },
  close: { label: "Terputus", tone: "danger" },
};

export function waConnection(value?: string | null): Label {
  const key = String(value ?? "").trim().toLowerCase();
  return CONNECTION[key] ?? { label: humanise(value), tone: "muted" };
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Has the money arrived?
 *
 * "Manual" is kept as its own label rather than folded into "Dibayar". The
 * owner approved it by hand with a written reason, and that reason is the whole
 * audit trail; a badge that reads "Dibayar" makes a manual approval
 * indistinguishable from a QRIS one and loses the trail the approval exists to
 * create.
 */
export function paymentLabel(order: Order): Label {
  const qris = String(order.qrisStatus ?? "").toLowerCase();
  if (qris === "paid") return { label: "Dibayar", tone: "success" };
  if (qris === "manual") return { label: "Manual", tone: "warning" };
  if (qris === "expired") return { label: "Kedaluwarsa", tone: "danger" };
  return { label: "Menunggu", tone: "warning" };
}

/**
 * The three statuses that mean "delivery did not happen".
 *
 * One list, because the label, the filter, the overview tile and the retry
 * button all have to agree on it -- and they used to be three copies that
 * drifted.
 *
 * `abandoned` is what the fulfilment repair job writes once it has retried 80
 * times and stopped: the customer paid, nothing was delivered, and no future
 * pass will ever select the order again. It is the one delivery state only the
 * owner can clear, via `retry-delivery`, which re-runs fulfilment and resets
 * the status when it succeeds. Excluding it made the overview's "Delivery
 * gagal" tile promise rows the orders page would not show.
 */
export const FAILED_DELIVERY_STATUSES = ["failed", "needs_redelivery", "abandoned"];

/**
 * Did the customer get what they paid for?
 *
 * Exported as a predicate, not as `fulfillmentLabel(order) === "Gagal"`, because
 * that string comparison is the bug: rename the label and the check silently
 * stops matching, with no type error and no failed test. Two call sites did
 * exactly that -- the "needs attention" counter and the button that offers to
 * re-send. A predicate cannot rot the way a label comparison can.
 */
export function deliveryFailed(order: Order): boolean {
  return FAILED_DELIVERY_STATUSES.includes(String(order.deliveryStatus ?? ""));
}

/**
 * Has the money arrived, as the owner console answers it?
 *
 * Deliberately narrower than it could be, and deliberately *different* from
 * `orderPaid` in `orders.ts` -- see the note there. Both rules are real and
 * they answer different questions; what was wrong before was that neither had
 * a name that said so, so each page invented one and the results silently
 * disagreed.
 */
export function isPaid(order: Order): boolean {
  if (String(order.orderStatus ?? "").toLowerCase() === "cancelled") return false;
  const qris = String(order.qrisStatus ?? "").toLowerCase();
  return qris === "paid" || qris === "manual" || String(order.orderStatus ?? "").toLowerCase() === "completed";
}

/**
 * Has the customer been given their credentials?
 *
 * Note this is `sent`, not "not failed". An order can be in every state
 * between "paid" and "sent" and still be perfectly healthy; that is what
 * "Diproses" is for.
 */
export function fulfillmentLabel(order: Order): Label {
  if (deliveryFailed(order)) return { label: "Gagal kirim", tone: "danger" };
  const lifecycle = String(order.orderStatus ?? "").toLowerCase();
  if (lifecycle === "completed" || String(order.deliveryStatus ?? "") === "sent") {
    return { label: "Selesai", tone: "success" };
  }
  if (lifecycle === "cancelled") return { label: "Dibatalkan", tone: "danger" };
  if (lifecycle === "processing" || isPaid(order)) return { label: "Diproses", tone: "warning" };
  return { label: "Menunggu", tone: "muted" };
}

/**
 * The one word to show when there is only room for one.
 *
 * The seven states an order can be in, and no more: Menunggu pembayaran,
 * Dibayar, Diproses, Selesai, Kedaluwarsa, Dibatalkan, Gagal kirim.
 *
 * An order's state is not one database column. `orderStatus` carries the
 * lifecycle, `qrisStatus` carries whether money arrived, and `deliveryStatus`
 * carries whether the customer got anything. An order can be paid, undelivered
 * and unfixable at the same time, so collapsing that to one field is how a
 * customer who paid for nothing gets shown as fine.
 *
 * The order of the checks is the order of severity: something wrong beats
 * something stale beats something fine. `Gagal kirim` sits above `Kedaluwarsa`
 * deliberately -- a customer who paid and got nothing is worse off than a
 * customer whose QRIS timed out, and the page that renders both has to say so.
 */
export function orderStatus(order: Order): Label {
  const lifecycle = String(order.orderStatus ?? "").toLowerCase();
  const qris = String(order.qrisStatus ?? "").toLowerCase();

  if (lifecycle === "cancelled") return { label: "Dibatalkan", tone: "danger" };
  if (deliveryFailed(order)) return { label: "Gagal kirim", tone: "danger" };
  if (qris === "expired") return { label: "Kedaluwarsa", tone: "danger" };
  if (qris === "pending") return { label: "Menunggu pembayaran", tone: "warning" };
  if (lifecycle === "completed") return { label: "Selesai", tone: "success" };
  if (lifecycle === "processing") return { label: "Diproses", tone: "info" };
  if (qris === "paid" || qris === "manual") return { label: "Dibayar", tone: "success" };
  return { label: "Menunggu", tone: "muted" };
}

/* -------------------------------------------------------------------------- */
/* Action labels                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Button text for actions, kept here so the same action cannot be called two
 * different things in two places.
 *
 * These were lifted from the API method names -- `markOrderPaid`,
 * `retryDelivery`, `repairOrderSheets` -- which is why a page once asked an
 * owner to press "Retry delivery". A button label is an instruction to a
 * person who does not read the source; it has to be in their language.
 */
export const ACTION_LABEL = {
  markPaid: "Tandai lunas",
  approveManual: "Setujui manual",
  retryDelivery: "Kirim ulang",
  repairSheets: "Pulihkan Sheets",
  rerenderTemplate: "Render ulang template",
  previewRepair: "Pratinjau perbaikan",
  highPriority: "Prioritas tinggi",
  stockLocks: "Stok terkunci",
  deliveryAudit: "Audit pengiriman",
  pendingDeposit: "Deposit menunggu",
} as const;

export function actionLabel(kind: keyof typeof ACTION_LABEL): string {
  return ACTION_LABEL[kind];
}