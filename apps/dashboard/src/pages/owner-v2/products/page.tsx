import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Copy, Edit3, FileText, LockKeyhole, PackagePlus, Trash2, UnlockKeyhole } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type ApiProduct } from "../../../lib/api";
import { formatRupiah } from "../../../lib/format";
import { sortedPriceEntries } from "../../../lib/durations";
import { Badge, Dialog, DialogActions, Field, MetricRow, Notice } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

type ProductForm = { name: string; code: string; category: string; description: string; isActive: boolean; resellerOnly: boolean; needsProfile: boolean; needsPin: boolean; variantName: string; variantCode: string; price: string };
/**
 * Per-variant price edits, keyed `variantId::durationLabel`.
 *
 * The edit form could not change a price at all: the price input was rendered
 * only when `!editing`, and the edit payload spread the existing product without
 * touching `variants[].prices`. A product's price was therefore whatever it was
 * when the product was first created -- there was no way to raise it, and no
 * way to lower one that had been set too high. For a catalogue whose whole job
 * is to be sold, that is a business operation the panel simply did not offer.
 *
 * Keyed by variant *and* duration, because `prices` is per-variant per-duration
 * and a product has both. A flat map keyed by duration would apply a 3-month
 * price typed for one variant to every variant that has a 3-month price.
 */
type PriceEdits = Record<string, string>;
type ProductVariant = ApiProduct["variants"][number];
type ProductAction = { type: "archive" | "delete" | "lock"; product: ApiProduct } | { type: "variant-lock"; product: ApiProduct; variant: ProductVariant } | null;
type TemplateTarget = { product: ApiProduct; variant: ProductVariant };
const emptyForm = (): ProductForm => ({ name: "", code: "", category: "Streaming", description: "", isActive: true, resellerOnly: false, needsProfile: false, needsPin: false, variantName: "", variantCode: "", price: "0" });

/** The key `priceEdits` uses for one variant/duration pair. */
export const priceEditKey = (variantId: string, duration: string) => `${variantId}::${duration}`;

/**
 * Apply the typed prices to a product's variants.
 *
 * Every variant comes back as a new object and every edited `prices` map as a
 * new map, so the product held in `products` state is never mutated in place --
 * which matters here, because `load()` does not necessarily follow: a rejected
 * update would otherwise leave the table showing a price that was never saved.
 *
 * A variant with no edits is passed through by identity, so the common case of
 * "renamed the description" allocates nothing.
 *
 * An empty field is dropped rather than written as `0`. A variant priced at
 * three durations and then blanked at one of them should stop offering that
 * duration; writing `0` would advertise a free month on the public catalogue.
 */
export function applyPriceEdits<T extends { id: string; prices: Record<string, number> }>(
  variants: T[],
  edits: PriceEdits,
): T[] {
  return (variants || []).map((variant) => {
    const entries = Object.entries(edits).filter(([key]) => key.startsWith(`${variant.id}::`));
    if (!entries.length) return variant;
    const prices = { ...variant.prices };
    for (const [key, raw] of entries) {
      const duration = key.slice(variant.id.length + 2);
      if (!duration) continue;
      const trimmed = String(raw ?? "").trim();
      if (!trimmed) {
        delete prices[duration];
        continue;
      }
      const amount = Number(trimmed);
      if (Number.isFinite(amount) && amount > 0) prices[duration] = amount;
    }
    return { ...variant, prices };
  });
}
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
  // Three jobs used to share one string, so a failed save replaced the reason
  // the catalogue could not load and blanked the table underneath. They are
  // split now: `error` is only ever a load failure, `formError` belongs to the
  // open dialog, `actionError` to the row action that was confirmed.
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ApiProduct | null | undefined>(undefined);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [priceEdits, setPriceEdits] = useState<PriceEdits>({});
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
  function openCreate() { setForm(emptyForm()); setFormError(""); setEditing(null); setPriceEdits({}); }
  function openEdit(row: ApiProduct) { setEditing(row); setFormError(""); setPriceEdits({}); setForm({ name: row.name, code: row.code, category: row.category, description: row.description, isActive: row.isActive, resellerOnly: Boolean(row.resellerOnly), needsProfile: row.needsProfile, needsPin: row.needsPin, variantName: "", variantCode: "", price: "0" }); }
  const requiredFields = useCallback(() => templateRequired.split(",").map((field) => field.trim()).filter(Boolean), [templateRequired]);
  async function openTemplate(product: ApiProduct, variant: ProductVariant) {
    setBusy(true);
    setTemplateError("");
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
      setTemplateError(cause instanceof Error ? cause.message : "Template pengiriman gagal dimuat.");
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
  async function save() { if (!form.name.trim() || !form.code.trim() || (!editing && (!form.variantName.trim() || !form.variantCode.trim()))) { setFormError("Nama, kode produk, dan variant awal wajib diisi."); return; } setFormError(""); setBusy(true); try { const payload: Omit<ApiProduct, "id"> = editing ? { ...editing, name: form.name, code: form.code, category: form.category, description: form.description, isActive: form.isActive, resellerOnly: form.resellerOnly, needsProfile: form.needsProfile, needsPin: form.needsPin, variants: applyPriceEdits(editing.variants, priceEdits) } : { name: form.name, code: form.code, category: form.category, description: form.description, isActive: form.isActive, resellerOnly: form.resellerOnly, needsProfile: form.needsProfile, needsPin: form.needsPin, variants: [{ id: `var-${Date.now().toString(36)}`, code: form.variantCode, name: form.variantName, description: "", isActive: true, prices: { "1 Bulan": Number(form.price || 0) }, snk: "" }] }; editing ? await api.updateProduct(editing.id, payload) : await api.createProduct(payload); setEditing(undefined); setPriceEdits({}); setMessage("Produk berhasil disimpan."); await load(); } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Produk gagal disimpan."); } finally { setBusy(false); } }
  async function executeAction() { if (!action) return; setActionError(""); setBusy(true); try { if (action.type === "archive") await api.archiveProduct(action.product.id, !action.product.isArchived); if (action.type === "delete") await api.deleteProduct(action.product.id); if (action.type === "lock") await api.setProductOrderLock(action.product.id, { enabled: !action.product.orderLock?.enabled, reason: reason.trim() }); if (action.type === "variant-lock") await api.setVariantOrderLock(action.product.id, action.variant.id, { enabled: !action.variant.orderLock?.enabled, reason: reason.trim() }); setAction(null); setReason(""); setMessage("Perubahan produk diterapkan."); await load(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : "Aksi produk gagal."); } finally { setBusy(false); } }
  const columns = useMemo<Array<DataColumn<ApiProduct>>>(() => [
    { id: "product", header: "Produk", value: (row) => `${row.name} ${row.code}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.name}</strong><small>{row.code} / {row.category}</small></span> },
    { id: "variants", header: "Variant", value: (row) => row.variants.length, sortable: true },
    { id: "price", header: "Harga mulai", value: (row) => { const prices = row.variants.flatMap((variant) => Object.values(variant.prices)).filter((value) => value > 0); return prices.length ? Math.min(...prices) : 0; }, cell: (row) => { const prices = row.variants.flatMap((variant) => Object.values(variant.prices)).filter((value) => value > 0); return prices.length ? formatRupiah(Math.min(...prices)) : "-"; } },
    { id: "status", header: "Status", value: (row) => row.isArchived ? "Archived" : row.isActive ? "Aktif" : "Nonaktif", sortable: true, cell: (row) => <Badge tone={row.isArchived ? "muted" : row.isActive ? "success" : "warning"}>{row.isArchived ? "Archived" : row.isActive ? "Aktif" : "Nonaktif"}</Badge> },
    { id: "lock", header: "Order", value: (row) => row.orderLock?.enabled ? "Frozen" : "Open", cell: (row) => <Badge tone={row.orderLock?.enabled ? "danger" : "success"}>{row.orderLock?.enabled ? "Frozen" : "Open"}</Badge> },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${row.name}`}><Edit3 size={14} /></button><button type="button" onClick={() => { setAction({ type: "lock", product: row }); setReason(row.orderLock?.reason || ""); }} aria-label={`${row.orderLock?.enabled ? "Buka" : "Kunci"} ${row.name}`}>{row.orderLock?.enabled ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />}</button><button type="button" onClick={() => setAction({ type: "archive", product: row })} aria-label={`Archive ${row.name}`}><Archive size={14} /></button><button type="button" onClick={() => setAction({ type: "delete", product: row })} aria-label={`Hapus ${row.name}`}><Trash2 size={14} /></button></div> },
  ], []);
  const filters = useMemo<Array<DataFilter<ApiProduct>>>(() => [{ id: "category", label: "Kategori", options: [...new Set(products.map((row) => row.category))].map((value) => ({ label: value, value })), value: (row) => row.category }], [products]);
  /* Order lock is the owner's own decision, so unlike a reserved account
     or an open claim it is genuinely outstanding work: the owner froze
     this product and it is still frozen. Archived and inactive products
     are excluded -- freezing those is deliberate housekeeping, not an
     oversight, and counting them would train the owner to ignore the
     number. */
  const frozenCount = products.filter((row) => row.orderLock?.enabled && row.isActive && !row.isArchived).length;
  return <ConsoleShell title="Produk" description="Kelola katalog, variant, dan safe mode pemesanan." refreshing={loading} attentionCount={frozenCount} systemState={systemStateFor(frozenCount, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[{ label: "Total produk", value: products.length }, { label: "Aktif", value: products.filter((row) => row.isActive && !row.isArchived).length, tone: "success" }, { label: "Archived", value: products.filter((row) => row.isArchived).length }, { label: "Order frozen", value: products.filter((row) => row.orderLock?.enabled).length, tone: "warning" }]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    <section className="console-panel"><div className="console-panel-header"><div><span>Katalog</span><h2>Daftar produk</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={openCreate}><PackagePlus size={15} /> Tambah produk</button></div></div><DataTable rows={products} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} initialPageSize={10} /></section>
    {editing !== undefined ? <Dialog open title={editing ? "Edit produk" : "Tambah produk"} eyebrow="Katalog" onClose={() => setEditing(undefined)} wide footer={<DialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel="Simpan produk" busy={busy} />}>{formError ? <Notice tone="danger">{formError}</Notice> : null}<div className="console-resource-form-grid"><Field label="Nama"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Kode"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field><Field label="Kategori"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field><Field label="Status"><select value={form.isActive ? "active" : "inactive"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></Field><Field label="Deskripsi"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field><Field label="Aturan"><div className="ui-checkbox-stack"><label><input type="checkbox" checked={form.resellerOnly} onChange={(e) => setForm({ ...form, resellerOnly: e.target.checked })} /> Reseller only</label><label><input type="checkbox" checked={form.needsProfile} onChange={(e) => setForm({ ...form, needsProfile: e.target.checked })} /> Butuh profil</label><label><input type="checkbox" checked={form.needsPin} onChange={(e) => setForm({ ...form, needsPin: e.target.checked })} /> Butuh PIN</label></div></Field>{!editing ? <><Field label="Variant awal"><input value={form.variantName} onChange={(e) => setForm({ ...form, variantName: e.target.value })} /></Field><Field label="Kode variant"><input value={form.variantCode} onChange={(e) => setForm({ ...form, variantCode: e.target.value })} /></Field><Field label="Harga 1 bulan"><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field></> : <div className="console-variant-locks">{editing.variants.map((variant) => <article key={variant.id}><div className="console-variant-title"><strong>{variant.name}</strong><small>{variant.code}</small></div><Badge tone={variant.deliveryTemplate ? "success" : "warning"}>{variant.deliveryTemplate ? `Template v${variant.deliveryTemplateVersion || 1}` : "Belum ada template"}</Badge><div className="console-variant-prices">{sortedPriceEntries(variant.prices).map(([duration, amount]) => <Field key={duration} label={duration}><input type="number" min="0" step="1000" value={priceEdits[priceEditKey(variant.id, duration)] ?? String(amount)} placeholder={String(amount)} onChange={(e) => setPriceEdits({ ...priceEdits, [priceEditKey(variant.id, duration)]: e.target.value })} /></Field>)}</div><div className="console-row-actions console-variant-actions"><button type="button" onClick={() => openTemplate(editing, variant)}><FileText size={14} /> Template</button><button type="button" onClick={() => { setReason(variant.orderLock?.reason || ""); setAction({ type: "variant-lock", product: editing, variant }); }}>{variant.orderLock?.enabled ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />} {variant.orderLock?.enabled ? "Buka" : "Freeze"}</button></div></article>)}</div>}</div></Dialog> : null}
    {templateTarget ? <Dialog open title="Template Pengiriman" eyebrow={`${templateTarget.product.name} / ${templateTarget.variant.name}`} onClose={() => setTemplateTarget(null)} wide footer={<DialogActions onCancel={() => setTemplateTarget(null)} onConfirm={saveTemplate} confirmLabel="Simpan template" busy={busy} />}>
      {templateError ? <Notice tone="danger">{templateError}</Notice> : null}
      <div className="console-template-editor">
        <div className="console-template-meta"><span>SKU <strong>{templateTarget.variant.code}</strong></span><span>Versi <strong>{templateVersion || "Belum ada"}</strong></span></div>
        <Field label="Plain text template"><textarea className="console-template-textarea" value={templateSource} onChange={(event) => setTemplateSource(event.target.value)} spellCheck={false} /></Field>
        <div><span className="console-template-label">Sisipkan placeholder</span><div className="console-template-placeholders">{templatePlaceholders.map((field) => <button type="button" key={field} onClick={() => insertPlaceholder(field)}>{`{{${field}}}`}</button>)}</div></div>
        <Field label="Field wajib (pisahkan koma, gunakan | untuk alternatif)"><input value={templateRequired} onChange={(event) => setTemplateRequired(event.target.value)} placeholder="email|login_identifier, password, rental_end" /></Field>
        <div className="console-template-actions"><button type="button" onClick={previewTemplate} disabled={busy}><FileText size={14} /> Preview Template</button><select value={templatePreviewDuration} onChange={(event) => setTemplatePreviewDuration(event.target.value)} aria-label="Durasi preview">{templatePreviewDurations.map((duration) => <option key={duration.value} value={duration.value}>{duration.label}</option>)}</select><select value={templateCopySource} onChange={(event) => setTemplateCopySource(event.target.value)}><option value="">Pilih varian sumber</option>{products.flatMap((product) => product.variants.map((variant) => ({ product, variant }))).filter(({ product, variant }) => product.id !== templateTarget.product.id || variant.id !== templateTarget.variant.id).map(({ product, variant }) => <option key={`${product.id}:${variant.id}`} value={`${product.id}::${variant.id}`}>{product.name} / {variant.name}</option>)}</select><button type="button" onClick={copyTemplate} disabled={!templateCopySource || busy}><Copy size={14} /> Salin dari Varian Lain</button></div>
        {templateWarnings.length ? <Notice tone={templateWarnings.some((item) => /tidak valid|belum ditutup|tidak dikenal|kosong/i.test(item)) ? "danger" : "warning"}>{templateWarnings.join(" ")}</Notice> : null}
        <div className="console-template-preview"><header><strong>Preview Template</strong><span>Data preview — bukan data pelanggan asli</span></header>{templatePreview ? <pre>{templatePreview}</pre> : <p>Preview otomatis muncul setelah template diisi.</p>}</div>
      </div>
    </Dialog> : null}
    {action ? <Dialog open title={action.type === "delete" ? "Hapus produk" : action.type === "archive" ? "Ubah status arsip" : action.type === "variant-lock" ? action.variant.orderLock?.enabled ? "Buka varian" : "Freeze varian" : action.product.orderLock?.enabled ? "Buka pemesanan" : "Freeze pemesanan"} eyebrow={action.type === "variant-lock" ? `${action.product.name} / ${action.variant.name}` : action.product.name} onClose={() => setAction(null)} footer={<DialogActions onCancel={() => setAction(null)} onConfirm={executeAction} confirmLabel="Konfirmasi" busy={busy} danger={action.type === "delete"} />}>{actionError ? <Notice tone="danger">{actionError}</Notice> : null}{action.type === "lock" || action.type === "variant-lock" ? <Field label="Alasan"><textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field> : <Notice tone={action.type === "delete" ? "danger" : "warning"}>{action.type === "delete" ? "Produk akan dihapus melalui endpoint owner yang sudah ada. Tindakan ini tidak dapat dibatalkan." : "Status arsip produk akan diubah tanpa menghapus data historis."}</Notice>}</Dialog> : null}
  </ConsoleShell>;
}
