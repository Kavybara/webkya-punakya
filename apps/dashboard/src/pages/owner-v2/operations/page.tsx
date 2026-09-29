import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, BadgeCheck, CreditCard, RefreshCw, RotateCcw, ShieldCheck, UnlockKeyhole, UserRoundCog, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleActionToast, ConsoleBadge, ConsoleDialog, ConsoleDialogActions, ConsoleField, ConsoleMetrics, ConsoleNotice } from "../../../components/console/ConsoleResource";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type ApiReseller, type OperationIssue, type OperationsCenterResult, type OperationsRepairPreview } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";

type Recovery = "sync" | "repair" | null;
type IssueAction = { type: "release" | "retry" | "mark-paid" | "check-payment"; issue: OperationIssue } | null;
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
  const clearMessage = useCallback(() => setMessage(""), []);
  const load = useCallback(async () => { setLoading(true); setError(""); const results = await Promise.allSettled([api.operationsCenter(), api.resellers()]); if (results[0].status === "fulfilled") { setData(results[0].value); setUpdated(formatDateTime(results[0].value.checkedAt)); } else setError("Operations Center gagal dimuat."); if (results[1].status === "fulfilled") setResellers(results[1].value); setLoading(false); }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  const issues = useMemo(() => {
    if (!data) return [];
    const unique = new Map<string, OperationIssue>();
    for (const issue of [...data.deliveryAudit.items, ...data.stockLocks.items, ...data.reconcile.issues, ...(data.sheetsAudit?.issues || []), ...data.reseller.items, ...data.manual.items, ...data.whatsapp.recentFailures]) {
      const key = issueFingerprint(issue);
      if (!unique.has(key)) unique.set(key, issue);
    }
    return [...unique.values()];
  }, [data]);
  const high = issues.filter((row) => row.severity === "high").length;
  const columns = useMemo<Array<DataColumn<OperationIssue>>>(() => [
    { id: "issue", header: "Temuan", value: (row) => `${row.title} ${row.detail}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.title}</strong><small>{row.detail}</small></span> },
    { id: "severity", header: "Severity", value: (row) => row.severity, sortable: true, cell: (row) => <ConsoleBadge tone={row.severity === "high" ? "danger" : row.severity === "medium" ? "warning" : "muted"}>{row.severity}</ConsoleBadge> },
    { id: "kind", header: "Kategori", value: (row) => row.kind || row.code || "-", sortable: true },
    { id: "reference", header: "Referensi", value: (row) => row.orderId || row.accountId || row.stockId || row.resellerId || "-", hideOnMobile: true },
    { id: "action", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions">{issuePath(row) ? <Link to={issuePath(row)} aria-label={`Buka ${row.title}`}><ArrowUpRight size={14} /></Link> : null}{row.orderId ? <><button type="button" onClick={() => setIssueAction({ type: "check-payment", issue: row })} aria-label={`Cek payment ${row.orderId}`}><CreditCard size={14} /></button><button type="button" onClick={() => setIssueAction({ type: "retry", issue: row })} aria-label={`Retry delivery ${row.orderId}`}><RotateCcw size={14} /></button><button type="button" onClick={() => setIssueAction({ type: "mark-paid", issue: row })} aria-label={`Tandai paid ${row.orderId}`}><BadgeCheck size={14} /></button></> : null}{row.stockId ? <button type="button" onClick={() => setIssueAction({ type: "release", issue: row })} aria-label={`Lepas reservasi ${row.stockId}`}><UnlockKeyhole size={14} /></button> : null}{row.accountId ? <button type="button" onClick={() => { setReassignIssue(row); setReassignForm({ resellerId: row.resellerId || "", buyer: "" }); }} aria-label={`Reassign akun ${row.accountId}`}><UserRoundCog size={14} /></button> : null}</div> },
  ], []);
  const filters = useMemo<Array<DataFilter<OperationIssue>>>(() => [{ id: "severity", label: "Severity", options: ["high", "medium", "low"].map((value) => ({ label: value, value })), value: (row) => row.severity }], []);
  async function prepareRepair() { setBusy(true); setError(""); try { const preview = await api.previewOperationsRepair(); setRepairPreview(preview); setRecovery("repair"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview repair gagal dibuat."); } finally { setBusy(false); } }
  async function executeRecovery() { if (!recovery) return; setBusy(true); setError(""); try { if (recovery === "sync") await api.syncGoogleSheets(); else { if (!repairPreview?.previewToken) throw new Error("Preview repair belum tersedia."); await api.applyOperationsRepair(repairPreview.previewToken); } setMessage(recovery === "sync" ? "Sinkronisasi Sheets dijalankan." : "Repair reseller selesai diterapkan."); setRecovery(null); setRepairPreview(null); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery gagal dijalankan."); } finally { setBusy(false); } }
  async function executeIssueAction() { if (!issueAction) return; setBusy(true); setError(""); try { const { type, issue } = issueAction; if (type === "release" && issue.stockId) await api.releaseStockReservation(issue.stockId); if (type === "retry" && issue.orderId) await api.retryDelivery(issue.orderId); if (type === "mark-paid" && issue.orderId) await api.markOrderPaid(issue.orderId); if (type === "check-payment" && issue.orderId) await api.reconcilePayment(issue.orderId); setMessage(type === "release" ? "Reservasi stok berhasil dilepas." : type === "retry" ? "Retry delivery dijalankan." : type === "mark-paid" ? "Order ditandai paid dan diproses ulang." : "Status pembayaran berhasil diperiksa."); setIssueAction(null); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery item gagal."); } finally { setBusy(false); } }
  async function executeReassign() { if (!reassignIssue?.accountId || !reassignForm.resellerId) { setError("Pilih reseller tujuan terlebih dahulu."); return; } setBusy(true); setError(""); try { await api.reassignAccount(reassignIssue.accountId, { resellerId: reassignForm.resellerId, buyer: reassignForm.buyer || undefined }); setReassignIssue(null); setMessage("Ownership akun berhasil dipindahkan."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Reassign akun gagal."); } finally { setBusy(false); } }
  return <ConsoleShell title="Operations Center" description="Temukan anomali, antrean recovery, dan kondisi sinkronisasi." lastUpdated={updated} refreshing={loading} attentionCount={issues.length} systemState={error ? "unknown" : issues.length ? "warning" : "healthy"} onRefresh={load}>
    <ConsoleMetrics items={[{ label: "High priority", value: high, tone: high ? "danger" : "success" }, { label: "Temuan aktif", value: issues.length }, { label: "Delivery audit", value: data?.deliveryAudit.summary.total || 0 }, { label: "Stock locks", value: data?.stockLocks.summary.total || 0 }, { label: "Pending deposit", value: data?.manual.summary.pendingDeposits || 0, tone: data?.manual.summary.pendingDeposits ? "warning" : "success" }, { label: "WA failures", value: data?.whatsapp.summary.failures || 0, tone: data?.whatsapp.summary.failures ? "warning" : "success" }]} />
    {error ? <ConsoleNotice tone="danger">{error}</ConsoleNotice> : null}<ConsoleActionToast message={message} onClose={clearMessage} />
    <section className="console-panel"><div className="console-panel-header"><div><span>Prioritas operasional</span><h2>Antrean temuan aktif</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={() => setRecovery("sync")}><RefreshCw size={15} /> Sync Sheets</button><button type="button" onClick={() => prepareRepair().catch(() => undefined)} disabled={busy}><Wrench size={15} /> {busy && !recovery ? "Menyiapkan preview..." : "Preview Repair"}</button></div></div><DataTable rows={issues} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} emptyText="Tidak ada temuan operasional yang perlu ditangani." initialPageSize={10} /></section>
    {recovery ? <ConsoleDialog title="Konfirmasi recovery" eyebrow="Tindakan sensitif" onClose={() => { setRecovery(null); setRepairPreview(null); }} footer={<ConsoleDialogActions onCancel={() => { setRecovery(null); setRepairPreview(null); }} onConfirm={executeRecovery} confirmLabel={recovery === "sync" ? "Jalankan sync" : "Terapkan hasil preview"} busy={busy} />}><div className="console-confirm-copy"><span className="console-confirm-icon">{recovery === "sync" ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}</span><p>{recovery === "sync" ? "Google Sheets akan dibaca ulang dan data lokal diselaraskan melalui flow yang sudah ada." : `${repairPreview?.affectedObjects || 0} objek terdeteksi akan berubah. ${repairPreview?.reason || ""}`}</p></div>{repairPreview ? <><ConsoleNotice tone="warning">{repairPreview.risk}</ConsoleNotice><div className="console-resource-form-grid"><ConsoleField label="Managed account sebelum"><strong>{repairPreview.before.accounts?.length || 0}</strong></ConsoleField><ConsoleField label="Managed account sesudah"><strong>{repairPreview.after.accounts?.length || 0}</strong></ConsoleField><ConsoleField label="Order diperiksa"><strong>{repairPreview.before.orders?.length || 0}</strong></ConsoleField><ConsoleField label="Stok diperiksa"><strong>{repairPreview.before.stock?.length || 0}</strong></ConsoleField></div></> : null}</ConsoleDialog> : null}
    {issueAction ? <ConsoleDialog title={issueAction.type === "release" ? "Lepas reservasi stok" : issueAction.type === "retry" ? "Retry delivery" : issueAction.type === "mark-paid" ? "Tandai order paid" : "Periksa pembayaran"} eyebrow={issueAction.issue.orderId || issueAction.issue.stockId || "Recovery item"} onClose={() => setIssueAction(null)} footer={<ConsoleDialogActions onCancel={() => setIssueAction(null)} onConfirm={executeIssueAction} confirmLabel="Jalankan tindakan" busy={busy} danger={issueAction.type === "release" || issueAction.type === "mark-paid"} />}><ConsoleNotice tone={issueAction.type === "mark-paid" || issueAction.type === "release" ? "warning" : "info"}>{issueAction.type === "release" ? "Lock reservasi akan dilepas. Pastikan tidak ada pembayaran aktif yang masih menggunakan stok ini." : issueAction.type === "mark-paid" ? "Order akan dianggap sudah dibayar dan fulfillment dapat berjalan. Gunakan hanya setelah pembayaran diverifikasi." : issueAction.type === "retry" ? "Sistem akan mencoba ulang fulfillment dan notifikasi melalui flow yang sudah ada." : "Pakasir akan diperiksa menggunakan payment reference order tanpa mengubah status secara manual."}</ConsoleNotice></ConsoleDialog> : null}
    {reassignIssue ? <ConsoleDialog title="Pindahkan ownership akun" eyebrow={reassignIssue.accountId || "Akun"} onClose={() => setReassignIssue(null)} footer={<ConsoleDialogActions onCancel={() => setReassignIssue(null)} onConfirm={executeReassign} confirmLabel="Pindahkan akun" busy={busy} />}><div className="console-resource-form-grid"><ConsoleField label="Reseller tujuan"><select value={reassignForm.resellerId} onChange={(event) => setReassignForm({ ...reassignForm, resellerId: event.target.value })}><option value="">Pilih reseller</option>{resellers.filter((row) => row.isActive).map((row) => <option key={row.id} value={row.id}>{row.name} (@{row.username})</option>)}</select></ConsoleField><ConsoleField label="Buyer (opsional)"><input value={reassignForm.buyer} onChange={(event) => setReassignForm({ ...reassignForm, buyer: event.target.value })} /></ConsoleField></div><ConsoleNotice tone="warning">Ownership dan visibilitas Manage Account akan mengikuti reseller tujuan melalui endpoint reassign yang sama.</ConsoleNotice></ConsoleDialog> : null}
  </ConsoleShell>;
}
