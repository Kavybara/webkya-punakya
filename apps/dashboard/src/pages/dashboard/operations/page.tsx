import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel, FilterPill, OwnerStat, PageToolbar, SearchBox } from "../../../components/feature/OwnerUi";
import {
  api,
  subscribeRealtime,
  type ApiOrder,
  type ApiReseller,
  type ExpiryQueueItem,
  type GoogleSheetsStatus,
  type MaintenanceState,
  type OperationIssue,
  type OperationsCenterResult,
  type WalletLedgerEntry,
  type WalletLedgerResellerSummary,
  type WhatsappHealthMessage,
  type WhatsappSilentGroup,
} from "../../../lib/api";
import { formatRupiah } from "../../../mocks/data";

type OperationsTab = "reconcile" | "reseller" | "expiry" | "manual" | "wallet" | "whatsapp";

const tabs: Array<{ id: OperationsTab; label: string }> = [
  { id: "reconcile", label: "Reconcile" },
  { id: "reseller", label: "Reseller Health" },
  { id: "expiry", label: "Expiry" },
  { id: "manual", label: "Manual Queue" },
  { id: "wallet", label: "Wallet Ledger" },
  { id: "whatsapp", label: "WhatsApp Health" },
];

function parseDate(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const parsed = new Date(normalized.includes("T") ? normalized : normalized.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateText(value = "") {
  const parsed = parseDate(value);
  if (!parsed) return value || "-";
  return parsed.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactDate(value = "") {
  return dateText(value);
}

function severityVariant(value = ""): "emerald" | "red" | "amber" | "slate" {
  if (value === "high") return "red";
  if (value === "medium") return "amber";
  if (value === "low") return "slate";
  return "emerald";
}

function connectionVariant(connected: boolean): "emerald" | "red" {
  return connected ? "emerald" : "red";
}

function orderStateVariant(order: ApiOrder): "emerald" | "red" | "amber" | "slate" {
  const delivery = String(order.deliveryStatus || "").toLowerCase();
  const qris = String(order.qrisStatus || "").toLowerCase();
  if (delivery === "sent" || delivery === "stock_unavailable_deposit" || delivery === "late_paid_deposit") return "emerald";
  if (delivery === "failed") return "red";
  if (qris === "paid" || ["paid", "processing", "paid_after_expired", "paid_by_deposit"].includes(delivery)) return "amber";
  return "slate";
}

function orderStateLabel(order: ApiOrder) {
  const delivery = String(order.deliveryStatus || "").toLowerCase();
  const qris = String(order.qrisStatus || "").toLowerCase();
  if (delivery === "sent") return "Akun terkirim";
  if (delivery === "stock_unavailable_deposit") return "Dana pindah ke deposit";
  if (delivery === "late_paid_deposit") return "Late paid ke deposit";
  if (delivery === "failed") return "Delivery gagal";
  if (qris === "paid" || ["paid", "processing", "paid_after_expired", "paid_by_deposit"].includes(delivery)) return "Paid, belum final";
  if (qris === "expired") return "QRIS expired";
  return "Menunggu bayar";
}

function isRecoveryFinal(order: ApiOrder) {
  return ["sent", "stock_unavailable_deposit", "late_paid_deposit"].includes(String(order.deliveryStatus || "").toLowerCase());
}

function isDepositOrder(order: ApiOrder) {
  const runtime = order as Record<string, unknown>;
  return String(runtime.orderType || runtime.type || "").toLowerCase() === "deposit_topup";
}

function recoveryOrderMoment(order: ApiOrder) {
  const runtime = order as Record<string, unknown>;
  return String(runtime.paidAt || order.createdAt || "").trim();
}

function isPendingOverdue(order: ApiOrder) {
  if (String(order.qrisStatus || "").toLowerCase() !== "pending") return false;
  const expiresAt = parseDate(order.paymentExpiresAt || "");
  if (!expiresAt) return false;
  return expiresAt.getTime() < Date.now();
}

function syncErrorCount(summary?: Record<string, unknown> | null) {
  if (!summary) return 0;
  return Object.values(summary).reduce<number>((total, item) => {
    if (!item || typeof item !== "object") return total;
    const current = item as Record<string, unknown>;
    const hasError = Boolean(current.error || current.reason);
    const warnings = Array.isArray(current.warnings) ? current.warnings.length : 0;
    return total + (hasError ? 1 : 0) + warnings;
  }, 0);
}

function matchesQuery(query: string, values: Array<string | number | null | undefined>) {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(search));
}

function sheetAuditRowsFromIssues(rows: OperationIssue[]) {
  return rows.filter((item) => {
    const kind = String(item.kind || "").toLowerCase();
    const title = String(item.title || "").toLowerCase();
    const detail = String(item.detail || "").toLowerCase();
    return kind === "sheet" || title.includes("sheet") || title.includes("metadata") || detail.includes("sheet");
  });
}

function anomalyLabel(order: ApiOrder) {
  const delivery = String(order.deliveryStatus || "").toLowerCase();
  if (delivery === "failed") return "Delivery gagal";
  if (isPendingOverdue(order)) return "QRIS pending lewat batas";
  if (String(order.qrisStatus || "").toLowerCase() === "paid") return "Sudah paid, belum final";
  if (["paid", "processing", "paid_after_expired", "paid_by_deposit"].includes(delivery)) return "Pengiriman belum final";
  return "Perlu dicek";
}

function anomalyTone(order: ApiOrder): "emerald" | "red" | "amber" | "slate" {
  const delivery = String(order.deliveryStatus || "").toLowerCase();
  if (delivery === "failed") return "red";
  if (isPendingOverdue(order)) return "amber";
  if (String(order.qrisStatus || "").toLowerCase() === "paid") return "amber";
  return "slate";
}

function traceTone(tone = ""): "emerald" | "red" | "amber" | "info" | "slate" {
  if (tone === "red") return "red";
  if (tone === "amber") return "amber";
  if (tone === "emerald") return "emerald";
  if (tone === "violet") return "info";
  return "slate";
}

function orderTimeline(order: ApiOrder) {
  const paidAt = String((order as Record<string, unknown>).paidAt || "").trim();
  return [
    { label: "Order dibuat", value: order.createdAt || "", tone: "slate" },
    Number(order.depositUsed || 0) > 0 ? { label: `Deposit dipakai ${formatRupiah(Number(order.depositUsed || 0))}`, value: order.createdAt || "", tone: "amber" } : null,
    paidAt ? { label: "Pembayaran diterima", value: paidAt, tone: "amber" } : null,
    order.fulfillmentSentAt ? { label: "Akun/SNK terkirim", value: order.fulfillmentSentAt, tone: "emerald" } : null,
    order.whatsappNotificationSentAt ? { label: "Notif reseller terkirim", value: order.whatsappNotificationSentAt, tone: "emerald" } : null,
    order.depositRefunded ? { label: `Deposit dikembalikan ${formatRupiah(Number(order.depositUsed || 0))}`, value: order.depositRefundedAt || "", tone: "emerald" } : null,
    order.latePaidDepositCredited ? { label: `Pembayaran telat masuk deposit ${formatRupiah(Number(order.latePaidDepositAmount || 0))}`, value: order.latePaidDepositCreditedAt || "", tone: "emerald" } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; tone: string }>;
}

function accountLabel(account: NonNullable<ApiOrder["deliveredAccounts"]>[number]) {
  const identity = [account.email, account.password].filter(Boolean).join(" / ");
  const extras = [account.profile, account.pin].filter(Boolean).join(" / ");
  return extras ? `${identity} (${extras})` : identity || "-";
}

function QueueTable({
  rows,
  emptyText,
}: {
  rows: Array<OperationIssue | ExpiryQueueItem>;
  emptyText: string;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400 shadow-sm shadow-slate-950/5">
          <tr>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Judul</th>
            <th className="px-4 py-3 font-medium">Catatan</th>
            <th className="px-4 py-3 font-medium">Waktu</th>
            <th className="px-4 py-3 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const title = "title" in row ? row.title : `${row.product} ${row.variant}`.trim() || row.email || row.accountId;
            const detail = "detail" in row ? row.detail : `${row.email || row.accountId} - ${row.needsAction}`;
            const createdAt = "expiresAt" in row ? row.expiresAt : row.createdAt;
            const href = row.href || "";
            return (
              <tr key={row.id} className="border-t border-gray-100 text-slate-700">
                <td className="px-4 py-4 align-top">
                  <Badge variant={severityVariant(row.severity || "")}>{row.severity || "info"}</Badge>
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="font-semibold text-slate-900">{title}</div>
                  {"status" in row && row.status ? <div className="mt-1 text-[11px] text-slate-400">{row.status}</div> : null}
                </td>
                <td className="px-4 py-4 align-top text-slate-500">{detail}</td>
                <td className="px-4 py-4 align-top text-slate-500">{dateText(createdAt || "")}</td>
                <td className="px-4 py-4 text-right align-top">
                  {href ? (
                    <Link to={href} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                      Buka
                    </Link>
                  ) : (
                    <span className="text-[11px] text-slate-400">-</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                {emptyText}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function WalletTable({
  summaries,
  entries,
}: {
  summaries: WalletLedgerResellerSummary[];
  entries: WalletLedgerEntry[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.2fr]">
      <DataPanel className="overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-950">Ringkasan Reseller</p>
          <p className="mt-1 text-xs text-slate-500">Posisi saldo dan arus saldo per reseller.</p>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Reseller</th>
                <th className="px-4 py-3 font-medium">Saldo</th>
                <th className="px-4 py-3 font-medium">Topup</th>
                <th className="px-4 py-3 font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((row) => (
                <tr key={`${row.resellerId}-${row.resellerName}`} className="border-t border-gray-100 text-slate-700">
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-900">{row.resellerName}</div>
                    <div className="mt-1 text-[11px] text-slate-400">{row.whatsapp || "-"}</div>
                  </td>
                  <td className="px-4 py-4 font-semibold text-slate-900">{formatRupiah(Number(row.currentBalance || 0))}</td>
                  <td className="px-4 py-4 text-emerald-700">{formatRupiah(Number(row.totalTopup || 0))}</td>
                  <td className="px-4 py-4 text-red-600">{formatRupiah(Number(row.totalSpent || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataPanel>

      <DataPanel className="overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-950">Ledger Terbaru</p>
          <p className="mt-1 text-xs text-slate-500">Mutasi saldo terbaru dari order, topup, refund, dan kredit khusus.</p>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Waktu</th>
                <th className="px-4 py-3 font-medium">Reseller</th>
                <th className="px-4 py-3 font-medium">Jenis</th>
                <th className="px-4 py-3 font-medium">Nominal</th>
                <th className="px-4 py-3 font-medium">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-gray-100 text-slate-700">
                  <td className="px-4 py-4 text-slate-500">{dateText(entry.createdAt)}</td>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-900">{entry.resellerName}</div>
                    <div className="mt-1 text-[11px] text-slate-400">{entry.whatsapp || "-"}</div>
                  </td>
                  <td className="px-4 py-4">
                    <Badge variant={entry.kind === "credit" ? "emerald" : "red"}>{entry.type}</Badge>
                  </td>
                  <td className={`px-4 py-4 font-semibold ${entry.kind === "credit" ? "text-emerald-700" : "text-red-600"}`}>
                    {entry.kind === "credit" ? "+" : "-"}
                    {formatRupiah(Number(entry.amount || 0))}
                  </td>
                  <td className="px-4 py-4 text-slate-500">
                    <div>{entry.detail}</div>
                    {(entry.balanceBefore != null || entry.balanceAfter != null) ? (
                      <div className="mt-1 text-[11px] text-slate-400">
                        {formatRupiah(Number(entry.balanceBefore || 0))} -&gt; {formatRupiah(Number(entry.balanceAfter || 0))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataPanel>
    </div>
  );
}

function WhatsappMessages({ rows }: { rows: WhatsappHealthMessage[] }) {
  return (
    <DataPanel className="overflow-hidden">
      <div className="border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-950">Pesan WhatsApp Terbaru</p>
        <p className="mt-1 text-xs text-slate-500">Snapshot inbound dan outbound bot terakhir.</p>
      </div>
      <div className="max-h-[420px] divide-y divide-gray-100 overflow-auto">
        {rows.map((item) => (
          <div key={item.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={item.direction === "inbound" ? "amber" : "emerald"}>{item.direction}</Badge>
              <span className="text-xs text-slate-400">{dateText(item.createdAt)}</span>
              <span className="text-xs text-slate-500">{item.from || item.to || "-"}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-slate-700">{item.body || "-"}</p>
          </div>
        ))}
        {!rows.length ? <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada log pesan WhatsApp.</div> : null}
      </div>
    </DataPanel>
  );
}

function SilentGroups({ rows }: { rows: WhatsappSilentGroup[] }) {
  return (
    <DataPanel className="overflow-hidden">
      <div className="border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-950">Grup yang Perlu Dicek</p>
        <p className="mt-1 text-xs text-slate-500">Deteksi cepat grup aktif yang belum sinkron, bot belum join, atau list-nya kosong.</p>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Grup</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Masalah</th>
              <th className="px-4 py-3 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className="border-t border-gray-100 text-slate-700">
                <td className="px-4 py-4">
                  <div className="font-semibold text-slate-900">{item.name}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{item.groupJid || "-"}</div>
                </td>
                <td className="px-4 py-4">
                  <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
                  <div className="mt-1 text-[11px] text-slate-400">join: {item.joinStatus || "-"}, list: {Number(item.listCount || 0)}</div>
                </td>
                <td className="px-4 py-4 text-slate-500">{item.reason}</td>
                <td className="px-4 py-4 text-right">
                  {item.href ? (
                    <Link to={item.href} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                      Buka
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                  Tidak ada grup aktif yang kelihatan bermasalah.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </DataPanel>
  );
}

function OrderRecoveryTable({
  rows,
  actionLoading,
  onRetry,
  onCheckPayment,
  onMarkPaid,
}: {
  rows: ApiOrder[];
  actionLoading: string;
  onRetry: (order: ApiOrder) => Promise<void>;
  onCheckPayment: (order: ApiOrder) => Promise<void>;
  onMarkPaid: (order: ApiOrder) => Promise<void>;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400 shadow-sm shadow-slate-950/5">
          <tr>
            <th className="px-4 py-3 font-medium">Order</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Signal</th>
            <th className="px-4 py-3 font-medium">Waktu</th>
            <th className="px-4 py-3 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => {
            const pendingCheck = actionLoading === `payment:${order.id}`;
            const pendingRetry = actionLoading === `retry:${order.id}`;
            const pendingMark = actionLoading === `mark:${order.id}`;
            const canCheckPayment = Boolean(order.paymentRef) && String(order.qrisStatus || "").toLowerCase() === "pending";
            const canRetry = !isRecoveryFinal(order) && (
              String(order.qrisStatus || "").toLowerCase() === "paid"
              || ["failed", "paid", "processing", "paid_after_expired", "paid_by_deposit"].includes(String(order.deliveryStatus || "").toLowerCase())
            );
            const canMarkPaid = !isRecoveryFinal(order) && String(order.qrisStatus || "").toLowerCase() === "pending";
            return (
              <tr key={order.id} className="border-t border-gray-100 text-slate-700">
                <td className="px-4 py-4 align-top">
                  <div className="font-semibold text-slate-900">{order.id}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{[order.product, order.variant, order.duration].filter(Boolean).join(" - ")}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{order.reseller || order.customer || order.whatsapp || "-"}</div>
                </td>
                <td className="px-4 py-4 align-top">
                  <Badge variant={orderStateVariant(order)}>{orderStateLabel(order)}</Badge>
                  <div className="mt-2 space-y-1 text-[11px] text-slate-400">
                    <div>QRIS: {order.qrisStatus || "-"}</div>
                    <div>Order: {order.orderStatus || "-"}</div>
                    <div>Delivery: {order.deliveryStatus || "-"}</div>
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-slate-500">
                  {order.deliveryError || (isPendingOverdue(order) ? "Pembayaran masih pending padahal melewati batas bayar." : "Perlu konfirmasi payment atau retry delivery.")}
                </td>
                <td className="px-4 py-4 align-top text-slate-500">
                  <div>{dateText(recoveryOrderMoment(order))}</div>
                  <div className="mt-1 text-[11px] text-slate-400">exp {dateText(order.paymentExpiresAt || "")}</div>
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="flex flex-wrap justify-end gap-2">
                    {canCheckPayment ? (
                      <button
                        type="button"
                        onClick={() => { onCheckPayment(order).catch(console.error); }}
                        disabled={pendingCheck || !!actionLoading}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-sky-200 px-3 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        {pendingCheck ? "Cek..." : "Cek Payment"}
                      </button>
                    ) : null}
                    {canRetry ? (
                      <button
                        type="button"
                        onClick={() => { onRetry(order).catch(console.error); }}
                        disabled={pendingRetry || !!actionLoading}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-200 px-3 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        {pendingRetry ? "Retry..." : "Retry Delivery"}
                      </button>
                    ) : null}
                    {canMarkPaid ? (
                      <button
                        type="button"
                        onClick={() => { onMarkPaid(order).catch(console.error); }}
                        disabled={pendingMark || !!actionLoading}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-amber-200 px-3 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        {pendingMark ? "Proses..." : "Tandai Paid"}
                      </button>
                    ) : null}
                    <Link to={`/dashboard/orders?order=${encodeURIComponent(order.id)}`} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                      Buka Order
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                Tidak ada order yang sedang butuh recovery cepat.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ResellerHealthTable({
  rows,
  actionLoading,
  onRepair,
  onReassign,
  onTimeline,
}: {
  rows: OperationIssue[];
  actionLoading: string;
  onRepair: (issue: OperationIssue) => Promise<void>;
  onReassign: (issue: OperationIssue) => void;
  onTimeline: (issue: OperationIssue) => void;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400 shadow-sm shadow-slate-950/5">
          <tr>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Kasus</th>
            <th className="px-4 py-3 font-medium">Catatan</th>
            <th className="px-4 py-3 font-medium">Waktu</th>
            <th className="px-4 py-3 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((issue) => {
            const pendingRepair = actionLoading === `reseller:${issue.id}`;
            return (
              <tr key={issue.id} className="border-t border-gray-100 text-slate-700">
                <td className="px-4 py-4 align-top">
                  <Badge variant={severityVariant(issue.severity || "")}>{issue.severity || "info"}</Badge>
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="font-semibold text-slate-900">{issue.title}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {[issue.orderId, issue.accountId, issue.stockId, issue.resellerId].filter(Boolean).join(" • ") || "-"}
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-slate-500">{issue.detail}</td>
                <td className="px-4 py-4 align-top text-slate-500">{dateText(issue.createdAt || "")}</td>
                <td className="px-4 py-4 align-top">
                  <div className="flex flex-wrap justify-end gap-2">
                    {issue.orderId ? (
                      <button
                        type="button"
                        onClick={() => onTimeline(issue)}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-violet-200 px-3 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                      >
                        Timeline
                      </button>
                    ) : null}
                    {issue.accountId ? (
                      <button
                        type="button"
                        onClick={() => onReassign(issue)}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-sky-200 px-3 text-[11px] font-semibold text-sky-700 hover:bg-sky-50"
                      >
                        Reassign
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => { onRepair(issue).catch(console.error); }}
                      disabled={pendingRepair || !!actionLoading}
                      className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-200 px-3 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      {pendingRepair ? "Repair..." : "Repair"}
                    </button>
                    {issue.href ? (
                      <Link to={issue.href} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                        Buka
                      </Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                Tidak ada issue reseller yang cocok.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function DeliveryAuditTable({
  rows,
  onOpenOrder,
}: {
  rows: OperationIssue[];
  onOpenOrder: (issue: OperationIssue) => void;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400 shadow-sm shadow-slate-950/5">
          <tr>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Kasus</th>
            <th className="px-4 py-3 font-medium">Catatan</th>
            <th className="px-4 py-3 font-medium">Waktu</th>
            <th className="px-4 py-3 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((issue) => (
            <tr key={issue.id} className="border-t border-gray-100 text-slate-700">
              <td className="px-4 py-4 align-top">
                <Badge variant={severityVariant(issue.severity || "")}>{issue.severity || "info"}</Badge>
              </td>
              <td className="px-4 py-4 align-top">
                <div className="font-semibold text-slate-900">{issue.title}</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {[issue.orderId, issue.stockId, issue.accountId].filter(Boolean).join(" • ") || "-"}
                </div>
              </td>
              <td className="px-4 py-4 align-top text-slate-500">{issue.detail}</td>
              <td className="px-4 py-4 align-top text-slate-500">{dateText(issue.createdAt || "")}</td>
              <td className="px-4 py-4 align-top">
                <div className="flex flex-wrap justify-end gap-2">
                  {issue.orderId ? (
                    <button
                      type="button"
                      onClick={() => onOpenOrder(issue)}
                      className="inline-flex h-8 items-center justify-center rounded-md border border-violet-200 px-3 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                    >
                      Audit
                    </button>
                  ) : null}
                  {issue.href ? (
                    <Link to={issue.href} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                      Buka
                    </Link>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                Tidak ada issue delivery audit yang cocok.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ReservedStockTable({
  rows,
  actionLoading,
  onOpenOrder,
  onRelease,
}: {
  rows: OperationIssue[];
  actionLoading: string;
  onOpenOrder: (issue: OperationIssue) => void;
  onRelease: (issue: OperationIssue) => Promise<void>;
}) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-400 shadow-sm shadow-slate-950/5">
          <tr>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Stock</th>
            <th className="px-4 py-3 font-medium">Catatan</th>
            <th className="px-4 py-3 font-medium">Waktu</th>
            <th className="px-4 py-3 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((issue) => {
            const pendingRelease = actionLoading === `release:${issue.stockId}`;
            const canRelease = issue.severity === "high" && Boolean(issue.stockId) && !issue.accountId;
            return (
              <tr key={issue.id} className="border-t border-gray-100 text-slate-700">
                <td className="px-4 py-4 align-top">
                  <Badge variant={severityVariant(issue.severity || "")}>{issue.severity || "info"}</Badge>
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="font-semibold text-slate-900">{issue.title}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {[issue.stockId, issue.orderId, issue.accountId].filter(Boolean).join(" • ") || "-"}
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-slate-500">{issue.detail}</td>
                <td className="px-4 py-4 align-top text-slate-500">{dateText(issue.createdAt || "")}</td>
                <td className="px-4 py-4 align-top">
                  <div className="flex flex-wrap justify-end gap-2">
                    {issue.orderId ? (
                      <button
                        type="button"
                        onClick={() => onOpenOrder(issue)}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-violet-200 px-3 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                      >
                        Lihat Order
                      </button>
                    ) : null}
                    {canRelease ? (
                      <button
                        type="button"
                        onClick={() => { onRelease(issue).catch(console.error); }}
                        disabled={pendingRelease || !!actionLoading}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-red-200 px-3 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        {pendingRelease ? "Release..." : "Release Lock"}
                      </button>
                    ) : null}
                    {issue.href ? (
                      <Link to={issue.href} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                        Buka
                      </Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                Tidak ada reserved stock yang perlu dicek.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardOperationsPage() {
  const [data, setData] = useState<OperationsCenterResult | null>(null);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [sheetsStatus, setSheetsStatus] = useState<GoogleSheetsStatus | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
  const [tab, setTab] = useState<OperationsTab>("reconcile");
  const [query, setQuery] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<ApiOrder | null>(null);
  const [timelineError, setTimelineError] = useState("");
  const [reassignIssue, setReassignIssue] = useState<OperationIssue | null>(null);
  const [reassignForm, setReassignForm] = useState({ resellerId: "", buyer: "" });
  const [reassignError, setReassignError] = useState("");

  function focusOperationsTab(nextTab: OperationsTab) {
    setTab(nextTab);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          document.getElementById("operations-tab-toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      });
    }
  }

  async function loadData() {
    const [operations, orderRows, resellerRows, sheets, maintenanceState] = await Promise.all([
      api.operationsCenter(),
      api.orders(),
      api.resellers(),
      api.googleSheetsStatus().catch(() => null),
      api.maintenance().then((result) => result.maintenance).catch(() => null),
    ]);
    setData(operations);
    setOrders(orderRows);
    setResellers(resellerRows);
    setSheetsStatus(sheets);
    setMaintenance(maintenanceState);
  }

  useEffect(() => {
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  const reconcileRows = useMemo(
    () => [...(data?.sheetsAudit?.issues || []), ...(data?.reconcile.issues || [])]
      .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
      .filter((item) => matchesQuery(query, [item.title, item.detail, item.kind, item.orderId, item.stockId, item.accountId, item.sheetName, item.sheetRow, item.identity])),
    [data?.reconcile.issues, data?.sheetsAudit?.issues, query],
  );
  const expiringRows = useMemo(
    () => (data?.expiry.expiringSoon || []).filter((item) => matchesQuery(query, [item.product, item.variant, item.email, item.buyer, item.reseller, item.needsAction])),
    [data?.expiry.expiringSoon, query],
  );
  const expiredRows = useMemo(
    () => (data?.expiry.expiredActive || []).filter((item) => matchesQuery(query, [item.product, item.variant, item.email, item.buyer, item.reseller, item.needsAction])),
    [data?.expiry.expiredActive, query],
  );
  const anomalyRows = useMemo(
    () => (data?.expiry.durationAnomalies || []).filter((item) => matchesQuery(query, [item.product, item.variant, item.email, item.needsAction])),
    [data?.expiry.durationAnomalies, query],
  );
  const anomalyDetectorRows = useMemo(
    () => [...(data?.sheetsAudit?.issues || []), ...sheetAuditRowsFromIssues(data?.reconcile.issues || []), ...(data?.expiry.durationAnomalies || [])].slice(0, 8),
    [data?.sheetsAudit?.issues, data?.reconcile.issues, data?.expiry.durationAnomalies],
  );
  const manualRows = useMemo(
    () => (data?.manual.items || []).filter((item) => matchesQuery(query, [item.title, item.detail, item.kind, item.orderId, item.requestId])),
    [data?.manual.items, query],
  );
  const deliveryAuditRows = useMemo(
    () => (data?.deliveryAudit.items || []).filter((item) => matchesQuery(query, [item.title, item.detail, item.orderId, item.stockId, item.accountId])),
    [data?.deliveryAudit.items, query],
  );
  const stockLockRows = useMemo(
    () => (data?.stockLocks.items || []).filter((item) => matchesQuery(query, [item.title, item.detail, item.orderId, item.stockId, item.accountId])),
    [data?.stockLocks.items, query],
  );
  const resellerRows = useMemo(
    () => (data?.reseller.items || []).filter((item) => matchesQuery(query, [item.title, item.detail, item.orderId, item.accountId, item.stockId, item.resellerId])),
    [data?.reseller.items, query],
  );
  const walletEntries = useMemo(
    () => (data?.wallet.entries || []).filter((item) => matchesQuery(query, [item.resellerName, item.detail, item.type, item.orderId, item.requestId, item.whatsapp])),
    [data?.wallet.entries, query],
  );
  const walletSummaries = useMemo(
    () => (data?.wallet.resellerSummaries || []).filter((item) => matchesQuery(query, [item.resellerName, item.whatsapp])),
    [data?.wallet.resellerSummaries, query],
  );
  const walletSummariesSorted = useMemo(
    () => [...walletSummaries].sort((left, right) => Number(right.currentBalance || 0) - Number(left.currentBalance || 0) || String(left.resellerName || "").localeCompare(String(right.resellerName || ""))),
    [walletSummaries],
  );
  const silentGroups = useMemo(
    () => (data?.whatsapp.silentGroups || []).filter((item) => matchesQuery(query, [item.name, item.groupJid, item.reason, item.joinError])),
    [data?.whatsapp.silentGroups, query],
  );
  const recentMessages = useMemo(
    () => (data?.whatsapp.recentMessages || []).filter((item) => matchesQuery(query, [item.from, item.to, item.body, item.direction])),
    [data?.whatsapp.recentMessages, query],
  );
  const recentFailures = useMemo(
    () => (data?.whatsapp.recentFailures || []).filter((item) => matchesQuery(query, [item.title, item.detail])),
    [data?.whatsapp.recentFailures, query],
  );
  const recoveryOrders = useMemo(
    () =>
      orders
        .filter((order) => !isDepositOrder(order))
        .filter((order) => {
          if (isRecoveryFinal(order)) return false;
          if (String(order.deliveryStatus || "").toLowerCase() === "failed") return true;
          if (String(order.qrisStatus || "").toLowerCase() === "paid") return true;
          if (["paid", "processing", "paid_after_expired", "paid_by_deposit"].includes(String(order.deliveryStatus || "").toLowerCase())) return true;
          if (isPendingOverdue(order)) return true;
          return false;
        })
        .filter((order) => matchesQuery(query, [order.id, order.paymentRef, order.product, order.variant, order.customer, order.reseller, order.whatsapp, order.deliveryError]))
        .sort((left, right) => Number(parseDate(recoveryOrderMoment(right))?.getTime() || 0) - Number(parseDate(recoveryOrderMoment(left))?.getTime() || 0))
        .slice(0, 12),
    [orders, query],
  );
  const recoveryStats = useMemo(() => ({
    failed: recoveryOrders.filter((order) => String(order.deliveryStatus || "").toLowerCase() === "failed").length,
    paidNotSent: recoveryOrders.filter((order) => String(order.qrisStatus || "").toLowerCase() === "paid").length,
    overdue: recoveryOrders.filter(isPendingOverdue).length,
  }), [recoveryOrders]);
  const orderAnomalyRows = useMemo(() => recoveryOrders.slice(0, 6), [recoveryOrders]);
  const sheetAuditRows = useMemo(() => (data?.sheetsAudit?.issues || []).slice(0, 8), [data?.sheetsAudit?.issues]);
  const sheetsWarnings = useMemo(() => {
    const summary = sheetsStatus?.lastSyncSummary;
    if (!summary) return [] as string[];
    return Object.entries(summary).flatMap(([key, value]) => {
      if (!value || typeof value !== "object") return [];
      const current = value as Record<string, unknown>;
      const rows: string[] = [];
      if (current.error) rows.push(`${key}: ${String(current.error)}`);
      if (current.reason) rows.push(`${key}: ${String(current.reason)}`);
      if (Array.isArray(current.warnings)) {
        rows.push(...current.warnings.slice(0, 2).map((warning) => `${key}: ${String(warning)}`));
      }
      return rows;
    }).slice(0, 6);
  }, [sheetsStatus?.lastSyncSummary]);

  async function runRecoveryAction(actionKey: string, task: () => Promise<unknown>, successText: string) {
    setActionLoading(actionKey);
    setActionError("");
    setActionMessage("");
    try {
      await task();
      setActionMessage(successText);
      await loadData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action gagal dijalankan.");
    } finally {
      setActionLoading("");
    }
  }

  async function runResellerRepair(actionKey: string, payload: { accountId?: string; orderId?: string; resellerId?: string; syncSheets?: boolean }, successText: string) {
    setActionLoading(actionKey);
    setActionError("");
    setActionMessage("");
    try {
      const result = await api.repairResellerData(payload);
      setActionMessage(`${successText} (matched ${result.matchedAccounts}, repair ${result.ownershipUpdated}, rebuild ${result.rebuiltAccounts}).`);
      await loadData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Repair reseller gagal dijalankan.");
    } finally {
      setActionLoading("");
    }
  }

  async function openOrderTimeline(issue: OperationIssue) {
    if (!issue.orderId) return;
    setTimelineError("");
    try {
      const detail = await api.order(issue.orderId);
      setSelectedOrder(detail);
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : "Timeline order gagal dimuat.");
    }
  }

  async function releaseReservedStock(issue: OperationIssue) {
    if (!issue.stockId) return;
    await runRecoveryAction(
      `release:${issue.stockId}`,
      () => api.releaseStockReservation(issue.stockId!),
      `Reserved stock ${issue.stockId} sudah dilepas ke available.`,
    );
  }

  function openReassign(issue: OperationIssue) {
    setReassignIssue(issue);
    setReassignError("");
    setReassignForm({ resellerId: issue.resellerId || "", buyer: "" });
  }

  async function saveReassign() {
    if (!reassignIssue?.accountId) return;
    if (!reassignForm.resellerId) {
      setReassignError("Pilih reseller tujuan dulu.");
      return;
    }
    setActionLoading(`reassign:${reassignIssue.accountId}`);
    setReassignError("");
    try {
      await api.reassignAccount(reassignIssue.accountId, {
        resellerId: reassignForm.resellerId,
        buyer: reassignForm.buyer || undefined,
      });
      setReassignIssue(null);
      setActionMessage("Ownership akun berhasil dipindahkan.");
      await loadData();
    } catch (error) {
      setReassignError(error instanceof Error ? error.message : "Reassign akun gagal.");
    } finally {
      setActionLoading("");
    }
  }

  return (
    <DashboardLayout role="owner" title="Operations Center">
      <div className="grid gap-3 md:grid-cols-7">
        <OwnerStat label="High Reconcile" value={data?.reconcile.summary.high || 0} active={tab === "reconcile"} icon="ri-alarm-warning-line" onClick={() => focusOperationsTab("reconcile")} />
        <OwnerStat label="Reseller Issues" value={data?.reseller.summary.high || 0} active={tab === "reseller"} icon="ri-user-shared-line" onClick={() => focusOperationsTab("reseller")} />
        <OwnerStat label="Expired Belum Bersih" value={data?.expiry.summary.expiredActive || 0} active={tab === "expiry"} icon="ri-timer-flash-line" onClick={() => focusOperationsTab("expiry")} />
        <OwnerStat label="Stock Anomaly" value={data?.expiry.summary.durationAnomalies || 0} active={tab === "expiry"} icon="ri-radar-line" onClick={() => focusOperationsTab("expiry")} />
        <OwnerStat label="Manual Queue" value={data?.manual.summary.total || 0} active={tab === "manual"} icon="ri-list-check-3" onClick={() => focusOperationsTab("manual")} />
        <OwnerStat label="Saldo Reseller" value={formatRupiah(Number(data?.wallet.summary.totalBalance || 0))} active={tab === "wallet"} icon="ri-wallet-3-line" onClick={() => focusOperationsTab("wallet")} />
        <OwnerStat label="WA Failures" value={data?.whatsapp.summary.failures || 0} active={tab === "whatsapp"} icon="ri-whatsapp-line" delta={data?.whatsapp.summary.connected ? "Connected" : "Disconnected"} deltaClassName={data?.whatsapp.summary.connected ? "text-emerald-600" : "text-red-600"} onClick={() => focusOperationsTab("whatsapp")} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <DataPanel className="overflow-hidden">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-950">Order Recovery Center</p>
            <p className="mt-1 text-xs text-slate-500">Aksi cepat untuk order yang sudah paid tapi belum final, delivery gagal, atau QRIS pending terlalu lama.</p>
          </div>
          <div className="grid gap-3 border-b border-gray-100 px-4 py-4 md:grid-cols-3">
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-red-600">Delivery Failed</div>
              <div className="mt-1 text-2xl font-semibold text-red-700">{recoveryStats.failed}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-amber-700">Paid Not Sent</div>
              <div className="mt-1 text-2xl font-semibold text-amber-800">{recoveryStats.paidNotSent}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Pending Overdue</div>
              <div className="mt-1 text-2xl font-semibold text-slate-700">{recoveryStats.overdue}</div>
            </div>
          </div>
          {actionMessage ? <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{actionMessage}</div> : null}
          {actionError ? <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div> : null}
          <OrderRecoveryTable
            rows={recoveryOrders}
            actionLoading={actionLoading}
            onRetry={(order) => runRecoveryAction(`retry:${order.id}`, () => api.retryDelivery(order.id), `Retry delivery dijalankan untuk ${order.id}.`)}
            onCheckPayment={(order) => runRecoveryAction(`payment:${order.id}`, () => api.payment(order.paymentRef || order.id), `Payment ${order.paymentRef || order.id} dicek ulang.`)}
            onMarkPaid={(order) => runRecoveryAction(`mark:${order.id}`, () => api.markOrderPaid(order.id), `${order.id} ditandai paid dan diproses ulang.`)}
          />
        </DataPanel>

        <DataPanel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">Sync Health</p>
              <p className="mt-1 text-xs text-slate-500">Status Google Sheets dan maintenance order tanpa pindah halaman.</p>
            </div>
            <Badge variant={sheetsStatus?.configured ? (syncErrorCount(sheetsStatus.lastSyncSummary) ? "amber" : "emerald") : "red"}>
              {sheetsStatus?.configured ? (syncErrorCount(sheetsStatus.lastSyncSummary) ? "Need Check" : "Connected") : "Not Configured"}
            </Badge>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2">
              <span className="text-slate-500">Last Sync</span>
              <span className="font-semibold text-slate-900">{dateText(sheetsStatus?.lastSyncAt || "")}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2">
              <span className="text-slate-500">Sync Errors</span>
              <span className={`font-semibold ${syncErrorCount(sheetsStatus?.lastSyncSummary) ? "text-red-600" : "text-emerald-700"}`}>{syncErrorCount(sheetsStatus?.lastSyncSummary)}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2">
              <span className="text-slate-500">Maintenance</span>
              <span className={`font-semibold ${maintenance?.enabled ? "text-amber-700" : "text-emerald-700"}`}>{maintenance?.enabled ? "Aktif" : "Normal"}</span>
            </div>
            <div className="rounded-md bg-[#fbf7f0] px-3 py-2 text-slate-600">
              {maintenance?.enabled ? maintenance.reason || "Order baru sedang ditahan sementara." : "Order baru sedang berjalan normal."}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-slate-100 py-3 text-xs">
            {[
              ["Rows", data?.sheetsAudit?.summary.rowsRead || 0, "text-slate-900"],
              ["Matched", data?.sheetsAudit?.summary.matched || 0, "text-emerald-700"],
              ["Ambiguous", data?.sheetsAudit?.summary.ambiguous || 0, "text-amber-700"],
              ["Mismatch", (data?.sheetsAudit?.summary.mismatch || 0) + (data?.sheetsAudit?.summary.duplicateStock || 0), "text-red-600"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{label}</span>
                <span className={`font-semibold ${tone}`}>{value}</span>
              </div>
            ))}
            <p className="col-span-2 text-[11px] text-slate-400">Audit otomatis: {dateText(data?.sheetsAudit?.automatedCheckedAt || data?.sheetsAudit?.checkedAt || "")}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { runRecoveryAction("sync:sheets", () => api.syncGoogleSheets(), "Sync Google Sheets dijalankan."); }}
              disabled={!!actionLoading}
              className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-200 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
            >
              {actionLoading === "sync:sheets" ? "Sync..." : "Sync Sheets"}
            </button>
            <Link to="/dashboard/stock" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Buka Stock
            </Link>
            <Link to="/dashboard/orders" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Semua Orders
            </Link>
          </div>
        </DataPanel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <DataPanel className="overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">Order Anomaly Alerts</p>
              <p className="mt-1 text-xs text-slate-500">Ringkasan order yang janggal supaya owner bisa fokus tanpa bongkar semua page.</p>
            </div>
            <button
              type="button"
              onClick={() => focusOperationsTab("manual")}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Fokus Queue
            </button>
          </div>
          <div className="grid gap-3 border-b border-gray-100 px-4 py-4 md:grid-cols-3">
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-red-600">Paid Belum Final</div>
              <div className="mt-1 text-2xl font-semibold text-red-700">{recoveryStats.paidNotSent}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-amber-700">Pending Lewat Batas</div>
              <div className="mt-1 text-2xl font-semibold text-amber-800">{recoveryStats.overdue}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Delivery Gagal</div>
              <div className="mt-1 text-2xl font-semibold text-slate-700">{recoveryStats.failed}</div>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {orderAnomalyRows.map((order) => (
              <div key={order.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-slate-900">{order.id}</div>
                    <Badge variant={anomalyTone(order)}>{anomalyLabel(order)}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {[order.product, order.variant, order.reseller || order.customer || order.whatsapp || "-"].filter(Boolean).join(" • ")}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {dateText(recoveryOrderMoment(order))} • {order.paymentRef || "-"}
                  </div>
                </div>
                <Link to={`/dashboard/orders?order=${encodeURIComponent(order.id)}`} className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                  Buka Order
                </Link>
              </div>
            ))}
            {!orderAnomalyRows.length ? <div className="px-4 py-8 text-center text-sm text-slate-500">Tidak ada order anomali yang aktif.</div> : null}
          </div>
        </DataPanel>

        <DataPanel className="overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">Sheets Audit Center</p>
              <p className="mt-1 text-xs text-slate-500">Fokus ke metadata Sheets, warning sync, dan anomali yang bisa bikin baris stok rancu.</p>
            </div>
            <button
              type="button"
              onClick={() => focusOperationsTab("reconcile")}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Fokus Reconcile
            </button>
          </div>
          <div className="grid gap-3 border-b border-gray-100 px-4 py-4 md:grid-cols-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Audit Rows</div>
              <div className="mt-1 text-2xl font-semibold text-slate-700">{sheetAuditRows.length}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-amber-700">Sync Warnings</div>
              <div className="mt-1 text-2xl font-semibold text-amber-800">{sheetsWarnings.length}</div>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-emerald-700">Last Sync</div>
              <div className="mt-1 text-sm font-semibold text-emerald-800">{dateText(sheetsStatus?.lastSyncAt || "")}</div>
            </div>
          </div>
          <div className="space-y-3 px-4 py-4">
            {sheetsWarnings.length ? (
              <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase text-amber-700">Warning terbaru</div>
                <div className="mt-2 space-y-1 text-xs text-amber-900">
                  {sheetsWarnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs text-emerald-800">
                Tidak ada warning sync aktif di summary Google Sheets terakhir.
              </div>
            )}
            <div className="space-y-2">
              {sheetAuditRows.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{item.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                    </div>
                    <Badge variant={severityVariant(item.severity || "")}>{item.severity || "info"}</Badge>
                  </div>
                </div>
              ))}
              {!sheetAuditRows.length ? <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-xs text-slate-500">Tidak ada audit row Sheets yang terdeteksi.</div> : null}
            </div>
          </div>
        </DataPanel>
      </div>

      <div className="mt-4">
        <DataPanel className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">Reseller Guardrail</p>
              <p className="mt-1 text-xs text-slate-500">Repair cepat untuk ownership drift, Manage Account kosong, dan signal double drop di panel reseller.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { runResellerRepair("reseller:all", {}, "Repair reseller massal selesai dijalankan").catch(console.error); }}
                disabled={!!actionLoading}
                className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-200 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60"
              >
                {actionLoading === "reseller:all" ? "Repair..." : "Repair Semua"}
              </button>
              <button
                type="button"
                onClick={() => { runResellerRepair("reseller:sync", { syncSheets: true }, "Sync Sheets + repair reseller selesai dijalankan").catch(console.error); }}
                disabled={!!actionLoading}
                className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
              >
                {actionLoading === "reseller:sync" ? "Sync..." : "Sync + Repair"}
              </button>
            </div>
          </div>
          {actionMessage ? <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{actionMessage}</div> : null}
          {actionError ? <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div> : null}
          <div className="grid gap-3 px-4 py-4 md:grid-cols-5">
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-red-600">Owner Missing</div>
              <div className="mt-1 text-2xl font-semibold text-red-700">{data?.reseller.summary.missingOwner || 0}</div>
            </div>
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-rose-700">Link Pool Legacy</div>
              <div className="mt-1 text-2xl font-semibold text-rose-800">{data?.reseller.summary.legacyLinkOwnerless || 0}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-amber-700">Manage Account Kosong</div>
              <div className="mt-1 text-2xl font-semibold text-amber-800">{data?.reseller.summary.orderMissingAccounts || 0}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Double Drop Signal</div>
              <div className="mt-1 text-2xl font-semibold text-slate-700">{data?.reseller.summary.duplicateDrops || 0}</div>
            </div>
            <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-violet-700">Managed Dupes</div>
              <div className="mt-1 text-2xl font-semibold text-violet-800">{data?.reseller.summary.managedDuplicates || 0}</div>
            </div>
          </div>
        </DataPanel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <DataPanel className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">Delivery Audit Center</p>
              <p className="mt-1 text-xs text-slate-500">Order yang secara status sudah selesai, tapi jejak akun, Sheets, atau notif reseller masih belum rapi.</p>
            </div>
            <Link to="/dashboard/orders" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Buka Orders
            </Link>
          </div>
          <div className="grid gap-3 border-b border-gray-100 px-4 py-4 md:grid-cols-4">
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-red-600">Missing Account</div>
              <div className="mt-1 text-2xl font-semibold text-red-700">{data?.deliveryAudit.summary.missingAccounts || 0}</div>
            </div>
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-rose-700">Double Drop</div>
              <div className="mt-1 text-2xl font-semibold text-rose-800">{data?.deliveryAudit.summary.duplicateDrops || 0}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-amber-700">Sheet Pending</div>
              <div className="mt-1 text-2xl font-semibold text-amber-800">{data?.deliveryAudit.summary.sheetPending || 0}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">WA Failed</div>
              <div className="mt-1 text-2xl font-semibold text-slate-700">{data?.deliveryAudit.summary.whatsappFailed || 0}</div>
            </div>
          </div>
          <DeliveryAuditTable rows={deliveryAuditRows.slice(0, 8)} onOpenOrder={openOrderTimeline} />
        </DataPanel>

        <DataPanel className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">Reserved Stock Monitor</p>
              <p className="mt-1 text-xs text-slate-500">Pantau stok yang masih locked. Release manual hanya dibuka untuk lock stale yang sudah tidak aman dibiarkan.</p>
            </div>
            <Link to="/dashboard/stock?status=reserved" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Buka Stock
            </Link>
          </div>
          <div className="grid gap-3 border-b border-gray-100 px-4 py-4 md:grid-cols-3">
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-red-600">Stale Lock</div>
              <div className="mt-1 text-2xl font-semibold text-red-700">{data?.stockLocks.summary.stale || 0}</div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-amber-700">Waiting Payment</div>
              <div className="mt-1 text-2xl font-semibold text-amber-800">{data?.stockLocks.summary.waitingPayment || 0}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Daily Assigned</div>
              <div className="mt-1 text-2xl font-semibold text-slate-700">{data?.stockLocks.summary.linkedDaily || 0}</div>
            </div>
          </div>
          <ReservedStockTable rows={stockLockRows.slice(0, 8)} actionLoading={actionLoading} onOpenOrder={openOrderTimeline} onRelease={releaseReservedStock} />
        </DataPanel>
      </div>

      <div className="mt-4">
        <DataPanel className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-950">Stock Anomaly Detector</p>
              <p className="mt-1 text-xs text-slate-500">Ringkasan cepat untuk durasi janggal, metadata Sheets aneh, dan sinyal stok yang perlu dicek manual.</p>
            </div>
            <button
              type="button"
              onClick={() => focusOperationsTab("expiry")}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Buka Anomali
            </button>
          </div>
          <div className="grid gap-3 px-4 py-4 md:grid-cols-3">
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-amber-700">Durasi Janggal</div>
              <div className="mt-1 text-2xl font-semibold text-amber-800">{data?.expiry.summary.durationAnomalies || 0}</div>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-red-600">Sheet Audit</div>
              <div className="mt-1 text-2xl font-semibold text-red-700">{data?.sheetsAudit?.issues.length || 0}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase text-slate-500">Perlu Review</div>
              <div className="mt-1 text-2xl font-semibold text-slate-700">{anomalyDetectorRows.length}</div>
            </div>
          </div>
          <QueueTable rows={anomalyDetectorRows} emptyText="Belum ada anomali stok yang menonjol." />
        </DataPanel>
      </div>

      <div id="operations-tab-toolbar" className="sticky top-16 z-30 -mx-4 mt-4 bg-[#f2ece2] px-4 py-3 md:-mx-6 md:px-6">
        <PageToolbar className="shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-sm flex-1">
              <SearchBox value={query} onChange={setQuery} placeholder="Cari issue, order, reseller, grup..." />
            </div>
            <div className="flex flex-wrap gap-2">
              {tabs.map((item) => (
                <FilterPill key={item.id} active={tab === item.id} onClick={() => setTab(item.id)}>
                  {item.label}
                </FilterPill>
              ))}
            </div>
          </div>
          <div className="mt-3 text-[11px] text-slate-400">
            Terakhir refresh: {dateText(data?.checkedAt || "")}
          </div>
        </PageToolbar>
      </div>

      <div className="mt-4 space-y-4">
        {tab === "reconcile" ? (
          <DataPanel className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-950">Stock Reconcile Center</p>
              <p className="mt-1 text-xs text-slate-500">Deteksi mismatch stok, akun, order, dan metadata Sheets yang rawan bikin data numpuk atau ketimpa.</p>
            </div>
            <QueueTable rows={reconcileRows} emptyText="Tidak ada issue reconcile yang cocok." />
          </DataPanel>
        ) : null}

        {tab === "reseller" ? (
          <DataPanel className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-950">Reseller Health Center</p>
              <p className="mt-1 text-xs text-slate-500">Kasus yang paling sering bikin reseller tidak melihat akun, ownership salah, atau terasa seperti ada drop ganda.</p>
            </div>
            <ResellerHealthTable
              rows={resellerRows}
              actionLoading={actionLoading}
              onTimeline={openOrderTimeline}
              onReassign={openReassign}
              onRepair={(issue) => runResellerRepair(
                `reseller:${issue.id}`,
                { accountId: issue.accountId, orderId: issue.orderId, resellerId: issue.resellerId },
                `Repair dijalankan untuk ${issue.orderId || issue.accountId || issue.id}`,
              )}
            />
          </DataPanel>
        ) : null}

        {tab === "expiry" ? (
          <div className="space-y-4">
            <DataPanel className="overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-950">Expiring Soon</p>
                <p className="mt-1 text-xs text-slate-500">Akun yang waktunya mepet supaya cleanup dan replacement tidak telat.</p>
              </div>
              <QueueTable rows={expiringRows} emptyText="Tidak ada akun yang akan habis dalam waktu dekat." />
            </DataPanel>
            <DataPanel className="overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-950">Expired Belum Bersih</p>
                <p className="mt-1 text-xs text-slate-500">Akun yang secara status sudah habis tapi belum dibersihkan dari workflow aktif.</p>
              </div>
              <QueueTable rows={expiredRows} emptyText="Tidak ada akun expired yang masih aktif di daftar." />
            </DataPanel>
            <DataPanel className="overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-950">Anomali Durasi</p>
                <p className="mt-1 text-xs text-slate-500">Kasus tanggal mulai dan expiry yang janggal dan perlu cek manual.</p>
              </div>
              <QueueTable rows={anomalyRows} emptyText="Tidak ada anomali durasi yang terdeteksi." />
            </DataPanel>
          </div>
        ) : null}

        {tab === "manual" ? (
          <DataPanel className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-950">Manual Action Queue</p>
              <p className="mt-1 text-xs text-slate-500">Kumpulan kasus yang tidak seharusnya dibiarkan berjalan sendiri: paid tapi belum delivery, deposit pending, grup belum sinkron, dan issue high severity lain.</p>
            </div>
            <QueueTable rows={manualRows} emptyText="Tidak ada action manual yang menunggu." />
          </DataPanel>
        ) : null}

        {tab === "wallet" ? (
          <WalletTable summaries={walletSummariesSorted} entries={walletEntries} />
        ) : null}

        {tab === "whatsapp" ? (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
              <DataPanel className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Connection</p>
                    <p className="mt-1 text-xs text-slate-500">Ringkasan koneksi Bailey dan retry loop terakhir.</p>
                  </div>
                  <Badge variant={connectionVariant(Boolean(data?.whatsapp.connection.connected))}>
                    {data?.whatsapp.connection.connected ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2"><span className="text-slate-500">State</span><span className="font-semibold text-slate-900">{data?.whatsapp.connection.state || "-"}</span></div>
                  <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2"><span className="text-slate-500">Owner WA</span><span className="font-semibold text-slate-900">{data?.whatsapp.connection.ownerWhatsAppNumber || "-"}</span></div>
                  <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2"><span className="text-slate-500">Last reconnect</span><span className="font-semibold text-slate-900">{dateText(data?.whatsapp.connection.lastReconnectAt || "")}</span></div>
                  <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2"><span className="text-slate-500">Last disconnect</span><span className="font-semibold text-slate-900">{dateText(data?.whatsapp.connection.lastDisconnectAt || "")}</span></div>
                  <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2"><span className="text-slate-500">Reconnect attempts</span><span className="font-semibold text-slate-900">{Number(data?.whatsapp.connection.reconnectAttempts || 0)}</span></div>
                  <div className="rounded-md bg-[#fbf7f0] px-3 py-2 text-slate-600">{data?.whatsapp.connection.error || data?.whatsapp.connection.lastDisconnectReason || "Tidak ada error aktif."}</div>
                </div>
              </DataPanel>
              <SilentGroups rows={silentGroups} />
            </div>
            <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <DataPanel className="overflow-hidden">
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-950">Failure Feed</p>
                  <p className="mt-1 text-xs text-slate-500">Notif gagal dan grup yang perlu dicek.</p>
                </div>
                <QueueTable rows={recentFailures} emptyText="Tidak ada failure feed yang cocok." />
              </DataPanel>
              <WhatsappMessages rows={recentMessages} />
            </div>
          </div>
        ) : null}
      </div>

      {selectedOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Order Timeline Audit</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">{selectedOrder.id}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedOrder.product} • {selectedOrder.variant}</p>
              </div>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setSelectedOrder(null)}>
                <i className="ri-close-line" />
              </button>
            </div>
            {timelineError ? <div className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{timelineError}</div> : null}
            <div className="mt-5 rounded-lg border border-gray-100 bg-[#fbf7f0] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Timeline</p>
                  <p className="mt-1 text-xs text-slate-500">Jejak pembayaran, refund, dan pengiriman.</p>
                </div>
                <Badge variant={orderStateVariant(selectedOrder)}>{orderStateLabel(selectedOrder)}</Badge>
              </div>
              <div className="mt-3 grid gap-2">
                {orderTimeline(selectedOrder).map((item) => (
                  <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm">
                    <span className="font-medium text-slate-800">{item.label}</span>
                    <span className="text-xs text-slate-400">{compactDate(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-gray-100 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Order Trace</p>
                  <p className="mt-1 text-xs text-slate-500">Jejak event lintas order, payment, account, dan WhatsApp.</p>
                </div>
                <Badge variant={selectedOrder.traceEvents?.length ? "emerald" : "slate"}>{selectedOrder.traceEvents?.length || 0} event</Badge>
              </div>
              {selectedOrder.traceEvents?.length ? (
                <div className="mt-3 space-y-2">
                  {selectedOrder.traceEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={traceTone(event.tone)}>{event.type}</Badge>
                          <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                        </div>
                        <span className="text-[11px] text-slate-400">{compactDate(event.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{event.detail}</p>
                    </div>
                  ))}
                </div>
              ) : <div className="mt-3 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">Belum ada jejak event detail untuk order ini.</div>}
            </div>
            <div className="mt-5 rounded-lg border border-gray-100 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Akun Terkirim</p>
                  <p className="mt-1 text-xs text-slate-500">Akun yang tertaut ke order ini.</p>
                </div>
                <Badge variant={selectedOrder.deliveredAccounts?.length ? "emerald" : "slate"}>{selectedOrder.deliveredAccounts?.length || 0} akun</Badge>
              </div>
              {selectedOrder.deliveredAccounts?.length ? (
                <div className="mt-3 space-y-3">
                  {selectedOrder.deliveredAccounts.map((account) => (
                    <div key={`${account.id}-${account.stockId}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{accountLabel(account)}</p>
                        <Badge variant={account.status === "active" ? "emerald" : account.status === "expired" ? "red" : "slate"}>{account.status || "-"}</Badge>
                      </div>
                      <div className="mt-2 grid gap-2 text-[11px] text-slate-500 md:grid-cols-2">
                        <span>Mulai: {compactDate(account.startedAt)}</span>
                        <span>Expired: {compactDate(account.expiresAt)}</span>
                        <span>Sheet: {account.sheetName || "-"}</span>
                        <span>Row: {account.sheetRow || "-"}</span>
                        <span>Stock: {account.stockId || "-"}</span>
                        <span>Source: {account.source || "-"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="mt-3 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">Belum ada akun tertaut yang bisa ditampilkan.</div>}
            </div>
          </div>
        </div>
      ) : null}

      {reassignIssue ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Reassign Account</h2>
                <p className="mt-1 text-xs text-slate-500">{reassignIssue.accountId || "-"} • {reassignIssue.orderId || "tanpa order"}</p>
              </div>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setReassignIssue(null)}>
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="mt-6 space-y-4">
              {reassignError ? <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{reassignError}</div> : null}
              <label className="block">
                <span className="text-sm text-slate-700">Reseller tujuan</span>
                <select value={reassignForm.resellerId} onChange={(event) => setReassignForm({ ...reassignForm, resellerId: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]">
                  <option value="">Pilih reseller</option>
                  {resellers.map((reseller) => (
                    <option key={reseller.id} value={reseller.id}>{reseller.name || reseller.username} - {reseller.whatsapp}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Buyer override</span>
                <input value={reassignForm.buyer} onChange={(event) => setReassignForm({ ...reassignForm, buyer: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Opsional, kalau ingin beda dari nama reseller" />
              </label>
              <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-700">
                Aksi ini memindahkan ownership akun dan, kalau ada order terkait, metadata reseller di order juga ikut disejajarkan supaya tidak balik lagi saat repair berikutnya.
              </div>
              <div className="grid gap-3 pt-2 md:grid-cols-2">
                <button type="button" className="h-11 rounded-md border border-gray-300 text-sm text-slate-700" onClick={() => setReassignIssue(null)}>Batal</button>
                <button type="button" className="h-11 rounded-md bg-[#2b2b2b] text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60" disabled={actionLoading === `reassign:${reassignIssue.accountId}`} onClick={saveReassign}>
                  {actionLoading === `reassign:${reassignIssue.accountId}` ? "Menyimpan..." : "Pindahkan Ownership"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
