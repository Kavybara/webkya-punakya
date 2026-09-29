import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Copy, Edit3, FileText, LockKeyhole, PackagePlus, Trash2, UnlockKeyhole } from "lucide-react";
import { ConsoleDataTable, type ConsoleColumn, type ConsoleFilter } from "../../../components/console/ConsoleDataTable";
import { ConsoleBadge, ConsoleDialog, ConsoleDialogActions, ConsoleField, ConsoleMetrics, ConsoleNotice } from "../../../components/console/ConsoleResource";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type ApiProduct } from "../../../lib/api";
import { formatRupiah } from "../../../mocks/data";

type ProductForm = { name: string; code: string; category: string; description: string; isActive: boolean; resellerOnly: boolean; needsProfile: boolean; needsPin: boolean; variantName: string; variantCode: string; price: string };
type ProductVariant = ApiProduct["variants"][number];
type ProductAction = { type: "archive" | "delete" | "lock"; product: ApiProduct } | { type: "variant-lock"; product: ApiProduct; variant: ProductVariant } | null;
type TemplateTarget = { product: ApiProduct; variant: ProductVariant };
const emptyForm = (): ProductForm => ({ name: "", code: "", category: "Streaming", description: "", isActive: true, resellerOnly: false, needsProfile: false, needsPin: false, variantName: "", variantCode: "", price: "0" });
const ownerTemplatePlaceholders = ["product_name", "variant_name", "duration", "email", "password", "profile", "rental_end"];
const templatePreviewDurations = [
  { label: "Preview Bulanan", value: "1 Bulan", days: 30 },
  { label: "Preview Harian", value: "7 Hari", days: 7 },
];
function templatePreviewDays(value: string) {
  return templatePreviewDurations.find((duration) => duration.value === value)?.days || 30;
}

export default function OwnerConsoleProductsPage() {
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ApiProduct | null | undefined>(undefined);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [action, setAction] = useState<ProductAction>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [templateTarget, setTemplateTarget] = useState<TemplateTarget | null>(null);
  const [templateSource, setTemplateSource] = useState("");
  const [templateRequired, setTemplateRequired] = useState("");
  const [templateVersion, setTemplateVersion] = useState(0);
  const [templatePlaceholders, setTemplatePlaceholders] = useState<string[]>([]);
  const [templatePreview, setTemplatePreview] = useState("");
  const [templateWarnings, setTemplateWarnings] = useState<string[]>([]);
  const [templateCopySource, setTemplateCopySource] = useState("");
  const [templatePreviewDuration, setTemplatePreviewDuration] = useState("1 Bulan");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setProducts(await api.products()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Produk gagal dimuat."); } finally { setLoading(false); } }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  function openCreate() { setForm(emptyForm()); setEditing(null); }
  function openEdit(row: ApiProduct) { setEditing(row); setForm({ name: row.name, code: row.code, category: row.category, description: row.description, isActive: row.isActive, resellerOnly: Boolean(row.resellerOnly), needsProfile: row.needsProfile, needsPin: row.needsPin, variantName: "", variantCode: "", price: "0" }); }
  const requiredFields = useCallback(() => templateRequired.split(",").map((field) => field.trim()).filter(Boolean), [templateRequired]);
  async function openTemplate(product: ApiProduct, variant: ProductVariant) {
    setBusy(true);
    setError("");
    setTemplatePreview("");
    setTemplateWarnings([]);
    try {
      const config = await api.deliveryTemplate(product.id, variant.id);
      setTemplateTarget({ product, variant });
      setTemplateSource(config.source);
      setTemplateRequired(config.requiredFields.map((field) => Array.isArray(field) ? field.join("|") : field).join(", "));
      setTemplateVersion(config.version);
      setTemplatePlaceholders(ownerTemplatePlaceholders.filter((field) => config.placeholders.includes(field)));
      setTemplateCopySource("");
      setTemplatePreviewDuration("1 Bulan");
      setEditing(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Template pengiriman gagal dimuat.");
    } finally {
      setBusy(false);
    }
  }
  function insertPlaceholder(field: string) {
    setTemplateSource((current) => `${current}${current && !current.endsWith("\n") ? "\n" : ""}{{${field}}}`);
  }
  async function previewTemplate() {
    if (!templateTarget) return;
    setBusy(true);
    try {
      const result = await api.previewDeliveryTemplate(templateTarget.product.id, templateTarget.variant.id, {
        source: templateSource,
        requiredFields: requiredFields(),
        duration: templatePreviewDuration,
        durationDays: templatePreviewDays(templatePreviewDuration),
      });
      setTemplatePreview(result.rendered.text);
      setTemplateWarnings([...result.validation.errors, ...result.validation.warnings, ...result.rendered.errors]);
    } catch (cause) {
      setTemplateWarnings([cause instanceof Error ? cause.message : "Preview template gagal dibuat."]);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!templateTarget) return;
    if (!templateSource.trim()) {
      setTemplatePreview("");
      return;
    }
    const timeout = window.setTimeout(() => {
      api.previewDeliveryTemplate(templateTarget.product.id, templateTarget.variant.id, {
        source: templateSource,
        requiredFields: requiredFields(),
        duration: templatePreviewDuration,
        durationDays: templatePreviewDays(templatePreviewDuration),
      }).then((result) => {
        setTemplatePreview(result.rendered.text);
        setTemplateWarnings([...result.validation.errors, ...result.validation.warnings, ...result.rendered.errors]);
      }).catch((cause) => {
        setTemplateWarnings([cause instanceof Error ? cause.message : "Preview template gagal dibuat."]);
      });
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [requiredFields, templatePreviewDuration, templateSource, templateTarget]);
  async function saveTemplate() {
    if (!templateTarget) return;
    setBusy(true);
    try {
      const result = await api.saveDeliveryTemplate(templateTarget.product.id, templateTarget.variant.id, {
        source: templateSource,
        requiredFields: requiredFields(),
      });
      setTemplateVersion(Number(result.variant.deliveryTemplateVersion || templateVersion + 1));
      setTemplateWarnings(result.validation.warnings || []);
      setMessage("Template pengiriman berhasil disimpan.");
      await load();
    } catch (cause) {
      setTemplateWarnings([cause instanceof Error ? cause.message : "Template gagal disimpan."]);
    } finally {
      setBusy(false);
    }
  }
  async function copyTemplate() {
    if (!templateTarget || !templateCopySource) return;
    const [sourceProductId, sourceVariantId] = templateCopySource.split("::");
    setBusy(true);
    try {
      await api.copyDeliveryTemplate(templateTarget.product.id, templateTarget.variant.id, { sourceProductId, sourceVariantId });
      const config = await api.deliveryTemplate(templateTarget.product.id, templateTarget.variant.id);
      setTemplateSource(config.source);
      setTemplateRequired(config.requiredFields.map((field) => Array.isArray(field) ? field.join("|") : field).join(", "));
      setTemplateVersion(config.version);
      setTemplatePreview("");
      setTemplateWarnings(["Template disalin sebagai versi independen. Periksa lalu simpan perubahan Anda."]);
      await load();
    } catch (cause) {
      setTemplateWarnings([cause instanceof Error ? cause.message : "Template gagal disalin."]);
    } finally {
      setBusy(false);
    }
  }
  async function save() { if (!form.name.trim() || !form.code.trim() || (!editing && (!form.variantName.trim() || !form.variantCode.trim()))) { setError("Nama, kode produk, dan variant awal wajib diisi."); return; } setBusy(true); try { const payload: Omit<ApiProduct, "id"> = editing ? { ...editing, name: form.name, code: form.code, category: form.category, description: form.description, isActive: form.isActive, resellerOnly: form.resellerOnly, needsProfile: form.needsProfile, needsPin: form.needsPin } : { name: form.name, code: form.code, category: form.category, description: form.description, isActive: form.isActive, resellerOnly: form.resellerOnly, needsProfile: form.needsProfile, needsPin: form.needsPin, variants: [{ id: `var-${Date.now().toString(36)}`, code: form.variantCode, name: form.variantName, description: "", isActive: true, prices: { "1 Bulan": Number(form.price || 0) }, snk: "" }] }; editing ? await api.updateProduct(editing.id, payload) : await api.createProduct(payload); setEditing(undefined); setMessage("Produk berhasil disimpan."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Produk gagal disimpan."); } finally { setBusy(false); } }
  async function executeAction() { if (!action) return; setBusy(true); try { if (action.type === "archive") await api.archiveProduct(action.product.id, !action.product.isArchived); if (action.type === "delete") await api.deleteProduct(action.product.id); if (action.type === "lock") await api.setProductOrderLock(action.product.id, { enabled: !action.product.orderLock?.enabled, reason: reason.trim() }); if (action.type === "variant-lock") await api.setVariantOrderLock(action.product.id, action.variant.id, { enabled: !action.variant.orderLock?.enabled, reason: reason.trim() }); setAction(null); setReason(""); setMessage("Perubahan produk diterapkan."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Aksi produk gagal."); } finally { setBusy(false); } }
  const columns = useMemo<Array<ConsoleColumn<ApiProduct>>>(() => [
    { id: "product", header: "Produk", value: (row) => `${row.name} ${row.code}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.name}</strong><small>{row.code} / {row.category}</small></span> },
    { id: "variants", header: "Variant", value: (row) => row.variants.length, sortable: true },
    { id: "price", header: "Harga mulai", value: (row) => { const prices = row.variants.flatMap((variant) => Object.values(variant.prices)).filter((value) => value > 0); return prices.length ? Math.min(...prices) : 0; }, cell: (row) => { const prices = row.variants.flatMap((variant) => Object.values(variant.prices)).filter((value) => value > 0); return prices.length ? formatRupiah(Math.min(...prices)) : "-"; } },
    { id: "status", header: "Status", value: (row) => row.isArchived ? "Archived" : row.isActive ? "Aktif" : "Nonaktif", sortable: true, cell: (row) => <ConsoleBadge tone={row.isArchived ? "muted" : row.isActive ? "success" : "warning"}>{row.isArchived ? "Archived" : row.isActive ? "Aktif" : "Nonaktif"}</ConsoleBadge> },
    { id: "lock", header: "Order", value: (row) => row.orderLock?.enabled ? "Frozen" : "Open", cell: (row) => <ConsoleBadge tone={row.orderLock?.enabled ? "danger" : "success"}>{row.orderLock?.enabled ? "Frozen" : "Open"}</ConsoleBadge> },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${row.name}`}><Edit3 size={14} /></button><button type="button" onClick={() => { setAction({ type: "lock", product: row }); setReason(row.orderLock?.reason || ""); }} aria-label={`${row.orderLock?.enabled ? "Buka" : "Kunci"} ${row.name}`}>{row.orderLock?.enabled ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />}</button><button type="button" onClick={() => setAction({ type: "archive", product: row })} aria-label={`Archive ${row.name}`}><Archive size={14} /></button><button type="button" onClick={() => setAction({ type: "delete", product: row })} aria-label={`Hapus ${row.name}`}><Trash2 size={14} /></button></div> },
  ], []);
  const filters = useMemo<Array<ConsoleFilter<ApiProduct>>>(() => [{ id: "category", label: "Kategori", options: [...new Set(products.map((row) => row.category))].map((value) => ({ label: value, value })), value: (row) => row.category }], [products]);
  return <ConsoleShell title="Produk" description="Kelola katalog, variant, dan safe mode pemesanan." refreshing={loading} systemState={error ? "unknown" : "healthy"} onRefresh={load}>
    <ConsoleMetrics items={[{ label: "Total produk", value: products.length }, { label: "Aktif", value: products.filter((row) => row.isActive && !row.isArchived).length, tone: "success" }, { label: "Archived", value: products.filter((row) => row.isArchived).length }, { label: "Order frozen", value: products.filter((row) => row.orderLock?.enabled).length, tone: "warning" }]} />
    {error ? <ConsoleNotice tone="danger">{error}</ConsoleNotice> : null}{message ? <ConsoleNotice>{message}</ConsoleNotice> : null}
    <section className="console-panel"><div className="console-panel-header"><div><span>Katalog</span><h2>Daftar produk</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={openCreate}><PackagePlus size={15} /> Tambah produk</button></div></div><ConsoleDataTable rows={products} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} initialPageSize={10} /></section>
    {editing !== undefined ? <ConsoleDialog title={editing ? "Edit produk" : "Tambah produk"} eyebrow="Katalog" onClose={() => setEditing(undefined)} wide footer={<ConsoleDialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel="Simpan produk" busy={busy} />}><div className="console-resource-form-grid"><ConsoleField label="Nama"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></ConsoleField><ConsoleField label="Kode"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></ConsoleField><ConsoleField label="Kategori"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></ConsoleField><ConsoleField label="Status"><select value={form.isActive ? "active" : "inactive"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></ConsoleField><ConsoleField label="Deskripsi"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></ConsoleField><ConsoleField label="Aturan"><div className="console-checkbox-stack"><label><input type="checkbox" checked={form.resellerOnly} onChange={(e) => setForm({ ...form, resellerOnly: e.target.checked })} /> Reseller only</label><label><input type="checkbox" checked={form.needsProfile} onChange={(e) => setForm({ ...form, needsProfile: e.target.checked })} /> Butuh profil</label><label><input type="checkbox" checked={form.needsPin} onChange={(e) => setForm({ ...form, needsPin: e.target.checked })} /> Butuh PIN</label></div></ConsoleField>{!editing ? <><ConsoleField label="Variant awal"><input value={form.variantName} onChange={(e) => setForm({ ...form, variantName: e.target.value })} /></ConsoleField><ConsoleField label="Kode variant"><input value={form.variantCode} onChange={(e) => setForm({ ...form, variantCode: e.target.value })} /></ConsoleField><ConsoleField label="Harga 1 bulan"><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></ConsoleField></> : <div className="console-variant-locks">{editing.variants.map((variant) => <article key={variant.id}><div className="console-variant-title"><strong>{variant.name}</strong><small>{variant.code}</small></div><ConsoleBadge tone={variant.deliveryTemplate ? "success" : "warning"}>{variant.deliveryTemplate ? `Template v${variant.deliveryTemplateVersion || 1}` : "Belum ada template"}</ConsoleBadge><div className="console-row-actions console-variant-actions"><button type="button" onClick={() => openTemplate(editing, variant)}><FileText size={14} /> Template</button><button type="button" onClick={() => { setReason(variant.orderLock?.reason || ""); setAction({ type: "variant-lock", product: editing, variant }); }}>{variant.orderLock?.enabled ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />} {variant.orderLock?.enabled ? "Buka" : "Freeze"}</button></div></article>)}</div>}</div></ConsoleDialog> : null}
    {templateTarget ? <ConsoleDialog title="Template Pengiriman" eyebrow={`${templateTarget.product.name} / ${templateTarget.variant.name}`} onClose={() => setTemplateTarget(null)} wide footer={<ConsoleDialogActions onCancel={() => setTemplateTarget(null)} onConfirm={saveTemplate} confirmLabel="Simpan template" busy={busy} />}>
      <div className="console-template-editor">
        <div className="console-template-meta"><span>SKU <strong>{templateTarget.variant.code}</strong></span><span>Versi <strong>{templateVersion || "Belum ada"}</strong></span></div>
        <ConsoleField label="Plain text template"><textarea className="console-template-textarea" value={templateSource} onChange={(event) => setTemplateSource(event.target.value)} spellCheck={false} /></ConsoleField>
        <div><span className="console-template-label">Sisipkan placeholder</span><div className="console-template-placeholders">{templatePlaceholders.map((field) => <button type="button" key={field} onClick={() => insertPlaceholder(field)}>{`{{${field}}}`}</button>)}</div></div>
        <ConsoleField label="Field wajib (pisahkan koma, gunakan | untuk alternatif)"><input value={templateRequired} onChange={(event) => setTemplateRequired(event.target.value)} placeholder="email|login_identifier, password, rental_end" /></ConsoleField>
        <div className="console-template-actions"><button type="button" onClick={previewTemplate} disabled={busy}><FileText size={14} /> Preview Template</button><select value={templatePreviewDuration} onChange={(event) => setTemplatePreviewDuration(event.target.value)} aria-label="Durasi preview">{templatePreviewDurations.map((duration) => <option key={duration.value} value={duration.value}>{duration.label}</option>)}</select><select value={templateCopySource} onChange={(event) => setTemplateCopySource(event.target.value)}><option value="">Pilih varian sumber</option>{products.flatMap((product) => product.variants.map((variant) => ({ product, variant }))).filter(({ product, variant }) => product.id !== templateTarget.product.id || variant.id !== templateTarget.variant.id).map(({ product, variant }) => <option key={`${product.id}:${variant.id}`} value={`${product.id}::${variant.id}`}>{product.name} / {variant.name}</option>)}</select><button type="button" onClick={copyTemplate} disabled={!templateCopySource || busy}><Copy size={14} /> Salin dari Varian Lain</button></div>
        {templateWarnings.length ? <ConsoleNotice tone={templateWarnings.some((item) => /tidak valid|belum ditutup|tidak dikenal|kosong/i.test(item)) ? "danger" : "warning"}>{templateWarnings.join(" ")}</ConsoleNotice> : null}
        <div className="console-template-preview"><header><strong>Preview Template</strong><span>Data preview — bukan data pelanggan asli</span></header>{templatePreview ? <pre>{templatePreview}</pre> : <p>Preview otomatis muncul setelah template diisi.</p>}</div>
      </div>
    </ConsoleDialog> : null}
    {action ? <ConsoleDialog title={action.type === "delete" ? "Hapus produk" : action.type === "archive" ? "Ubah status arsip" : action.type === "variant-lock" ? action.variant.orderLock?.enabled ? "Buka varian" : "Freeze varian" : action.product.orderLock?.enabled ? "Buka pemesanan" : "Freeze pemesanan"} eyebrow={action.type === "variant-lock" ? `${action.product.name} / ${action.variant.name}` : action.product.name} onClose={() => setAction(null)} footer={<ConsoleDialogActions onCancel={() => setAction(null)} onConfirm={executeAction} confirmLabel="Konfirmasi" busy={busy} danger={action.type === "delete"} />}>{action.type === "lock" || action.type === "variant-lock" ? <ConsoleField label="Alasan"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></ConsoleField> : <ConsoleNotice tone={action.type === "delete" ? "danger" : "warning"}>{action.type === "delete" ? "Produk akan dihapus melalui endpoint owner yang sudah ada. Tindakan ini tidak dapat dibatalkan." : "Status arsip produk akan diubah tanpa menghapus data historis."}</ConsoleNotice>}</ConsoleDialog> : null}
  </ConsoleShell>;
}
