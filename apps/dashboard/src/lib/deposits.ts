/**
 * How a purchase is paid for: what the deposit covers, what is left.
 *
 * This mirrors `depositBreakdown` in `server/auto-order.js`:
 *
 *     const depositUsed = Math.min(depositBefore, Math.max(0, Number(total || 0)));
 *     return { depositUsed, depositAfter, paymentDue: total - depositUsed };
 *
 * It exists in the client for one reason: **the catalog used to be silent about
 * it.** A dealer with Rp50.000 of deposit picked a Rp75.000 package, pressed
 * "Lanjut ke Checkout", and only on the checkout page discovered that
 * Rp25.000 was coming out of their own pocket as QRIS. The split is not an
 * edge case -- it is the normal path for anybody whose balance does not happen
 * to cover the whole order.
 *
 * Two rules this file holds to:
 *
 * 1. **It never blocks.** Checkout stays available at Rp0. The server does not
 *    refuse an order the deposit cannot cover, it splits it; a UI that
 *    disabled the button would be refusing something the product sells, and
 *    would break a flow that currently works. The only honest response to "you
 *    cannot afford this outright" is to say what the shortfall is *before* the
 *    dealer commits, not to stop them finding out afterwards.
 * 2. **It never invents a limit.** Nothing here is a minimum order value or a
 *    maximum top-up -- the server enforces neither.
 */

export type DepositSplit = {
  /** The reseller's balance before this purchase. */
  balance: number;
  /** The order total. */
  total: number;
  /** How much of the balance this purchase consumes. Never more than `balance` or `total`. */
  depositUsed: number;
  /** What is left of the balance afterwards. */
  depositAfter: number;
  /** What still has to be paid by QRIS. `0` when the balance covers everything. */
  paymentDue: number;
  /** True when the balance alone does not cover the total. */
  isShort: boolean;
};

/**
 * The same arithmetic as the server, in the same order.
 *
 * `Math.min` before the subtraction is what makes a large balance safe: a
 * Rp500.000 balance on a Rp75.000 order must leave `paymentDue: 0`, not a
 * negative amount that would render as a refund.
 */
export function depositSplit(balance: number, total: number): DepositSplit {
  const safeBalance = Math.max(0, Number(balance) || 0);
  const safeTotal = Math.max(0, Number(total) || 0);
  const depositUsed = Math.min(safeBalance, safeTotal);

  return {
    balance: safeBalance,
    total: safeTotal,
    depositUsed,
    depositAfter: Math.max(0, safeBalance - depositUsed),
    paymentDue: Math.max(0, safeTotal - depositUsed),
    isShort: safeBalance < safeTotal,
  };
}

/**
 * The one sentence the catalog shows under the checkout button.
 *
 * Returns "" when the balance covers the order, because the interesting case
 * is only the one where money is still owed -- a notice under a fully-covered
 * purchase would train the dealer to ignore that spot. Returns "" for a
 * zero-price selection too: "Rp0 masih harus dibayar" is a worse sentence than
 * no sentence.
 */
export function splitNotice(split: DepositSplit, format: (value: number) => string): string {
  if (!split.total) return "";
  if (!split.isShort) return "";
  if (split.balance <= 0) {
    return `Saldo ${format(0)}. Seluruh ${format(split.total)} dibayar lewat QRIS.`;
  }
  return (
    `Saldo ${format(split.balance)} menutup ${format(split.depositUsed)}. ` +
    `Sisa ${format(split.paymentDue)} dibayar lewat QRIS.`
  );
}