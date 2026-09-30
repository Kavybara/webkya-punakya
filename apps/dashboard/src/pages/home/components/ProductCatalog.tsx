import { useMemo, type PointerEvent, type ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion } from "framer-motion";
import { Archive, ArrowRight, Tv, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import type { CatalogProduct } from "../../../lib/api";
import { sortedAllowedPriceEntries } from "../../../lib/durations";
import { productBrandAsset, productLogoUrl } from "../../../lib/productBrandAssets";
import { formatRupiah } from "../../../lib/format";
import type { Catalog } from "../useCatalog";

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
      whileHover={reduceMotion ? undefined : { y: -4 }}
      className="home-product-card"
      data-product-shop
    >
      <motion.div className="home-spotlight" style={{ backgroundImage: spotlight, opacity }} aria-hidden="true" />
      <div className="relative">{children}</div>
    </motion.article>
  );
}

/**
 * The live catalogue.
 *
 * The data is a prop. This component used to open its own request and its own
 * `db-change` subscription, which was the second of the two the page was
 * making for the same payload -- the hero had one too -- so every visitor
 * paid for `GET /public/catalog?includeEmpty=1` twice and the two halves of
 * the page could disagree about what was in stock. The page owns it now.
 *
 * `id="produk"` is load-bearing beyond the anchor: `/store` and `/katalog`
 * both redirect here, so renaming it breaks two routes nobody would think to
 * check.
 */
export default function ProductCatalog({ catalog }: { catalog: Catalog }) {
  const reduceMotion = useReducedMotion();
  const { products, loading, error: loadError, reload } = catalog;

  const readyProducts = useMemo(
    () => products.filter((product) => product.isActive !== false).sort((a, b) => b.stockCount - a.stockCount).slice(0, 4),
    [products],
  );

  return (
    <section id="produk" className="border-b border-[var(--border)] bg-[var(--bg-raised)] py-12 md:py-16">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-6 md:px-8 lg:px-10">
        <header className="mb-7 max-w-2xl md:mb-9">
          <p className="text-label font-bold uppercase text-[var(--text-muted)]">Produk</p>
          <h2 className="mt-3 text-title font-extrabold leading-tight text-[var(--text-primary)]">Pilih layanan yang kamu butuhkan.</h2>
          <p className="mt-3 text-lede leading-6 text-[var(--text-secondary)]">Harga dan ketersediaan mengikuti katalog aktif Kavya.</p>
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
            <button type="button" onClick={reload} className="home-cta min-h-11 shrink-0 text-sm">Coba Lagi</button>
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
                     {isReady ? <Link to={resellerCatalogLoginPath} className="home-cta group mt-5 min-h-11 w-full text-sm">Lihat Paket<ArrowRight size={16} className="transition-transform group-hover:translate-x-[3px]" aria-hidden="true" /></Link> : <button type="button" disabled className="home-cta-ghost mt-5 min-h-11 w-full cursor-not-allowed text-sm text-[var(--text-muted)]">Stok Habis</button>}
                  </div>
                </SpotlightProductCard>
              );
            })}
          </motion.div>
        ) : (
          <div className="flex max-w-2xl items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-secondary)]"><Archive size={18} aria-hidden="true" /></span><div><h3 className="font-extrabold">Belum ada produk aktif</h3><p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">Produk akan muncul setelah diaktifkan dari dashboard.</p></div></div>
        )}

        <div className="mt-7"><Link to={resellerCatalogLoginPath} className="home-cta-ghost group min-h-11 text-sm">Lihat semua produk<ArrowRight size={16} className="transition-transform group-hover:translate-x-[3px]" aria-hidden="true" /></Link></div>
      </div>
    </section>
  );
}
