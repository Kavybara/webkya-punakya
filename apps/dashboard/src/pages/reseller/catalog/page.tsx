import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, subscribeRealtime, type ApiReseller, type CatalogProduct, type CatalogVariant } from "../../../lib/api";
import { firstAllowedPriceEntry, isDailyDuration, sortedAllowedPriceEntries } from "../../../lib/durations";
import { productBrandAsset, productLogoUrl } from "../../../lib/productBrandAssets";
import { ResellerPageTitle, ResellerSearch, ResellerStatCard, money } from "../resellerUi";

type SelectedPackage = {
  product: CatalogProduct;
  variant: CatalogVariant;
  duration: string;
  price: number;
};

type CatalogDurationMode = "monthly" | "daily";

function minPrice(product: CatalogProduct) {
  const prices = product.variants
    .flatMap((variant) => sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).map(([, price]) => price))
    .map(Number)
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function durationCount(product: CatalogProduct) {
  return product.variants.reduce((total, variant) => total + sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).length, 0);
}

function durationModeOf(duration = ""): CatalogDurationMode {
  return isDailyDuration(duration) ? "daily" : "monthly";
}

function durationEntriesForMode(variant?: CatalogVariant, mode: CatalogDurationMode = "monthly") {
  const entries = sortedAllowedPriceEntries(variant?.prices || {}, variant?.durationModes);
  const filtered = entries.filter(([duration]) => (mode === "daily" ? isDailyDuration(duration) : !isDailyDuration(duration)));
  return filtered.length ? filtered : entries;
}

function durationModeOptions(variant?: CatalogVariant) {
  const entries = sortedAllowedPriceEntries(variant?.prices || {}, variant?.durationModes);
  return {
    daily: entries.some(([duration]) => isDailyDuration(duration)),
    monthly: entries.some(([duration]) => !isDailyDuration(duration)),
  };
}

function firstDuration(variant?: CatalogVariant, mode?: CatalogDurationMode) {
  const entries = mode ? durationEntriesForMode(variant, mode) : sortedAllowedPriceEntries(variant?.prices || {}, variant?.durationModes);
  const [duration, price] = entries[0] || firstAllowedPriceEntry(variant?.prices || {}, variant?.durationModes);
  return { duration, price: Number(price || 0) };
}

function normalizeWhatsapp(value = "") {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export default function ResellerCatalogPage() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [reseller, setReseller] = useState<ApiReseller | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openProductId, setOpenProductId] = useState("");
  const [selection, setSelection] = useState<SelectedPackage | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  async function loadCatalog() {
    try {
      setError("");
      await Promise.all([
        api.catalog().then(setProducts),
        api.resellers().then((rows) => setReseller(rows[0] || null)),
      ]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Katalog produk gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCatalog().catch(console.error);
    return subscribeRealtime(() => {
      loadCatalog().catch(console.error);
    });
  }, []);

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return products
      .filter((product) => Number(product.stockCount || 0) > 0)
      .filter((product) => !keyword || [product.name, product.category, product.code, product.description].join(" ").toLowerCase().includes(keyword))
      .sort((a, b) => b.stockCount - a.stockCount);
  }, [products, query]);
  const totalStock = useMemo(() => rows.reduce((sum, product) => sum + Number(product.stockCount || 0), 0), [rows]);
  const totalVariants = useMemo(() => rows.reduce((sum, product) => sum + Number(product.variants.length || 0), 0), [rows]);

  const resellerWhatsapp = normalizeWhatsapp(reseller?.whatsapp || "");

  function selectPackage(product: CatalogProduct, variant: CatalogVariant, duration?: string, price?: number) {
    const selectedDuration = duration ? { duration, price: Number(price || 0) } : firstDuration(variant);
    setSelection({ product, variant, duration: selectedDuration.duration, price: selectedDuration.price });
    setNotice("");
    setError("");
  }

  function chooseProduct(productId: string) {
    setOpenProductId((current) => {
      const next = current === productId ? "" : productId;
      if (next !== productId) setSelection(null);
      else setSelection((currentSelection) => (currentSelection?.product.id === productId ? currentSelection : null));
      return next;
    });
    setNotice("");
    setError("");
  }

  function chooseVariant(product: CatalogProduct, variantId: string) {
    const variant = product.variants.find((item) => item.id === variantId);
    if (!variant) {
      setSelection(null);
      return;
    }
    selectPackage(product, variant);
  }

  function chooseDuration(duration: string) {
    setSelection((current) => {
      if (!current) return current;
      return { ...current, duration, price: Number(current.variant.prices?.[duration] || 0) };
    });
    setNotice("");
    setError("");
  }

  function chooseDurationMode(mode: CatalogDurationMode) {
    setSelection((current) => {
      if (!current) return current;
      const next = firstDuration(current.variant, mode);
      return { ...current, duration: next.duration, price: next.price };
    });
    setNotice("");
    setError("");
  }

  async function openCheckout() {
    if (!selection || redirecting) return;
    setRedirecting(true);
    setError("");
    setNotice("");
    const params = new URLSearchParams({
      productId: selection.product.id,
      variantId: selection.variant.id,
      duration: selection.duration,
      qty: "1",
      from: "reseller",
    });
    navigate(`/reseller/checkout?${params.toString()}`, {
      state: {
        checkoutSelection: selection,
        quantity: 1,
      },
    });
  }

  return (
    <DashboardLayout role="reseller" title="Katalog Produk">
      <div className="space-y-5 pb-24 md:pb-0">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <ResellerPageTitle title="Katalog Produk" subtitle="Pilih produk ready, pilih varian dan durasi, lalu lanjut ke halaman checkout." />
          <div className="rounded-xl border border-amber-100 bg-white px-4 py-3 text-xs">
            <p className="text-slate-400">Saldo Deposit</p>
            <p className="mt-1 text-lg font-bold text-slate-950">{money(Number(reseller?.deposit || 0))}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <ResellerStatCard label="Produk Ready" value={rows.length} icon="ri-stack-line" tone="blue" hint="Produk yang masih punya stok" />
          <ResellerStatCard label="Total Varian" value={totalVariants} icon="ri-grid-line" tone="amber" hint="Pilihan varian yang bisa dipilih" />
          <ResellerStatCard label="Total Slot Stok" value={totalStock} icon="ri-database-2-line" tone="emerald" hint="Akumulasi stok aktif di katalog" />
        </div>

        <div className="sticky top-16 z-30 isolate -mx-4 border-b border-white/10 bg-[#070708] px-4 py-3 md:-mx-6 md:px-6">
          <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm shadow-slate-950/5">
            <ResellerSearch value={query} onChange={setQuery} placeholder="Cari produk ready..." />
          </div>
        </div>

        {!loading && rows.length ? (
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm shadow-slate-950/5">
            Menampilkan <span className="font-semibold text-slate-900">{rows.length}</span> produk ready untuk order cepat.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
            {notice}
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-1 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-500">Katalog Produk</p>
            <h2 className="text-xl font-bold text-slate-950">Produk Kavya - Data Asli</h2>
            <p className="text-xs leading-5 text-slate-500">Card hanya menampilkan produk ready. Klik produk untuk melihat varian, lalu lanjut ke checkout resmi Kavya.</p>
          </div>

          {loading ? (
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-72 animate-pulse rounded-xl border border-slate-100 bg-slate-50" />
              ))}
            </div>
          ) : rows.length ? (
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((product) => {
                const brand = productBrandAsset(product);
                const logoUrl = productLogoUrl(product);
                const expanded = openProductId === product.id;
                const selectedForProduct = selection?.product.id === product.id ? selection : null;
                return (
                  <article key={product.id} className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-colors ${expanded ? "border-red-200 ring-2 ring-red-50" : "border-gray-100"}`}>
                    <button type="button" onClick={() => chooseProduct(product.id)} className="block w-full text-left">
                      <div className={`relative flex h-40 items-center justify-center bg-gradient-to-br ${brand.tone}`}>
                        <span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-bold text-white">Tersedia</span>
                        <span className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-700">{product.category || product.code}</span>
                        <span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1 text-[11px] font-semibold text-white">{product.stockCount} stok</span>
                        <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-700">
                          {expanded ? "Tutup varian" : "Lihat varian"}
                        </span>
                        <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-white/90 text-slate-950 shadow-2xl">
                          <span className="px-2 text-center text-xs font-black leading-tight tracking-wide">{product.code || brand.label}</span>
                          {logoUrl ? (
                            <img
                              src={logoUrl}
                              alt={`${brand.label} logo`}
                              className="absolute h-12 w-12 object-contain"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                      <div className="p-5">
                        <h3 className="text-base font-bold text-slate-950">{product.name}</h3>
                        <p className="mt-2 min-h-[42px] text-sm leading-5 text-slate-500">{product.description}</p>
                        <div className="mt-4 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-[11px] text-slate-400">Mulai dari</p>
                            <p className="text-lg font-bold text-slate-950">{money(minPrice(product))}</p>
                          </div>
                          <div className="text-right text-[11px] text-slate-400">
                            <p>{product.variants.length} varian</p>
                            <p>{durationCount(product)} pilihan durasi</p>
                          </div>
                        </div>
                      </div>
                    </button>

                    {expanded ? (
                      <div className="border-t border-gray-100 px-5 pb-5 pt-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pilih varian</p>
                        <div className="mt-3 space-y-2">
                          {product.variants.map((variant) => {
                            const first = firstDuration(variant);
                            const selectedVariant = selectedForProduct?.variant.id === variant.id;
                            return (
                              <button
                                key={variant.id}
                                type="button"
                                onClick={() => chooseVariant(product, variant.id)}
                                disabled={variant.stockCount <= 0}
                                className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                                  selectedVariant ? "border-red-200 bg-red-50" : "border-gray-100 hover:border-red-100 hover:bg-red-50/40"
                                } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400`}
                              >
                                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${selectedVariant ? "bg-red-500 text-white" : "bg-red-50 text-red-500"}`}>
                                  <i className={`${selectedVariant ? "ri-check-line" : "ri-checkbox-blank-circle-line"} text-xs`} />
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold">
                                    {variant.name} <span className="text-[10px] font-medium text-slate-400">{variant.code}</span>
                                  </span>
                                  <span className="block truncate text-xs text-slate-400">{variant.stockCount} akun tersedia</span>
                                </span>
                                <span className="text-right text-sm font-bold">
                                  {money(first.price)}
                                  <span className="block text-[10px] font-medium text-slate-400">mulai</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {selectedForProduct ? (() => {
                          const modeOptions = durationModeOptions(selectedForProduct.variant);
                          const activeMode = durationModeOf(selectedForProduct.duration);
                          const durationEntries = durationEntriesForMode(selectedForProduct.variant, activeMode).slice(0, 9);
                          const showModeSwitcher = modeOptions.monthly && modeOptions.daily;
                          return (
                            <>
                              {showModeSwitcher ? (
                                <div className="reseller-catalog-duration-switch">
                                  {(["monthly", "daily"] as CatalogDurationMode[]).map((mode) => (
                                    <button
                                      key={mode}
                                      type="button"
                                      onClick={() => chooseDurationMode(mode)}
                                      className={`reseller-catalog-duration-mode ${activeMode === mode ? "is-active" : ""}`}
                                    >
                                      {mode === "monthly" ? "Bulanan" : "Harian"}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              <div className="reseller-catalog-duration-grid">
                                {durationEntries.map(([duration, price]) => (
                                  <button
                                    key={duration}
                                    type="button"
                                    onClick={() => chooseDuration(duration)}
                                    className={`reseller-catalog-duration-option ${
                                      selectedForProduct.duration === duration ? "is-selected" : ""
                                    }`}
                                  >
                                    <span className="reseller-catalog-duration-label">{duration}</span>
                                    <span className="reseller-catalog-duration-price">{money(Number(price || 0))}</span>
                                  </button>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={openCheckout}
                                disabled={redirecting}
                                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2b2b2b] text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-wait disabled:bg-slate-300"
                              >
                                <i className="ri-shopping-cart-line" />
                                {redirecting ? "Membuka checkout..." : "Lanjut ke Checkout"}
                              </button>
                            </>
                          );
                        })() : (
                          <button type="button" disabled className="mt-4 h-10 w-full cursor-not-allowed rounded-md bg-slate-200 text-sm font-semibold text-slate-500">
                            Pilih varian dulu
                          </button>
                        )}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Belum ada produk ready untuk ditampilkan.
            </div>
          )}
        </section>

        {selection ? (
          <div className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-950/20 md:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-950">{selection.product.name} - {selection.variant.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{selection.duration} / {money(selection.price)}</p>
              </div>
              <button
                type="button"
                onClick={openCheckout}
                disabled={redirecting}
                className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#2b2b2b] px-4 text-xs font-semibold text-white disabled:cursor-wait disabled:bg-slate-300"
              >
                <i className={redirecting ? "ri-loader-4-line animate-spin" : "ri-shopping-cart-line"} />
                Checkout
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
