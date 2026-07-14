import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PublicNavbar from "../../components/feature/PublicNavbar";
import { api, subscribeRealtime, type CatalogProduct } from "../../lib/api";
import { sortedAllowedPriceEntries } from "../../lib/durations";
import { productBrandAsset, productLogoUrl } from "../../lib/productBrandAssets";

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

export default function CatalogPage() {
  const [activeCategory, setActiveCategory] = useState("Semua");
  const [filterStatus, setFilterStatus] = useState("Semua");
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

  const categories = useMemo(
    () => ["Semua", ...Array.from(new Set(products.map((product) => product.category).filter(Boolean)))],
    [products],
  );

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchCat = activeCategory === "Semua" || product.category === activeCategory;
        const matchStatus =
          filterStatus === "Semua" ? true : filterStatus === "Ready" ? product.stockCount > 0 : product.stockCount === 0;
        return product.isActive !== false && matchCat && matchStatus;
      }),
    [activeCategory, filterStatus, products],
  );

  return (
    <div className="min-h-screen bg-kavya-cream pb-16 pt-24 font-sans">
      <PublicNavbar />
      <div className="mx-auto w-full max-w-7xl px-4 md:px-8 lg:px-12">
        <div className="mb-6 flex items-center gap-2 text-sm text-kavya-brown">
          <Link to="/" className="transition-colors hover:text-kavya-dark">
            Beranda
          </Link>
          <i className="ri-arrow-right-s-line text-kavya-sand" />
          <span className="font-semibold text-kavya-dark">Katalog Produk</span>
        </div>

        <div className="mb-10">
          <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-kavya-sand/30 bg-white/80 px-4 py-1.5 text-xs font-semibold text-kavya-brown shadow-sm">
            <i className="ri-store-line text-kavya-accent" />
            Katalog Kavya
          </span>
          <h1 className="mb-3 text-3xl font-extrabold text-kavya-dark md:text-4xl">Semua Produk Kavya</h1>
          <p className="max-w-xl text-sm text-kavya-brown md:text-base">
            Data di halaman ini mengikuti produk, varian, harga, dan stok aktif dari dashboard Kavya.
          </p>
        </div>

        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`cursor-pointer whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition-all md:text-sm ${
                  activeCategory === cat
                    ? "border-kavya-dark bg-kavya-dark text-kavya-cream shadow-lg"
                    : "border-kavya-sand/40 bg-white/80 text-kavya-charcoal hover:border-kavya-sand/60 hover:bg-white hover:shadow-md"
                }`}
                type="button"
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {["Semua", "Ready", "Habis"].map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`cursor-pointer whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition-all md:text-sm ${
                  filterStatus === status
                    ? "border-kavya-gold/50 bg-kavya-gold/20 text-kavya-dark"
                    : "border-kavya-sand/30 bg-white/60 text-kavya-brown hover:bg-white"
                }`}
                type="button"
              >
                {status === "Ready" && <i className="ri-check-double-line mr-1" />}
                {status === "Habis" && <i className="ri-close-circle-line mr-1" />}
                {status}
              </button>
            ))}
          </div>
        </div>

        <p className="mb-4 text-xs text-kavya-brown">
          Menampilkan {filteredProducts.length} produk
          {activeCategory !== "Semua" && ` dalam kategori ${activeCategory}`}
          {filterStatus !== "Semua" && ` dengan status ${filterStatus}`}
        </p>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-[420px] animate-pulse rounded-2xl border border-kavya-sand/30 bg-white" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((product) => {
              const isReady = product.stockCount > 0;
              const asset = productBrandAsset(product);
              const logo = productLogoUrl(product);
              const price = minPrice(product);

              return (
                <div
                  key={product.id}
                  className={`group overflow-hidden rounded-2xl border bg-white [contain:layout_paint_style] [content-visibility:auto] [contain-intrinsic-size:420px] transition-[transform,border-color,box-shadow,opacity] duration-300 hover:-translate-y-1 hover:shadow-lg ${
                    isReady
                      ? "border-kavya-sand/30 hover:border-kavya-gold/30"
                      : "border-kavya-sand/20 opacity-70 hover:opacity-90"
                  }`}
                >
                  <div className={`relative aspect-[4/3] overflow-hidden bg-gradient-to-br ${asset.tone}`}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(255,255,255,0.18),transparent_25%),radial-gradient(circle_at_25%_80%,rgba(231,76,60,0.26),transparent_35%)]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/10">
                        {logo ? (
                          <img src={logo} alt={`${asset.label} logo`} className="h-12 w-12 object-contain" loading="lazy" />
                        ) : (
                          <i className="ri-tv-line text-4xl text-white/80" />
                        )}
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-kavya-dark/55 to-transparent opacity-80" />
                    <div className="absolute left-3 top-3">
                      {isReady ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                          Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-kavya-charcoal/80 px-3 py-1.5 text-xs font-bold text-kavya-cream shadow-sm">
                          <i className="ri-time-line text-kavya-sand" />
                          Stok Habis
                        </span>
                      )}
                    </div>
                    <div className="absolute right-3 top-3">
                      <span className="rounded-full border border-kavya-sand/20 bg-white/95 px-3 py-1.5 text-xs font-semibold text-kavya-dark shadow-sm">
                        {product.category || asset.label}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 md:p-5">
                    <h3 className="mb-1.5 text-base font-bold text-kavya-dark">{product.name}</h3>
                    <p className="mb-4 line-clamp-2 min-h-[40px] text-xs leading-relaxed text-kavya-brown md:text-sm">
                      {product.description}
                    </p>
                    <div className="mb-3 flex items-baseline gap-1.5">
                      <span className="text-xl font-extrabold text-kavya-dark md:text-2xl">
                        {price ? formatPrice(price) : "Harga belum diatur"}
                      </span>
                      {price ? <span className="text-xs font-medium text-kavya-brown">mulai dari</span> : null}
                    </div>
                    {isReady ? (
                      <>
                        <div className="mb-4 flex items-center gap-1.5">
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-kavya-gold/20">
                            <i className="ri-archive-line text-xs text-kavya-accent" />
                          </div>
                          <span className="text-xs font-medium text-kavya-brown">{product.stockCount} stok tersedia</span>
                        </div>
                        <Link
                          to="/products"
                          className="block w-full cursor-pointer rounded-xl bg-kavya-red py-3 text-center text-sm font-semibold text-white shadow-md transition-colors hover:bg-red-700"
                        >
                          Order Sekarang
                        </Link>
                      </>
                    ) : (
                      <>
                        <div className="mb-4 flex items-center gap-1.5">
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-kavya-sand/30">
                            <i className="ri-time-line text-xs text-kavya-brown" />
                          </div>
                          <span className="text-xs font-medium text-kavya-brown">Belum ada akun tersedia</span>
                        </div>
                        <button
                          className="w-full cursor-not-allowed rounded-xl border border-kavya-sand/40 bg-kavya-sand/30 py-3 text-sm font-semibold text-kavya-brown"
                          disabled
                          type="button"
                        >
                          Stok Habis
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && filteredProducts.length === 0 && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-kavya-linen">
              <i className="ri-search-line text-2xl text-kavya-accent" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-kavya-dark">Produk tidak ditemukan</h3>
            <p className="text-sm text-kavya-brown">Coba ubah filter kategori atau status.</p>
          </div>
        )}
      </div>
    </div>
  );
}
