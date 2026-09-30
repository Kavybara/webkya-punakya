import type { ReactNode } from "react";
import { motion, MotionConfig } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { Link } from "react-router-dom";
import PublicNavbar from "../../components/feature/PublicNavbar";
import { ownerWhatsappLink } from "../../lib/ownerContact";
import { BrandStrip } from "./components/BrandStrip";
import { HeroSection } from "./components/HeroSection";
import ProductCatalog from "./components/ProductCatalog";
import { StatsStrip } from "./components/StatsStrip";
import { useCatalog } from "./useCatalog";
import "./home.css";

const whatsappUrl = ownerWhatsappLink();

/**
 * The landing page.
 *
 * It is a 100vh hero and then four sections, and that ordering is the whole
 * design. The hero is a word and a sentence over a moving background; a
 * visitor who wants proof scrolls, and the proof is a live catalogue, four
 * counted numbers, and the brands that are actually for sale. Nothing on this
 * page is decorative, and nothing is a mock-up.
 *
 * Four things used to be here and are not any more: a chip strip of category
 * links, a fan of three product cards, a "Preview antarmuka" bento, and a
 * closing call to action. The first two crowded the hero, the third showed
 * invented stock percentages, and the fourth repeated the two buttons the
 * navbar already carries.
 *
 * `useCatalog()` is called once, here, and passed down. It used to be called
 * twice -- once by the hero's deck and once by the catalogue below -- into two
 * unrelated `useState`s, so every visitor paid for the same request twice and
 * the two halves of the page could disagree about what was in stock.
 */
const revealViewport = { once: true, amount: 0.16 };
const revealItem = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={revealViewport}
      variants={stagger}
    >
      {children}
    </motion.div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="mb-8 max-w-2xl md:mb-10">
      <p className="text-label font-bold uppercase text-[var(--text-muted)]">{eyebrow}</p>
      <h2 className="mt-3 text-title font-extrabold leading-tight text-[var(--text-primary)]">{title}</h2>
      <p className="mt-3 text-lede leading-6 text-[var(--text-secondary)]">{description}</p>
    </header>
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
        <motion.div variants={revealItem}>
          <SectionHeading
            eyebrow="Cara pemesanan"
            title="Tiga langkah untuk mulai."
            description="Pilih layanan, selesaikan pembayaran, lalu pantau pesanan."
          />
        </motion.div>
        <motion.ol variants={stagger} className="grid gap-3 md:grid-cols-3">
          {steps.map(([number, title, body], index) => (
            <motion.li key={title} variants={revealItem} className="home-step">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-medium tracking-tight text-[var(--text-muted)]">{number}</span>
                {index < 2 ? (
                  <ArrowRight size={16} className="hidden text-[var(--text-muted)] md:block" aria-hidden="true" />
                ) : (
                  <Check size={16} className="text-[var(--accent-cyan)]" aria-hidden="true" />
                )}
              </div>
              <h3 className="mt-7 text-lg font-extrabold">{title}</h3>
              <p className="mt-2 text-small leading-6 text-[var(--text-secondary)]">{body}</p>
            </motion.li>
          ))}
        </motion.ol>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-raised)] py-8 text-small text-[var(--text-muted)]">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6 md:px-8 lg:px-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <Link to="/" className="font-extrabold text-[var(--text-primary)]">Kavya</Link>
          <nav aria-label="Tautan footer" className="flex max-w-3xl flex-wrap gap-x-5 gap-y-3">
            <a href="#produk" className="hover:text-[var(--text-primary)]">Produk</a>
            <Link to="/order-tracking" className="hover:text-[var(--text-primary)]">Lacak Pesanan</Link>
            <a href={whatsappUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--text-primary)]">Bantuan</a>
            <Link to="/register" className="hover:text-[var(--text-primary)]">Daftar Reseller</Link>
          </nav>
        </div>
        <p className="mt-7 border-t border-[var(--border)] pt-5">© 2026 Kavya.</p>
      </div>
    </footer>
  );
}

export default function HomePage() {
  const catalog = useCatalog();

  return (
    <MotionConfig reducedMotion="user">
      <main className="theme-dark min-h-screen overflow-x-hidden font-sans">
        <PublicNavbar />
        <HeroSection />
        <StatsStrip catalog={catalog} />
        <ProductCatalog catalog={catalog} />
        <BrandStrip catalog={catalog} />
        <OrderStepsSection />
        <Footer />
      </main>
    </MotionConfig>
  );
}
