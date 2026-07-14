import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, subscribeRealtime, type CatalogProduct } from "../../../lib/api";
import { sortedAllowedPriceEntries } from "../../../lib/durations";
import { productBrandAsset, productLogoUrl } from "../../../lib/productBrandAssets";

function formatPrice(price: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(price)
    .replace("IDR", "Rp");
}

function minPrice(product: CatalogProduct) {
  const prices = product.variants
    .flatMap((variant) => sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).map(([, price]) => Number(price)))
    .filter((price) => Number.isFinite(price));
  return prices.length ? Math.min(...prices) : 0;
}

function durationCount(product: CatalogProduct) {
  return product.variants.reduce((total, variant) => total + sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).length, 0);
}

const resellerCatalogLoginPath = "/login?next=/reseller/catalog";

export default function ProductCatalog() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadCatalog = async () => {
      try {
        const catalog = await api.catalogAll();
        if (mounted) setProducts(catalog);
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
  }, []);

  const readyProducts = useMemo(
    () =>
      products
        .filter((product) => product.isActive !== false)
        .sort((a, b) => b.stockCount - a.stockCount)
        .slice(0, 6),
    [products],
  );

  return (
    <section id="produk" className="relative overflow-hidden bg-kavya-cream py-10 md:py-14 lg:py-20">
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-kavya-sand/40 to-transparent" />
      <div
        className="pointer-events-none absolute right-0 top-20 h-72 w-72 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #C4A882 0%, transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute bottom-40 left-0 h-60 w-60 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #B5A899 0%, transparent 70%)" }}
      />

      <div className="relative z-10 w-full px-4 md:px-8 lg:px-12">
        <div className="mb-6 text-center md:mb-8">
          <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-kavya-sand/30 bg-white/80 px-4 py-1.5 text-xs font-semibold text-kavya-brown shadow-sm md:text-sm">
            <i className="ri-flashlight-line text-kavya-red" />
            Katalog Produk
          </span>
          <h2 className="mb-3 text-2xl font-extrabold tracking-tight text-kavya-dark md:mb-4 md:text-3xl lg:text-4xl">
            Produk Kavya - Data Asli
          </h2>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-kavya-brown md:text-base">
            Produk di bawah ini mengikuti produk, varian, harga, dan stok asli dari dashboard Kavya.
          </p>
        </div>

        {loading ? (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-[520px] animate-pulse rounded-2xl border border-kavya-sand/30 bg-white" />
            ))}
          </div>
        ) : readyProducts.length ? (
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3">
            {readyProducts.map((product) => {
              const asset = productBrandAsset(product);
              const logo = productLogoUrl(product);
              const price = minPrice(product);
              const isReady = product.stockCount > 0;

              return (
                <div
                  key={product.id}
                  className="group overflow-hidden rounded-2xl border border-kavya-sand/30 bg-white [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:520px] transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-kavya-gold/30 hover:shadow-lg"
                  data-product-shop
                >
                  <div className={`relative aspect-[4/3] overflow-hidden bg-gradient-to-br ${asset.tone}`}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(255,255,255,0.18),transparent_25%),radial-gradient(circle_at_25%_80%,rgba(231,76,60,0.26),transparent_35%)]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white/10">
                        {logo ? (
                          <img src={logo} alt={`${asset.label} logo`} className="h-14 w-14 object-contain" loading="lazy" />
                        ) : (
                          <i className="ri-tv-line text-5xl text-white/80" />
                        )}
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-kavya-dark/55 to-transparent opacity-80" />
                    <div className="absolute right-3 top-3">
                        <span className="rounded-full border border-kavya-sand/20 bg-white/95 px-3 py-1.5 text-xs font-semibold text-kavya-dark shadow-sm">
                        {product.category || asset.label}
                      </span>
                    </div>
                    <div className="absolute left-3 top-3">
                      {isReady ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                          Tersedia
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-kavya-charcoal/90 px-3 py-1.5 text-xs font-bold text-kavya-cream shadow-sm">
                          <i className="ri-time-line text-kavya-sand" />
                          Stok Habis
                        </span>
                      )}
                    </div>
                    <div className="absolute bottom-3 left-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-kavya-dark/80 px-3 py-1.5 text-xs font-medium text-kavya-cream">
                        <i className="ri-archive-line text-kavya-gold" />
                        {product.stockCount} stok
                      </span>
                    </div>
                  </div>

                  <div className="p-4 md:p-5">
                    <h3 className="mb-1.5 text-base font-bold text-kavya-dark transition-colors group-hover:text-kavya-espresso md:text-lg">
                      {product.name}
                    </h3>
                    <p className="mb-4 line-clamp-2 min-h-[40px] text-xs leading-relaxed text-kavya-brown md:text-sm">
                      {product.description}
                    </p>
                    <div className="mb-3 flex items-baseline gap-1.5">
                      <span className="text-xl font-extrabold text-kavya-dark md:text-2xl">
                        {price ? formatPrice(price) : "Harga belum diatur"}
                      </span>
                      {price ? <span className="text-xs font-medium text-kavya-brown md:text-sm">mulai dari</span> : null}
                    </div>
                    <div className="mb-5 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-kavya-brown">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-kavya-gold/20">
                          <i className="ri-check-line text-xs text-kavya-accent" />
                        </span>
                        {product.variants.length} varian
                      </span>
                      <span className="text-xs font-medium text-kavya-brown">{durationCount(product)} pilihan durasi</span>
                    </div>
                    {isReady ? (
                      <Link
                        to={resellerCatalogLoginPath}
                        className="group/btn flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-kavya-red py-3 text-sm font-semibold text-white shadow-md transition-colors duration-300 hover:bg-red-700"
                      >
                        Order Sekarang
                        <i className="ri-arrow-right-line text-sm transition-transform group-hover/btn:translate-x-1" />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="flex w-full cursor-not-allowed items-center justify-center rounded-xl border border-kavya-sand/40 bg-kavya-sand/30 py-3 text-sm font-semibold text-kavya-brown"
                      >
                        Stok Habis
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mx-auto max-w-xl rounded-2xl border border-kavya-sand/30 bg-white p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-kavya-linen text-kavya-accent">
              <i className="ri-archive-line text-2xl" />
            </div>
            <h3 className="text-lg font-extrabold text-kavya-dark">Belum ada produk aktif</h3>
            <p className="mt-2 text-sm text-kavya-brown">Aktifkan produk dari dashboard supaya muncul di homepage.</p>
          </div>
        )}

        <div className="mt-10 text-center md:mt-12">
          <Link
            to={resellerCatalogLoginPath}
            className="group inline-flex items-center gap-2.5 rounded-2xl border-2 border-kavya-sand/50 bg-white px-7 py-3 text-sm font-semibold text-kavya-dark shadow-sm transition-[transform,border-color,background-color,box-shadow] hover:-translate-y-0.5 hover:border-kavya-sand hover:bg-kavya-cream hover:shadow-md"
          >
            <span>Lihat Semua Produk</span>
            <i className="ri-arrow-right-line text-sm transition-transform group-hover:translate-x-1" />
            <span className="ml-1 hidden items-center rounded-md bg-kavya-linen px-2 py-0.5 text-[10px] font-bold text-kavya-brown sm:inline-flex">
              {products.length} produk
            </span>
          </Link>
          <p className="mt-3 text-xs text-kavya-brown/60">Mengikuti data produk yang aktif di dashboard</p>
        </div>
      </div>
    </section>
  );
}
