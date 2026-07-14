import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel, SearchBox } from "../../../components/feature/OwnerUi";
import { api, subscribeRealtime, type ApiReseller, type ApiStockItem, type GoogleSheetsPreview, type MaintenanceState } from "../../../lib/api";
import type { Product } from "../../../mocks/data";

type ProductVariant = Product["variants"][number];

const emptyForm = {
  productId: "",
  variantId: "",
  email: "",
  password: "",
  profile: "",
  pin: "",
  notes: "",
};

const emptyAssignForm = {
  resellerId: "",
  variantId: "",
  startedAt: nowDateTimeLocal(),
  durationDays: "1",
  buyer: "",
  device: "",
};

function nowDateTimeLocal() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addDaysDateTimeLocal(dateText: string, days: number) {
  const date = new Date(dateText || nowDateTimeLocal());
  if (Number.isNaN(date.getTime())) return "";
  date.setTime(date.getTime() + Math.max(1, Math.floor(days || 1)) * 86400000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSyncTime(value = "") {
  if (!value) return "";
  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function syncSummaryNumber(summary: Record<string, unknown> | null | undefined, key: string) {
  const value = Number(summary?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function syncSummaryError(summary: Record<string, unknown> | null | undefined) {
  return String(summary?.error || summary?.reason || "").trim();
}

function syncSummaryStatus(summary: Record<string, unknown> | null | undefined) {
  if (!summary) return "Belum sync";
  if (syncSummaryError(summary)) return "Error";
  return "OK";
}

function syncSummaryTone(summary: Record<string, unknown> | null | undefined) {
  const status = syncSummaryStatus(summary);
  if (status === "Error") return "border-red-100 bg-red-50 text-red-700";
  if (status === "Belum sync") return "border-slate-100 bg-slate-50 text-slate-500";
  return "border-emerald-100 bg-white/80 text-emerald-800";
}

function syncHealthTone(status = "Belum sync") {
  if (status === "Error") return "border-red-100 bg-red-50 text-red-700";
  if (status === "Belum sync") return "border-slate-100 bg-slate-50 text-slate-500";
  return "border-emerald-100 bg-white/80 text-emerald-800";
}

function syncAgeText(value = "") {
  if (!value) return "";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
}

const syncSourceLabels: Record<string, string> = {
  netflix: "Netflix",
  viu: "Viu",
  vidio: "Vidio",
  dynamic: "Universal",
  canva: "Canva",
  linkPools: "Link Pool",
  resellers: "Data Reseller",
};

function syncSummaryWarnings(summary: Record<string, unknown> | null | undefined) {
  const warnings = Array.isArray(summary?.warnings) ? summary?.warnings : [];
  return [
    syncSummaryError(summary),
    ...warnings.map((item) => String(item || "").trim()),
  ].filter(Boolean);
}

function syncSummarySource(summary: Record<string, unknown> | null | undefined, key: string) {
  return (summary?.[key] || null) as Record<string, unknown> | null;
}

function syncSourceDetail(key: string, item: Record<string, unknown> | null | undefined) {
  const label = syncSourceLabels[key] || key;
  if (!item) return `${label}: belum ada data sync`;
  return `${label}: ${syncSummaryDetails(key, item)}`;
}

function sumSyncSources(summary: Record<string, unknown> | null | undefined, keys: string[], field: string) {
  return keys.reduce((total, key) => total + syncSummaryNumber(syncSummarySource(summary, key), field), 0);
}

function syncSummaryItems(summary?: Record<string, unknown> | null) {
  const accountKeys = ["netflix", "viu", "vidio", "dynamic"];
  const linkKeys = ["canva", "linkPools"];
  const allKeys = [...accountKeys, ...linkKeys, "resellers"];
  const allWarnings = allKeys.flatMap((key) =>
    syncSummaryWarnings(syncSummarySource(summary, key)).map((message) => `${syncSourceLabels[key] || key}: ${message}`),
  );
  const accountErrors = accountKeys.flatMap((key) => syncSummaryWarnings(syncSummarySource(summary, key)));
  const linkErrors = linkKeys.flatMap((key) => syncSummaryWarnings(syncSummarySource(summary, key)));
  const resellerErrors = syncSummaryWarnings(syncSummarySource(summary, "resellers"));
  const accountPresent = accountKeys.some((key) => syncSummarySource(summary, key));
  const linkPresent = linkKeys.some((key) => syncSummarySource(summary, key));
  const resellerItem = syncSummarySource(summary, "resellers");
  const accountExpired =
    sumSyncSources(summary, accountKeys, "expired") +
    sumSyncSources(summary, accountKeys, "returned") +
    sumSyncSources(summary, accountKeys, "removed");
  const linkExpired =
    sumSyncSources(summary, linkKeys, "expired") +
    sumSyncSources(summary, linkKeys, "returned") +
    sumSyncSources(summary, linkKeys, "removed");
  const linkPools = sumSyncSources(summary, linkKeys, "pools") || sumSyncSources(summary, linkKeys, "imported");

  return [
    {
      key: "accountPools",
      label: "Akun Pool",
      status: accountErrors.length ? "Error" : accountPresent ? "OK" : "Belum sync",
      details: `Import ${sumSyncSources(summary, accountKeys, "imported")} | Ready ${sumSyncSources(summary, accountKeys, "available")} | Sold ${sumSyncSources(summary, accountKeys, "sold")} | Expired ${accountExpired}`,
      detailLines: accountKeys.map((key) => syncSourceDetail(key, syncSummarySource(summary, key))),
      errorCount: accountErrors.length,
      hasData: accountPresent,
    },
    {
      key: "linkPools",
      label: "Link Pool",
      status: linkErrors.length ? "Error" : linkPresent ? "OK" : "Belum sync",
      details: `Pool ${linkPools} | Kuota ${sumSyncSources(summary, linkKeys, "quota")} | Terpakai ${sumSyncSources(summary, linkKeys, "used")} | Sisa ${sumSyncSources(summary, linkKeys, "available")} | Expired ${linkExpired}`,
      detailLines: linkKeys.map((key) => syncSourceDetail(key, syncSummarySource(summary, key))),
      errorCount: linkErrors.length,
      hasData: linkPresent,
    },
    {
      key: "resellers",
      label: "Data Reseller",
      status: resellerErrors.length ? "Error" : resellerItem ? "OK" : "Belum sync",
      details: `Row ${syncSummaryNumber(resellerItem, "rows")} | Alias ${syncSummaryNumber(resellerItem, "aliases")}`,
      detailLines: [syncSourceDetail("resellers", resellerItem)],
      errorCount: resellerErrors.length,
      hasData: Boolean(resellerItem),
    },
    {
      key: "errors",
      label: "Error",
      status: allWarnings.length ? "Error" : summary ? "OK" : "Belum sync",
      details: allWarnings.length ? `${allWarnings.length} masalah perlu dicek` : "Tidak ada error sync",
      detailLines: allWarnings.length ? allWarnings : ["Tidak ada error atau warning pada sync terakhir."],
      errorCount: allWarnings.length,
      hasData: Boolean(summary),
    },
  ];
}

function syncSummaryDetails(key: string, item: Record<string, unknown> | null | undefined) {
  if (!item) return "Belum ada data sync.";
  if (key === "resellers") {
    return `Row ${syncSummaryNumber(item, "rows")} | Alias ${syncSummaryNumber(item, "aliases")}`;
  }
  if (key === "canva" || key === "linkPools") {
    return `Kuota ${syncSummaryNumber(item, "quota")} | Terpakai ${syncSummaryNumber(item, "used")} | Sisa ${syncSummaryNumber(item, "available")}`;
  }
  const parts = [
    `Import ${syncSummaryNumber(item, "imported")}`,
    `Ready ${syncSummaryNumber(item, "available")}`,
    `Sold ${syncSummaryNumber(item, "sold")}`,
  ];
  const returned = syncSummaryNumber(item, "returned");
  const removed = syncSummaryNumber(item, "removed");
  const locked = syncSummaryNumber(item, "locked");
  if (returned) parts.push(`Arsip ${returned}`);
  if (removed) parts.push(`Expired ${removed}`);
  if (locked) parts.push(`Locked ${locked}`);
  return parts.join(" | ");
}

function statusLabel(item: ApiStockItem) {
  if (item.status === "reserved" && item.reservedAccountId) return "Dipakai Harian";
  const status = item.status;
  if (status === "available") return "Tersedia";
  if (status === "sold") return "Terjual";
  return "Dipesan";
}

function isDisneyStock(item: ApiStockItem, product?: Product | undefined, variant?: ProductVariant | undefined) {
  return [product?.name, product?.code, variant?.name, variant?.code, item.sheetPool]
    .join(" ")
    .toLowerCase()
    .includes("disney");
}

function stockIdentity(item: ApiStockItem, product?: Product | undefined, variant?: ProductVariant | undefined) {
  return isDisneyStock(item, product, variant) ? (item.loginPhone || item.email || "-") : (item.email || "-");
}

function isVisibleStockRow(item: ApiStockItem) {
  return String(item.status || "").toLowerCase() === "available";
}

function isLinkPoolStockRow(item: ApiStockItem) {
  return item.stockType === "link_pool" || item.sheetPoolSchema === "link";
}

function normalizeCode(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
}

function isNetflixSharedVariant(product?: Product, variant?: ProductVariant) {
  if (!product || !variant) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  return (
    (productText.includes("netflix") || normalizeCode(product.code) === "NET") &&
    (normalizeCode(variant.code) === "NET-1P1U" || normalizeCode(variant.code) === "NET-SEMI" || variantText.includes("1p1u") || variantText.includes("semi"))
  );
}

function isNetflixTwoUserVariant(product?: Product, variant?: ProductVariant) {
  if (!product || !variant) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  return (
    (productText.includes("netflix") || normalizeCode(product.code) === "NET") &&
    (["NET-2U", "NET-2P1U", "NET-1P2U"].includes(normalizeCode(variant.code)) || /\b2u\b/.test(variantText) || variantText.includes("2p1u") || variantText.includes("1p2u"))
  );
}

function isNetflixPrivateVariant(product?: Product, variant?: ProductVariant) {
  if (!product || !variant) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  return (productText.includes("netflix") || normalizeCode(product.code) === "NET") && variantText.includes("private") && !variantText.includes("semi");
}

function isViuVariant(product?: Product, variant?: ProductVariant) {
  if (!product || !variant || variant.isActive === false) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  return productText.includes("viu") || normalizeCode(product.code) === "VIU";
}

function isVidioPlatinumVariant(product?: Product, variant?: ProductVariant) {
  if (!product || !variant || variant.isActive === false) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  return (productText.includes("vidio") || normalizeCode(product.code) === "VIDIO") && variantText.includes("platinum");
}

function isStockVariantEnabled(product?: Product, variant?: ProductVariant) {
  return Boolean(product && variant && variant.isActive !== false && !isNetflixPrivateVariant(product, variant));
}

function stockVariantLabel(product?: Product, variant?: ProductVariant) {
  if (isNetflixSharedVariant(product, variant)) return "Sharing 1P1U / Semi Private";
  if (isNetflixTwoUserVariant(product, variant)) return "Sharing 2U";
  if (isViuVariant(product, variant)) return "Viu Pool";
  return variant?.name || "-";
}

function stockVariantCodeLabel(product?: Product, variant?: ProductVariant) {
  if (isNetflixSharedVariant(product, variant)) return "NET-1P1U / NET-SEMI";
  if (isNetflixTwoUserVariant(product, variant)) return "NET-2U";
  if (isViuVariant(product, variant)) return "VIU";
  return variant?.code || variant?.id || "-";
}

function stockVariantOptions(product?: Product) {
  const variants = (product?.variants || []).filter((variant) => isStockVariantEnabled(product, variant));
  if (!product) return variants;
  const shared = variants.find((variant) => isNetflixSharedVariant(product, variant));
  if (!shared) return variants;
  return [shared, ...variants.filter((variant) => !isNetflixSharedVariant(product, variant))];
}

function stockManageProducts(products: Product[]) {
  return products.filter((product) => !product.isArchived);
}

function scrollToElement(id = "") {
  if (!id || typeof document === "undefined") return;
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

export default function StockPage() {
  const [params] = useSearchParams();
  const stockParam = params.get("stock")?.trim() || "";
  const [query, setQuery] = useState(stockParam);
  const [status, setStatus] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<ApiStockItem | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [stock, setStock] = useState<ApiStockItem[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigningStock, setAssigningStock] = useState<ApiStockItem | null>(null);
  const [assignForm, setAssignForm] = useState(emptyAssignForm);
  const [assignError, setAssignError] = useState("");
  const [sheetsStatus, setSheetsStatus] = useState<{ configured: boolean; lastSyncAt?: string; lastSyncSummary?: Record<string, unknown> | null } | null>(null);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [previewingSheets, setPreviewingSheets] = useState(false);
  const [syncPreview, setSyncPreview] = useState<GoogleSheetsPreview | null>(null);
  const [syncDetail, setSyncDetail] = useState<ReturnType<typeof syncSummaryItems>[number] | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function loadData() {
    try {
      setLoadError("");
      const [productRows, stockRows, resellerRows, sheets, maintenanceState] = await Promise.all([
        api.products(),
        api.stock(),
        api.resellers(),
        api.googleSheetsStatus().catch(() => null),
        api.maintenance().then((result) => result.maintenance).catch(() => null),
      ]);
      const manageableProducts = stockManageProducts(productRows);
      setProducts(productRows);
      setStock(stockRows);
      setResellers(resellerRows);
      setSheetsStatus(sheets);
      setMaintenance(maintenanceState);
      setForm((current) => ({
        ...current,
        productId: current.productId || manageableProducts[0]?.id || "",
        variantId: current.variantId || stockVariantOptions(manageableProducts[0])?.[0]?.id || "",
      }));
      setAssignForm((current) => ({
        ...current,
        resellerId: current.resellerId || resellerRows[0]?.id || "",
      }));
    } catch (error) {
      setProducts([]);
      setStock([]);
      setLoadError(error instanceof Error ? error.message : "Gagal memuat data stok.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  useEffect(() => {
    setQuery(stockParam);
    if (stockParam) setStatus("all");
  }, [stockParam]);

  useEffect(() => {
    if (!stockParam || !stock.some((item) => item.id === stockParam)) return;
    scrollToElement(`stock-row-${stockParam}`);
  }, [stock, stockParam]);

  const rows = useMemo(
    () =>
      stock.filter((item) => {
        const isTargetStock = Boolean(stockParam && item.id === stockParam);
        if (!isVisibleStockRow(item) && !isTargetStock) return false;
        const product = products.find((row) => row.id === item.productId);
        const variant = product?.variants.find((row) => row.id === item.variantId);
        const matchStatus = status === "all" || item.status === status || isTargetStock;
        const matchQuery = [item.id, item.email, item.loginPhone, item.otpEmail, product?.name, variant?.name, item.sheetPool].join(" ").toLowerCase().includes(query.toLowerCase());
        return matchStatus && matchQuery;
      }),
    [products, query, status, stock, stockParam],
  );

  const manageableProducts = useMemo(() => stockManageProducts(products), [products]);
  const selectedProduct = products.find((item) => item.id === form.productId) || products[0];
  const selectedVariant = selectedProduct?.variants.find((item) => item.id === form.variantId) || selectedProduct?.variants[0];
  const assignProduct = products.find((item) => item.id === assigningStock?.productId);
  const assignVariantOptions = stockVariantOptions(assignProduct);

  function openStockModal() {
    if (loading || !manageableProducts.length) return;
    const product = manageableProducts[0];
    setEditingStock(null);
    setForm({
      ...emptyForm,
      productId: product?.id || "",
      variantId: stockVariantOptions(product)?.[0]?.id || "",
    });
    setModalOpen(true);
  }

  function openEditStock(item: ApiStockItem) {
    const product = products.find((row) => row.id === item.productId);
    setEditingStock(item);
    setForm({
      productId: item.productId,
      variantId: item.variantId || stockVariantOptions(product)?.[0]?.id || "",
      email: item.email || "",
      password: item.password || "",
      profile: item.profile || "",
      pin: item.pin || "",
      notes: item.notes || "",
    });
    setModalOpen(true);
  }

  function closeStockModal() {
    setModalOpen(false);
    setEditingStock(null);
  }

  function selectProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    setForm((current) => ({
      ...current,
      productId,
      variantId: stockVariantOptions(product)?.[0]?.id || "",
      profile: product?.needsProfile ? current.profile : "",
      pin: product?.needsPin ? current.pin : "",
    }));
  }

  async function saveStock() {
    if (!form.email || !form.password || !selectedProduct || !selectedVariant) return;
    const payload = {
      productId: selectedProduct.id,
      variantId: selectedVariant.id,
      email: form.email,
      password: form.password,
      profile: form.profile,
      pin: form.pin,
      notes: form.notes,
      status: editingStock?.status || "available",
    };
    if (editingStock) await api.updateStock(editingStock.id, payload);
    else await api.createStock(payload);
    closeStockModal();
    setForm({
      ...emptyForm,
      productId: manageableProducts[0]?.id || "",
      variantId: stockVariantOptions(manageableProducts[0])?.[0]?.id || "",
    });
    await loadData();
  }

  async function deleteStock(id: string) {
    if (!window.confirm("Hapus stok ini dari database?")) return;
    await api.deleteStock(id);
    await loadData();
  }

  function openAssignDaily(item: ApiStockItem) {
    const product = products.find((row) => row.id === item.productId);
    setAssigningStock(item);
    setAssignForm({
      ...emptyAssignForm,
      resellerId: resellers[0]?.id || "",
      variantId: item.variantId || stockVariantOptions(product)[0]?.id || "",
      startedAt: nowDateTimeLocal(),
      durationDays: "1",
      device: "",
    });
    setAssignError("");
    setAssignOpen(true);
  }

  function closeAssignDaily() {
    setAssignOpen(false);
    setAssigningStock(null);
    setAssignError("");
  }

  async function saveAssignDaily() {
    if (!assigningStock) return;
    if (!assignForm.resellerId) {
      setAssignError("Pilih reseller tujuan dulu.");
      return;
    }
    const days = Number(assignForm.durationDays || 1);
    if (!Number.isFinite(days) || days <= 0) {
      setAssignError("Durasi hari tidak valid.");
      return;
    }
    await api.assignDailyStock(assigningStock.id, {
      resellerId: assignForm.resellerId,
      variantId: assignForm.variantId || assigningStock.variantId,
      startedAt: assignForm.startedAt,
      durationDays: Math.floor(days),
      buyer: assignForm.buyer,
      device: assignForm.device,
    });
    closeAssignDaily();
    await loadData();
  }

  async function syncSheetsStock() {
    setSyncingSheets(true);
    try {
      await api.syncGoogleSheets();
      setSyncPreview(null);
      await loadData();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Sync Google Sheets gagal.");
    } finally {
      setSyncingSheets(false);
    }
  }

  async function previewSheetsStock() {
    setPreviewingSheets(true);
    setLoadError("");
    try {
      const result = await api.googleSheetsPreview();
      setSyncPreview(result.preview);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Preview Google Sheets gagal.");
    } finally {
      setPreviewingSheets(false);
    }
  }

  async function updateMaintenance(enabled: boolean) {
    setMaintenanceBusy(true);
    setLoadError("");
    try {
      const result = await api.updateMaintenance({
        enabled,
        reason: enabled ? "Maintenance manual dari owner. Order baru ditahan sementara." : "",
      });
      setMaintenance(result.maintenance);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Maintenance gagal diubah.");
    } finally {
      setMaintenanceBusy(false);
    }
  }

  return (
    <DashboardLayout role="owner" title="Manajemen Stok">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <p className="text-sm text-slate-500">Kelola stok akun yang tersedia. Data ini tersimpan ke backend lokal.</p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button
            type="button"
            onClick={previewSheetsStock}
            disabled={previewingSheets || syncingSheets || !sheetsStatus?.configured}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-sky-100 bg-white px-4 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <i className={previewingSheets ? "ri-loader-4-line animate-spin" : "ri-eye-line"} />
            Preview Sync
          </button>
          <button
            type="button"
            onClick={syncSheetsStock}
            disabled={syncingSheets || !sheetsStatus?.configured}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-100 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <i className={syncingSheets ? "ri-loader-4-line animate-spin" : "ri-refresh-line"} />
            Sync Sheets
          </button>
          <button
            type="button"
            onClick={() => updateMaintenance(!maintenance?.enabled)}
            disabled={maintenanceBusy}
            className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${
              maintenance?.enabled
                ? "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100"
            }`}
          >
            <i className={maintenanceBusy ? "ri-loader-4-line animate-spin" : maintenance?.enabled ? "ri-play-circle-line" : "ri-pause-circle-line"} />
            {maintenance?.enabled ? "Matikan Maintenance" : "Maintenance"}
          </button>
          <button
            type="button"
            onClick={openStockModal}
            disabled={loading || !manageableProducts.length}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#2b2b2b] px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <i className="ri-add-line" />
            </span>
            {loading ? "Memuat Produk..." : "Tambah Stok"}
          </button>
        </div>
      </div>

      <DataPanel className="mb-4 border border-emerald-100 bg-emerald-50/40 p-4 text-xs leading-5 text-emerald-700">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Sync Health Google Sheets</span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${sheetsStatus?.configured ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                  {sheetsStatus?.configured ? "Terhubung" : "Belum dikonfigurasi"}
                </span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${maintenance?.enabled ? "bg-amber-100 text-amber-700" : "bg-white text-emerald-700"}`}>
                  {maintenance?.enabled ? "Maintenance aktif" : "Order aktif"}
                </span>
              </div>
              <p className="mt-1 text-emerald-700/80">
                {sheetsStatus?.lastSyncAt
                  ? `Sync terakhir ${formatSyncTime(sheetsStatus.lastSyncAt)} (${syncAgeText(sheetsStatus.lastSyncAt)}).`
                  : "Isi Settings > API & Integrasi > Google Sheets Stock untuk mengaktifkan."}
              </p>
              {maintenance?.enabled ? (
                <p className="mt-1 text-amber-700">
                  Order baru ditahan: {maintenance.reason || "Maintenance aktif"} {maintenance.updatedAt ? `(${formatSyncTime(maintenance.updatedAt)})` : ""}
                </p>
              ) : null}
            </div>
            {sheetsStatus?.lastSyncSummary ? (
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-emerald-700">
                  Source {syncSummaryItems(sheetsStatus.lastSyncSummary).filter(({ hasData }) => hasData).length}/{syncSummaryItems(sheetsStatus.lastSyncSummary).length}
                </span>
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-red-600">
                  Error {syncSummaryItems(sheetsStatus.lastSyncSummary).reduce((total, item) => total + (item.key === "errors" ? item.errorCount : 0), 0)}
                </span>
              </div>
            ) : null}
          </div>
          {sheetsStatus?.lastSyncSummary ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {syncSummaryItems(sheetsStatus.lastSyncSummary).map((card) => (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => setSyncDetail(card)}
                  className={`rounded-lg border px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${syncHealthTone(card.status)}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{card.label}</span>
                    <span className="text-[11px] font-semibold">{card.status}</span>
                  </div>
                  <p className="mt-1 text-[11px]">{card.details}</p>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </DataPanel>

      {loadError ? (
        <DataPanel className="mb-4 border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {loadError.includes("Sesi login")
            ? "Sesi login sudah berakhir. Silakan login ulang supaya produk dan stok bisa dimuat."
            : loadError}
        </DataPanel>
      ) : null}

      <div className="sticky top-16 z-40 isolate -mx-3 mb-4 border-b border-white/60 bg-[#f2ece2] px-3 py-3 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.45)] sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
        <DataPanel className="p-4 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <SearchBox value={query} onChange={setQuery} placeholder="Cari email, ID, atau variant..." />
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["all", "Semua"],
                ["available", "Tersedia"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatus(id)}
                  className={`h-9 rounded-md px-4 text-xs font-medium transition-colors ${
                    status === id ? "bg-[#2b2b2b] text-white" : "bg-[#f7f1e8] text-slate-700 hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {stockParam ? (
            <div className="mt-3 rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700">
              Fokus ke stok <span className="font-semibold">{stockParam}</span>. Row target tetap ditampilkan walau statusnya bukan stok available biasa.
            </div>
          ) : null}
        </DataPanel>
      </div>

      <DataPanel className="overflow-hidden p-0">
        <div className="kavya-mobile-scroll-hint">Geser tabel ke samping untuk melihat password, profile, PIN, dan aksi.</div>
        <div className="max-h-[calc(100vh-330px)] min-h-[360px] overflow-auto">
          <table className="w-full min-w-[1060px] text-left text-xs">
            <thead className="sticky top-0 z-20 bg-[#fbf8f2] text-slate-400 shadow-sm shadow-slate-950/5">
              <tr>
                <th className="px-4 py-4 font-medium uppercase">ID</th>
                <th className="px-4 py-4 font-medium uppercase">Produk</th>
                <th className="px-4 py-4 font-medium uppercase">Identitas</th>
                <th className="px-4 py-4 font-medium uppercase">Password / Link</th>
                <th className="px-4 py-4 font-medium uppercase">Variant</th>
                <th className="px-4 py-4 font-medium uppercase">Status</th>
                <th className="px-4 py-4 font-medium uppercase">Profile</th>
                <th className="px-4 py-4 font-medium uppercase">PIN</th>
                <th className="sticky right-0 z-30 bg-[#fbf8f2] px-4 py-4 text-right font-medium uppercase shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    Memuat stok akun...
                  </td>
                </tr>
              ) : rows.map((item) => {
                const product = products.find((row) => row.id === item.productId);
                const variant = product?.variants.find((row) => row.id === item.variantId);
                return (
                  <tr
                    key={item.id}
                    id={`stock-row-${item.id}`}
                    className={`border-t border-gray-100 text-slate-800 transition-colors ${item.id === stockParam ? "bg-sky-50/70" : ""}`}
                  >
                    <td className="px-4 py-4 font-semibold">{item.id}</td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{product?.name}</div>
                      <div className="text-[11px] text-slate-500">{stockVariantLabel(product, variant)}</div>
                      {item.sheetSource ? <div className="mt-1 text-[11px] text-emerald-600">{item.sheetPool}</div> : null}
                    </td>
                    <td className="px-4 py-4">{stockIdentity(item, product, variant)}</td>
                    <td className="px-4 py-4">
                      <span className="rounded bg-[#f7f1e8] px-2 py-1 text-[11px]">{item.password}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{stockVariantLabel(product, variant)}</div>
                      <div className="text-[11px] text-slate-500">{stockVariantCodeLabel(product, variant) || item.variantId}</div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge variant={item.status === "available" ? "emerald" : item.status === "sold" ? "info" : "amber"}>
                        {statusLabel(item)}
                      </Badge>
                      {item.reservedUntil ? <div className="mt-1 text-[11px] text-slate-400">s/d {item.reservedUntil}</div> : null}
                    </td>
                    <td className="px-4 py-4">{item.profile || "-"}</td>
                    <td className="px-4 py-4">{item.pin || "-"}</td>
                    <td className="sticky right-0 bg-[#fbf8f2] px-4 py-4 text-right shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">
                      <div className="flex justify-end gap-2">
                        {isLinkPoolStockRow(item) ? (
                          <span className="text-xs font-medium text-slate-400">Kelola di Sheets</span>
                        ) : item.status === "available" ? (
                          <button type="button" onClick={() => openAssignDaily(item)} className="text-xs font-medium text-slate-600 hover:text-red-600">
                            Assign Harian
                          </button>
                        ) : null}
                        {!isLinkPoolStockRow(item) ? (
                          <>
                            <button type="button" onClick={() => openEditStock(item)} className="text-xs font-medium text-slate-600 hover:text-red-600">
                              Edit
                            </button>
                            <button type="button" onClick={() => deleteStock(item.id)} className="text-xs font-medium text-red-600 hover:text-red-700">
                              Hapus
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && !rows.length ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    {loadError ? "Data stok belum bisa dimuat." : "Stok kosong untuk filter ini."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DataPanel>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">{editingStock ? "Edit Stok" : "Tambah Stok Baru"}</h2>
              <button className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={closeStockModal}>
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="mt-6 space-y-4">
              <div className="block">
                <span className="text-sm text-slate-700">Produk</span>
                <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto rounded-md border border-[#ded6ca] bg-[#f7f1e8] p-2">
                  {manageableProducts.length ? manageableProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => selectProduct(product.id)}
                      className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                        selectedProduct?.id === product.id ? "bg-[#2b2b2b] text-white" : "bg-white text-slate-700 hover:bg-[#f2ece2]"
                      }`}
                    >
                      <span>{product.name}</span>
                      <span className="text-xs opacity-70">{product.variants.length} varian</span>
                    </button>
                  )) : (
                    <div className="rounded-md bg-white px-3 py-3 text-sm text-slate-500">
                      Produk belum termuat. Tutup modal lalu coba lagi.
                    </div>
                  )}
                </div>
              </div>
              <div className="block">
                <span className="text-sm text-slate-700">Variant</span>
                <div className="mt-2 grid max-h-32 gap-2 overflow-y-auto rounded-md border border-[#ded6ca] bg-[#f7f1e8] p-2">
                  {stockVariantOptions(selectedProduct).length ? stockVariantOptions(selectedProduct).map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => setForm({ ...form, variantId: variant.id })}
                      className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                        selectedVariant?.id === variant.id ? "bg-[#2b2b2b] text-white" : "bg-white text-slate-700 hover:bg-[#f2ece2]"
                      }`}
                    >
                      <span>{stockVariantLabel(selectedProduct, variant)}</span>
                      <span className="text-xs opacity-70">{stockVariantCodeLabel(selectedProduct, variant)}</span>
                    </button>
                  )) : (
                    <div className="rounded-md bg-white px-3 py-3 text-sm text-slate-500">
                      Pilih produk yang punya varian terlebih dulu.
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm text-slate-700">Email Akun</span>
                  <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="email@gmail.com" />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Password / Link</span>
                  <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Password atau link akun" />
                </label>
              </div>
              {selectedProduct?.needsProfile || selectedProduct?.needsPin ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {selectedProduct?.needsProfile ? (
                    <label className="block">
                      <span className="text-sm text-slate-700">Profile</span>
                      <input value={form.profile} onChange={(event) => setForm({ ...form, profile: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Nama profile..." />
                    </label>
                  ) : null}
                  {selectedProduct?.needsPin ? (
                    <label className="block">
                      <span className="text-sm text-slate-700">PIN</span>
                      <input value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="4 digit PIN" />
                    </label>
                  ) : null}
                </div>
              ) : null}
              <label className="block">
                <span className="text-sm text-slate-700">Catatan</span>
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="mt-2 h-20 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 py-2 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Catatan opsional" />
              </label>
              {editingStock ? (
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
                  Kalau password diubah, password email yang sama otomatis ikut berubah di manajemen akun reseller. Profile dan PIN tidak ikut disamakan.
                </div>
              ) : null}
              <div className="grid gap-3 pt-2 md:grid-cols-2">
                <button className="h-11 rounded-md border border-gray-300 text-sm text-slate-700" onClick={closeStockModal}>Batal</button>
                <button
                  className="h-11 rounded-md bg-[#2b2b2b] text-sm font-medium text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
                  onClick={saveStock}
                  disabled={!selectedProduct || !selectedVariant || !form.email || !form.password}
                >
                  {editingStock ? "Simpan Perubahan" : "Simpan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {assignOpen && assigningStock ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Assign Harian</h2>
                <p className="mt-1 text-xs text-slate-500">{assigningStock.email}</p>
              </div>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={closeAssignDaily}>
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="mt-6 space-y-4">
              {assignError ? <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{assignError}</div> : null}
              <label className="block">
                <span className="text-sm text-slate-700">Reseller</span>
                <select value={assignForm.resellerId} onChange={(event) => setAssignForm({ ...assignForm, resellerId: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]">
                  <option value="">Pilih reseller</option>
                  {resellers.map((reseller) => (
                    <option key={reseller.id} value={reseller.id}>{reseller.name || reseller.username} - {reseller.whatsapp}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Varian Customer</span>
                <select value={assignForm.variantId} onChange={(event) => setAssignForm({ ...assignForm, variantId: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]">
                  {assignVariantOptions.map((variant) => (
                    <option key={variant.id} value={variant.id}>{stockVariantLabel(assignProduct, variant)} ({stockVariantCodeLabel(assignProduct, variant)})</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm text-slate-700">Mulai</span>
                  <input type="datetime-local" value={assignForm.startedAt} onChange={(event) => setAssignForm({ ...assignForm, startedAt: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Durasi (hari)</span>
                  <input type="number" min={1} max={365} value={assignForm.durationDays} onChange={(event) => setAssignForm({ ...assignForm, durationDays: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" />
                </label>
              </div>
              <label className="block">
                <span className="text-sm text-slate-700">Nama Buyer / Catatan</span>
                <input value={assignForm.buyer} onChange={(event) => setAssignForm({ ...assignForm, buyer: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Opsional" />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Device Netflix</span>
                <input value={assignForm.device} onChange={(event) => setAssignForm({ ...assignForm, device: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Contoh: Smart TV LG, iPhone 13" />
              </label>
              <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                Expired: {addDaysDateTimeLocal(assignForm.startedAt, Number(assignForm.durationDays || 1))}. Setelah assign, stok hilang dari Manajemen Stok dan akun muncul di panel reseller.
              </div>
              <div className="grid gap-3 pt-2 md:grid-cols-2">
                <button type="button" className="h-11 rounded-md border border-gray-300 text-sm text-slate-700" onClick={closeAssignDaily}>Batal</button>
                <button type="button" className="h-11 rounded-md bg-[#2b2b2b] text-sm font-medium text-white hover:bg-slate-900" onClick={saveAssignDaily}>
                  Assign ke Reseller
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {syncPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview Sync Sheets</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">Cek perubahan sebelum sync</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">Belum ada data yang diubah. Lanjutkan hanya kalau ringkasan ini sesuai dengan isi Sheets.</p>
              </div>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setSyncPreview(null)}>
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {[
                ["Tambah stok", syncPreview.addStock],
                ["Stok jadi sold", syncPreview.soldStock],
                ["Balik available", syncPreview.availableStock],
                ["Stok removed", syncPreview.removedStock],
                ["Akun expired/hidden", syncPreview.expiredAccounts],
                ["Warning", syncPreview.warnings.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Baris dibaca", syncPreview.rowAudit.summary.rowsRead],
                ["Cocok", syncPreview.rowAudit.summary.matched],
                ["Ambigu", syncPreview.rowAudit.summary.ambiguous],
                ["Mismatch", syncPreview.rowAudit.summary.mismatch + syncPreview.rowAudit.summary.duplicateStock],
              ].map(([label, value]) => (
                <div key={label} className="border-t border-slate-200 px-1 py-2">
                  <p className="text-[11px] text-slate-500">{label}</p>
                  <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
                </div>
              ))}
            </div>
            {syncPreview.changes.length ? (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-800">Perubahan per baris</p>
                  <span className="text-[11px] text-slate-500">{syncPreview.changes.length} perubahan</span>
                </div>
                <div className="mt-2 max-h-56 overflow-auto border-y border-slate-100">
                  {syncPreview.changes.map((change) => (
                    <div key={`${change.stockId}-${change.type}`} className="grid gap-1 border-b border-slate-100 px-1 py-3 text-xs last:border-b-0 md:grid-cols-[190px_1fr]">
                      <div>
                        <p className="font-semibold text-slate-900">{change.identity}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{change.sheetName || "-"} row {change.sheetRow || "-"} · {change.type}</p>
                      </div>
                      <div className="space-y-1 text-slate-600">
                        {change.fields.map((field) => <p key={field}>{field}</p>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 border-y border-emerald-100 py-3 text-xs font-medium text-emerald-700">Tidak ada perubahan baris.</div>
            )}
            {syncPreview.warnings.length ? (
              <div className="mt-4 max-h-40 space-y-2 overflow-y-auto rounded-md border border-amber-100 bg-amber-50 p-3">
                {syncPreview.warnings.slice(0, 12).map((warning, index) => (
                  <p key={`${warning}-${index}`} className="text-xs leading-5 text-amber-800">{warning}</p>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                Tidak ada warning besar dari preview.
              </div>
            )}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" className="h-10 rounded-md border border-gray-200 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setSyncPreview(null)}>
                Batal
              </button>
              <button type="button" disabled={syncingSheets} className="h-10 rounded-md bg-[#2b2b2b] text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-wait disabled:bg-slate-300" onClick={syncSheetsStock}>
                {syncingSheets ? "Sync..." : "Lanjut Sync"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {syncDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sync Health</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">{syncDetail.label}</h2>
                <p className="mt-1 text-sm text-slate-500">{syncDetail.details}</p>
              </div>
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setSyncDetail(null)}>
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="mt-5 space-y-2">
              {syncDetail.detailLines.map((line, index) => (
                <div key={`${syncDetail.key}-${index}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-700">
                  {line}
                </div>
              ))}
            </div>
            <button type="button" className="mt-5 h-10 w-full rounded-md bg-[#2b2b2b] text-sm font-semibold text-white hover:bg-slate-900" onClick={() => setSyncDetail(null)}>
              Tutup
            </button>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}

