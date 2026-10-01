import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { ErrorState, LoadingState } from "../../../components/ui";
import { formatRupiah } from "../../../lib/format";
import type { ResellerPoint } from "./analytics";

/**
 * Reseller balances, thinnest first.
 *
 * These come from `operations.wallet`, a double-entry ledger the server already
 * builds on every operations call, and which no screen was rendering. The
 * reseller list itself carries a single `deposit` running number with no
 * history, so a top-up that was later clawed back looks identical to one that
 * stands. Showing top-up, spend and refund side by side is what makes the
 * balance legible -- a balance of zero with a large refund total is a very
 * different situation from a balance of zero with no activity, and the single
 * number cannot tell them apart.
 */
export function ResellerBalances({ rows, loading, error, onRetry }: { rows: ResellerPoint[]; loading: boolean; error?: string; onRetry: () => void }) {
  if (loading) return <LoadingState label="Memuat saldo reseller" />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows.length) {
    return <p className="console-queue-empty">Belum ada ledger saldo. Saldo reseller tercatat begitu ada topup pertama.</p>;
  }
  return (
    <ul className="console-balance-list">
      {rows.map((row) => (
        <li key={row.id}>
          <Link to={`/owner-v2/resellers?reseller=${encodeURIComponent(row.id)}`}>
            <span className="console-balance-name">
              <strong>{row.name}</strong>
              <small>
                {row.orders} order · topup {formatRupiah(row.totalTopup)} · spend {formatRupiah(row.totalSpent)}
                {row.totalRefund > 0 ? ` · refund ${formatRupiah(row.totalRefund)}` : ""}
              </small>
            </span>
            <span className={`console-balance-amount${row.thin ? " is-thin" : ""}`}>
              {row.thin ? <AlertTriangle size={13} aria-label="Saldo di bawah satu order biasa" /> : null}
              <strong>{formatRupiah(row.balance)}</strong>
            </span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
