import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import {
  motion,
  MotionConfig,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
} from "framer-motion";
import { Link } from "react-router-dom";
import PublicNavbar from "../../components/feature/PublicNavbar";
import { api, type CatalogProduct } from "../../lib/api";
import { productBrandAsset, productLogoUrl } from "../../lib/productBrandAssets";
import { ownerWhatsappLink } from "../../lib/ownerContact";
import ProductCatalog from "./components/ProductCatalog";

const whatsappUrl = ownerWhatsappLink();
const revealViewport = { once: true, amount: 0.16 };
const revealTransition = { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const };
const revealItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: revealTransition },
};
const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div className={className} initial={reduceMotion ? false : "hidden"} whileInView="visible" viewport={revealViewport} variants={stagger}>
      {children}
    </motion.div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="mb-8 max-w-2xl md:mb-10">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-extrabold leading-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)] sm:text-base">{description}</p>
    </header>
  );
}

function CatalogPreview({ products, loading }: { products: CatalogProduct[]; loading: boolean }) {
  const visibleProducts = products
    .filter((product) => product.isActive !== false)
    .sort((left, right) => right.stockCount - left.stockCount)
    .slice(0, 4);
  return (
    <div className="mx-auto w-full max-w-[620px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-2xl shadow-black/30">
      <div className="flex min-h-12 items-center justify-between border-b border-[var(--border)] px-4">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">Katalog aktif</p><p className="mt-0.5 text-sm font-bold text-[var(--text-primary)]">Pilihan terlaris hari ini</p></div>
        <a href="#produk" className="text-xs font-bold text-[var(--accent-cyan)] hover:text-white">Lihat semua</a>
      </div>
      <div className="grid grid-cols-2">
        {(loading ? Array.from({ length: 4 }) : visibleProducts).map((item, index) => {
          if (!item) return <div key={index} className="h-[118px] animate-pulse border-b border-r border-[var(--border)] bg-[var(--bg-raised)]" />;
          const product = item as CatalogProduct;
          const asset = productBrandAsset(product);
          const logo = productLogoUrl(product);
          return (
            <a key={product.id} href="#produk" className="group flex min-h-[118px] min-w-0 flex-col justify-between border-b border-r border-[var(--border)] p-4 transition-colors hover:bg-[var(--surface-hover)]">
              <span className="flex items-start justify-between gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-md border border-[var(--border)] bg-[var(--bg-raised)]">
                  {logo ? <img src={logo} alt="" width="24" height="24" className="h-6 w-6 object-contain" /> : <i className="ri-tv-line text-[var(--text-secondary)]" />}
                </span>
                <span className={`mt-1 h-2 w-2 rounded-full ${product.stockCount > 0 ? "bg-[var(--accent-cyan)]" : "bg-[var(--text-muted)]"}`} aria-label={product.stockCount > 0 ? "Stok tersedia" : "Stok habis"} />
              </span>
              <span className="min-w-0"><strong className="block truncate text-sm text-[var(--text-primary)]">{product.name}</strong><small className="mt-1 block truncate text-[11px] text-[var(--text-muted)]">{product.category || asset.label} / {product.stockCount} stok</small></span>
            </a>
          );
        })}
      </div>
      {!loading && !visibleProducts.length ? <p className="p-6 text-center text-sm text-[var(--text-secondary)]">Katalog sedang diperbarui.</p> : null}
    </div>
  );
}

function HeroSection() {
  const reduceMotion = useReducedMotion();
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void api.catalogAll()
      .then((catalog) => {
        if (!mounted) return;
        const categories = Array.from(new Set(catalog
          .filter((product) => product.isActive !== false)
          .map((product) => product.category?.trim())
          .filter((category): category is string => Boolean(category))))
          .slice(0, 6);
        setProducts(catalog);
        setAvailableCategories(categories);
      })
      .catch(() => {
        if (mounted) setAvailableCategories([]);
      })
      .finally(() => {
        if (mounted) setCategoriesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section
      id="beranda"
      className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--bg-canvas)] pt-16"
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.022] [background-image:radial-gradient(var(--fx-grid-dot)_1px,transparent_1px)] [background-size:34px_34px]" aria-hidden="true" />
      <div className="relative flex min-h-[calc(78svh-4rem)] flex-col">
        <div className="flex w-full flex-1 items-center px-6 py-8 sm:px-10 md:py-10 lg:px-12 xl:px-16">
          <div className="mx-auto grid w-full max-w-[1240px] items-center gap-10 md:grid-cols-[minmax(0,.8fr)_minmax(360px,1.2fr)] md:gap-x-12">
            <motion.div initial={reduceMotion ? false : "hidden"} animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.06 } } }} className="relative z-10 max-w-[520px]">
              <motion.h1 variants={revealItem} className="max-w-[520px] text-5xl font-semibold leading-[0.98] text-[var(--text-primary)] sm:text-6xl lg:text-7xl">
                Kavya
              </motion.h1>
              <motion.p variants={revealItem} className="mt-6 max-w-[500px] text-[17px] font-normal leading-[1.6] text-[var(--text-secondary)] lg:text-lg">
                Produk digital dengan stok, pembayaran, dan pengiriman yang tersusun dalam satu alur.
              </motion.p>
              <motion.div variants={revealItem} className="mt-8 flex flex-col gap-3 min-[430px]:flex-row">
                <motion.a href="#produk" whileHover={reduceMotion ? undefined : { y: -2 }} whileTap={reduceMotion ? undefined : { y: 1, scale: 0.985 }} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--text-primary)] px-6 text-[15px] font-extrabold text-[var(--bg-canvas)] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                  Lihat Produk
                </motion.a>
                <Link to="/order-tracking" className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--border)] px-6 text-[15px] font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                  Lacak Pesanan
                </Link>
              </motion.div>
            </motion.div>

            <motion.div initial={reduceMotion ? false : { opacity: 0, scale: 0.96, filter: "blur(7px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ duration: 0.68, delay: 0.14, ease: [0.22, 1, 0.36, 1] }} className="md:min-w-0">
              <CatalogPreview products={products} loading={categoriesLoading} />
            </motion.div>
          </div>
        </div>

        {categoriesLoading || availableCategories.length ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.58, ease: [0.22, 1, 0.36, 1] }}
            className="border-y border-[var(--border)] bg-[var(--surface-glass-strong)]"
          >
            <div className="px-6 sm:px-10 lg:px-12 xl:px-16">
              <div className="mx-auto grid min-h-[72px] max-w-[1360px] grid-cols-[1fr_auto] items-center gap-x-5 gap-y-3 py-4 md:grid-cols-[180px_minmax(0,1fr)_auto] md:py-0">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-primary)]">Layanan tersedia</span>
                <div
                  aria-label={categoriesLoading ? "Kategori layanan sedang dimuat" : "Kategori layanan tersedia"}
                  className="order-3 col-span-2 flex min-w-0 items-center gap-7 overflow-x-auto py-1 text-xs font-semibold uppercase tracking-[0.13em] text-[var(--text-muted)] [scrollbar-width:none] md:order-none md:col-span-1 md:justify-evenly md:gap-5 [&::-webkit-scrollbar]:hidden"
                >
                  {categoriesLoading ? (
                    Array.from({ length: 4 }, (_, index) => (
                      <span key={index} className="h-3 w-20 shrink-0 rounded-full bg-[var(--border-strong)] motion-safe:animate-pulse" aria-hidden="true" />
                    ))
                  ) : (
                    availableCategories.map((category) => (
                      <a key={category} href="#produk" className="shrink-0 py-1 transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{category}</a>
                    ))
                  )}
                </div>
                <a href="#produk" className="group inline-flex min-h-11 shrink-0 items-center justify-end gap-1.5 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                  Lihat katalog produk
                  <i className="ri-arrow-right-line text-base transition-transform group-hover:translate-x-[3px]" aria-hidden="true" />
                </a>
              </div>
            </div>
          </motion.div>
        ) : null}
      </div>
    </section>
  );
}

function SpotlightCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(-300);
  const y = useMotionValue(-300);
  const opacity = useMotionValue(0);
  const spotlight = useMotionTemplate`radial-gradient(220px circle at ${x}px ${y}px, color-mix(in srgb, var(--accent-violet) 10%, transparent), transparent 74%)`;

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (reduceMotion || event.pointerType === "touch" || window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
    opacity.set(1);
  };

  return (
    <motion.article onPointerMove={onPointerMove} onPointerLeave={() => opacity.set(0)} whileHover={reduceMotion ? undefined : { y: -2, borderColor: "var(--border-strong)" }} className={`relative overflow-hidden rounded-[10px] border border-[rgba(255,255,255,0.11)] bg-[#080808] ${className}`}>
      <motion.div className="pointer-events-none absolute inset-0" style={{ backgroundImage: spotlight, opacity }} aria-hidden="true" />
      <div className="relative h-full">{children}</div>
    </motion.article>
  );
}

function PreviewLabel() {
  return <span className="inline-flex rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Preview antarmuka</span>;
}

function BentoSection() {
  const reduceMotion = useReducedMotion();
  const orderStages = [
    { label: "Pembayaran", detail: "Pembayaran diterima", tone: "var(--accent-violet)" },
    { label: "Diproses", detail: "Pesanan sedang disiapkan", tone: "var(--accent-cyan)" },
    { label: "Selesai", detail: "Pesanan siap digunakan", tone: "var(--text-primary)" },
  ];
  const stockRows = [
    { label: "Produk digital", width: "88%" },
    { label: "Paket aktif", width: "68%" },
    { label: "Katalog", width: "48%" },
  ];

  return (
    <section id="fitur" className="border-b border-[var(--border)] bg-[var(--bg-canvas)] py-14 md:py-20">
      <Reveal className="mx-auto max-w-[1360px] px-4 sm:px-6 md:px-8 lg:px-10">
        <motion.header variants={revealItem} className="mb-10 max-w-3xl md:mb-14">
          <h2 className="text-3xl font-medium leading-tight tracking-[-0.035em] text-[var(--text-primary)] sm:text-4xl lg:text-5xl">Setiap tahap, tetap terhubung.</h2>
          <p className="mt-4 text-base leading-7 text-[var(--text-secondary)] sm:text-lg">Pesanan, pembayaran, dan ketersediaan dalam satu alur.</p>
        </motion.header>

        <motion.div variants={stagger} className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:grid-rows-2 lg:gap-5">
          <motion.div variants={revealItem} className="contents">
            <SpotlightCard className="flex min-h-[440px] flex-col sm:min-h-[480px] lg:col-span-7 lg:row-span-2 lg:min-h-[560px]">
              <div className="flex min-h-0 flex-1 flex-col p-6 sm:p-8">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Status Pesanan</p>
                  <PreviewLabel />
                </div>

                <div className="relative mt-9 flex flex-1 flex-col justify-center sm:mt-12">
                  <motion.div
                    aria-hidden="true"
                    className="absolute bottom-8 left-[17px] top-8 w-px origin-top bg-[linear-gradient(to_bottom,var(--accent-violet),var(--accent-cyan),rgba(255,255,255,0.35))]"
                    initial={reduceMotion ? false : { scaleY: 0, opacity: 0 }}
                    whileInView={{ scaleY: 1, opacity: 1 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
                  />
                  <ol className="relative space-y-8 sm:space-y-10">
                    {orderStages.map((stage, index) => (
                      <motion.li
                        key={stage.label}
                        className="grid grid-cols-[36px_1fr_auto] items-center gap-4 sm:gap-5"
                        initial={reduceMotion ? false : { opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true, amount: 0.7 }}
                        transition={{ duration: 0.45, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <span className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(255,255,255,0.16)] bg-[#0d0d0f]" aria-hidden="true">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.tone }} />
                        </span>
                        <div>
                          <p className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">{stage.label}</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)] sm:text-base">{stage.detail}</p>
                        </div>
                        <span className="hidden text-sm font-medium text-[var(--text-muted)] sm:block">0{index + 1}</span>
                      </motion.li>
                    ))}
                  </ol>
                </div>
              </div>
              <div className="border-t border-[var(--border)] px-6 py-6 sm:px-8">
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text-primary)] sm:text-2xl">Status pesanan tetap jelas</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)] sm:text-base">Pantau proses dan riwayat pesanan dari satu tempat.</p>
              </div>
            </SpotlightCard>

            <SpotlightCard className="flex min-h-[280px] flex-col lg:col-span-5">
              <div className="flex min-h-0 flex-1 items-center justify-between gap-5 p-6 sm:p-7">
                <div>
                  <div className="flex items-center gap-3">
                    <motion.span
                      className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--accent-cyan)_36%,transparent)] bg-[color-mix(in_srgb,var(--accent-cyan)_8%,transparent)] text-2xl text-[var(--accent-cyan)]"
                      initial={reduceMotion ? false : { opacity: 0.45, scale: 0.86 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true, amount: 0.8 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <i className="ri-check-line" aria-hidden="true" />
                    </motion.span>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Pembayaran</span>
                  </div>
                  <p className="mt-6 text-2xl font-semibold tracking-[-0.025em] text-[var(--text-primary)] sm:text-3xl">Terverifikasi</p>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">Nominal pembayaran: Rp --</p>
                </div>
                <PreviewLabel />
              </div>
              <div className="border-t border-[var(--border)] px-6 py-5 sm:px-7">
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text-primary)]">Konfirmasi pembayaran</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Status pembayaran terhubung langsung dengan pesanan.</p>
              </div>
            </SpotlightCard>

            <SpotlightCard className="flex min-h-[280px] flex-col lg:col-span-5">
              <div className="flex min-h-0 flex-1 flex-col justify-center p-6 sm:p-7">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Produk &amp; Stok</p>
                  <PreviewLabel />
                </div>
                <div className="mt-6 space-y-4">
                  {stockRows.map((row, index) => (
                    <div key={row.label} className="grid grid-cols-[112px_1fr] items-center gap-4 sm:grid-cols-[128px_1fr]">
                      <span className="text-sm font-medium text-[var(--text-secondary)]">{row.label}</span>
                      <div className="h-2.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                        <motion.span
                          className="block h-full origin-left rounded-full bg-[var(--accent-cyan)]"
                          style={{ width: row.width, opacity: 0.82 - index * 0.12 }}
                          initial={reduceMotion ? false : { scaleX: 0 }}
                          whileInView={{ scaleX: 1 }}
                          viewport={{ once: true, amount: 0.8 }}
                          transition={{ duration: 0.65, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-[var(--border)] px-6 py-5 sm:px-7">
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-[var(--text-primary)]">Ketersediaan mudah dilihat</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Produk dan paket aktif tersusun dengan jelas.</p>
              </div>
            </SpotlightCard>
          </motion.div>
        </motion.div>
      </Reveal>
    </section>
  );
}

function OrderStepsSection() {
  const steps = [
    ["01", "Pilih produk", "Pilih layanan, varian, dan durasi yang tersedia."],
    ["02", "Selesaikan pembayaran", "Ikuti metode pembayaran yang tampil saat checkout."],
    ["03", "Pantau pesanan", "Gunakan Order ID untuk melihat perkembangan pesanan."],
  ];
  return (
    <section id="cara-pemesanan" className="border-b border-[var(--border)] bg-[var(--bg-raised)] py-12 md:py-16">
      <Reveal className="mx-auto max-w-[1180px] px-4 sm:px-6 md:px-8 lg:px-10">
        <motion.div variants={revealItem}><SectionHeading eyebrow="Cara pemesanan" title="Tiga langkah untuk mulai." description="Pilih layanan, selesaikan pembayaran, lalu pantau pesanan." /></motion.div>
        <motion.ol variants={stagger} className="grid gap-3 md:grid-cols-3">
          {steps.map(([number, title, body], index) => <motion.li key={title} variants={revealItem} className="relative rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"><div className="flex items-center justify-between"><span className="text-3xl font-medium tracking-[-0.04em] text-[var(--text-muted)]">{number}</span>{index < 2 ? <i className="ri-arrow-right-line hidden text-[var(--text-muted)] md:block" aria-hidden="true" /> : <i className="ri-check-line text-[var(--accent-cyan)]" aria-hidden="true" />}</div><h3 className="mt-7 text-lg font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{body}</p></motion.li>)}
        </motion.ol>
      </Reveal>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <section id="mulai" className="relative overflow-hidden bg-[var(--bg-canvas)] py-14 md:py-20">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-2/3 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl" style={{ background: "radial-gradient(ellipse, color-mix(in srgb, var(--accent-magenta) 13%, transparent), transparent 68%)" }} aria-hidden="true" />
      <Reveal className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
        <motion.p variants={revealItem} className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">Kavya</motion.p>
        <motion.h2 variants={revealItem} className="mt-4 text-3xl font-medium leading-tight tracking-[-0.03em] sm:text-4xl">Temukan layanan digitalmu di Kavya.</motion.h2>
        <motion.div variants={revealItem} className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><a href="#produk" className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--text-primary)] px-6 text-sm font-extrabold text-[var(--bg-canvas)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Lihat Produk</a><Link to="/register" className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--border)] px-6 text-sm font-bold hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Daftar Reseller</Link></motion.div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-raised)] py-8 text-sm text-[var(--text-muted)]">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6 md:px-8 lg:px-10"><div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between"><Link to="/" className="font-extrabold text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Kavya</Link><nav aria-label="Tautan footer" className="flex max-w-3xl flex-wrap gap-x-5 gap-y-3"><a href="#produk" className="hover:text-[var(--text-primary)]">Produk</a><Link to="/order-tracking" className="hover:text-[var(--text-primary)]">Lacak Pesanan</Link><a href={whatsappUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--text-primary)]">Bantuan</a><Link to="/register" className="hover:text-[var(--text-primary)]">Daftar Reseller</Link><span>Kebijakan Privasi</span><span>Syarat dan Ketentuan</span></nav></div><p className="mt-7 border-t border-[var(--border)] pt-5">(c) 2026 Kavya.</p></div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <MotionConfig reducedMotion="user">
      
        <main className="kavya-public-dark min-h-screen overflow-x-hidden font-sans">
          <PublicNavbar />
          <HeroSection />
          <ProductCatalog />
          <BentoSection />
          <OrderStepsSection />
          <FinalCtaSection />
          <Footer />
        </main>
      
    </MotionConfig>
  );
}
