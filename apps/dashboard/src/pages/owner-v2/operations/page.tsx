import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, BadgeCheck, CreditCard, RefreshCw, RotateCcw, ShieldCheck, UnlockKeyhole, UserRoundCog, Wrench } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type ApiReseller, type ExpiryQueueItem, type OperationIssue, type OperationsCenterResult, type OperationsRepairPreview } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";
import { Badge, Dialog, DialogActions, Field, MetricRow, Notice, Toast } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

type Recovery = "sync" | "repair" | null;
type IssueAction = { type: "release" | "retry" | "mark-paid" | "check-payment"; issue: OperationIssue } | null;

/**
 * The queues behind `?focus=`.
 *
 * The overview's attention queue links here with a focus so the owner lands on
 * the rows that produced the number rather than on the union of all of them.
 * Before this the parameter was ignored and every link opened the same
 * undifferentiated list, which is what made the old queue useless: a count of
 * 4 stock anomalies would land the reader in front of 40 rows and send them
 * hunting. Order is the display order when a queue is focused.
 */
const focusQueues = [
  { id: "all", label: "Semua temuan" },
  { id: "delivery", label: "Delivery" },
  { id: "stock", label: "Stok" },
  { id: "expiry", label: "Masa aktif" },
  { id: "sheets", label: "Sheets" },
  { id: "reseller", label: "Reseller" },
  { id: "manual", label: "Topup & manual" },
  { id: "whatsapp", label: "WhatsApp" },
] as const;

type FocusId = (typeof focusQueues)[number]["id"];

const focusIds = new Set<string>(focusQueues.map((queue) => queue.id));

/**
 * Expiry items are not `OperationIssue` -- they are a richer shape with their
 * own `href`, `daysLeft` and a server-written `needsAction` sentence. They are
 * projected into the issue shape rather than duplicating the table with a
 * second one, so that focusing a queue shows one list with one set of actions.
 *
 * These rows were computed by the server on every operations call and rendered
 * nowhere. An account sitting past its expiry date while still marked active
 * is inventory that will never sell again and is not in stock, which is
 * exactly the sort of leak an owner has no way to see.
 */
function expiryIssue(item: ExpiryQueueItem, group: string): OperationIssue {
  const daysLeft = item.daysLeft;
  return {
    id: `expiry:${group}:${item.id}`,
    severity: item.severity,
    kind: "expiry",
    title: group === "expiredActive" ? "Expired tapi masih aktif" : group === "durationAnomalies" ? "Durasi tidak valid" : "Segera expired",
    detail: `${item.product} · ${item.variant} · ${item.email || "tanpa email"}${
      daysLeft === null || daysLeft === undefined ? "" : daysLeft < 0 ? ` · lewat ${Math.abs(daysLeft)} hari` : ` · ${daysLeft} hari lagi`
    }. ${item.needsAction}`,
    createdAt: item.expiresAt,
    href: item.href,
    accountId: item.accountId,
    stockId: item.stockId,
    orderId: item.orderId,
  };
}

function issuePath(issue: OperationIssue) {
  if (issue.kind === "warranty_sync" && issue.href) return issue.href;
  if (issue.orderId) return `/owner-v2/orders?order=${encodeURIComponent(issue.orderId)}`;
  if (issue.accountId) return `/owner-v2/accounts?account=${encodeURIComponent(issue.accountId)}`;
  if (issue.stockId) return `/owner-v2/stock?stock=${encodeURIComponent(issue.stockId)}`;
  if (issue.resellerId) return `/owner-v2/resellers?reseller=${encodeURIComponent(issue.resellerId)}`;
  if (issue.groupId) return `/owner-v2/whatsapp?group=${encodeURIComponent(issue.groupId)}`;
  return issue.href || "";
}

function issueFingerprint(issue: OperationIssue) {
  const title = String(issue.title || "").toLowerCase();
  if (issue.orderId) {
    if (/melebihi|double drop|duplicate/.test(title)) return `order:${issue.orderId}:delivery-over`;
    if (/belum tertaut|kurang dari|belum lengkap|tanpa jejak akun|manage account/.test(title)) return `order:${issue.orderId}:delivery-under`;
    if (/redelivery/.test(title)) return `order:${issue.orderId}:redelivery`;
    if (/whatsapp|notif/.test(title)) return `order:${issue.orderId}:whatsapp`;
    if (/sheet/.test(title)) return `order:${issue.orderId}:sheets`;
    return `order:${issue.orderId}:${title}`;
  }
  if (issue.accountId) return `account:${issue.accountId}:${title}`;
  if (issue.stockId) return `stock:${issue.stockId}:${title}`;
  return issue.id;
}

/**
 * The same order failing delivery is one problem, not four.
 *
 * The audit emits a row per detected condition, so a single undelivered order
 * can appear as "no trace of account", "less than required" and "redelivery
 * failed" at once. The fingerprint keys on the order and the class of problem,
 * so those collapse to one row while genuinely different orders stay apart.
 */
function dedupe(issues: OperationIssue[]): OperationIssue[] {
  const unique = new Map<string, OperationIssue>();
  for (const issue of issues) {
    const key = issueFingerprint(issue);
    if (!unique.has(key)) unique.set(key, issue);
  }
  return [...unique.values()];
}

export default function OwnerConsoleOperationsPage() {
  const [data, setData] = useState<OperationsCenterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState<Recovery>(null);
  const [issueAction, setIssueAction] = useState<IssueAction>(null);
  const [reassignIssue, setReassignIssue] = useState<OperationIssue | null>(null);
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [reassignForm, setReassignForm] = useState({ resellerId: "", buyer: "" });
  const [busy, setBusy] = useState(false);
  const [repairPreview, setRepairPreview] = useState<OperationsRepairPreview | null>(null);
  const [updated, setUpdated] = useState("");
  const [params, setParams] = useSearchParams();
  const requestedFocus = params.get("focus") || "all";
  const focus: FocusId = focusIds.has(requestedFocus) ? (requestedFocus as FocusId) : "all";
  const clearMessage = useCallback(() => setMessage(""), []);
  const load = useCallback(async () => { setLoading(true); setError(""); const results = await Promise.allSettled([api.operationsCenter(), api.resellers()]); if (results[0].status === "fulfilled") { setData(results[0].value); setUpdated(formatDateTime(results[0].value.checkedAt)); } else setError("Operations Center gagal dimuat."); if (results[1].status === "fulfilled") setResellers(results[1].value); setLoading(false); }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const selectFocus = useCallback((next: FocusId) => {
    setParams((current) => {
      const updatedParams = new URLSearchParams(current);
      next === "all" ? updatedParams.delete("focus") : updatedParams.set("focus", next);
      return updatedParams;
    }, { replace: true });
  }, [setParams]);

  /**
   * Issues grouped by the queue they came from.
   *
   * Deduping happens within a queue, not across all of them, so focusing one
   * queue cannot have its rows swallowed by a same-titled row from another.
   * A "reseller data drift" finding and a "reseller name mismatch" finding
   * have different ids and different fixes, and collapsing them by title
   * would hide one of them.
   */
  const queues = useMemo(() => {
    const empty: Record<FocusId, OperationIssue[]> = { all: [], delivery: [], stock: [], expiry: [], sheets: [], reseller: [], manual: [], whatsapp: [] };
    if (!data) return empty;
    const expiry = data.expiry;
    return {
      delivery: dedupe([...data.deliveryAudit.items]),
      stock: dedupe([...data.stockLocks.items, ...data.reconcile.issues]),
      expiry: dedupe([
        ...expiry.expiredActive.map((item) => expiryIssue(item, "expiredActive")),
        ...expiry.expiringSoon.map((item) => expiryIssue(item, "expiringSoon")),
        ...expiry.durationAnomalies.map((item) => expiryIssue(item, "durationAnomalies")),
      ]),
      sheets: dedupe(data.sheetsAudit?.issues || []),
      reseller: dedupe(data.reseller.items),
      manual: dedupe(data.manual.items),
      whatsapp: dedupe(data.whatsapp.recentFailures),
      all: [],
    };
  }, [data]);

  const issues = useMemo(() => (focus === "all" ? dedupe(Object.values(queues).flat()) : queues[focus]), [focus, queues]);
  const totalIssues = useMemo(() => dedupe(Object.values(queues).flat()).length, [queues]);
  const high = issues.filter((row) => row.severity === "high").length;
  // Split by who can act on them, so the page opens on the distinction rather
  // than on one undifferentiated alarm count.
  const ownerFixable = issues.filter((row) => row.severity === "high" && row.ownerFixable).length;
  const systemSide = issues.filter((row) => row.severity === "high" && !row.ownerFixable).length;
  const columns = useMemo<Array<DataColumn<OperationIssue>>>(() => [
    { id: "issue", header: "Temuan", value: (row) => `${row.title} ${row.detail}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.title}</strong><small>{row.detail}</small></span> },
    { id: "severity", header: "Severity", value: (row) => row.severity, sortable: true, cell: (row) => <Badge tone={row.severity === "high" ? "danger" : row.severity === "medium" ? "warning" : "muted"}>{row.severity}</Badge> },
    { id: "kind", header: "Kategori", value: (row) => row.kind || row.code || "-", sortable: true },
    // Who has to act. Nearly every finding in this queue used to be presented
    // the same way, which was wrong in both directions: it sent the owner to
    // Google Sheets to fix a row that was already correct, and it buried which
    // rows were genuinely hers to edit.
    { id: "owner", header: "Perbaiki", value: (row) => (row.ownerFixable ? "kamu" : "sistem"), sortable: true, cell: (row) => <Badge tone={row.ownerFixable ? "warning" : "muted"}>{row.ownerFixable ? "Data Sheets" : "Sistem"}</Badge> },
    { id: "reference", header: "Referensi", value: (row) => row.orderId || row.accountId || row.stockId || row.resellerId || "-", hideOnMobile: true },
    { id: "action", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions">{issuePath(row) ? <Link to={issuePath(row)} aria-label={`Buka ${row.title}`}><ArrowUpRight size={14} /></Link> : null}{row.orderId ? <><button type="button" onClick={() => setIssueAction({ type: "check-payment", issue: row })} aria-label={`Cek payment ${row.orderId}`}><CreditCard size={14} /></button><button type="button" onClick={() => setIssueAction({ type: "retry", issue: row })} aria-label={`Retry delivery ${row.orderId}`}><RotateCcw size={14} /></button><button type="button" onClick={() => setIssueAction({ type: "mark-paid", issue: row })} aria-label={`Tandai paid ${row.orderId}`}><BadgeCheck size={14} /></button></> : null}{row.stockId ? <button type="button" onClick={() => setIssueAction({ type: "release", issue: row })} aria-label={`Lepas reservasi ${row.stockId}`}><UnlockKeyhole size={14} /></button> : null}{row.accountId ? <button type="button" onClick={() => { setReassignIssue(row); setReassignForm({ resellerId: row.resellerId || "", buyer: "" }); }} aria-label={`Reassign akun ${row.accountId}`}><UserRoundCog size={14} /></button> : null}</div> },
  ], []);
  const filters = useMemo<Array<DataFilter<OperationIssue>>>(() => [
    { id: "severity", label: "Severity", options: ["high", "medium", "low"].map((value) => ({ label: value, value })), value: (row) => row.severity },
    // The filter the owner actually wants: "show me only the rows I can fix by
    // editing Sheets", which is a short list, instead of every internal
    // inconsistency the system has noticed about itself.
    { id: "owner", label: "Perbaiki", options: [{ label: "Data Sheets", value: "kamu" }, { label: "Sistem", value: "sistem" }], value: (row) => (row.ownerFixable ? "kamu" : "sistem") },
  ], []);
  async function prepareRepair() { setBusy(true); setError(""); try { const preview = await api.previewOperationsRepair(); setRepairPreview(preview); setRecovery("repair"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview repair gagal dibuat."); } finally { setBusy(false); } }
  async function executeRecovery() { if (!recovery) return; setBusy(true); setError(""); try { if (recovery === "sync") await api.syncGoogleSheets(); else { if (!repairPreview?.previewToken) throw new Error("Preview repair belum tersedia."); await api.applyOperationsRepair(repairPreview.previewToken); } setMessage(recovery === "sync" ? "Sinkronisasi Sheets dijalankan." : "Repair reseller selesai diterapkan."); setRecovery(null); setRepairPreview(null); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery gagal dijalankan."); } finally { setBusy(false); } }
  async function executeIssueAction() { if (!issueAction) return; setBusy(true); setError(""); try { const { type, issue } = issueAction; if (type === "release" && issue.stockId) await api.releaseStockReservation(issue.stockId); if (type === "retry" && issue.orderId) await api.retryDelivery(issue.orderId); if (type === "mark-paid" && issue.orderId) await api.markOrderPaid(issue.orderId); if (type === "check-payment" && issue.orderId) await api.reconcilePayment(issue.orderId); setMessage(type === "release" ? "Reservasi stok berhasil dilepas." : type === "retry" ? "Retry delivery dijalankan." : type === "mark-paid" ? "Order ditandai paid dan diproses ulang." : "Status pembayaran berhasil diperiksa."); setIssueAction(null); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery item gagal."); } finally { setBusy(false); } }
  async function executeReassign() { if (!reassignIssue?.accountId || !reassignForm.resellerId) { setError("Pilih reseller tujuan terlebih dahulu."); return; } setBusy(true); setError(""); try { await api.reassignAccount(reassignIssue.accountId, { resellerId: reassignForm.resellerId, buyer: reassignForm.buyer || undefined }); setReassignIssue(null); setMessage("Ownership akun berhasil dipindahkan."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Reassign akun gagal."); } finally { setBusy(false); } }
  return <ConsoleShell title="Operations Center" description="Temukan anomali, antrean recovery, dan kondisi sinkronisasi." lastUpdated={updated} refreshing={loading} attentionCount={totalIssues} systemState={systemStateFor(totalIssues, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[{ label: "High priority", value: high, tone: high ? "danger" : "success" }, { label: "Perlu kamu perbaiki", value: ownerFixable, tone: ownerFixable ? "warning" : "success" }, { label: "Masalah sistem", value: systemSide, tone: systemSide ? "danger" : "success" }, { label: "Temuan aktif", value: totalIssues }, { label: "Delivery audit", value: data?.deliveryAudit.summary.total || 0 }, { label: "Stock locks", value: data?.stockLocks.summary.total || 0 }, { label: "Expired masih aktif", value: data?.expiry.summary.expiredActive || 0, tone: data?.expiry.summary.expiredActive ? "warning" : "success" }, { label: "Pending deposit", value: data?.manual.summary.pendingDeposits || 0, tone: data?.manual.summary.pendingDeposits ? "warning" : "success" }, { label: "WA failures", value: data?.whatsapp.summary.failures || 0, tone: data?.whatsapp.summary.failures ? "warning" : "success" }]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}<Toast message={message} onClose={clearMessage} />
    <nav className="console-focus-tabs" aria-label="Filter antrean temuan">
      {focusQueues.map((queue) => {
        const count = queue.id === "all" ? totalIssues : queues[queue.id].length;
        return <button key={queue.id} type="button" className={focus === queue.id ? "is-active" : ""} aria-pressed={focus === queue.id} onClick={() => selectFocus(queue.id)}>{queue.label}<span>{count}</span></button>;
      })}
    </nav>
    <section className="console-panel"><div className="console-panel-header"><div><span>Prioritas operasional</span><h2>{focusQueues.find((queue) => queue.id === focus)?.label || "Antrean temuan aktif"}</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={() => setRecovery("sync")}><RefreshCw size={15} /> Sync Sheets</button><button type="button" onClick={() => prepareRepair().catch(() => undefined)} disabled={busy}><Wrench size={15} /> {busy && !recovery ? "Menyiapkan preview..." : "Preview Repair"}</button></div></div><DataTable rows={issues} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} emptyText={focus === "all" ? "Tidak ada temuan operasional yang perlu ditangani." : `Tidak ada temuan pada antrean ${focusQueues.find((queue) => queue.id === focus)?.label.toLowerCase()}.`} initialPageSize={10} /></section>
    {recovery ? <Dialog open title="Konfirmasi recovery" eyebrow="Tindakan sensitif" onClose={() => { setRecovery(null); setRepairPreview(null); }} footer={<DialogActions onCancel={() => { setRecovery(null); setRepairPreview(null); }} onConfirm={executeRecovery} confirmLabel={recovery === "sync" ? "Jalankan sync" : "Terapkan hasil preview"} busy={busy} />}><div className="console-confirm-copy"><span className="console-confirm-icon">{recovery === "sync" ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}</span><p>{recovery === "sync" ? "Google Sheets akan dibaca ulang dan data lokal diselaraskan melalui flow yang sudah ada." : `${repairPreview?.affectedObjects || 0} objek terdeteksi akan berubah. ${repairPreview?.reason || ""}`}</p></div>{repairPreview ? <><Notice tone="warning">{repairPreview.risk}</Notice><div className="console-resource-form-grid"><Field label="Managed account sebelum"><strong>{repairPreview.before.accounts?.length || 0}</strong></Field><Field label="Managed account sesudah"><strong>{repairPreview.after.accounts?.length || 0}</strong></Field><Field label="Order diperiksa"><strong>{repairPreview.before.orders?.length || 0}</strong></Field><Field label="Stok diperiksa"><strong>{repairPreview.before.stock?.length || 0}</strong></Field></div></> : null}</Dialog> : null}
    {issueAction ? <Dialog open title={issueAction.type === "release" ? "Lepas reservasi stok" : issueAction.type === "retry" ? "Retry delivery" : issueAction.type === "mark-paid" ? "Tandai order paid" : "Periksa pembayaran"} eyebrow={issueAction.issue.orderId || issueAction.issue.stockId || "Recovery item"} onClose={() => setIssueAction(null)} footer={<DialogActions onCancel={() => setIssueAction(null)} onConfirm={executeIssueAction} confirmLabel="Jalankan tindakan" busy={busy} danger={issueAction.type === "release" || issueAction.type === "mark-paid"} />}><Notice tone={issueAction.type === "mark-paid" || issueAction.type === "release" ? "warning" : "info"}>{issueAction.type === "release" ? "Lock reservasi akan dilepas. Pastikan tidak ada pembayaran aktif yang masih menggunakan stok ini." : issueAction.type === "mark-paid" ? "Order akan dianggap sudah dibayar dan fulfillment dapat berjalan. Gunakan hanya setelah pembayaran diverifikasi." : issueAction.type === "retry" ? "Sistem akan mencoba ulang fulfillment dan notifikasi melalui flow yang sudah ada." : "Pakasir akan diperiksa menggunakan payment reference order tanpa mengubah status secara manual."}</Notice></Dialog> : null}
    {reassignIssue ? <Dialog open title="Pindahkan ownership akun" eyebrow={reassignIssue.accountId || "Akun"} onClose={() => setReassignIssue(null)} footer={<DialogActions onCancel={() => setReassignIssue(null)} onConfirm={executeReassign} confirmLabel="Pindahkan akun" busy={busy} />}><div className="console-resource-form-grid"><Field label="Reseller tujuan"><select value={reassignForm.resellerId} onChange={(event) => setReassignForm({ ...reassignForm, resellerId: event.target.value })}><option value="">Pilih reseller</option>{resellers.filter((row) => row.isActive).map((row) => <option key={row.id} value={row.id}>{row.name} (@{row.username})</option>)}</select></Field><Field label="Buyer (opsional)"><input value={reassignForm.buyer} onChange={(event) => setReassignForm({ ...reassignForm, buyer: event.target.value })} /></Field></div><Notice tone="warning">Ownership dan visibilitas Manage Account akan mengikuti reseller tujuan melalui endpoint reassign yang sama.</Notice></Dialog> : null}
  </ConsoleShell>;
}
