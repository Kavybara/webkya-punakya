import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, DatabaseZap, Edit3, Eye, EyeOff, Plus, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type ApiProduct, type ApiReseller, type ApiStockItem, type GoogleSheetsPreview, type GoogleSheetsStatus, type MaintenanceState } from "../../../lib/api";
import { Badge, Dialog, DialogActions, Field, MetricRow, Notice } from "../../../components/ui";

type StockForm = { productId: string; variantId: string; email: string; loginPhone: string; otpEmail: string; password: string; profile: string; pin: string; status: ApiStockItem["status"]; sheetName: string; sheetRow: string };
type DailyForm = { resellerId: string; variantId: string; startedAt: string; durationDays: string; buyer: string; device: string };
type StockAction = { type: "delete" | "sync" | "maintenance"; stock?: ApiStockItem } | null;
const emptyForm = (): StockForm => ({ productId: "", variantId: "", email: "", loginPhone: "", otpEmail: "", password: "", profile: "", pin: "", status: "available", sheetName: "", sheetRow: "" });

function stockStatusLabel(status: ApiStockItem["status"]) {
  if (status === "available") return "Tersedia";
  if (status === "reserved") return "Direservasi";
  if (status === "sold") return "Terjual";
  return "Diblokir";
}

function accountConditionLabel(value?: string, known = true) {
  if (!known) return "Tidak dikenal";
  const condition = String(value || "NORMAL").trim().toUpperCase();
  if (condition === "BERMASALAH") return "Bermasalah";
  if (condition === "DIPERIKSA") return "Diperiksa";
  if (condition === "REPLACED") return "Diganti";
  if (condition === "DISABLED") return "Dinonaktifkan";
  return "Normal";
}

function accountConditionTone(row: ApiStockItem) {
  if (row.accountConditionKnown === false) return "danger" as const;
  const condition = String(row.accountCondition || "NORMAL").toUpperCase();
  if (condition === "BERMASALAH" || condition === "DISABLED") return "danger" as const;
  if (condition === "DIPERIKSA") return "warning" as const;
  if (condition === "REPLACED") return "muted" as const;
  return "success" as const;
}

export default function OwnerConsoleStockPage() {
  const [stock, setStock] = useState<ApiStockItem[]>([]);
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [sheets, setSheets] = useState<GoogleSheetsStatus | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ApiStockItem | null | undefined>(undefined);
  const [form, setForm] = useState<StockForm>(emptyForm);
  const [showSecret, setShowSecret] = useState(false);
  const [action, setAction] = useState<StockAction>(null);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState<ApiStockItem | null>(null);
  const [dailyForm, setDailyForm] = useState<DailyForm>({ resellerId: "", variantId: "", startedAt: new Date().toISOString().slice(0, 10), durationDays: "1", buyer: "", device: "" });
  const [preview, setPreview] = useState<GoogleSheetsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(""); const results = await Promise.allSettled([api.stock(), api.products(), api.resellers(), api.googleSheetsStatus(), api.maintenance()]); if (results[0].status === "fulfilled") setStock(results[0].value); else setError("Stok gagal dimuat."); if (results[1].status === "fulfilled") setProducts(results[1].value); if (results[2].status === "fulfilled") setResellers(results[2].value); if (results[3].status === "fulfilled") setSheets(results[3].value); if (results[4].status === "fulfilled") setMaintenance(results[4].value.maintenance); setLoading(false); }, []);
  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);
  function openCreate() { setEditing(null); setForm(emptyForm()); setShowSecret(false); }
  function openEdit(row: ApiStockItem) { setEditing(row); setForm({ productId: row.productId, variantId: row.variantId, email: row.email || "", loginPhone: row.loginPhone || "", otpEmail: row.otpEmail || "", password: row.password || "", profile: row.profile || "", pin: row.pin || "", status: row.status, sheetName: row.sheetName || "", sheetRow: String(row.sheetRow || "") }); setShowSecret(false); }
  async function save() { if (!form.productId || !form.variantId || (!form.email && !form.loginPhone)) { setError("Produk, variant, dan identitas akun wajib diisi."); return; } setBusy(true); try { const payload: Partial<ApiStockItem> = { ...form, sheetRow: Number(form.sheetRow || 0) || undefined }; editing ? await api.updateStock(editing.id, payload) : await api.createStock(payload); setEditing(undefined); setMessage("Stok berhasil disimpan."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Stok gagal disimpan."); } finally { setBusy(false); } }
  async function executeAction() { if (!action) return; setBusy(true); try { if (action.type === "delete" && action.stock) await api.deleteStock(action.stock.id); if (action.type === "sync") await api.syncGoogleSheets(); if (action.type === "maintenance") await api.updateMaintenance({ enabled: !maintenance?.enabled, reason: maintenance?.enabled ? "" : "Maintenance manual dari Kavya Console" }); setAction(null); setMessage(action.type === "sync" ? "Google Sheets berhasil disinkronkan." : "Perubahan berhasil diterapkan."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Tindakan stok gagal."); } finally { setBusy(false); } }
  async function previewSheets() { if (previewLoading) return; setPreviewLoading(true); setError(""); setMessage("Membaca Google Sheets untuk membuat preview tanpa menulis data..."); try { const result = await api.googleSheetsPreview(); setPreview(result.preview); setMessage("Preview Sheets siap. Belum ada data yang diubah."); } catch (cause) { setMessage(""); setError(cause instanceof Error ? cause.message : "Preview Google Sheets gagal."); } finally { setPreviewLoading(false); } }
  function openDaily(row: ApiStockItem) { setAssigning(row); setDailyForm({ resellerId: "", variantId: row.variantId, startedAt: new Date().toISOString().slice(0, 10), durationDays: "1", buyer: "", device: "" }); }
  async function assignDaily() { if (!assigning || !dailyForm.resellerId || Number(dailyForm.durationDays) <= 0) { setError("Reseller dan durasi harian yang valid wajib diisi."); return; } setBusy(true); try { await api.assignDailyStock(assigning.id, { resellerId: dailyForm.resellerId, variantId: dailyForm.variantId || assigning.variantId, startedAt: dailyForm.startedAt, durationDays: Math.floor(Number(dailyForm.durationDays)), buyer: dailyForm.buyer || undefined, device: dailyForm.device || undefined }); setAssigning(null); setMessage("Stok harian berhasil diberikan dan ownership diperbarui."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Assign stok harian gagal."); } finally { setBusy(false); } }
  const productName = useCallback((row: ApiStockItem) => products.find((product) => product.id === row.productId)?.name || row.productId, [products]);
  const variantName = useCallback((row: ApiStockItem) => products.find((product) => product.id === row.productId)?.variants.find((variant) => variant.id === row.variantId)?.name || row.variantId, [products]);
  const columns = useMemo<Array<DataColumn<ApiStockItem>>>(() => [
    { id: "identity", header: "Identitas", value: (row) => row.email || row.loginPhone || "-", sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.email || row.loginPhone || "-"}</strong><small>{row.profile || "Tanpa profil"}</small></span> },
    { id: "product", header: "Produk", value: (row) => `${productName(row)} ${variantName(row)}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{productName(row)}</strong><small>{variantName(row)}</small></span> },
    { id: "status", header: "Status", value: (row) => row.status, sortable: true, cell: (row) => <Badge tone={row.status === "available" ? "success" : row.status === "reserved" ? "warning" : row.status === "blocked" ? "danger" : "muted"}>{stockStatusLabel(row.status)}</Badge> },
    { id: "condition", header: "Kondisi akun", value: (row) => row.accountConditionKnown === false ? `UNKNOWN ${row.accountConditionRaw || ""}` : row.accountCondition || "NORMAL", sortable: true, cell: (row) => <Badge tone={accountConditionTone(row)}>{accountConditionLabel(row.accountCondition, row.accountConditionKnown !== false)}</Badge> },
    { id: "sheet", header: "Sheets", value: (row) => `${row.sheetName || ""} ${row.sheetRow || ""}`, hideOnMobile: true, cell: (row) => row.sheetName ? `${row.sheetName} / row ${row.sheetRow || "-"}` : "Lokal" },
    { id: "reservation", header: "Reservasi", value: (row) => row.reservedFor || "-", hideOnMobile: true },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" onClick={() => openEdit(row)} aria-label={`Edit stok ${row.id}`}><Edit3 size={14} /></button>{row.status === "available" ? <button type="button" onClick={() => openDaily(row)} aria-label={`Assign harian ${row.id}`}><CalendarPlus size={14} /></button> : null}<button type="button" onClick={() => setAction({ type: "delete", stock: row })} aria-label={`Hapus stok ${row.id}`}><Trash2 size={14} /></button></div> },
  ], [productName, variantName]);
  const filters = useMemo<Array<DataFilter<ApiStockItem>>>(() => [
    { id: "status", label: "Status", options: (["available", "reserved", "sold", "blocked"] as const).map((value) => ({ label: stockStatusLabel(value), value })), value: (row) => row.status },
    { id: "condition", label: "Kondisi akun", options: [
      { label: "Normal", value: "NORMAL" },
      { label: "Bermasalah", value: "BERMASALAH" },
      { label: "Diperiksa", value: "DIPERIKSA" },
      { label: "Diganti", value: "REPLACED" },
      { label: "Dinonaktifkan", value: "DISABLED" },
      { label: "Tidak dikenal", value: "UNKNOWN" },
    ], value: (row) => row.accountConditionKnown === false ? "UNKNOWN" : row.accountCondition || "NORMAL" },
    { id: "product", label: "Produk", options: products.map((product) => ({ label: product.name, value: product.id })), value: (row) => row.productId },
  ], [products]);
  const variants = products.find((product) => product.id === form.productId)?.variants || [];
  return <ConsoleShell title="Stok Akun" description="Kelola inventory dan sinkronisasi Google Sheets." refreshing={loading} attentionCount={stock.filter((row) => row.status === "reserved").length} systemState={error ? "unknown" : maintenance?.enabled ? "warning" : "healthy"} onRefresh={load}>
    <MetricRow items={[{ label: "Tersedia", value: stock.filter((row) => row.status === "available").length, tone: "success" }, { label: "Direservasi", value: stock.filter((row) => row.status === "reserved").length, tone: "warning" }, { label: "Terjual", value: stock.filter((row) => row.status === "sold").length }, { label: "Diblokir", value: stock.filter((row) => row.status === "blocked").length, tone: "warning" }, { label: "Sheets", value: sheets?.configured ? "Terhubung" : "Periksa", tone: sheets?.configured ? "success" : "warning", hint: sheets?.lastSyncAt || "Belum sync" }, { label: "Maintenance", value: maintenance?.enabled ? "Aktif" : "Nonaktif", tone: maintenance?.enabled ? "warning" : "success" }]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    <section className="console-panel"><div className="console-panel-header"><div><span>Katalog</span><h2>Inventory stok</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={previewSheets} disabled={previewLoading} aria-busy={previewLoading}><ScanSearch size={15} /> {previewLoading ? "Membaca Sheets..." : "Preview Sheets"}</button><button type="button" onClick={() => setAction({ type: "sync" })}><RefreshCw size={15} /> Sync Sheets</button><button type="button" onClick={() => setAction({ type: "maintenance" })}><DatabaseZap size={15} /> {maintenance?.enabled ? "Matikan maintenance" : "Maintenance"}</button><button type="button" onClick={openCreate}><Plus size={15} /> Tambah stok</button></div></div><DataTable rows={stock} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} initialPageSize={10} /></section>
    {editing !== undefined ? <Dialog open title={editing ? "Edit stok" : "Tambah stok"} eyebrow="Inventory" onClose={() => setEditing(undefined)} wide footer={<DialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel="Simpan stok" busy={busy} />}><div className="console-resource-form-grid"><Field label="Produk"><select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value, variantId: "" })}><option value="">Pilih produk</option>{products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><Field label="Variant"><select value={form.variantId} onChange={(e) => setForm({ ...form, variantId: e.target.value })}><option value="">Pilih variant</option>{variants.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field><Field label="Email / identitas"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="Nomor login"><input value={form.loginPhone} onChange={(e) => setForm({ ...form, loginPhone: e.target.value })} /></Field><Field label="OTP email"><input value={form.otpEmail} onChange={(e) => setForm({ ...form, otpEmail: e.target.value })} /></Field><Field label="Password"><div className="console-secret-input"><input type={showSecret ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><button type="button" onClick={() => setShowSecret((value) => !value)} aria-label={showSecret ? "Sembunyikan password" : "Tampilkan password"}>{showSecret ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></Field><Field label="Profil"><input value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })} /></Field><Field label="PIN"><input type={showSecret ? "text" : "password"} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></Field><Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ApiStockItem["status"] })}><option value="available">Tersedia</option><option value="reserved">Direservasi</option><option value="sold">Terjual</option>{form.status === "blocked" ? <option value="blocked" disabled>Diblokir oleh kondisi Sheets</option> : null}</select></Field>{editing?.sheetSource === "google_sheets" ? <Field label="Kondisi akun (read-only)"><input value={accountConditionLabel(editing.accountCondition, editing.accountConditionKnown !== false)} readOnly aria-readonly="true" /></Field> : null}<Field label="Sheet name"><input value={form.sheetName} onChange={(e) => setForm({ ...form, sheetName: e.target.value })} /></Field><Field label="Sheet row"><input type="number" value={form.sheetRow} onChange={(e) => setForm({ ...form, sheetRow: e.target.value })} /></Field></div><div className="console-privacy-note"><EyeOff size={16} /><span>Password dan PIN dimasking secara default. Kondisi akun Google Sheets ditampilkan read-only agar kolom yang salah tidak tertimpa.</span></div></Dialog> : null}
    {action ? <Dialog open title={action.type === "delete" ? "Hapus stok" : action.type === "sync" ? "Sinkronkan Google Sheets" : maintenance?.enabled ? "Matikan maintenance" : "Aktifkan maintenance"} eyebrow="Konfirmasi tindakan" onClose={() => setAction(null)} footer={<DialogActions onCancel={() => setAction(null)} onConfirm={executeAction} confirmLabel="Konfirmasi" busy={busy} danger={action.type === "delete"} />}><Notice tone={action.type === "delete" ? "danger" : "warning"}>{action.type === "delete" ? "Stok akan dihapus melalui endpoint owner. Pastikan akun tidak sedang dipakai atau terikat order." : action.type === "sync" ? "Google Sheets menjadi sumber rekonsiliasi dan data akan diselaraskan melalui proses sync yang ada." : "Order baru akan mengikuti kondisi maintenance setelah perubahan diterapkan."}</Notice></Dialog> : null}
    {assigning ? <Dialog open title="Assign stok harian" eyebrow={assigning.email || assigning.loginPhone || assigning.id} onClose={() => setAssigning(null)} wide footer={<DialogActions onCancel={() => setAssigning(null)} onConfirm={assignDaily} confirmLabel="Assign akun" busy={busy} />}><div className="console-resource-form-grid"><Field label="Reseller"><select value={dailyForm.resellerId} onChange={(e) => setDailyForm({ ...dailyForm, resellerId: e.target.value })}><option value="">Pilih reseller</option>{resellers.filter((row) => row.isActive).map((row) => <option key={row.id} value={row.id}>{row.name} (@{row.username})</option>)}</select></Field><Field label="Mulai"><input type="date" value={dailyForm.startedAt} onChange={(e) => setDailyForm({ ...dailyForm, startedAt: e.target.value })} /></Field><Field label="Durasi hari"><input type="number" min="1" value={dailyForm.durationDays} onChange={(e) => setDailyForm({ ...dailyForm, durationDays: e.target.value })} /></Field><Field label="Buyer"><input value={dailyForm.buyer} onChange={(e) => setDailyForm({ ...dailyForm, buyer: e.target.value })} /></Field><Field label="Device"><input value={dailyForm.device} onChange={(e) => setDailyForm({ ...dailyForm, device: e.target.value })} /></Field></div><Notice tone="warning">Assignment menggunakan endpoint stok harian yang sama dan akan menulis ownership sesuai konfigurasi Sheets.</Notice></Dialog> : null}
    {preview ? <Dialog open title="Preview sinkronisasi Sheets" eyebrow="Belum ada data yang ditulis" onClose={() => setPreview(null)} wide><div className="console-preview-summary"><span><small>Tambah stok</small><strong>{preview.addStock}</strong></span><span><small>Sold</small><strong>{preview.soldStock}</strong></span><span><small>Dihapus</small><strong>{preview.removedStock}</strong></span><span><small>Warning</small><strong>{preview.warnings.length}</strong></span></div>{preview.warnings.length ? <Notice tone="warning">{preview.warnings.slice(0, 4).join(" | ")}</Notice> : <Notice>Preview tidak menemukan warning.</Notice>}<div className="console-preview-list">{preview.changes.slice(0, 12).map((change) => <article key={`${change.stockId}-${change.sheetName}-${change.sheetRow}`}><div><strong>{change.identity || change.stockId}</strong><small>{change.sheetName} / row {change.sheetRow}</small></div><Badge tone={change.type === "removed" ? "danger" : "muted"}>{change.type}</Badge></article>)}</div>{preview.changes.length > 12 ? <p className="console-preview-more">Dan {preview.changes.length - 12} perubahan lain.</p> : null}</Dialog> : null}
  </ConsoleShell>;
}
