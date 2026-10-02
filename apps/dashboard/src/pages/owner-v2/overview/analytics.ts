/**
 * Everything the overview knows that the raw API does not hand over.
 *
 * The overview is the one page in the console that is not a CRUD list over a
 * single collection -- it reads five of them at once and has to turn them into
 * a morning's worth of answers. That arithmetic was inline in the page
 * component, spread across six `useMemo` blocks that each re-derived the same
 * notions of "paid", "live" and "today" from scratch.
 *
 * It lives here instead so that the numbers have one definition. The reseller
 * panel already has this problem in a worse form -- `statusForOrder` in
 * `pages/reseller-v2/page.tsx` and `orderStatus` in `lib/orders.ts` disagree
 * about the same order on two adjacent screens -- and the way that happened is
 * the way this file is meant to prevent.
 *
 * A note on what is deliberately absent: there is no profit, no margin, no
 * cost. Nothing in the database records what an account cost to buy -- not on
 * the order, not on the stock item, not on the product. A dashboard that
 * printed a profit figure would be inventing one, and an invented number on a
 * page whose entire job is to be trusted about money is worse than a missing
 * one. If that number should exist, the field has to be recorded first, at
 * purchase. The wallet ledger is the closest honest substitute and it is real:
 * top-ups, spend and refunds are all recorded, so cash position is derivable.
 * Revenue minus spend is not margin, and is never presented as one.
 */
import type { ApiOrder, ApiStockItem, OperationsCenterResult, SystemStatus } from "../../../lib/api";

/** The two questions every dashboard opens with: is it money, and is it real. */
export function isSmokeTest(order: ApiOrder) {
  return Boolean(order.excludeFromSalesMetrics || order.isSmokeTest || String(order.source || "").toLowerCase() === "owner_smoke_test");
}

export function isPaid(order: ApiOrder) {
  return ["paid", "manual"].includes(String(order.qrisStatus || "").toLowerCase());
}

export function parseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function dateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function paymentLabel(order: ApiOrder) {
  if (isPaid(order)) return "Dibayar";
  if (order.qrisStatus === "expired") return "Expired";
  return "Menunggu";
}

/*
 * The statuses that mean "delivery did not happen". `abandoned` belongs here:
 * the fulfillment repair job gives up on it after 80 attempts, so nothing in the
 * backend will ever retry it again and only the owner can, via the orders page.
 * Reading only "failed" here showed an abandoned order as "Diproses" on the
 * overview's recent-orders table, which is the one place a paid customer
 * looking like still-handled is worst.
 */
export const FAILED_DELIVERY_STATUSES = ["failed", "needs_redelivery", "abandoned"];

export function fulfillmentLabel(order: ApiOrder) {
  if (FAILED_DELIVERY_STATUSES.includes(String(order.deliveryStatus || ""))) return "Gagal";
  if (order.orderStatus === "completed" || order.deliveryStatus === "sent") return "Selesai";
  if (order.orderStatus === "processing" || isPaid(order)) return "Diproses";
  if (order.orderStatus === "cancelled") return "Dibatalkan";
  return "Menunggu";
}

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

export type RevenuePoint = {
  key: string;
  label: string;
  revenue: number;
  orders: number;
};

/**
 * One point per day for the last `days` days, oldest first.
 *
 * The series is built by walking the calendar rather than by bucketing the
 * orders that happen to be in the response. An earlier version mapped over the
 * orders and grouped them, which silently drops a day with no orders -- so a
 * quiet Tuesday made the line jump from Monday to Wednesday and the owner read
 * it as a trend. A day that sold nothing is a real data point: zero revenue,
 * and it should be drawn as a dip.
 */
export function buildRevenueSeries(orders: ApiOrder[], days: number, now = new Date()): RevenuePoint[] {
  const formatter = new Intl.DateTimeFormat("id-ID", { weekday: "short" });
  const buckets = new Map<string, { revenue: number; orders: number }>();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = startOfDay(now);
    day.setDate(day.getDate() - offset);
    buckets.set(dateKey(day), { revenue: 0, orders: 0 });
  }
  for (const order of orders) {
    if (isSmokeTest(order) || !isPaid(order)) continue;
    const created = parseDate(order.createdAt);
    if (!created) continue;
    const bucket = buckets.get(dateKey(created));
    // An order older than the window has no bucket, and one dated in the
    // future cannot be in a closed window either. Both are dropped rather
    // than forced into the nearest day.
    if (!bucket) continue;
    bucket.revenue += Number(order.total || 0);
    bucket.orders += 1;
  }
  return Array.from(buckets.entries()).map(([key, value]) => {
    const day = new Date(`${key}T00:00:00`);
    return { key, label: formatter.format(day), revenue: value.revenue, orders: value.orders };
  });
}

export type RevenueSummary = {
  today: number;
  /** Every live order placed today, paid or not. See `summariseRevenue`. */
  todayOrders: number;
  todayPaid: number;
  todayPending: number;
  yesterday: number;
  /** Null when there is no comparable day, so the UI can say "no baseline" instead of inventing a percentage. */
  changePercent: number | null;
  week: number;
  weekOrders: number;
  pending: number;
  failed: number;
  /**
   * Mean of the paid orders *inside the same window* as `week` and `weekOrders`.
   *
   * This was the mean of every paid order on record, while the number it sits
   * next to counted only the last seven days. On the overview that read as
   * "6 pesanan paid, Rp 47.600 rata-rata" directly under "Rp 291.000" for the
   * week -- and 6 x 47.600 is 285.600, not 291.000, so the row contradicted the
   * figure above it and there was no way for the owner to tell which was right.
   * Two numbers in one summary have to share a denominator, or one of them is
   * describing a different question.
   */
  averageOrderValue: number;
  /** Paid orders inside the same window as `week`. */
  paidOrders: number;
};

export function summariseRevenue(series: RevenuePoint[], orders: ApiOrder[]): RevenueSummary {
  const last = series[series.length - 1];
  const previous = series[series.length - 2];
  const today = last?.revenue ?? 0;
  const yesterday = previous?.revenue ?? 0;
  const week = series.reduce((sum, point) => sum + point.revenue, 0);
  const weekOrders = series.reduce((sum, point) => sum + point.orders, 0);

  // The tile counts every live order placed today, not just the paid ones.
  // `series` only buckets paid orders -- that is what revenue means -- so a
  // customer who ordered this morning and has not paid yet is absent from it.
  // Counting from the orders themselves, keyed on the same day the series uses
  // for its last bucket, keeps "Pesanan hari ini" honest: it is the number of
  // orders that arrived today, and the hint below it splits them by payment.
  const todayKey = last?.key;
  const todayOrders = todayKey
    ? orders.filter((order) => {
        if (isSmokeTest(order)) return false;
        const created = parseDate(order.createdAt);
        return created !== null && dateKey(created) === todayKey;
      })
    : [];
  const todayPaid = todayOrders.filter((order) => isPaid(order)).length;

  return {
    today,
    todayOrders: todayOrders.length,
    todayPaid,
    todayPending: todayOrders.length - todayPaid,
    yesterday,
    changePercent: !previous || previous.revenue === 0 ? null : ((today - previous.revenue) / previous.revenue) * 100,
    week,
    weekOrders,
    pending: orders.filter((order) => order.qrisStatus === "pending").length,
    failed: orders.filter((order) => order.deliveryStatus === "failed").length,
    paidOrders: weekOrders,
    // week / weekOrders, so the mean, the order count, and the week total in the
    // same row are one set of numbers. See RevenueSummary.averageOrderValue.
    averageOrderValue: weekOrders ? week / weekOrders : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

export type ProductPoint = { name: string; revenue: number; orders: number };

/**
 * What is actually selling, by revenue.
 *
 * Grouped on the display name rather than the product id because the owner
 * reads this to answer "which one do I restock", and a list of ids answers
 * nothing. Paid orders only -- a cancelled order is not demand.
 */
export function topProducts(orders: ApiOrder[], limit: number): ProductPoint[] {
  const buckets = new Map<string, ProductPoint>();
  for (const order of orders) {
    if (isSmokeTest(order) || !isPaid(order)) continue;
    const name = String(order.product || "-").trim() || "-";
    const existing = buckets.get(name) ?? { name, revenue: 0, orders: 0 };
    existing.revenue += Number(order.total || 0);
    existing.orders += 1;
    buckets.set(name, existing);
  }
  return Array.from(buckets.values()).sort((left, right) => right.revenue - left.revenue).slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Stock
 * ------------------------------------------------------------------ */

export type StockSummary = {
  ready: number;
  reserved: number;
  sold: number;
  total: number;
  /**
   * Products running out soon, measured in days of cover.
   *
   * Cover rather than a fixed count, because "3 left" means something different
   * for a product that sells 20 a week than for one that sells once a month.
   * Demand comes from the orders, not the stock list. Products with no demand
   * in the window fall back to a plain count -- a slow mover is not judged
   * against a rate it does not have.
   */
  lowStock: Array<{ product: string; ready: number; daysOfCover: number | null }>;
};

const DAYS_OF_COVER_LINE = 3;

/**
 * `productName` maps a stock row's `productId` to something readable.
 *
 * A stock row carries only the id -- the display name lives on the product
 * record, and the stock page resolves it the same way. It is a parameter
 * rather than a lookup against a products list passed in whole, because this
 * function only ever needs the name for the handful of rows it reports on, and
 * because a caller that has no product list should still get ids back rather
 * than blanks.
 */
export function summariseStock(stock: ApiStockItem[], orders: ApiOrder[], productName: (productId: string) => string, now = new Date()): StockSummary {
  const countOf = (item: ApiStockItem) => Math.max(1, Number(item.availableCount || 1));
  const ready = stock.filter((item) => item.status === "available").reduce((sum, item) => sum + countOf(item), 0);
  const reserved = stock.filter((item) => item.status === "reserved").length;
  const sold = stock.filter((item) => item.status === "sold").length;

  const weekAgo = new Date(startOfDay(now).getTime() - 6 * 86400000);
  const demand = new Map<string, number>();
  for (const order of orders) {
    if (isSmokeTest(order) || !isPaid(order)) continue;
    const created = parseDate(order.createdAt);
    if (!created || created < weekAgo) continue;
    const key = String(order.product || "-");
    demand.set(key, (demand.get(key) ?? 0) + 1);
  }

  // Orders carry a product *name* and stock rows carry a product *id*, so the
  // two are joined through the name resolver. When a product has been renamed
  // or the list is unavailable the id is used, and the row simply does not
  // match a demand bucket -- which understates cover rather than inventing it.
  const readyByProduct = new Map<string, number>();
  for (const item of stock) {
    if (item.status !== "available") continue;
    const product = productName(item.productId);
    readyByProduct.set(product, (readyByProduct.get(product) ?? 0) + countOf(item));
  }

  const lowStock = Array.from(readyByProduct.entries())
    .map(([product, count]) => {
      const weekly = demand.get(product) ?? 0;
      return { product, ready: count, daysOfCover: weekly > 0 ? Math.round((count / (weekly / 7)) * 10) / 10 : null };
    })
    .filter(({ product, ready: count, daysOfCover }) => {
      if (product === "-") return false;
      return daysOfCover === null ? count <= DAYS_OF_COVER_LINE : daysOfCover < DAYS_OF_COVER_LINE;
    })
    .sort((left, right) => {
      if (left.daysOfCover === null) return -1;
      if (right.daysOfCover === null) return 1;
      return left.daysOfCover - right.daysOfCover;
    });

  return { ready, reserved, sold, total: stock.length, lowStock };
}

/* ------------------------------------------------------------------ *
 * Resellers -- from the wallet ledger, not from the reseller list
 * ------------------------------------------------------------------ */

export type ResellerPoint = {
  id: string;
  name: string;
  balance: number;
  totalTopup: number;
  totalSpent: number;
  totalRefund: number;
  orders: number;
  /**
   * True when the balance will not cover one typical order.
   *
   * The comparison is against the seller's own average basket, not a global
   * one, and the typical order comes from that seller's paid history. A
   * reseller with a small balance who only ever buys cheap items is fine.
   */
  thin: boolean;
};

/**
 * Sorted by balance ascending: the reseller about to stop being able to buy is
 * the one the owner has to top up today, and sorting by name buries them.
 *
 * Balances come from `operations.wallet`, which is a real double-entry ledger
 * with `balanceAfter` on every entry. The `deposit` field on the reseller list
 * is a single running number with no history behind it, so a top-up that was
 * later clawed back is indistinguishable from one that stands. The ledger is
 * the same source the money actually moved through.
 */
export function summariseResellers(operations: OperationsCenterResult | null, orders: ApiOrder[]): ResellerPoint[] {
  const summaries = operations?.wallet?.resellerSummaries || [];
  if (!summaries.length) return [];

  const perReseller = new Map<string, { revenue: number; orders: number }>();
  for (const order of orders) {
    if (isSmokeTest(order) || !isPaid(order) || !order.resellerId) continue;
    const existing = perReseller.get(order.resellerId) ?? { revenue: 0, orders: 0 };
    existing.revenue += Number(order.total || 0);
    existing.orders += 1;
    perReseller.set(order.resellerId, existing);
  }

  return summaries
    .map((summary) => {
      const id = summary.resellerId || summary.resellerName;
      const stats = perReseller.get(id);
      const averageBasket = stats && stats.orders > 0 ? stats.revenue / stats.orders : 0;
      return {
        id,
        name: summary.resellerName,
        balance: Number(summary.currentBalance || 0),
        totalTopup: Number(summary.totalTopup || 0),
        totalSpent: Number(summary.totalSpent || 0),
        totalRefund: Number(summary.totalRefund || 0),
        orders: summary.totalOrders ?? stats?.orders ?? 0,
        thin: averageBasket > 0 && Number(summary.currentBalance || 0) < averageBasket,
      };
    })
    .sort((left, right) => left.balance - right.balance);
}

export type WalletSummary = {
  totalBalance: number;
  totalTopup: number;
  totalSpent: number;
  resellerCount: number;
  pendingRequests: number;
};

export function summariseWallet(operations: OperationsCenterResult | null): WalletSummary {
  const summary = operations?.wallet?.summary;
  return {
    totalBalance: Number(summary?.totalBalance || 0),
    totalTopup: Number(summary?.totalTopup || 0),
    totalSpent: Number(summary?.totalSpent || 0),
    resellerCount: Number(summary?.resellerCount || 0),
    pendingRequests: Number(summary?.pendingRequests || 0),
  };
}

/* ------------------------------------------------------------------ *
 * The attention queue
 *
 * The type, the total and the state arithmetic now live in
 * `components/attention/`, because the reseller console needs the same three
 * and could not reach them from here. What stays in this file is the part that
 * is genuinely the overview's: reading five collections at once and deciding
 * which nine questions that raises.
 * ------------------------------------------------------------------ */

// Re-exported so anything that used to import the queue's shape from here
// still works, but imported as well -- `export type { X } from` publishes the
// name without binding it locally, and `buildAttentionQueue` below annotates
// its return type with it.
import type { AttentionItem } from "../../../components/attention";
export type { AttentionItem, AttentionSide, AttentionTone } from "../../../components/attention";

/**
 * Ordered by what breaks money first, not by how alarming it looks. A failed
 * delivery is a customer who paid and got nothing; a Sheets mismatch is a
 * bookkeeping problem that will still be a bookkeeping problem in an hour.
 *
 * The first three are derived from live order state, so they move within
 * seconds of a payment webhook landing. The rest come from the operations
 * centre, which is a snapshot of the last audit run.
 */
export function buildAttentionQueue(orders: ApiOrder[], operations: OperationsCenterResult | null, now = new Date()): AttentionItem[] {
  const live = orders.filter((order) => !isSmokeTest(order));
  const nowMs = now.getTime();

  // All three statuses count, and they have to: the orders page filters
  // "Delivery gagal" on the same three, so a count that read only `failed`
  // would promise fewer rows than the link delivers. A tile whose number
  // disagrees with the page it opens is worse than no tile. `abandoned` is the
  // one worth naming -- the repair job gave up on it after 80 attempts, so
  // nothing else in the system will ever retry it, and it counts as attention
  // precisely because only the owner can still clear it.
  //
  // Cancelled orders are excluded from both rows below. They are neither a
  // delivery failure nor money awaiting delivery: the order was called off, and
  // the customer is not waiting on anything. They used to be counted twice --
  // once per row -- because `isPaid` accepts qrisStatus "manual" and a
  // cancelled order keeps it, so a cancelled order satisfied every term of the
  // paidNotSent predicate. In the demo runtime the two cancelled orders were
  // the entire content of both rows, which made the header claim four things
  // needed handling when there were two.
  const isCancelled = (order: ApiOrder) => String(order.orderStatus || "").toLowerCase() === "cancelled";
  const isLiveDeliveryFailure = (order: ApiOrder) => !isCancelled(order) && FAILED_DELIVERY_STATUSES.includes(String(order.deliveryStatus || ""));
  const deliveryFailed = live.filter(isLiveDeliveryFailure);
  const failedIds = new Set(deliveryFailed.map((order) => order.id));
  // Excludes the delivery-failed set, and that exclusion is the whole point.
  // These two rows are not independent readings that happen to correlate: a
  // failed order is by definition paid and not sent, so without this every
  // failure was counted twice and the header sum read "4 hal perlu ditangani"
  // for two orders. The rows are now disjoint by construction and can be added.
  //
  // What is left is the genuinely in-flight set: money settled, delivery not
  // attempted yet or still retrying. Those are the ones the 45-second repair job
  // is actively working on, which is why the row is a warning and not a danger.
  const paidNotSent = live.filter((order) => isPaid(order) && !isCancelled(order) && !failedIds.has(order.id) && order.orderStatus !== "completed" && order.deliveryStatus !== "sent");

  // The reason the delivery failed, so the owner reads why on the row instead of
  // opening each order. `deliveryError` is written by the fulfillment code on
  // every known failure path and is already rendered in the order drawer; this
  // is the same string, surfaced one level earlier. Orders with no reason (the
  // repair job gives up without setting one) contribute nothing rather than an
  // empty label.
  const reasons = deliveryFailed.map((order) => String(order.deliveryError || "").trim()).filter(Boolean);
  // One line only: a queue cell has room for a sentence, not for every distinct
  // cause. When the failures share a cause -- which they do, because a bad
  // product config fails every order the same way -- that one sentence is the
  // whole story. Distinct causes are counted instead so the owner knows the row
  // is not one thing.
  const reasonCounts = new Map<string, number>();
  for (const reason of reasons) reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const deliveryDetail = !topReason
    ? ""
    : reasonCounts.size === 1
      ? topReason[0]
      : `${topReason[0]} (+${reasonCounts.size - 1} alasan lain)`;
  const pendingOverdue = live.filter((order) => {
    if (order.qrisStatus !== "pending" || !order.paymentExpiresAt) return false;
    const expiry = parseDate(order.paymentExpiresAt)?.getTime() ?? Infinity;
    return expiry < nowMs;
  });
  const pendingFresh = live.filter((order) => order.qrisStatus === "pending" && !pendingOverdue.includes(order));

  const reconcile = operations?.reconcile?.summary;
  const sheet = operations?.sheetsAudit?.summary;
  const expiry = operations?.expiry?.summary;
  const manual = operations?.manual?.summary;
  const delivery = operations?.deliveryAudit?.summary;

  const count = (...values: Array<number | undefined>) => values.reduce<number>((sum, value) => sum + Number(value || 0), 0);

  return [
    {
      id: "delivery-failed",
      label: "Delivery gagal",
      count: deliveryFailed.length,
      hint: "Sudah dibayar tapi fulfillment gagal. Sudah dicoba ulang otomatis.",
      detail: deliveryDetail,
      tone: "danger",
      side: "system",
      // The orders page has a real `delivery-failed` filter whose predicate is
      // the same delivery states counted here, so this lands on exactly the rows
      // the number refers to, and each one opens an order you can act on.
      path: "/owner-v2/orders?status=delivery-failed",
    },
    {
      id: "paid-not-sent",
      label: "Paid belum terkirim",
      count: paidNotSent.length,
      // Not a danger on its own. The fulfillment-repair job re-attempts every
      // unsent paid order every 45 seconds, so for the first few minutes after a
      // payment lands this row is simply the system doing its job. Describing it
      // as urgent taught the owner to ignore the row; it is `warning` because it
      // only matters once it stops shrinking, which the hint now says.
      hint: "Uang masuk, akun belum sampai. Sistem mencoba ulang tiap 45 detik.",
      tone: "warning",
      side: "system",
      // This pointed at `?focus=delivery`, which renders `deliveryAudit.items`.
      // That builder only emits rows for orders that are ALREADY finished --
      // sent-but-no-account, fewer-accounts-than-qty, needs_redelivery,
      // WhatsApp-failed. It never emits a row for a paid-but-unsent order, so
      // the owner clicked a count of N and landed on a page not containing
      // those N orders. The rows that do exist are `manual-order-paid-*` in the
      // manual queue (server/index.js:7701), each carrying the delivery status
      // as its detail, so that is where this link goes.
      path: "/owner-v2/operations?focus=manual",
    },
    {
      id: "expired-active",
      label: "Expired tapi masih aktif",
      count: count(expiry?.expiredActive),
      hint: "Akun lewat masa aktif belum kembali ke stok.",
      tone: "danger",
      side: "you",
      path: "/owner-v2/operations?focus=expiry",
    },
    {
      id: "stock-anomaly",
      label: "Anomali stok",
      count: count(reconcile?.high, delivery?.missingAccounts),
      // Split by who can act, because "anomali stok" was one number for two
      // unrelated things. Most of what reconciliation finds is the system
      // disagreeing with itself -- a stale reservation, a duplicated account
      // record, a sale with no trace -- and no edit to Sheets resolves any of
      // those. A minority are rows the owner typed wrong and can fix in a
      // minute. Presenting both as one alarm sent them to the wrong place and
      // taught them the queue was not actionable.
      hint: reconcile?.highOwnerFixable
        ? `${reconcile.highOwnerFixable} baris Data Sheets salah, ${reconcile.highSystemSide || 0} masalah sistem.`
        : "Tidak ada baris Sheets yang salah. Sisanya masalah sistem.",
      tone: "warning",
      // This is the one row that is genuinely two rows wearing a coat, so the
      // tag is derived from which half is larger rather than asserted. Calling
      // it "kamu" when 12 of 14 findings are the system disagreeing with
      // itself would send the owner to Sheets to look for a typo that is not
      // there -- the exact failure the split exists to prevent, reintroduced
      // one level up. The hint below already carries both numbers, so the tag
      // and the sentence cannot disagree.
      side: Number(reconcile?.highOwnerFixable || 0) >= Number(reconcile?.highSystemSide || 0) ? "you" : "system",
      path: "/owner-v2/operations?focus=stock",
    },
    {
      id: "sync-warning",
      label: "Peringatan sinkronisasi",
      count: count(sheet?.invalid, sheet?.mismatch, sheet?.duplicateStock),
      hint: "Baris invalid, tidak cocok, atau duplikat.",
      tone: "warning",
      side: "you",
      path: "/owner-v2/operations?focus=sheets",
    },
    {
      id: "expiring-soon",
      label: "Segera expired",
      count: count(expiry?.expiringSoon),
      hint: "Akun habis masa aktif dalam 5 hari.",
      tone: "warning",
      side: "you",
      path: "/owner-v2/operations?focus=expiry",
    },
    {
      id: "deposit-pending",
      label: "Topup menunggu",
      count: count(manual?.pendingDeposits, operations?.wallet?.summary?.pendingRequests),
      hint: "Permintaan isi saldo belum diproses.",
      tone: "warning",
      side: "you",
      // No query parameter: the reseller page already renders the pending
      // deposit table below the reseller list, so a bare path lands on the
      // queue. A `?tab=` that nothing reads would be a link that looks
      // targeted and is not.
      path: "/owner-v2/resellers",
    },
    {
      id: "pending-overdue",
      label: "Pending lewat batas",
      count: pendingOverdue.length,
      hint: "QRIS sudah kedaluwarsa tapi masih menggantung.",
      tone: "info",
      side: "you",
      path: "/owner-v2/orders?status=pending",
    },
    {
      id: "pending",
      label: "Menunggu pembayaran",
      count: pendingFresh.length,
      hint: "QRIS aktif, masih dalam masa bayar.",
      tone: "info",
      side: "system",
      path: "/owner-v2/orders?status=pending",
    },
  ];
}

/** Only the rows that need a decision. A queue showing a row of zeroes is noise. */
export { attentionTotal } from "../../../components/attention";

/* ------------------------------------------------------------------ *
 * System
 * ------------------------------------------------------------------ */

export type ServiceState = "ok" | "warning" | "down";

export type ServiceRow = {
  id: string;
  label: string;
  detail: string;
  state: ServiceState;
  path: string;
};

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam`;
  return `${Math.floor((seconds % 3600) / 60)} menit`;
}

/**
 * A stale Sheets sync is the failure mode that hides best: the last run
 * reported healthy, so every screen downstream says green while the sheet has
 * been stale for hours. `lastSyncAt` is only trusted when the most recent
 * *attempt* also landed, because a run that tried and failed is not the same
 * as a run that never tried.
 */
export function serviceRows(system: SystemStatus | null): ServiceRow[] {
  if (!system) return [];
  const sheets = system.integrations?.googleSheets;
  const attempt = sheets?.lastSyncAttemptAt ? parseDate(sheets.lastSyncAttemptAt)?.getTime() ?? 0 : 0;
  const lastSync = sheets?.lastSyncAt ? parseDate(sheets.lastSyncAt)?.getTime() ?? 0 : 0;
  const sheetsStale = lastSync > 0 && attempt > lastSync;
  const sheetsFresh = lastSync > 0 && !sheetsStale;

  return [
    {
      id: "whatsapp",
      label: "WhatsApp",
      detail: system.whatsapp.connected ? system.whatsapp.state || "Terhubung" : system.whatsapp.error || "Tidak terhubung",
      state: system.whatsapp.connected ? (system.whatsapp.state === "open" ? "ok" : "warning") : "down",
      path: "/owner-v2/whatsapp",
    },
    {
      id: "sheets",
      label: "Google Sheets",
      detail: !sheets?.configured
        ? "Belum dikonfigurasi"
        : sheetsStale
          ? "Sinkron terakhir gagal"
          : sheetsFresh
            ? `Sinkron ${sheets.lastSyncAt}`
            : "Belum pernah sinkron",
      state: !sheets?.configured ? "down" : sheetsStale ? "down" : sheetsFresh ? "ok" : "warning",
      path: "/owner-v2/integrations",
    },
    {
      id: "pakasir",
      label: "Pakasir",
      detail: system.integrations?.pakasir?.configured ? `Merchant ${system.integrations.pakasir.merchantId || "-"}` : "Belum dikonfigurasi",
      state: system.integrations?.pakasir?.configured ? "ok" : "down",
      path: "/owner-v2/integrations",
    },
    {
      id: "vps",
      label: "VPS",
      // A high restart count is a crash loop that has already recovered. It is
      // the cheapest crash detector the server offers and nothing else reads
      // it, so it is surfaced here rather than lost.
      detail: `${system.server.platform} · uptime ${formatUptime(system.server.uptime)}${
        system.pm2?.available && system.pm2.restartCount > 0 ? ` · restart ${system.pm2.restartCount}×` : ""
      }`,
      state: !system.ok ? "down" : (system.pm2?.available && system.pm2.restartCount >= 3) || system.memory.percent > 92 ? "warning" : "ok",
      path: "/owner-v2/health",
    },
    {
      id: "tunnel",
      label: "Tunnel",
      detail: system.tunnel.publicDomain || "Domain belum terpasang",
      state: system.tunnel.running ? "ok" : system.tunnel.configured ? "warning" : "down",
      path: "/owner-v2/health",
    },
  ];
}

/** The server's own warnings, which no screen currently reads. */
export function systemWarnings(system: SystemStatus | null): string[] {
  return system?.warnings || [];
}
