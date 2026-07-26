import { useEffect, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import {
  motion,
  MotionConfig,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import { Link } from "react-router-dom";
import { PageTransition } from "../../components/feature/PageTransition";
import PublicNavbar from "../../components/feature/PublicNavbar";
import { api } from "../../lib/api";
import ProductCatalog from "./components/ProductCatalog";

const whatsappUrl = "https://wa.me/6287777655549";
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
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--kavya-text-muted)]">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-extrabold leading-tight text-[var(--kavya-text-primary)] sm:text-3xl lg:text-4xl">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-[var(--kavya-text-secondary)] sm:text-base">{description}</p>
    </header>
  );
}

function SpectralMark() {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 120, damping: 22, mass: 0.7 });
  const springY = useSpring(y, { stiffness: 120, damping: 22, mass: 0.7 });

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    if (reduceMotion || window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(((event.clientX - rect.left) / rect.width - 0.5) * 10);
    y.set(((event.clientY - rect.top) / rect.height - 0.5) * 10);
  };

  return (
    <motion.div
      className="relative mx-auto h-[210px] w-full max-w-[340px] sm:h-[350px] sm:max-w-[500px] lg:h-[540px] lg:max-w-[620px]"
      style={{ x: reduceMotion ? 0 : springX, y: reduceMotion ? 0 : springY }}
      onMouseMove={onMove}
      onMouseLeave={() => { x.set(0); y.set(0); }}
      aria-hidden="true"
    >
      <motion.div
        className="absolute -left-[20%] top-[17%] h-[72%] w-[72%] rounded-full"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--kavya-magenta) 38%, transparent), transparent 70%)" }}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.88 }}
        animate={reduceMotion ? undefined : { opacity: [0.34, 0.46, 0.34], scale: [1, 1.035, 1] }}
        transition={{ opacity: { duration: 0.75, delay: 0.26 }, scale: { duration: 9, repeat: Infinity, ease: "easeInOut" } }}
      />
      <motion.div
        className="absolute left-[5%] -top-[20%] h-[96%] w-[96%] rounded-full"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--kavya-violet) 36%, transparent), transparent 70%)" }}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={reduceMotion ? undefined : { opacity: [0.34, 0.48, 0.34], y: [0, -3, 0] }}
        transition={{ opacity: { duration: 0.78, delay: 0.3 }, y: { duration: 10, repeat: Infinity, ease: "easeInOut" } }}
      />
      <motion.div
        className="absolute -bottom-[22%] right-[-22%] h-[78%] w-[78%] rounded-full"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--kavya-cyan) 36%, transparent), transparent 70%)" }}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={reduceMotion ? undefined : { opacity: [0.3, 0.42, 0.3], x: [0, 3, 0] }}
        transition={{ opacity: { duration: 0.8, delay: 0.34 }, x: { duration: 11, repeat: Infinity, ease: "easeInOut" } }}
      />
      <motion.div
        className="absolute bottom-[5%] left-[17%] h-[48%] w-[66%] rounded-full"
        style={{ background: "radial-gradient(ellipse, color-mix(in srgb, var(--kavya-text-primary) 18%, transparent), transparent 68%)" }}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={reduceMotion ? undefined : { opacity: [0.18, 0.27, 0.18] }}
        transition={{ opacity: { duration: 8, repeat: Infinity, ease: "easeInOut", delay: 0.36 } }}
      />
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.93, filter: "blur(8px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)", y: reduceMotion ? 0 : [0, -4, 0] }}
        transition={{ opacity: { duration: 0.62, delay: 0.16 }, scale: { duration: 0.62, delay: 0.16, ease: [0.22, 1, 0.36, 1] }, filter: { duration: 0.62, delay: 0.16 }, y: { duration: 8, repeat: Infinity, ease: "easeInOut", delay: 0.8 } }}
      >
        <span
          className="select-none font-serif text-[clamp(11rem,24vw,14rem)] font-medium leading-none sm:text-[17rem] lg:text-[21rem]"
          style={{
            color: "var(--kavya-graphite)",
            WebkitTextStroke: "1px var(--kavya-graphite-edge)",
            textShadow: "-1px -1px 0 var(--kavya-graphite-edge), 0 24px 70px var(--kavya-bg-deep)",
          }}
        >
          K
        </span>
      </motion.div>
      <div className="absolute bottom-[18%] left-[30%] h-px w-[42%] bg-gradient-to-r from-transparent via-[var(--kavya-graphite-edge)] to-transparent" />
    </motion.div>
  );
}

function HeroSection() {
  const reduceMotion = useReducedMotion();
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
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
      className="relative min-h-[94svh] overflow-hidden border-b border-[var(--kavya-border)] bg-[var(--kavya-bg)] pt-16"
      style={{ backgroundImage: "radial-gradient(circle at 43% 52%, color-mix(in srgb, var(--kavya-violet) 4%, var(--kavya-bg-ambient)) 0%, var(--kavya-bg) 43%, var(--kavya-bg-deep) 100%)" }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.022] [background-image:radial-gradient(var(--kavya-grid-dot)_1px,transparent_1px)] [background-size:34px_34px]" aria-hidden="true" />
      <div className="relative flex min-h-[calc(94svh-4rem)] flex-col">
        <div className="flex w-full flex-1 items-center px-6 py-8 sm:px-10 md:py-10 lg:px-12 xl:px-16">
          <div className="mx-auto grid w-full max-w-[1360px] items-center gap-8 md:grid-cols-[minmax(0,0.8fr)_minmax(300px,1.2fr)] md:gap-x-8 md:gap-y-7 xl:grid-cols-[30fr_42fr_28fr] xl:gap-6">
            <motion.div initial={reduceMotion ? false : "hidden"} animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.06 } } }} className="relative z-10 max-w-[520px]">
              <motion.h1 variants={revealItem} className="max-w-[520px] text-[clamp(4.5rem,7vw,7.75rem)] font-normal leading-[0.92] tracking-[-0.055em] text-[var(--kavya-text-primary)]">
                Kavya
              </motion.h1>
              <motion.p variants={revealItem} className="mt-6 whitespace-nowrap text-[17px] font-normal leading-[1.5] text-[var(--kavya-text-secondary)] lg:text-lg xl:text-xl">
                Produk digital, dalam satu alur.
              </motion.p>
              <motion.div variants={revealItem} className="mt-8 flex flex-col gap-3 min-[430px]:flex-row">
                <motion.a href="#produk" whileHover={reduceMotion ? undefined : { y: -2 }} whileTap={reduceMotion ? undefined : { y: 1, scale: 0.985 }} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--kavya-text-primary)] px-6 text-[15px] font-extrabold text-[var(--kavya-bg)] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                  Lihat Produk
                </motion.a>
                <Link to="/order-tracking" className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--kavya-border)] px-6 text-[15px] font-bold text-[var(--kavya-text-primary)] transition-colors hover:border-[var(--kavya-border-hover)] hover:bg-[var(--kavya-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                  Lacak Pesanan
                </Link>
              </motion.div>
            </motion.div>

            <motion.div initial={reduceMotion ? false : { opacity: 0, scale: 0.96, filter: "blur(7px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ duration: 0.68, delay: 0.14, ease: [0.22, 1, 0.36, 1] }} className="md:min-w-0">
              <SpectralMark />
            </motion.div>

            <motion.aside
              aria-label="Ringkasan Kavya"
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.42, ease: [0.22, 1, 0.36, 1] }}
              className="hidden gap-4 border-t border-[var(--kavya-border)] pt-5 text-[13px] font-semibold uppercase leading-6 tracking-[0.14em] text-[var(--kavya-microcopy)] sm:grid sm:grid-cols-3 md:col-span-2 xl:col-span-1 xl:-ml-2 xl:grid-cols-1 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0"
            >
              <p>Produk digital</p>
              <p>Pemesanan terpusat</p>
              <p>Akses mudah</p>
            </motion.aside>
          </div>
        </div>

        {categoriesLoading || availableCategories.length ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.58, ease: [0.22, 1, 0.36, 1] }}
            className="border-y border-[var(--kavya-border)] bg-[var(--kavya-bg-elevated-translucent)]"
          >
            <div className="px-6 sm:px-10 lg:px-12 xl:px-16">
              <div className="mx-auto grid min-h-[72px] max-w-[1360px] grid-cols-[1fr_auto] items-center gap-x-5 gap-y-3 py-4 md:grid-cols-[180px_minmax(0,1fr)_auto] md:py-0">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--kavya-text-primary)]">Layanan tersedia</span>
                <div
                  aria-label={categoriesLoading ? "Kategori layanan sedang dimuat" : "Kategori layanan tersedia"}
                  className="order-3 col-span-2 flex min-w-0 items-center gap-7 overflow-x-auto py-1 text-xs font-semibold uppercase tracking-[0.13em] text-[var(--kavya-text-muted)] [scrollbar-width:none] md:order-none md:col-span-1 md:justify-evenly md:gap-5 [&::-webkit-scrollbar]:hidden"
                >
                  {categoriesLoading ? (
                    Array.from({ length: 4 }, (_, index) => (
                      <span key={index} className="h-3 w-20 shrink-0 rounded-full bg-[var(--kavya-border-hover)] motion-safe:animate-pulse" aria-hidden="true" />
                    ))
                  ) : (
                    availableCategories.map((category) => (
                      <a key={category} href="#produk" className="shrink-0 py-1 transition-colors hover:text-[var(--kavya-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">{category}</a>
                    ))
                  )}
                </div>
                <a href="#produk" className="group inline-flex min-h-11 shrink-0 items-center justify-end gap-1.5 text-sm font-semibold text-[var(--kavya-text-secondary)] transition-colors hover:text-[var(--kavya-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
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
  const spotlight = useMotionTemplate`radial-gradient(220px circle at ${x}px ${y}px, color-mix(in srgb, var(--kavya-violet) 10%, transparent), transparent 74%)`;

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (reduceMotion || event.pointerType === "touch" || window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
    opacity.set(1);
  };

  return (
    <motion.article onPointerMove={onPointerMove} onPointerLeave={() => opacity.set(0)} whileHover={reduceMotion ? undefined : { y: -2, borderColor: "var(--kavya-border-hover)" }} className={`relative overflow-hidden rounded-[10px] border border-[rgba(255,255,255,0.11)] bg-[#080808] ${className}`}>
      <motion.div className="pointer-events-none absolute inset-0" style={{ backgroundImage: spotlight, opacity }} aria-hidden="true" />
      <div className="relative h-full">{children}</div>
    </motion.article>
  );
}

function PreviewLabel() {
  return <span className="inline-flex rounded-full border border-[var(--kavya-border)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--kavya-text-muted)]">Preview antarmuka</span>;
}

function BentoSection() {
  const reduceMotion = useReducedMotion();
  const orderStages = [
    { label: "Pembayaran", detail: "Pembayaran diterima", tone: "var(--kavya-violet)" },
    { label: "Diproses", detail: "Pesanan sedang disiapkan", tone: "var(--kavya-cyan)" },
    { label: "Selesai", detail: "Pesanan siap digunakan", tone: "var(--kavya-text-primary)" },
  ];
  const stockRows = [
    { label: "Produk digital", width: "88%" },
    { label: "Paket aktif", width: "68%" },
    { label: "Katalog", width: "48%" },
  ];

  return (
    <section id="fitur" className="border-b border-[var(--kavya-border)] bg-[var(--kavya-bg)] py-14 md:py-20">
      <Reveal className="mx-auto max-w-[1360px] px-4 sm:px-6 md:px-8 lg:px-10">
        <motion.header variants={revealItem} className="mb-10 max-w-3xl md:mb-14">
          <h2 className="text-3xl font-medium leading-tight tracking-[-0.035em] text-[var(--kavya-text-primary)] sm:text-4xl lg:text-5xl">Setiap tahap, tetap terhubung.</h2>
          <p className="mt-4 text-base leading-7 text-[var(--kavya-text-secondary)] sm:text-lg">Pesanan, pembayaran, dan ketersediaan dalam satu alur.</p>
        </motion.header>

        <motion.div variants={stagger} className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:grid-rows-2 lg:gap-5">
          <motion.div variants={revealItem} className="contents">
            <SpotlightCard className="flex min-h-[440px] flex-col sm:min-h-[480px] lg:col-span-7 lg:row-span-2 lg:min-h-[560px]">
              <div className="flex min-h-0 flex-1 flex-col p-6 sm:p-8">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--kavya-text-muted)]">Status Pesanan</p>
                  <PreviewLabel />
                </div>

                <div className="relative mt-9 flex flex-1 flex-col justify-center sm:mt-12">
                  <motion.div
                    aria-hidden="true"
                    className="absolute bottom-8 left-[17px] top-8 w-px origin-top bg-[linear-gradient(to_bottom,var(--kavya-violet),var(--kavya-cyan),rgba(255,255,255,0.35))]"
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
                          <p className="text-lg font-semibold text-[var(--kavya-text-primary)] sm:text-xl">{stage.label}</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--kavya-text-secondary)] sm:text-base">{stage.detail}</p>
                        </div>
                        <span className="hidden text-sm font-medium text-[var(--kavya-text-muted)] sm:block">0{index + 1}</span>
                      </motion.li>
                    ))}
                  </ol>
                </div>
              </div>
              <div className="border-t border-[var(--kavya-border)] px-6 py-6 sm:px-8">
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-[var(--kavya-text-primary)] sm:text-2xl">Status pesanan tetap jelas</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--kavya-text-secondary)] sm:text-base">Pantau proses dan riwayat pesanan dari satu tempat.</p>
              </div>
            </SpotlightCard>

            <SpotlightCard className="flex min-h-[280px] flex-col lg:col-span-5">
              <div className="flex min-h-0 flex-1 items-center justify-between gap-5 p-6 sm:p-7">
                <div>
                  <div className="flex items-center gap-3">
                    <motion.span
                      className="flex h-12 w-12 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--kavya-cyan)_36%,transparent)] bg-[color-mix(in_srgb,var(--kavya-cyan)_8%,transparent)] text-2xl text-[var(--kavya-cyan)]"
                      initial={reduceMotion ? false : { opacity: 0.45, scale: 0.86 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true, amount: 0.8 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <i className="ri-check-line" aria-hidden="true" />
                    </motion.span>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--kavya-text-muted)]">Pembayaran</span>
                  </div>
                  <p className="mt-6 text-2xl font-semibold tracking-[-0.025em] text-[var(--kavya-text-primary)] sm:text-3xl">Terverifikasi</p>
                  <p className="mt-2 text-sm text-[var(--kavya-text-muted)]">Nominal pembayaran: Rp --</p>
                </div>
                <PreviewLabel />
              </div>
              <div className="border-t border-[var(--kavya-border)] px-6 py-5 sm:px-7">
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-[var(--kavya-text-primary)]">Konfirmasi pembayaran</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--kavya-text-secondary)]">Status pembayaran terhubung langsung dengan pesanan.</p>
              </div>
            </SpotlightCard>

            <SpotlightCard className="flex min-h-[280px] flex-col lg:col-span-5">
              <div className="flex min-h-0 flex-1 flex-col justify-center p-6 sm:p-7">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--kavya-text-muted)]">Produk &amp; Stok</p>
                  <PreviewLabel />
                </div>
                <div className="mt-6 space-y-4">
                  {stockRows.map((row, index) => (
                    <div key={row.label} className="grid grid-cols-[112px_1fr] items-center gap-4 sm:grid-cols-[128px_1fr]">
                      <span className="text-sm font-medium text-[var(--kavya-text-secondary)]">{row.label}</span>
                      <div className="h-2.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                        <motion.span
                          className="block h-full origin-left rounded-full bg-[var(--kavya-cyan)]"
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
              <div className="border-t border-[var(--kavya-border)] px-6 py-5 sm:px-7">
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-[var(--kavya-text-primary)]">Ketersediaan mudah dilihat</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--kavya-text-secondary)]">Produk dan paket aktif tersusun dengan jelas.</p>
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
    <section id="cara-pemesanan" className="border-b border-[var(--kavya-border)] bg-[var(--kavya-bg-elevated)] py-12 md:py-16">
      <Reveal className="mx-auto max-w-[1180px] px-4 sm:px-6 md:px-8 lg:px-10">
        <motion.div variants={revealItem}><SectionHeading eyebrow="Cara pemesanan" title="Tiga langkah untuk mulai." description="Pilih layanan, selesaikan pembayaran, lalu pantau pesanan." /></motion.div>
        <motion.ol variants={stagger} className="grid gap-3 md:grid-cols-3">
          {steps.map(([number, title, body], index) => <motion.li key={title} variants={revealItem} className="relative rounded-lg border border-[var(--kavya-border)] bg-[var(--kavya-surface)] p-5"><div className="flex items-center justify-between"><span className="text-3xl font-medium tracking-[-0.04em] text-[var(--kavya-text-muted)]">{number}</span>{index < 2 ? <i className="ri-arrow-right-line hidden text-[var(--kavya-text-muted)] md:block" aria-hidden="true" /> : <i className="ri-check-line text-[var(--kavya-cyan)]" aria-hidden="true" />}</div><h3 className="mt-7 text-lg font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-[var(--kavya-text-secondary)]">{body}</p></motion.li>)}
        </motion.ol>
      </Reveal>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <section id="mulai" className="relative overflow-hidden bg-[var(--kavya-bg)] py-14 md:py-20">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-2/3 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl" style={{ background: "radial-gradient(ellipse, color-mix(in srgb, var(--kavya-magenta) 13%, transparent), transparent 68%)" }} aria-hidden="true" />
      <Reveal className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
        <motion.p variants={revealItem} className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--kavya-text-muted)]">Kavya</motion.p>
        <motion.h2 variants={revealItem} className="mt-4 text-3xl font-medium leading-tight tracking-[-0.03em] sm:text-4xl">Temukan layanan digitalmu di Kavya.</motion.h2>
        <motion.div variants={revealItem} className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><a href="#produk" className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--kavya-text-primary)] px-6 text-sm font-extrabold text-[var(--kavya-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Lihat Produk</a><Link to="/register" className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--kavya-border)] px-6 text-sm font-bold hover:bg-[var(--kavya-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Daftar Reseller</Link></motion.div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--kavya-border)] bg-[var(--kavya-bg-elevated)] py-8 text-sm text-[var(--kavya-text-muted)]">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6 md:px-8 lg:px-10"><div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between"><Link to="/" className="font-extrabold text-[var(--kavya-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Kavya</Link><nav aria-label="Tautan footer" className="flex max-w-3xl flex-wrap gap-x-5 gap-y-3"><a href="#produk" className="hover:text-[var(--kavya-text-primary)]">Produk</a><Link to="/order-tracking" className="hover:text-[var(--kavya-text-primary)]">Lacak Pesanan</Link><a href={whatsappUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--kavya-text-primary)]">Bantuan</a><Link to="/register" className="hover:text-[var(--kavya-text-primary)]">Daftar Reseller</Link><span>Kebijakan Privasi</span><span>Syarat dan Ketentuan</span></nav></div><p className="mt-7 border-t border-[var(--kavya-border)] pt-5">(c) 2026 Kavya.</p></div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <MotionConfig reducedMotion="user">
      <PageTransition>
        <main className="kavya-public-dark min-h-screen overflow-x-hidden font-sans">
          <PublicNavbar />
          <HeroSection />
          <ProductCatalog />
          <BentoSection />
          <OrderStepsSection />
          <FinalCtaSection />
          <Footer />
        </main>
      </PageTransition>
    </MotionConfig>
  );
}
