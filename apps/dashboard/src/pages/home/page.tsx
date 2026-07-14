import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PageTransition } from "../../components/feature/PageTransition";
import PublicNavbar from "../../components/feature/PublicNavbar";
import ProductCatalog from "./components/ProductCatalog";

type RevealElement = HTMLDivElement | HTMLElement;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function useScrollReveal(threshold = 0.1) {
  const ref = useRef<RevealElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, revealed };
}

function revealClass(revealed: boolean, offset = "translate-y-8") {
  return revealed ? "translate-y-0 opacity-100" : `${offset} opacity-0`;
}

function SectionBadge({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-kavya-sand/30 bg-white px-4 py-1.5 text-sm font-semibold text-kavya-brown shadow-sm">
      <i className={icon} />
      {label}
    </span>
  );
}

function SectionHeader({
  icon,
  badge,
  title,
  subtitle,
}: {
  icon: string;
  badge: string;
  title: string;
  subtitle: string;
}) {
  const reveal = useScrollReveal();

  return (
    <div
      ref={reveal.ref as React.RefObject<HTMLDivElement>}
      className={classNames(
        "mx-auto mb-8 max-w-3xl text-center transition-all duration-700",
        revealClass(reveal.revealed, "translate-y-6"),
      )}
    >
      <SectionBadge icon={icon} label={badge} />
      <h2 className="mt-5 text-3xl font-extrabold leading-tight text-kavya-dark md:text-4xl lg:text-5xl">
        {title}
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-kavya-brown md:text-lg">{subtitle}</p>
    </div>
  );
}

const testimonials = [
  {
    initial: "DM",
    name: "Douglas Max",
    role: "Reseller Netflix",
    quote:
      "Dashboard Kavya bikin kerjaanku jadi 10x lebih cepat. Auto order dan stock management itu game changer banget. Reseller wajib coba!",
  },
  {
    initial: "S",
    name: "Simson",
    role: "Owner Akun Streaming",
    quote:
      "Sebelumnya ribet banget ngatur akun manual. Sekarang semua otomatis, QRIS payment terverifikasi, akun langsung dikirim via WhatsApp. Super efisien.",
  },
  {
    initial: "DY",
    name: "Dian Yustika",
    role: "Reseller Part-time",
    quote:
      "Harga reseller di Kavya paling kompetitif. Margin untung lumayan dan sistemnya stabil banget. Sudah 6 bulan gabung, ga pernah ada kendala.",
  },
  {
    initial: "JS",
    name: "Joko Susilo",
    role: "Customer Premium",
    quote:
      "Beli akun Netflix di sini paling aman. Full garansi, support 24/7 respon cepat. Kalau ada masalah langsung digantiin akunnya.",
  },
];

const featureCards = [
  ["ri-archive-line", "Stock Management", "Tambah, kurangi, dan pantau stok akun Netflix real-time."],
  ["ri-robot-line", "Auto Order", "Sistem order otomatis dengan notifikasi WhatsApp instan."],
  ["ri-qr-code-line", "QRIS Payment", "Pembayaran QRIS dengan cek status otomatis."],
  ["ri-user-search-line", "Reseller Tracking", "Pantau aktivitas reseller dan histori transaksi."],
  ["ri-settings-3-line", "Account Config", "Kelola sign-in code, verification code, dan reset link."],
  ["ri-whatsapp-line", "WhatsApp Integration", "Terhubung dengan WhatsApp Bailey untuk auto notifikasi."],
  ["ri-stack-line", "Product Variants", "Atur variant produk, harga, SNK, dan credential."],
  ["ri-history-line", "Activity Log", "Lihat riwayat lengkap aktivitas dan transaksi."],
];

const steps = [
  ["ri-shopping-bag-line", "Pilih Produk", "Pilih paket Netflix yang sesuai dengan kebutuhan Anda dari katalog produk."],
  ["ri-qr-code-line", "Pembayaran QRIS", "Lakukan pembayaran dengan QRIS. Sistem akan otomatis memverifikasi pembayaran."],
  ["ri-mail-send-line", "Dapatkan Akun", "Akun Netflix dengan email dan password akan dikirim otomatis via WhatsApp."],
];

function HeroDecoration() {
  return (
    <>
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_18%_20%,rgba(212,200,184,0.45),transparent_28%),radial-gradient(circle_at_80%_28%,rgba(196,168,130,0.28),transparent_30%),radial-gradient(circle_at_58%_85%,rgba(232,213,184,0.34),transparent_32%)]" />
      <div className="absolute inset-0 z-[1] opacity-[0.06] [background-image:radial-gradient(#2C2824_1px,transparent_1px)] [background-size:24px_24px]" />
      <div className="absolute inset-0 z-[2] opacity-[0.03] [background-image:linear-gradient(90deg,#2C2824_1px,transparent_1px),linear-gradient(#2C2824_1px,transparent_1px)] [background-size:8px_8px]" />
      <div className="pointer-events-none absolute inset-0 z-[3] overflow-hidden">
        {Array.from({ length: 13 }).map((_, index) => (
          <span
            key={index}
            className={classNames(
              "absolute rounded-full bg-kavya-accent",
              index % 3 === 0
                ? "h-1.5 w-1.5 animate-float-slow"
                : index % 3 === 1
                  ? "h-1 w-1 animate-float-medium"
                  : "h-2 w-2 animate-float-fast",
            )}
            style={{
              left: `${7 + ((index * 17) % 86)}%`,
              top: `${11 + ((index * 23) % 72)}%`,
              opacity: 0.16 + (index % 4) * 0.08,
              animationDelay: `${index * 140}ms`,
            }}
          />
        ))}
        <span className="absolute right-[9%] top-[30%] animate-float-medium text-4xl text-kavya-gold/30">+</span>
        <span className="absolute left-[25%] top-[42%] animate-float-fast text-2xl text-kavya-sand/60">+</span>
        <span className="absolute right-[17%] top-[10%] h-52 w-52 rounded-full border border-dashed border-kavya-sand/40 animate-spin-slow" />
        <span className="absolute left-[10%] top-[35%] h-8 w-8 rounded-full border border-kavya-sand/50 animate-spin-reverse" />
        <svg className="absolute left-[22%] top-[12%] h-24 w-44 text-kavya-sand/40" viewBox="0 0 180 100" fill="none">
          <path d="M5 70Q80 10 175 58" stroke="currentColor" strokeDasharray="7 8" />
        </svg>
      </div>
    </>
  );
}

function HeroSection() {
  return (
    <section id="beranda" className="relative flex min-h-[90vh] items-center overflow-hidden bg-kavya-linen pb-8 pt-20">
      <HeroDecoration />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-4 md:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:px-12 xl:px-0">
        <div className="pt-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-kavya-sand/40 bg-white/80 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-kavya-charcoal shadow-sm backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-kavya-red" />
            Netflix Digital Account Sales
          </span>
          <h1 className="mt-7 font-serif text-7xl font-black leading-none tracking-tight text-kavya-dark sm:text-8xl md:text-9xl">
            Kavya
          </h1>
          <p className="mt-7 max-w-xl text-xl leading-relaxed text-kavya-brown">
            Panel penjualan akun digital untuk stok, reseller, order, dan WhatsApp bot dalam satu dashboard.
          </p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <a
              href="#produk"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-kavya-red px-8 text-lg font-bold text-white shadow-xl shadow-red-600/15 transition-all hover:-translate-y-0.5 hover:bg-red-700"
            >
              <i className="ri-shopping-bag-line" />
              Lihat Produk
            </a>
            <Link
              to="/login"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-kavya-sand/60 bg-white px-8 text-lg font-bold text-kavya-dark shadow-sm transition-all hover:-translate-y-0.5 hover:bg-kavya-cream"
            >
              <i className="ri-login-box-line" />
              Masuk Dashboard
            </Link>
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-5 text-base font-semibold text-kavya-accent">
            {[
              ["ri-shield-check-line", "100% Garansi"],
              ["ri-time-line", "Support 24/7"],
              ["ri-refresh-line", "Auto Order"],
            ].map(([icon, label], index) => (
              <span key={label} className="inline-flex items-center gap-2">
                {index > 0 ? <span className="h-4 w-px bg-kavya-sand/60" /> : null}
                <i className={icon} />
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="hidden flex-col justify-center gap-6 lg:flex">
          {[
            ["ri-shield-user-line", "OWNER", "Admin", "Full Management Access", "Kelola stok, produk, reseller, order, dan WhatsApp bot.", "Login sebagai Owner"],
            ["ri-user-line", "RESELLER", "Partner", "Reseller Access", "Lihat stok, buat order, dan akses akun Netflix customer.", "Login sebagai Reseller"],
          ].map(([icon, role, badge, title, body, action]) => (
            <Link
              key={role}
              to="/login"
              className="group relative overflow-hidden rounded-3xl border border-kavya-sand/20 bg-white p-8 shadow-xl shadow-kavya-dark/10 transition-all hover:-translate-y-1 hover:border-kavya-gold/40"
            >
              <span className="absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-gradient-to-bl from-kavya-gold/10 to-transparent" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3 text-sm font-extrabold tracking-wider text-kavya-charcoal">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-kavya-sand/40 bg-kavya-linen text-kavya-accent">
                    <i className={icon} />
                  </span>
                  {role}
                </div>
                <span className="rounded-lg bg-kavya-linen px-3 py-1 text-xs font-bold text-kavya-brown">{badge}</span>
              </div>
              <h2 className="relative mt-6 text-2xl font-extrabold text-kavya-dark">{title}</h2>
              <p className="relative mt-4 text-lg leading-relaxed text-kavya-brown">{body}</p>
              <p className="relative mt-7 inline-flex items-center gap-2 text-lg font-extrabold text-kavya-red">
                {action}
                <i className="ri-arrow-right-line transition-transform group-hover:translate-x-1" />
              </p>
            </Link>
          ))}
        </div>
      </div>
      <a
        href="#produk"
        className="absolute bottom-10 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-kavya-sand md:flex"
      >
        <span className="flex h-10 w-6 justify-center rounded-full border-2 border-kavya-sand p-1">
          <span className="h-2 w-1.5 animate-float-fast rounded-full bg-kavya-accent" />
        </span>
        <i className="ri-arrow-down-s-line animate-bounce" />
      </a>
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-kavya-cream/80 to-transparent" />
    </section>
  );
}

function StatsTestimonialsSection() {
  const statsReveal = useScrollReveal();
  const testimonialsReveal = useScrollReveal();

  return (
    <section className="relative bg-kavya-linen py-10 md:py-14 lg:py-20">
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-kavya-sand/40 to-transparent" />
      <div className="mx-auto max-w-6xl px-4 md:px-8 lg:px-12 xl:px-0">
        <div
          ref={statsReveal.ref as React.RefObject<HTMLDivElement>}
          className={classNames(
            "mx-auto mb-16 grid max-w-5xl grid-cols-2 gap-5 transition-all duration-700 md:grid-cols-4",
            revealClass(statsReveal.revealed),
          )}
        >
          {[
            ["ri-apps-line", "7+", "Kategori Produk"],
            ["ri-user-star-line", "13", "Reseller Aktif"],
            ["ri-global-line", "8+", "Negara Terlayani"],
            ["ri-trophy-line", "4", "Tahun Berpengalaman"],
          ].map(([icon, value, label]) => (
            <div
              key={label}
              className="rounded-2xl border border-kavya-sand/30 bg-white p-7 text-center shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-kavya-sand/40 bg-kavya-cream text-kavya-accent">
                <i className={`${icon} text-xl`} />
              </span>
              <div className="mt-5 text-5xl font-extrabold text-kavya-dark">{value}</div>
              <div className="mt-2 text-lg font-bold text-kavya-brown">{label}</div>
            </div>
          ))}
        </div>

        <SectionHeader
          icon="ri-chat-smile-3-line"
          badge="Apa Kata Mereka"
          title="Dipercaya oleh Reseller & Customer"
          subtitle="Ribuan pengguna sudah merasakan kemudahan mengelola akun Netflix bersama Kavya."
        />

        <div
          ref={testimonialsReveal.ref as React.RefObject<HTMLDivElement>}
          className="mx-auto grid max-w-5xl grid-cols-1 gap-7 md:grid-cols-2"
        >
          {testimonials.map((item, index) => (
            <div
              key={item.name}
              className={classNames(
                "relative rounded-2xl border border-kavya-sand/20 bg-white p-8 transition-all duration-700 hover:-translate-y-1 hover:border-kavya-gold/40 hover:shadow-lg",
                revealClass(testimonialsReveal.revealed),
              )}
              style={{ transitionDelay: `${index * 120}ms` }}
            >
              <div className="flex gap-1 text-kavya-gold">
                {Array.from({ length: 5 }).map((_, starIndex) => (
                  <i key={starIndex} className="ri-star-fill" />
                ))}
              </div>
              <p className="mt-6 text-2xl leading-relaxed text-kavya-dark">
                <i className="ri-double-quotes-l mr-2 text-3xl text-kavya-sand" />
                {item.quote}
              </p>
              <div className="mt-8 flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-kavya-sand/40 bg-kavya-cream text-xl font-extrabold text-kavya-accent">
                  {item.initial}
                </span>
                <span>
                  <span className="block text-lg font-extrabold text-kavya-dark">{item.name}</span>
                  <span className="block text-base text-kavya-brown">{item.role}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const reveal = useScrollReveal();

  return (
    <section id="cara-kerja" className="relative bg-kavya-linen py-10 md:py-14 lg:py-20">
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-kavya-sand/40 to-transparent" />
      <div className="mx-auto max-w-6xl px-4 md:px-8 lg:px-12 xl:px-0">
        <SectionHeader
          icon="ri-route-line"
          badge="Cara Kerja"
          title="Order & Dapatkan Akun dalam 3 Langkah"
          subtitle="Proses cepat, aman, dan otomatis. Dari pemilihan hingga pengiriman akun Netflix Anda."
        />
        <div ref={reveal.ref as React.RefObject<HTMLDivElement>} className="grid grid-cols-1 gap-7 md:grid-cols-3">
          {steps.map(([icon, title, body], index) => (
            <div
              key={title}
              className={classNames(
                "relative rounded-2xl border border-kavya-sand/30 bg-white p-8 transition-all duration-700 hover:-translate-y-1 hover:shadow-lg",
                revealClass(reveal.revealed),
              )}
              style={{ transitionDelay: `${index * 150}ms` }}
            >
              <span className="absolute -right-4 -top-4 flex h-12 w-12 items-center justify-center rounded-full bg-kavya-dark text-lg font-extrabold text-white shadow-xl">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-kavya-sand/40 bg-kavya-cream text-kavya-accent">
                <i className={`${icon} text-2xl`} />
              </span>
              <h3 className="mt-7 text-2xl font-extrabold text-kavya-dark">{title}</h3>
              <p className="mt-4 text-lg leading-relaxed text-kavya-brown">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const reveal = useScrollReveal();

  return (
    <section id="fitur" className="relative overflow-hidden bg-kavya-cream py-10 md:py-14 lg:py-20">
      <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-kavya-sand/50 to-transparent" />
      <div className="mx-auto max-w-6xl px-4 md:px-8 lg:px-12 xl:px-0">
        <SectionHeader
          icon="ri-dashboard-line"
          badge="Fitur Lengkap"
          title="Dashboard untuk Owner & Reseller"
          subtitle="Kelola bisnis streaming Anda dengan sistem manajemen yang komprehensif dan terintegrasi penuh."
        />
        <div ref={reveal.ref as React.RefObject<HTMLDivElement>} className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featureCards.map(([icon, title, body], index) => (
            <div
              key={title}
              className={classNames(
                "group rounded-2xl border border-kavya-sand/30 bg-white p-7 transition-all duration-700 hover:-translate-y-1 hover:border-kavya-gold/40 hover:shadow-xl",
                revealClass(reveal.revealed),
              )}
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-kavya-sand/30 bg-kavya-cream text-kavya-accent transition-colors group-hover:text-kavya-gold">
                <i className={`${icon} text-2xl`} />
              </span>
              <h3 className="mt-6 text-2xl font-extrabold text-kavya-dark">{title}</h3>
              <p className="mt-4 text-lg leading-relaxed text-kavya-brown">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTAFooter() {
  const reveal = useScrollReveal();

  return (
    <>
      <section className="relative overflow-hidden bg-kavya-charcoal py-16 md:py-20 lg:py-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_50%,rgba(196,168,130,0.24)_0%,transparent_70%)]" />
        <div
          ref={reveal.ref as React.RefObject<HTMLDivElement>}
          className={classNames(
            "relative z-10 mx-auto max-w-4xl px-4 text-center transition-all duration-700 md:px-8",
            revealClass(reveal.revealed, "translate-y-6"),
          )}
        >
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-kavya-gold/30 bg-kavya-gold/10 text-kavya-gold">
            <i className="ri-sparkling-line text-3xl" />
          </span>
          <h2 className="mt-8 text-4xl font-extrabold text-kavya-cream md:text-5xl lg:text-6xl">
            Siap Mulai Bisnis Streaming?
          </h2>
          <p className="mx-auto mt-7 max-w-2xl text-xl leading-relaxed text-kavya-cream/60">
            Bergabung sebagai reseller dan dapatkan akses ke dashboard lengkap dengan harga terbaik dan komisi menarik.
          </p>
          <div className="mt-12 flex flex-col justify-center gap-5 sm:flex-row">
            <a
              href="#produk"
              className="inline-flex h-16 items-center justify-center gap-3 rounded-2xl bg-white px-12 text-xl font-extrabold text-kavya-dark shadow-xl transition-all hover:-translate-y-0.5"
            >
              <i className="ri-compass-3-line" />
              Jelajahi Produk
            </a>
            <Link
              to="/login"
              className="inline-flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-kavya-gold/40 bg-kavya-gold/10 px-12 text-xl font-extrabold text-kavya-cream transition-all hover:-translate-y-0.5 hover:bg-kavya-gold/20"
            >
              <i className="ri-dashboard-3-line" />
              Masuk Dashboard
            </Link>
          </div>
        </div>
      </section>

      <footer id="kontak" className="bg-kavya-charcoal pb-8 pt-16 text-kavya-cream/60">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 border-t border-white/10 px-4 pt-14 sm:grid-cols-2 md:px-8 lg:grid-cols-3 lg:px-12 xl:px-0">
          <div>
            <Link to="/" className="flex items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-xl font-extrabold text-kavya-dark">
                K
              </span>
              <span className="text-3xl font-extrabold text-white">Kavya</span>
            </Link>
            <p className="mt-6 max-w-sm text-lg leading-relaxed">
              Sistem manajemen akun Netflix terlengkap dengan auto-order, stock management, QRIS, integrasi WhatsApp
              untuk kemudahan bisnis streaming Anda.
            </p>
            <div className="mt-8 flex gap-4">
              {["ri-instagram-line", "ri-whatsapp-line", "ri-telegram-line"].map((icon) => (
                <a
                  key={icon}
                  href="#"
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-kavya-cream/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <i className={`${icon} text-xl`} />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-7 text-xl font-extrabold text-white">Menu Cepat</h3>
            <div className="flex flex-col gap-4 text-lg">
              {[
                ["Beranda", "#beranda"],
                ["Produk", "#produk"],
                ["Cara Kerja", "#cara-kerja"],
                ["Fitur", "#fitur"],
                ["Kontak", "#kontak"],
                ["Lacak Pesanan", "/order-tracking"],
                ["Masuk Dashboard", "/login"],
              ].map(([label, href]) => (
                <a key={label} href={href} className="inline-flex items-center gap-3 transition-colors hover:text-white">
                  <i className="ri-arrow-right-s-line text-kavya-gold" />
                  {label}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-7 text-xl font-extrabold text-white">Kontak & Bantuan</h3>
            <div className="flex flex-col gap-4 text-lg">
              {[
                ["ri-phone-line", "087777655549"],
                ["ri-mail-line", "support@kiyaw.com"],
                ["ri-time-line", "Support 24/7"],
              ].map(([icon, label]) => (
                <span key={label} className="inline-flex items-center gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/5">
                    <i className={icon} />
                  </span>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-14 flex max-w-6xl flex-col gap-4 border-t border-white/10 px-4 pt-8 text-sm md:flex-row md:items-center md:justify-between md:px-8 lg:px-12 xl:px-0">
          <span>© 2026 Kavya. All rights reserved.</span>
          <span className="flex gap-8">
            <a href="#" className="hover:text-white">
              Kebijakan Privasi
            </a>
            <a href="#" className="hover:text-white">
              Syarat & Ketentuan
            </a>
          </span>
        </div>
      </footer>
    </>
  );
}

export default function HomePage() {
  return (
    <PageTransition>
      <main className="min-h-screen bg-kavya-linen font-sans text-kavya-dark">
        <PublicNavbar />
        <HeroSection />
        <ProductCatalog />
        <StatsTestimonialsSection />
        <HowItWorksSection />
        <FeaturesSection />
        <CTAFooter />
      </main>
    </PageTransition>
  );
}
