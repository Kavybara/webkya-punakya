import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel, SearchBox } from "../../../components/feature/OwnerUi";
import { api, subscribeRealtime } from "../../../lib/api";
import { normalizedDurationModes, sortedAllowedPriceEntries } from "../../../lib/durations";
import { productBrandAsset, productLogoUrl } from "../../../lib/productBrandAssets";
import { formatRupiah, type Product, type ProductVariant } from "../../../mocks/data";

const preferredCategories = ["Netflix", "Spotify", "HBO Max", "Disney+", "YouTube", "Canva", "Microsoft 365"];
const priceLabels = [
  "1 Hari",
  "2 Hari",
  "3 Hari",
  "4 Hari",
  "5 Hari",
  "6 Hari",
  "7 Hari",
  "1 Bulan",
  "2 Bulan",
  "3 Bulan",
  "4 Bulan",
  "5 Bulan",
  "6 Bulan",
  "1 Tahun",
  "Lifetime",
];

function activeOrderLock(product: Product, variant?: ProductVariant | null) {
  if (product.orderLock?.enabled) return { scope: "product" as const, ...product.orderLock };
  if (variant?.orderLock?.enabled) return { scope: "variant" as const, ...variant.orderLock };
  return null;
}

type ProductForm = Omit<Product, "id">;
type CheckoutFieldMode = "auto" | "email" | "device" | "optional";

function checkoutFieldValue(requirements?: Product["checkoutRequirements"]): CheckoutFieldMode {
  return requirements?.customerField || "auto";
}

function checkoutRequirementsPatch(field: CheckoutFieldMode, previous?: Product["checkoutRequirements"]): Product["checkoutRequirements"] | undefined {
  if (field === "auto") return undefined;
  return {
    customerField: field,
    required: previous?.required ?? field !== "optional",
    minItems: Math.max(1, Number(previous?.minItems || 1)),
    label: previous?.label || (field === "email" ? "Email Customer" : field === "device" ? "Device Customer" : "Data Customer"),
    placeholder: previous?.placeholder || (field === "email" ? "email customer, pisahkan jika beli banyak" : field === "device" ? "Contoh: Smart TV Samsung" : "Email, device, atau catatan customer"),
    helper: previous?.helper || "",
  };
}

function cleanCheckoutRequirements(requirements?: Product["checkoutRequirements"]) {
  if (!requirements?.customerField) return undefined;
  return {
    customerField: requirements.customerField,
    required: requirements.required ?? requirements.customerField !== "optional",
    minItems: Math.max(1, Number(requirements.minItems || 1)),
    label: String(requirements.label || "").trim(),
    placeholder: String(requirements.placeholder || "").trim(),
    helper: String(requirements.helper || "").trim(),
  };
}

function draftId() {
  return `variant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeCode(value: string, fallback: string) {
  return (value || fallback || "PRD").trim().toUpperCase().replace(/\s+/g, "-").slice(0, 24);
}

function makeVariantDraft(index = 0): ProductVariant {
  return {
    id: draftId(),
    code: "",
    name: index === 0 ? "1 Bulan" : "",
    description: "",
    durationModes: { daily: true, monthly: true },
    prices: { "1 Bulan": 35000 },
    snk: "",
    snkMonthly: "",
    snkDaily: "",
  };
}

function makeEmptyProduct(): ProductForm {
  return {
    name: "",
    code: "",
    category: "Netflix",
    description: "",
    isActive: true,
    isArchived: false,
    archivedAt: "",
    needsProfile: true,
    needsPin: true,
    messageTemplates: { delivery: "", warranty: "" },
    variants: [makeVariantDraft()],
  };
}

function cloneProduct(product: Product): ProductForm {
  return {
    name: product.name,
    code: product.code,
    category: product.category,
    description: product.description,
    isActive: product.isActive,
    isArchived: Boolean(product.isArchived),
    archivedAt: product.archivedAt || "",
    needsProfile: product.needsProfile,
    needsPin: product.needsPin,
    checkoutRequirements: product.checkoutRequirements ? { ...product.checkoutRequirements } : undefined,
    messageTemplates: { ...(product.messageTemplates || {}) },
    variants: product.variants.map((variant) => ({
      ...variant,
      checkoutRequirements: variant.checkoutRequirements ? { ...variant.checkoutRequirements } : undefined,
      durationModes: normalizedDurationModes(variant.durationModes),
      prices: { ...variant.prices },
      snk: variant.snkMonthly ?? variant.snk ?? "",
      snkMonthly: variant.snkMonthly ?? variant.snk ?? "",
      snkDaily: variant.snkDaily ?? "",
    })),
  };
}

function cleanProductForm(form: ProductForm): ProductForm {
  const code = normalizeCode(form.code, form.name);
  return {
    ...form,
    name: form.name.trim(),
    code,
    category: form.category.trim() || "Custom",
    description: form.description.trim(),
    checkoutRequirements: cleanCheckoutRequirements(form.checkoutRequirements),
    messageTemplates: {
      delivery: String(form.messageTemplates?.delivery || "").trim(),
      warranty: String(form.messageTemplates?.warranty || "").trim(),
    },
    variants: form.variants.map((variant, index) => {
      const variantCode = normalizeCode(variant.code, `${code}-${index + 1}`);
      const prices = Object.fromEntries(
        Object.entries(variant.prices || {})
          .map(([duration, amount]) => [duration, Number(amount)])
          .filter(([duration, amount]) => duration && Number.isFinite(amount)),
      );
      const snkMonthly = String(variant.snkMonthly ?? variant.snk ?? "").trim();
      const snkDaily = String(variant.snkDaily ?? "").trim();

      return {
        id: variant.id || variantCode.toLowerCase(),
        code: variantCode,
        name: variant.name.trim() || variantCode,
        description: variant.description.trim(),
        isActive: variant.isActive !== false,
        checkoutRequirements: cleanCheckoutRequirements(variant.checkoutRequirements),
        durationModes: normalizedDurationModes(variant.durationModes),
        deliveryTemplate: String(variant.deliveryTemplate || "").trim(),
        warrantyTemplate: String(variant.warrantyTemplate || "").trim(),
        prices: Object.keys(prices).length ? prices : { "1 Bulan": 0 },
        snk: snkMonthly,
        snkMonthly,
        snkDaily,
      };
    }),
  };
}

function productMatchesCategory(product: Product, category: string) {
  if (category === "Semua") return true;
  const target = category.toLowerCase();
  return [product.category, product.name, product.code].join(" ").toLowerCase().includes(target);
}

function ProductVisual({ product }: { product: Product }) {
  const asset = productBrandAsset(product);
  const logoUrl = productLogoUrl(product);
  return (
    <div className={`relative flex h-[84px] w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br ${asset.tone}`}>
      <span className="absolute inset-0 bg-black/15" />
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/95 shadow-sm">
        <span className="px-1 text-center text-[10px] font-black leading-tight tracking-wide text-slate-900">{product.code || asset.label}</span>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${asset.label} logo`}
            className="absolute h-9 w-9 object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : null}
      </span>
    </div>
  );
}

export default function DashboardProductsPage() {
  const [params, setParams] = useSearchParams();
  const productParam = params.get("product")?.trim() || "";
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("Semua");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  const [openId, setOpenId] = useState("");
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(() => makeEmptyProduct());
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyProductId, setBusyProductId] = useState("");
  const productListRef = useRef<HTMLDivElement | null>(null);

  async function loadProducts() {
    const rows = await api.products();
    setProducts(rows);
    setOpenId((current) => (current && rows.some((row) => row.id === current) ? current : ""));
  }

  useEffect(() => {
    loadProducts().catch(console.error);
    return subscribeRealtime(() => {
      loadProducts().catch(console.error);
    });
  }, []);

  useEffect(() => {
    if (!productParam) return;
    setArchiveFilter("all");
    setActiveCategory("Semua");
    setQuery(productParam);
  }, [productParam]);

  useEffect(() => {
    if (!productParam || !products.some((item) => item.id === productParam)) return;
    setOpenId(productParam);
    window.requestAnimationFrame(() => {
      document.getElementById(`product-card-${productParam}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });
  }, [productParam, products]);

  const rows = useMemo(
    () =>
      products.filter((item) => {
        const matchCategory = productMatchesCategory(item, activeCategory);
        const matchQuery = [item.id, item.name, item.category, item.code, ...(item.variants || []).flatMap((variant) => [variant.name, variant.code])].join(" ").toLowerCase().includes(query.toLowerCase());
        const matchArchive = archiveFilter === "all" || (archiveFilter === "archived" ? item.isArchived : !item.isArchived);
        return matchCategory && matchQuery && matchArchive;
      }),
    [activeCategory, archiveFilter, products, query],
  );

  const categoryOptions = useMemo(() => {
    const categories = Array.from(new Set(products.map((product) => product.category).filter(Boolean)));
    const ordered = [
      ...preferredCategories.filter((category) => categories.includes(category)),
      ...categories.filter((category) => !preferredCategories.includes(category)).sort((a, b) => a.localeCompare(b)),
    ];
    return ["Semua", ...ordered];
  }, [products]);
  const lockedProducts = useMemo(() => products.filter((product) => Boolean(product.orderLock?.enabled)), [products]);
  const lockedVariants = useMemo(
    () => products.flatMap((product) => (product.variants || []).filter((variant) => Boolean(variant.orderLock?.enabled)).map((variant) => ({ product, variant }))),
    [products],
  );

  function setCategory(category: string) {
    setActiveCategory(category);
    setOpenId("");
    window.requestAnimationFrame(() => {
      productListRef.current?.scrollTo({ top: 0 });
    });
  }

  function openProduct(productId: string) {
    setOpenId((current) => {
      const next = current === productId ? "" : productId;
      setParams((existing) => {
        const nextParams = new URLSearchParams(existing);
        if (next) nextParams.set("product", next);
        else nextParams.delete("product");
        if (query.trim()) nextParams.set("q", query.trim());
        return nextParams;
      });
      return next;
    });
  }

  function onSummaryKeyDown(event: KeyboardEvent<HTMLDivElement>, productId: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openProduct(productId);
  }

  function openCreateModal() {
    setForm(makeEmptyProduct());
    setEditingId("");
    setModalMode("create");
  }

  function openEditModal(product: Product) {
    setForm(cloneProduct(product));
    setEditingId(product.id);
    setModalMode("edit");
  }

  function closeModal() {
    setModalMode(null);
    setEditingId("");
    setForm(makeEmptyProduct());
  }

  async function saveProduct() {
    if (!form.name.trim()) return;
    const payload = cleanProductForm(form);
    setActionError("");
    setActionMessage("");
    if (modalMode === "edit" && editingId) {
      await api.updateProduct(editingId, payload);
      setOpenId(editingId);
    } else {
      const created = await api.createProduct(payload);
      setOpenId(created.id);
    }
    closeModal();
    await loadProducts();
  }

  async function archiveProduct(product: Product, archived: boolean) {
    if (busyProductId) return;
    const confirmed = archived
      ? window.confirm(`Arsipkan ${product.name}? Produk disembunyikan dari katalog dan order baru, tapi data lama tetap aman.`)
      : window.confirm(`Pulihkan ${product.name}? Produk akan aktif lagi dan tampil kalau punya stok ready.`);
    if (!confirmed) return;
    setBusyProductId(product.id);
    setActionError("");
    setActionMessage("");
    try {
      const updated = await api.archiveProduct(product.id, archived);
      setActionMessage(archived ? `${updated.name} sudah diarsipkan.` : `${updated.name} sudah dipulihkan.`);
      await loadProducts();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Aksi produk gagal.");
    } finally {
      setBusyProductId("");
    }
  }

  async function deleteProduct(product: Product) {
    if (busyProductId) return;
    const confirmed = window.confirm(`Hapus permanen ${product.name}? Ini hanya berhasil kalau produk tidak punya stok, akun reseller, atau order terkait.`);
    if (!confirmed) return;
    setBusyProductId(product.id);
    setActionError("");
    setActionMessage("");
    try {
      await api.deleteProduct(product.id);
      setActionMessage(`${product.name} sudah dihapus permanen.`);
      setOpenId("");
      await loadProducts();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Produk tidak bisa dihapus.");
    } finally {
      setBusyProductId("");
    }
  }

  async function toggleProductLock(product: Product) {
    if (busyProductId) return;
    const locked = Boolean(product.orderLock?.enabled);
    const reason = locked ? "" : window.prompt(`Alasan lock order untuk ${product.name}:`, product.orderLock?.reason || "Audit stok sementara") || "";
    if (!locked && !reason.trim()) return;
    setBusyProductId(`${product.id}:lock`);
    setActionError("");
    setActionMessage("");
    try {
      await api.setProductOrderLock(product.id, { enabled: !locked, reason: reason.trim() });
      setActionMessage(!locked ? `${product.name} sekarang dikunci untuk order baru.` : `Lock order ${product.name} sudah dibuka.`);
      await loadProducts();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Lock produk gagal diubah.");
    } finally {
      setBusyProductId("");
    }
  }

  async function toggleVariantLock(product: Product, variant: ProductVariant) {
    if (busyProductId) return;
    const locked = Boolean(variant.orderLock?.enabled);
    const reason = locked ? "" : window.prompt(`Alasan lock order untuk ${product.name} ${variant.name}:`, variant.orderLock?.reason || "Pause order varian sementara") || "";
    if (!locked && !reason.trim()) return;
    setBusyProductId(`${product.id}:${variant.id}:lock`);
    setActionError("");
    setActionMessage("");
    try {
      await api.setVariantOrderLock(product.id, variant.id, { enabled: !locked, reason: reason.trim() });
      setActionMessage(!locked ? `${product.name} ${variant.name} sekarang dikunci untuk order baru.` : `Lock order ${product.name} ${variant.name} sudah dibuka.`);
      await loadProducts();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Lock variant gagal diubah.");
    } finally {
      setBusyProductId("");
    }
  }

  async function toggleCategorySafeMode(category: string, enable: boolean) {
    if (busyProductId) return;
    const target = products.filter((product) => product.category === category);
    if (!target.length) return;
    const reason = enable ? window.prompt(`Alasan freeze untuk kategori ${category}:`, "Safe mode sementara karena audit stok") || "" : "";
    if (enable && !reason.trim()) return;
    setBusyProductId(`category:${category}`);
    setActionError("");
    setActionMessage("");
    try {
      await Promise.all(target.map((product) => api.setProductOrderLock(product.id, { enabled: enable, reason: reason.trim() })));
      setActionMessage(enable ? `Safe mode ${category} aktif untuk ${target.length} produk.` : `Safe mode ${category} dibuka untuk ${target.length} produk.`);
      await loadProducts();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Safe mode kategori gagal diubah.");
    } finally {
      setBusyProductId("");
    }
  }

  function updateVariant(index: number, patch: Partial<ProductVariant>) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, itemIndex) => (itemIndex === index ? { ...variant, ...patch } : variant)),
    }));
  }

  function updateVariantPrice(index: number, duration: string, value: string) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, itemIndex) => {
        if (itemIndex !== index) return variant;
        const prices = { ...variant.prices };
        if (value === "") {
          delete prices[duration];
        } else {
          prices[duration] = Number(value);
        }
        return { ...variant, prices };
      }),
    }));
  }

  function addVariant() {
    setForm((current) => ({
      ...current,
      variants: [...current.variants, makeVariantDraft(current.variants.length)],
    }));
  }

  function removeVariant(index: number) {
    setForm((current) => ({
      ...current,
      variants: current.variants.length === 1 ? current.variants : current.variants.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function updateProductCheckoutRequirements(patch: Partial<NonNullable<Product["checkoutRequirements"]>>) {
    setForm((current) => {
      const currentRequirements = current.checkoutRequirements || checkoutRequirementsPatch("optional");
      if (!currentRequirements) return current;
      return {
        ...current,
        checkoutRequirements: {
          ...currentRequirements,
          ...patch,
        },
      };
    });
  }

  return (
    <DashboardLayout role="owner" title="Daftar Produk">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <p className="text-sm text-slate-500">Lihat produk, variant, dan SNK yang tersedia. Data ini tersambung ke backend.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2b2b2b] px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-900"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <i className="ri-add-line" />
            </span>
            Tambah Produk
          </button>
        </div>
      </div>

      {actionMessage ? (
        <DataPanel className="mb-4 border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {actionMessage}
        </DataPanel>
      ) : null}
      {actionError ? (
        <DataPanel className="mb-4 border border-red-100 bg-red-50 p-4 text-sm font-medium text-red-700">
          {actionError}
        </DataPanel>
      ) : null}

      <DataPanel className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-950">Safe Mode / Freeze Center</p>
            <p className="mt-1 text-xs text-slate-500">Kunci order per produk atau aktifkan freeze cepat per kategori saat ada audit stok.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {preferredCategories.slice(0, 5).map((category) => {
              const categoryLocked = products.filter((product) => product.category === category && product.orderLock?.enabled).length;
              const categoryTotal = products.filter((product) => product.category === category).length;
              if (!categoryTotal) return null;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategorySafeMode(category, categoryLocked !== categoryTotal)}
                  className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {categoryLocked === categoryTotal ? `Buka ${category}` : `Freeze ${category}`}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 px-4 py-4 md:grid-cols-3">
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase text-red-600">Produk Locked</div>
            <div className="mt-1 text-2xl font-semibold text-red-700">{lockedProducts.length}</div>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase text-amber-700">Variant Locked</div>
            <div className="mt-1 text-2xl font-semibold text-amber-800">{lockedVariants.length}</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase text-slate-500">Kategori Aktif</div>
            <div className="mt-1 text-2xl font-semibold text-slate-700">{categoryOptions.filter((item) => item !== "Semua").length}</div>
          </div>
        </div>
      </DataPanel>

      <div className="sticky top-16 z-30 -mx-4 mb-4 bg-[#f2ece2] px-4 py-3 md:-mx-6 md:px-6">
        <DataPanel className="p-4 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {[
                ["active", "Aktif"],
                ["archived", "Diarsipkan"],
                ["all", "Semua"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setArchiveFilter(id as "active" | "archived" | "all")}
                  className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                    archiveFilter === id ? "bg-[#2b2b2b] text-white" : "bg-[#f7f1e8] text-slate-700 hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
              {categoryOptions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                    activeCategory === item ? "bg-[#2b2b2b] text-white" : "bg-[#f7f1e8] text-slate-700 hover:bg-white"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="w-full lg:max-w-sm">
              <SearchBox value={query} onChange={setQuery} placeholder="Cari produk..." />
            </div>
          </div>
        </DataPanel>
      </div>

      <div ref={productListRef} className="max-h-[calc(100vh-260px)] min-h-[360px] space-y-4 overflow-y-auto pr-2">
        {rows.map((product) => {
          const minPrice = Math.min(
            ...product.variants
              .flatMap((variant) => sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).map(([, price]) => price))
              .filter((price) => Number.isFinite(price)),
          );
          const price = Number.isFinite(minPrice) ? minPrice : 0;
          const expanded = openId === product.id;
          const productLock = activeOrderLock(product, null);

          return (
            <DataPanel key={product.id} id={`product-card-${product.id}`} className={`overflow-hidden p-4 transition-colors ${expanded ? "border-red-100" : ""}`}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => openProduct(product.id)}
                  onKeyDown={(event) => onSummaryKeyDown(event, product.id)}
                  className="flex min-w-0 flex-1 cursor-pointer gap-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                >
                  <ProductVisual product={product} />
                  <div className="min-w-0 flex-1">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                      {product.name}
                      <span className="flex h-4 w-4 items-center justify-center text-slate-500">
                        <i className={expanded ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
                      </span>
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-5 text-slate-500">{product.description}</p>
                    <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
                      <span>
                        Harga mulai: <strong className="text-slate-950">{formatRupiah(price)}</strong>
                      </span>
                      <span className="text-slate-400">|</span>
                      <span>{product.variants.length} variant</span>
                      <span className="text-slate-400">|</span>
                      <span>
                        {product.needsProfile ? "Butuh Profile" : "Tanpa Profile"} {product.needsPin ? "+ PIN" : ""}
                      </span>
                    </div>
                    {productLock ? (
                      <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                        Order dikunci owner{productLock.reason ? `: ${productLock.reason}` : "."}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 md:items-start">
                  <button
                    type="button"
                    onClick={() => openEditModal(product)}
                    disabled={busyProductId === product.id}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#ded6ca] bg-white px-3 text-xs font-medium text-slate-700 hover:border-red-100 hover:text-red-600"
                  >
                    <i className="ri-edit-line" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => archiveProduct(product, !product.isArchived)}
                    disabled={busyProductId === product.id}
                    className={`inline-flex h-8 items-center justify-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                      product.isArchived
                        ? "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    }`}
                  >
                    <i className={busyProductId === product.id ? "ri-loader-4-line animate-spin" : product.isArchived ? "ri-inbox-unarchive-line" : "ri-inbox-archive-line"} />
                    {product.isArchived ? "Pulihkan" : "Arsipkan"}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleProductLock(product)}
                    disabled={busyProductId === `${product.id}:lock`}
                    className={`inline-flex h-8 items-center justify-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                      product.orderLock?.enabled
                        ? "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
                    }`}
                  >
                    <i className={busyProductId === `${product.id}:lock` ? "ri-loader-4-line animate-spin" : product.orderLock?.enabled ? "ri-lock-unlock-line" : "ri-lock-line"} />
                    {product.orderLock?.enabled ? "Buka Lock" : "Lock Order"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteProduct(product)}
                    disabled={busyProductId === product.id}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-red-100 bg-white px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    <i className="ri-delete-bin-line" />
                    Hapus
                  </button>
                  {product.isArchived ? (
                    <Badge variant="amber">Arsip</Badge>
                  ) : (
                    <Badge variant={product.isActive ? "emerald" : "red"}>{product.isActive ? "Aktif" : "Nonaktif"}</Badge>
                  )}
                  {product.orderLock?.enabled ? <Badge variant="red">Order Locked</Badge> : null}
                </div>
              </div>

              {expanded ? (
                <div className="mt-4 grid gap-2 pl-0 md:grid-cols-3 md:pl-[102px]">
                  {product.variants.map((variant) => (
                    <div key={variant.id} className="rounded-md bg-[#f7f1e8] p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900">{variant.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{variant.code}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => { toggleVariantLock(product, variant).catch(console.error); }}
                          disabled={busyProductId === `${product.id}:${variant.id}:lock`}
                          className={`inline-flex h-7 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                            variant.orderLock?.enabled
                              ? "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                              : "border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
                          }`}
                        >
                          <i className={busyProductId === `${product.id}:${variant.id}:lock` ? "ri-loader-4-line animate-spin" : variant.orderLock?.enabled ? "ri-lock-unlock-line" : "ri-lock-line"} />
                          {variant.orderLock?.enabled ? "Buka" : "Lock"}
                        </button>
                      </div>
                      {variant.orderLock?.enabled ? (
                        <div className="mt-2 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                          Order dikunci{variant.orderLock.reason ? `: ${variant.orderLock.reason}` : "."}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).map(([duration, amount]) => (
                          <Badge key={duration} variant="amber">
                            {duration}: {formatRupiah(amount)}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">SNK: {variant.snk}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </DataPanel>
          );
        })}

        {!rows.length ? <DataPanel className="p-6 text-sm text-slate-500">Produk tidak ditemukan.</DataPanel> : null}
      </div>

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-slate-950">{modalMode === "edit" ? "Edit Produk" : "Tambah Produk Baru"}</h2>
              <button className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={closeModal}>
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm text-slate-700">Nama Produk</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]"
                  placeholder="Netflix Premium"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Kode Produk</span>
                <input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]"
                  placeholder="NET"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Kategori</span>
                <input
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]"
                  placeholder="Netflix"
                />
              </label>
              <label className="flex items-center gap-3 pt-7 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                  className="h-4 w-4 accent-red-600"
                />
                Produk aktif
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm text-slate-700">Deskripsi</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  className="mt-2 h-20 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 py-2 text-sm outline-none focus:border-[#2b2b2b]"
                  placeholder="Deskripsi produk"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.needsProfile}
                  onChange={(event) => setForm({ ...form, needsProfile: event.target.checked })}
                  className="h-4 w-4 accent-red-600"
                />
                Butuh Profile
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.needsPin}
                  onChange={(event) => setForm({ ...form, needsPin: event.target.checked })}
                  className="h-4 w-4 accent-red-600"
                />
                Butuh PIN
              </label>
              <div className="rounded-md border border-[#ded6ca] bg-[#fbf7f0] p-4 md:col-span-2">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-slate-900">Rule Checkout Produk</span>
                  <span className="text-xs leading-5 text-slate-500">Atur field yang wajib diisi reseller/customer saat order. Kosongkan ke Otomatis kalau ingin Kavya menebak dari nama produk.</span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <label className="block">
                    <span className="text-xs text-slate-600">Field</span>
                    <select
                      value={checkoutFieldValue(form.checkoutRequirements)}
                      onChange={(event) => setForm({ ...form, checkoutRequirements: checkoutRequirementsPatch(event.target.value as CheckoutFieldMode, form.checkoutRequirements) })}
                      className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-white px-3 text-sm outline-none focus:border-[#2b2b2b]"
                    >
                      <option value="auto">Otomatis</option>
                      <option value="email">Email customer</option>
                      <option value="device">Device customer</option>
                      <option value="optional">Opsional</option>
                    </select>
                  </label>
                  {form.checkoutRequirements ? (
                    <>
                      <label className="block">
                        <span className="text-xs text-slate-600">Minimal isi</span>
                        <input
                          type="number"
                          min="1"
                          value={form.checkoutRequirements.minItems || 1}
                          onChange={(event) => updateProductCheckoutRequirements({ minItems: Number(event.target.value || 1) })}
                          className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-white px-3 text-sm outline-none focus:border-[#2b2b2b]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs text-slate-600">Label</span>
                        <input
                          value={form.checkoutRequirements.label || ""}
                          onChange={(event) => updateProductCheckoutRequirements({ label: event.target.value })}
                          className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-white px-3 text-sm outline-none focus:border-[#2b2b2b]"
                          placeholder="Device Customer"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs text-slate-600">Placeholder</span>
                        <input
                          value={form.checkoutRequirements.placeholder || ""}
                          onChange={(event) => updateProductCheckoutRequirements({ placeholder: event.target.value })}
                          className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-white px-3 text-sm outline-none focus:border-[#2b2b2b]"
                          placeholder="Contoh: Android TV"
                        />
                      </label>
                      <label className="block md:col-span-4">
                        <span className="text-xs text-slate-600">Helper</span>
                        <input
                          value={form.checkoutRequirements.helper || ""}
                          onChange={(event) => updateProductCheckoutRequirements({ helper: event.target.value })}
                          className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-white px-3 text-sm outline-none focus:border-[#2b2b2b]"
                          placeholder="Wajib isi device customer supaya admin bisa audit."
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-3 rounded-md border border-[#ded6ca] bg-[#fbf7f0] p-4 md:col-span-2 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-900">Template Delivery</span>
                  <textarea
                    value={form.messageTemplates?.delivery || ""}
                    onChange={(event) => setForm({ ...form, messageTemplates: { ...(form.messageTemplates || {}), delivery: event.target.value } })}
                    className="mt-2 h-24 w-full rounded-md border border-[#ded6ca] bg-white px-3 py-2 text-sm outline-none focus:border-[#2b2b2b]"
                    placeholder="Opsional. Kosongkan untuk template default."
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-900">Template Garansi</span>
                  <textarea
                    value={form.messageTemplates?.warranty || ""}
                    onChange={(event) => setForm({ ...form, messageTemplates: { ...(form.messageTemplates || {}), warranty: event.target.value } })}
                    className="mt-2 h-24 w-full rounded-md border border-[#ded6ca] bg-white px-3 py-2 text-sm outline-none focus:border-[#2b2b2b]"
                    placeholder="Opsional. Untuk format klaim/replacement khusus produk."
                  />
                </label>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">Variant & SNK</h3>
              <button
                type="button"
                onClick={addVariant}
                className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-[#ded6ca] px-3 text-xs font-medium text-slate-700 hover:bg-[#f7f1e8]"
              >
                <i className="ri-add-line" />
                Tambah Variant
              </button>
            </div>

            <div className="mt-3 space-y-3">
              {form.variants.map((variant, index) => {
                const durationModes = normalizedDurationModes(variant.durationModes);
                return (
                <div key={variant.id || index} className="rounded-md border border-[#ded6ca] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">Variant {index + 1}</p>
                    <button
                      type="button"
                      onClick={() => removeVariant(index)}
                      disabled={form.variants.length === 1}
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <i className="ri-delete-bin-line" />
                      Hapus
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs text-slate-600">Nama Variant</span>
                      <input
                        value={variant.name}
                        onChange={(event) => updateVariant(index, { name: event.target.value })}
                        className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]"
                        placeholder="1 Profile 1 User"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-600">Kode Variant</span>
                      <input
                        value={variant.code}
                        onChange={(event) => updateVariant(index, { code: event.target.value })}
                        className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]"
                        placeholder="NET-1P1U"
                      />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs text-slate-600">Deskripsi Variant</span>
                      <input
                        value={variant.description}
                        onChange={(event) => updateVariant(index, { description: event.target.value })}
                        className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]"
                        placeholder="Profile private dengan PIN"
                      />
                    </label>
                    <div className="md:col-span-2 rounded-md border border-[#ded6ca] bg-[#fbf7f0] p-3">
                      <span className="text-xs font-semibold text-slate-900">Mode Durasi</span>
                      <p className="mt-1 text-xs text-slate-500">Centang durasi yang boleh tampil dan bisa dibeli untuk varian ini.</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="flex items-center gap-2 rounded-md border border-[#ded6ca] bg-white px-3 py-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={durationModes.daily}
                            onChange={(event) => {
                              const next = { ...durationModes, daily: event.target.checked };
                              if (!next.daily && !next.monthly) next.monthly = true;
                              updateVariant(index, { durationModes: next });
                            }}
                          />
                          <span>Harian</span>
                        </label>
                        <label className="flex items-center gap-2 rounded-md border border-[#ded6ca] bg-white px-3 py-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={durationModes.monthly}
                            onChange={(event) => {
                              const next = { ...durationModes, monthly: event.target.checked };
                              if (!next.daily && !next.monthly) next.daily = true;
                              updateVariant(index, { durationModes: next });
                            }}
                          />
                          <span>Bulanan / Tahunan</span>
                        </label>
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-xs text-slate-600">Harga</span>
                      <div className="mt-1 grid gap-2 md:grid-cols-4">
                        {priceLabels.map((duration) => (
                          <label key={duration} className="block">
                            <span className="text-[11px] text-slate-500">{duration}</span>
                            <input
                              type="number"
                              min="0"
                              value={variant.prices[duration] ?? ""}
                              onChange={(event) => updateVariantPrice(index, duration, event.target.value)}
                              className="mt-1 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]"
                              placeholder="0"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-xs text-slate-600">SNK Bulanan / Default</span>
                      <textarea
                        value={variant.snkMonthly ?? variant.snk ?? ""}
                        onChange={(event) => updateVariant(index, { snk: event.target.value, snkMonthly: event.target.value })}
                        className="mt-1 h-28 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 py-2 text-sm outline-none focus:border-[#2b2b2b]"
                        placeholder="S&K untuk durasi bulanan, tahunan, dan default."
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-slate-600">SNK Harian</span>
                      <textarea
                        value={variant.snkDaily ?? ""}
                        onChange={(event) => updateVariant(index, { snkDaily: event.target.value })}
                        className="mt-1 h-28 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 py-2 text-sm outline-none focus:border-[#2b2b2b]"
                        placeholder="S&K khusus 1h/1d/1 Hari sampai 7 Hari. Kosongkan untuk memakai SNK bulanan/default."
                      />
                    </label>
                    <p className="text-xs text-slate-500 md:col-span-2">
                      Harian dan bulanan tetap memakai pool stok varian yang sama. Sistem hanya memilih S&K sesuai durasi order.
                    </p>
                  </div>
                </div>
                );
              })}
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <button className="h-11 rounded-md border border-gray-300 text-sm text-slate-700" onClick={closeModal}>
                Batal
              </button>
              <button className="h-11 rounded-md bg-[#2b2b2b] text-sm font-medium text-white hover:bg-slate-900" onClick={saveProduct}>
                {modalMode === "edit" ? "Simpan Perubahan" : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}

