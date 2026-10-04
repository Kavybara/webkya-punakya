import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Database,
  Grid2X2,
  Layers,
  LoaderCircle,
  Search,
  ShoppingCart,
  WalletCards,
} from "lucide-react";
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";
import { systemStateFor } from "../../../components/attention";
import {
  Badge,
  EmptyState,
  ErrorState,
  Field,
  LoadingSkeleton,
  MetricRow,
  Notice,
} from "../../../components/ui";
import { api, subscribeRealtime, type ApiReseller, type CatalogProduct, type CatalogVariant } from "../../../lib/api";
import { firstAllowedPriceEntry, isDailyDuration, sortedAllowedPriceEntries } from "../../../lib/durations";
import { depositSplit, splitNotice } from "../../../lib/deposits";
import { formatRupiah } from "../../../lib/format";
import { productBrandAsset, productLogoUrl } from "../../../lib/productBrandAssets";
import "./catalog.css";

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

export default function ResellerV2CatalogPage() {
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

  const loadCatalog = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadCatalog().catch(console.error);
    return subscribeRealtime(() => {
      loadCatalog().catch(console.error);
    });
  }, [loadCatalog]);

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return products
      .filter((product) => Number(product.stockCount || 0) > 0)
      .filter((product) => !keyword || [product.name, product.category, product.code, product.description].join(" ").toLowerCase().includes(keyword))
      .sort((a, b) => b.stockCount - a.stockCount);
  }, [products, query]);
  /* The two ways this page can be a dead end, both checked against `products`
     rather than `rows`: `rows` is what the current search matches, so a search
     with no hits would light the pill up every time somebody typed. A catalog
     nobody can afford and a catalog with nothing in it are not the same
     failure, but they are the same page being useless, which is what the
     count is for. */
  const noBalance = reseller && Number(reseller.deposit || 0) <= 0 ? 1 : 0;
  const catalogAttention = noBalance + (products.length ? 0 : 1);
  /* What the currently-selected package actually costs, split the way the
     server splits it. See `lib/deposits.ts` -- notably this does NOT gate
     checkout. */
  const balance = Number(reseller?.deposit || 0);
  const split = useMemo(
    () => depositSplit(balance, selection?.price || 0),
    [balance, selection?.price],
  );
  const paymentNotice = useMemo(
    () => splitNotice(split, formatRupiah),
    [split],
  );
  const totalStock = useMemo(() => rows.reduce((sum, product) => sum + Number(product.stockCount || 0), 0), [rows]);
  const totalVariants = useMemo(() => rows.reduce((sum, product) => sum + Number(product.variants.length || 0), 0), [rows]);

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
    void navigate(`/reseller/checkout?${params.toString()}`, {
      state: {
        checkoutSelection: selection,
        quantity: 1,
      },
    });
  }

  return (
    <ResellerShell
      title="Katalog Produk"
      description="Pilih produk ready, pilih varian dan durasi, lalu lanjut ke halaman checkout."
      loading={loading}
      balance={reseller ? formatRupiah(Number(reseller.deposit || 0)) : ""}
      attentionCount={catalogAttention}
      systemState={systemStateFor(catalogAttention, { error: Boolean(error), loading })}
    >
      {error ? <ErrorState message={error} onRetry={() => loadCatalog().catch(console.error)} /> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <MetricRow
        label="Ringkasan katalog"
        items={[
          {
            label: "Saldo Deposit",
            value: formatRupiah(Number(reseller?.deposit || 0)),
            icon: <WalletCards size={17} aria-hidden="true" />,
            tone: "info",
            loading,
          },
          {
            label: "Produk Ready",
            value: rows.length,
            icon: <Layers size={17} aria-hidden="true" />,
            tone: "info",
            hint: "Produk yang masih punya stok",
            loading,
          },
          {
            label: "Total Varian",
            value: totalVariants,
            icon: <Grid2X2 size={17} aria-hidden="true" />,
            tone: "warning",
            hint: "Pilihan varian yang bisa dipilih",
            loading,
          },
          {
            label: "Total Slot Stok",
            value: totalStock,
            icon: <Database size={17} aria-hidden="true" />,
            tone: "success",
            hint: "Akumulasi stok aktif di katalog",
            loading,
          },
        ]}
      />

      <section className="reseller-v2-panel reseller-v2-catalog-panel">
        <header className="reseller-v2-catalog-head">
          <div>
            <span>Katalog Produk</span>
            <h2>Produk Kavya - Data Asli</h2>
            <p>Card hanya menampilkan produk ready. Klik produk untuk melihat varian, lalu lanjut ke checkout resmi Kavya.</p>
          </div>
        </header>

        <div className="reseller-v2-catalog-toolbar">
          <Field label="Cari produk ready">
            <span className="reseller-v2-catalog-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari produk ready..."
              />
            </span>
          </Field>
          {!loading && rows.length ? (
            <p className="reseller-v2-catalog-count" role="status">
              Menampilkan <strong>{rows.length}</strong> produk ready untuk order cepat.
            </p>
          ) : null}
        </div>

        {loading ? (
          <div className="reseller-v2-catalog-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <article key={index} className="reseller-v2-catalog-skeleton">
                <LoadingSkeleton lines={4} />
              </article>
            ))}
          </div>
        ) : rows.length ? (
          <div className="reseller-v2-catalog-grid">
            {rows.map((product) => (
              <CatalogCard
                key={product.id}
                product={product}
                expanded={openProductId === product.id}
                selection={selection?.product.id === product.id ? selection : null}
                redirecting={redirecting}
                paymentNotice={paymentNotice}
                onToggle={() => chooseProduct(product.id)}
                onChooseVariant={(variantId) => chooseVariant(product, variantId)}
                onChooseDuration={chooseDuration}
                onChooseDurationMode={chooseDurationMode}
                onCheckout={() => openCheckout()}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Belum ada produk ready untuk ditampilkan."
            description="Card hanya menampilkan produk ready. Klik produk untuk melihat varian, lalu lanjut ke checkout resmi Kavya."
          />
        )}
      </section>

      {selection ? (
        <div className="reseller-v2-catalog-mobile-bar">
          <div>
            <p>{selection.product.name} - {selection.variant.name}</p>
            <span>{selection.duration} / {formatRupiah(selection.price)}</span>
            {/* The same split sentence the expanded card shows. Without it this
                bar was the one checkout control on a phone that said nothing
                about the shortfall -- and it is sticky, so it is the last thing
                on screen before the tap. */}
            {paymentNotice ? (
              <small className="reseller-v2-catalog-split">{paymentNotice}</small>
            ) : null}
          </div>
          <button
            type="button"
            onClick={openCheckout}
            disabled={redirecting}
          >
            {redirecting
              ? <LoaderCircle className="reseller-v2-catalog-spin" size={15} aria-hidden="true" />
              : <ShoppingCart size={15} aria-hidden="true" />}
            Checkout
          </button>
        </div>
      ) : null}
    </ResellerShell>
  );
}

function CatalogCard({
  product,
  expanded,
  selection,
  redirecting,
  paymentNotice,
  onToggle,
  onChooseVariant,
  onChooseDuration,
  onChooseDurationMode,
  onCheckout,
}: {
  product: CatalogProduct;
  expanded: boolean;
  selection: SelectedPackage | null;
  redirecting: boolean;
  paymentNotice: string;
  onToggle: () => void;
  onChooseVariant: (variantId: string) => void;
  onChooseDuration: (duration: string) => void;
  onChooseDurationMode: (mode: CatalogDurationMode) => void;
  onCheckout: () => void;
}) {
  const brand = productBrandAsset(product);
  const logoUrl = productLogoUrl(product);

  return (
    <article className={`reseller-v2-catalog-card${expanded ? " is-expanded" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded}>
        <div className={`reseller-v2-catalog-art bg-gradient-to-br ${brand.tone}`}>
          <Badge tone="success">Tersedia</Badge>
          <span className="reseller-v2-catalog-chip">{product.category || product.code}</span>
          <span className="reseller-v2-catalog-chip is-dark">{product.stockCount} stok</span>
          <span className="reseller-v2-catalog-chip is-toggle">
            {expanded
              ? <ChevronUp size={12} aria-hidden="true" />
              : <ChevronDown size={12} aria-hidden="true" />}
            {expanded ? "Tutup varian" : "Lihat varian"}
          </span>
          <div className="reseller-v2-catalog-mark">
            <span>{product.code || brand.label}</span>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${brand.label} logo`}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null}
          </div>
        </div>
        <div className="reseller-v2-catalog-body">
          <h3>{product.name}</h3>
          <p>{product.description}</p>
          <div className="reseller-v2-catalog-facts">
            <div>
              <span>Mulai dari</span>
              <strong>{formatRupiah(minPrice(product))}</strong>
            </div>
            <div>
              <span>{product.variants.length} varian</span>
              <span>{durationCount(product)} pilihan durasi</span>
            </div>
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="reseller-v2-catalog-variants">
          <p className="reseller-v2-catalog-variants-title">Pilih varian</p>
          <div className="reseller-v2-catalog-variant-list">
            {product.variants.map((variant) => {
              const first = firstDuration(variant);
              const selectedVariant = selection?.variant.id === variant.id;
              return (
                <button
                  key={variant.id}
                  type="button"
                  className={`reseller-v2-catalog-variant${selectedVariant ? " is-selected" : ""}`}
                  onClick={() => onChooseVariant(variant.id)}
                  disabled={variant.stockCount <= 0}
                >
                  <span className="reseller-v2-catalog-variant-mark" aria-hidden="true">
                    {selectedVariant
                      ? <Check size={13} />
                      : <Circle size={13} />}
                  </span>
                  <span className="reseller-v2-catalog-variant-copy">
                    <strong>
                      {variant.name} <em>{variant.code}</em>
                    </strong>
                    <small>{variant.stockCount} akun tersedia</small>
                  </span>
                  <span className="reseller-v2-catalog-variant-price">
                    {formatRupiah(first.price)}
                    <small>mulai</small>
                  </span>
                </button>
              );
            })}
          </div>

          {selection ? (
            <DurationPicker
              variant={selection.variant}
              duration={selection.duration}
              onChooseDuration={onChooseDuration}
              onChooseMode={onChooseDurationMode}
            />
          ) : (
            <button type="button" disabled className="reseller-v2-catalog-checkout is-pending">
              Pilih varian dulu
            </button>
          )}

          {selection ? (
            <>
              <button
                type="button"
                onClick={onCheckout}
                disabled={redirecting}
                className="reseller-v2-catalog-checkout"
              >
                {redirecting
                  ? <LoaderCircle className="reseller-v2-catalog-spin" size={16} aria-hidden="true" />
                  : <ShoppingCart size={16} aria-hidden="true" />}
                {redirecting ? "Membuka checkout..." : "Lanjut ke Checkout"}
              </button>
              {/* What the balance does and does not cover, said here rather than
                  discovered on the checkout page. The button above stays
                  enabled at Rp0 on purpose -- the server splits the payment
                  (`depositBreakdown` in `server/auto-order.js`), so an order
                  the balance cannot cover is still a sale. See
                  `lib/deposits.ts`. */}
              {paymentNotice ? (
                <p className="reseller-v2-catalog-split">{paymentNotice}</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function DurationPicker({
  variant,
  duration,
  onChooseDuration,
  onChooseMode,
}: {
  variant: CatalogVariant;
  duration: string;
  onChooseDuration: (duration: string) => void;
  onChooseMode: (mode: CatalogDurationMode) => void;
}) {
  const modeOptions = durationModeOptions(variant);
  const activeMode = durationModeOf(duration);
  const entries = durationEntriesForMode(variant, activeMode).slice(0, 9);
  const showModeSwitcher = modeOptions.monthly && modeOptions.daily;

  return (
    <>
      {showModeSwitcher ? (
        <div className="reseller-v2-catalog-duration-switch" role="group" aria-label="Pilih jenis durasi">
          {(["monthly", "daily"] as CatalogDurationMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChooseMode(mode)}
              aria-pressed={activeMode === mode}
              className={`reseller-v2-catalog-duration-mode${activeMode === mode ? " is-active" : ""}`}
            >
              {mode === "monthly" ? "Bulanan" : "Harian"}
            </button>
          ))}
        </div>
      ) : null}
      <div className="reseller-v2-catalog-duration-grid">
        {entries.map(([option, price]) => (
          <button
            key={option}
            type="button"
            onClick={() => onChooseDuration(option)}
            aria-pressed={duration === option}
            className={`reseller-v2-catalog-duration-option${duration === option ? " is-selected" : ""}`}
          >
            <span className="reseller-v2-catalog-duration-label">{option}</span>
            <span className="reseller-v2-catalog-duration-price">{formatRupiah(Number(price || 0))}</span>
          </button>
        ))}
      </div>
    </>
  );
}
