import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";
import { api, subscribeRealtime, type WalletLedgerEntry } from "../../../lib/api";
import { formatDateTime, formatRupiah } from "../../../lib/format";
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";
import { systemStateFor } from "../../../components/attention";
import {
  Badge,
  Button,
  DataTable,
  type DataColumn,
  ErrorState,
  MetricRow,
  Notice,
} from "../../../components/ui";
import "./balance.css";

type LedgerSummary = {
  totalTopup: number;
  totalSpent: number;
  totalRefund: number;
  totalLateCredit: number;
  totalOrders: number;
};

/**
 * The six money paths `buildWalletLedger` knows about, in Indonesian.
 *
 * The server sends `type` as a stable machine key, and the owner console reads
 * that key directly. This page is the opposite: a dealer does not know what
 * `stock_race_credit` means and has no reason to. Mapping the six here rather
 * than showing the key means a new server-side path shows up as a gap to fill
 * instead of as an English identifier on a page that is otherwise Indonesian.
 */
function entryLabel(entry: WalletLedgerEntry) {
  switch (entry.type) {
    case "order_spend":
      return "Pembelian";
    case "deposit_refund":
      return "Refund pesanan";
    case "stock_race_credit":
      return "Kredit stok habis";
    case "late_paid_credit":
      return "Kredit bayar telat";
    case "deposit_topup_paid":
      return "Top up QRIS";
    case "manual_topup":
      return "Top up manual";
    default:
      return "Perubahan saldo";
  }
}

/**
 * Whether a movement grew or shrank the balance, from the server's `kind`.
 *
 * Not from the sign of `amount`. A refund and a late-paid credit are both
 * credits that arrived because something went wrong, and both are positive.
 * What the dealer needs beside the number is "did this help me or cost me" --
 * so it reads the same field the ledger summary totals read.
 */
function isCredit(entry: WalletLedgerEntry) {
  return entry.kind === "credit";
}

export default function ResellerV2BalancePage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<WalletLedgerEntry[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [balance, setBalance] = useState(0);
  const [requestState, setRequestState] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setRequestState("loading");
    try {
      const result = await api.balanceHistory();
      setEntries(result.entries || []);
      setSummary(result.summary);
      setBalance(Number(result.balance || 0));
      setError("");
      setRequestState("success");
    } catch {
      // Same rule as the orders page: a silent refresh that fails leaves the
      // visible ledger alone rather than replacing it with an error.
      if (!options.silent) {
        setError("Riwayat saldo belum dapat dimuat. Periksa koneksi lalu coba lagi.");
        setRequestState("error");
      }
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    return subscribeRealtime(() => {
      load({ silent: true }).catch(() => undefined);
    });
  }, [load]);

  /* A negative balance is the one thing on this page the dealer can act on
     without reading a single row: the ledger records a debit against an
     account that was already short, so a `manual_topup` has not landed yet and
     money is owed. Passing a literal 0 instead would satisfy nothing -- the
     shell renders no pill for 0, which reads as "nothing here needs looking
     at", and that is exactly the wrong reading of an owed balance. */
  const balanceAttention = balance < 0 ? 1 : 0;

  const credits = useMemo(
    () => entries.filter(isCredit).reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    [entries],
  );
  const debits = useMemo(
    () => entries.filter((entry) => !isCredit(entry)).reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    [entries],
  );

  const columns: Array<DataColumn<WalletLedgerEntry>> = [
    {
      id: "created",
      header: "Waktu",
      value: (entry) => entry.createdAt,
      cell: (entry) => <span className="reseller-v2-balance-muted">{formatDateTime(entry.createdAt)}</span>,
      sortable: true,
    },
    {
      id: "kind",
      header: "Jenis",
      value: (entry) => entryLabel(entry),
      cell: (entry) => (
        <div className="reseller-v2-balance-kind">
          <Badge tone={isCredit(entry) ? "success" : "default"}>{entryLabel(entry)}</Badge>
          <small>{entry.detail}</small>
        </div>
      ),
    },
    {
      id: "amount",
      header: "Nominal",
      value: (entry) => Number(entry.amount || 0),
      cell: (entry) => (
        <span className={isCredit(entry) ? "reseller-v2-balance-credit" : "reseller-v2-balance-debit"}>
          {isCredit(entry) ? "+" : "-"}
          {formatRupiah(Number(entry.amount || 0))}
        </span>
      ),
      sortable: true,
    },
    {
      id: "after",
      header: "Saldo akhir",
      value: (entry) => Number(entry.balanceAfter ?? 0),
      // `balanceAfter` is absent on the rows that have no anchor: a refund and
      // a manual topup are recorded without the balance the order was taken
      // from. Those rows show nothing rather than a fabricated zero, which
      // would read as "this left you at nothing".
      cell: (entry) => (
        <span className="reseller-v2-balance-muted">
          {entry.balanceAfter === undefined || entry.balanceAfter === null
            ? "-"
            : formatRupiah(Number(entry.balanceAfter))}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      id: "ref",
      header: "Referensi",
      value: (entry) => entry.orderId || entry.requestId || "",
      cell: (entry) => {
        const ref = entry.orderId || entry.requestId;
        if (!ref) return <span className="reseller-v2-balance-muted">-</span>;
        return (
          <Button
            weight="quiet"
            className="reseller-v2-balance-ref"
            onClick={() => navigate(entry.orderId ? "/reseller-v2/orders" : "/reseller-v2/ringkasan")}
          >
            {ref}
          </Button>
        );
      },
      hideOnMobile: true,
    },
  ];

  return (
    <ResellerShell
      title="Riwayat Saldo"
      description="Setiap rupiah yang masuk dan keluar dari saldo Anda, beserta sisa saldo setiap transaksi."
      onRefresh={() => load().catch(() => undefined)}
      loading={requestState === "loading"}
      attentionCount={balanceAttention}
      systemState={systemStateFor(balanceAttention, { error: Boolean(error), loading: requestState === "loading" })}
    >
      <div className="reseller-v2-balance">
        <MetricRow
          label="Ringkasan saldo"
          items={[
            {
              label: "Saldo Saat Ini",
              value: requestState === "loading" ? "..." : formatRupiah(balance),
              hint: "Saldo yang siap dipakai",
              icon: <Wallet size={16} />,
            },
            {
              label: "Total Masuk",
              value: formatRupiah(credits),
              hint: "Top up dan kredit",
              icon: <ArrowUpRight size={16} />,
              tone: "success",
            },
            {
              label: "Total Keluar",
              value: formatRupiah(debits),
              hint: "Pemakaian untuk pembelian",
              icon: <ArrowDownRight size={16} />,
            },
          ]}
        />

        {/* The summary totals are the ledger's own, which are computed over the
            whole history. The metric row above sums what is on screen, and the
            server caps entries at 120 -- so on a long-running account those two
            disagree by design. Saying so is better than letting a dealer find
            the discrepancy and conclude the money is wrong. */}
        {summary && Number(summary.totalOrders || 0) > 0 ? (
          <Notice tone="muted">
            Sepanjang akun ini tercatat {summary.totalOrders} pembelian dengan total pengeluaran{" "}
            {formatRupiah(Number(summary.totalSpent || 0))}, termasuk yang sudah keluar dari 120
            transaksi terakhir di tabel.
          </Notice>
        ) : null}

        {requestState === "error" ? <ErrorState message={error} /> : null}

        {/* Named on screen as well as in the shell pill. A negative balance is
            the only row on this page that asks the dealer to do something, and
            a badge in a nav rail is not something anyone reads from the page
            they are already on. */}
        {balance < 0 ? (
          <Notice tone="danger">
            Saldo Anda minus {formatRupiah(Math.abs(balance))}. Ada pesanan yang memakai saldo
            sebelum top up masuk -- hubungi owner kalau ini tidak sesuai.
          </Notice>
        ) : null}

        <DataTable
          rows={entries}
          columns={columns}
          rowKey={(entry) => entry.id}
          initialPageSize={8}
          loading={requestState === "loading"}
          error={requestState === "error" ? error : ""}
          emptyText="Belum ada perubahan saldo."
          filters={[
            {
              id: "kind",
              label: "Arah",
              options: [
                { label: "Semua", value: "" },
                { label: "Masuk", value: "credit" },
                { label: "Keluar", value: "debit" },
              ],
              value: (entry) => entry.kind,
            },
          ]}
        />
      </div>
    </ResellerShell>
  );
}