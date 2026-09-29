import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion } from "framer-motion";
import { Archive, ArrowRight, Tv, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { api, subscribeRealtime, type CatalogProduct } from "../../../lib/api";
import { sortedAllowedPriceEntries } from "../../../lib/durations";
import { productBrandAsset, productLogoUrl } from "../../../lib/productBrandAssets";
import { formatRupiah } from "../../../lib/format";

function minPrice(product: CatalogProduct) {
  const prices = product.variants
    .flatMap((variant) => sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).map(([, price]) => Number(price)))
    .filter((price) => Number.isFinite(price));
  return prices.length ? Math.min(...prices) : 0;
}

const resellerCatalogLoginPath = "/login?next=/reseller-v2/catalog";
const catalogGridVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };
const productCardVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

function SpotlightProductCard({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(-300);
  const y = useMotionValue(-300);
  const opacity = useMotionValue(0);
  const spotlight = useMotionTemplate`radial-gradient(240px circle at ${x}px ${y}px, color-mix(in srgb, var(--accent-cyan) 12%, transparent), transparent 72%)`;

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (reduceMotion || event.pointerType === "touch" || window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
    opacity.set(1);
  };

  return (
    <motion.article
      variants={productCardVariants}
      onPointerMove={onPointerMove}
      onPointerLeave={() => opacity.set(0)}
      whileHover={reduceMotion ? undefined : { y: -4, borderColor: "var(--border-strong)" }}
      className="relative overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:360px]"
      data-product-shop
    >
      <motion.div className="pointer-events-none absolute inset-0" style={{ backgroundImage: spotlight, opacity }} aria-hidden="true" />
      <div className="relative">{children}</div>
    </motion.article>
  );
}

export default function ProductCatalog() {
  const reduceMotion = useReducedMotion();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    const loadCatalog = async () => {
      try {
        const catalog = await api.catalogAll();
        if (mounted) {
          setProducts(catalog);
          setLoadError("");
        }
      } catch {
        if (mounted) setLoadError("Katalog belum dapat dimuat. Silakan coba lagi.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadCatalog();
    const unsubscribe = subscribeRealtime(() => void loadCatalog());
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [refreshKey]);

  const readyProducts = useMemo(
    () => products.filter((product) => product.isActive !== false).sort((a, b) => b.stockCount - a.stockCount).slice(0, 4),
    [products],
  );

  return (
    <section id="produk" className="border-b border-[var(--border)] bg-[var(--bg-raised)] py-12 md:py-16">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 md:px-8 lg:px-10">
        <header className="mb-7 max-w-2xl md:mb-9">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">Produk</p>
          <h2 className="mt-3 text-2xl font-extrabold leading-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">Pilih layanan yang kamu butuhkan.</h2>
          <p className="mt-3 text-base leading-6 text-[var(--text-secondary)]">Harga dan ketersediaan mengikuti katalog aktif Kavya.</p>
        </header>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Memuat katalog produk">
            <span className="sr-only">Memuat katalog produk</span>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="relative h-[320px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <motion.div
                  className="absolute inset-y-0 -left-full w-full"
                  style={{ background: "linear-gradient(90deg, transparent, var(--fx-shimmer), transparent)" }}
                  animate={reduceMotion ? undefined : { x: ["0%", "200%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear", delay: index * 0.1 }}
                  aria-hidden="true"
                />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="flex max-w-2xl flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-secondary)]"><WifiOff size={18} aria-hidden="true" /></span><div><h3 className="font-extrabold text-[var(--text-primary)]">Katalog belum tersedia</h3><p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{loadError}</p></div></div>
            <button type="button" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1); }} className="min-h-11 shrink-0 rounded-full bg-[var(--text-primary)] px-5 text-sm font-extrabold text-[var(--bg-canvas)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Coba Lagi</button>
          </div>
        ) : readyProducts.length ? (
          <motion.div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" variants={catalogGridVariants} initial={reduceMotion ? false : "hidden"} animate="visible">
            {readyProducts.map((product) => {
              const asset = productBrandAsset(product);
              const logo = productLogoUrl(product);
              const price = minPrice(product);
              const isReady = product.stockCount > 0;
              return (
                <SpotlightProductCard key={product.id}>
                   <div className="relative flex aspect-[16/8.5] items-center justify-center overflow-hidden border-b border-[var(--border)] bg-[var(--bg-raised)]">
                    <div className="absolute left-[18%] top-[14%] h-24 w-24 rounded-full bg-[var(--accent-violet)]/10 blur-3xl" aria-hidden="true" />
                    <div className="absolute bottom-[10%] right-[12%] h-24 w-24 rounded-full bg-[var(--accent-cyan)]/10 blur-3xl" aria-hidden="true" />
                    <div className="relative flex h-20 w-20 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                      {logo ? <img src={logo} alt={`Logo ${asset.label}`} width="52" height="52" className="h-12 w-12 object-contain" loading="lazy" decoding="async" /> : <Tv size={30} className="text-[var(--text-secondary)]" aria-hidden="true" />}
                    </div>
                    <span className="absolute right-3 top-3 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[10px] font-bold text-[var(--text-secondary)]">{product.category || asset.label}</span>
                    <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[10px] font-bold text-[var(--text-secondary)]"><span className={`h-1.5 w-1.5 rounded-full ${isReady ? "bg-[var(--accent-cyan)]" : "bg-[var(--text-muted)]"}`} />{isReady ? `${product.stockCount} stok` : "Stok habis"}</span>
                  </div>
                   <div className="p-5">
                     <h3 className="text-lg font-extrabold text-[var(--text-primary)]">{product.name}</h3>
                     <div className="mt-5"><p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Mulai dari</p><p className="mt-1 text-xl font-black text-[var(--text-primary)]">{price ? formatRupiah(price) : "Belum diatur"}</p></div>
                     {isReady ? <Link to={resellerCatalogLoginPath} className="group mt-5 flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--text-primary)] text-sm font-extrabold text-[var(--bg-canvas)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Lihat Paket<ArrowRight size={16} className="transition-transform group-hover:translate-x-[3px]" aria-hidden="true" /></Link> : <button type="button" disabled className="mt-5 flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-full border border-[var(--border)] text-sm font-bold text-[var(--text-muted)]">Stok Habis</button>}
                  </div>
                </SpotlightProductCard>
              );
            })}
          </motion.div>
        ) : (
          <div className="flex max-w-2xl items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-secondary)]"><Archive size={18} aria-hidden="true" /></span><div><h3 className="font-extrabold">Belum ada produk aktif</h3><p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">Produk akan muncul setelah diaktifkan dari dashboard.</p></div></div>
        )}

        <div className="mt-7"><Link to={resellerCatalogLoginPath} className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] px-5 text-sm font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Lihat semua produk<ArrowRight size={16} className="transition-transform group-hover:translate-x-[3px]" aria-hidden="true" /></Link></div>
      </div>
    </section>
  );
}
