import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function PublicNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { label: "Produk", href: "#produk" },
    { label: "Cara Kerja", href: "#cara-pemesanan" },
    { label: "Reseller", href: "/register" },
    { label: "Bantuan", href: "https://wa.me/6287777655549" },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      aria-label="Navigasi utama"
      className={`fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled
          ? "border-[var(--kavya-border)] bg-[var(--kavya-bg-translucent)] backdrop-blur-xl"
          : "border-transparent bg-transparent"
      }`}
    >
      <div className="px-6 sm:px-10 lg:px-12 xl:px-16">
        <div className="relative mx-auto flex h-16 max-w-[1360px] items-center justify-between">
          <Link
            to="/"
            aria-label="Kavya, kembali ke beranda"
            className="flex items-center gap-2.5 rounded-md text-[var(--kavya-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--kavya-border)] bg-[var(--kavya-surface)]">
              <i className="ri-shield-keyhole-line text-sm" aria-hidden="true" />
            </span>
            <span className="text-base font-extrabold">Kavya</span>
          </Link>

          <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="rounded-full px-3.5 py-2 text-sm font-semibold text-[var(--kavya-text-secondary)] transition-colors hover:text-[var(--kavya-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/login"
              className="hidden min-h-10 items-center justify-center rounded-full border border-[var(--kavya-border)] px-5 text-sm font-bold text-[var(--kavya-text-primary)] transition-colors hover:border-[var(--kavya-border-hover)] hover:bg-[var(--kavya-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white sm:inline-flex"
            >
              Masuk
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--kavya-text-primary)] px-5 text-sm font-extrabold text-[var(--kavya-bg)] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white"
            >
              <span className="hidden sm:inline">Daftar Reseller</span>
              <span className="sm:hidden">Daftar</span>
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((current) => !current)}
              aria-label={menuOpen ? "Tutup menu navigasi" : "Buka menu navigasi"}
              aria-expanded={menuOpen}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--kavya-border)] text-[var(--kavya-text-primary)] transition-colors hover:border-[var(--kavya-border-hover)] hover:bg-[var(--kavya-surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white lg:hidden"
            >
              <i className={menuOpen ? "ri-close-line" : "ri-menu-line"} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {menuOpen ? (
        <div className="mx-4 mb-3 rounded-lg border border-[var(--kavya-border)] bg-[var(--kavya-bg-translucent)] p-2 shadow-2xl backdrop-blur-xl sm:mx-6 lg:hidden">
          <div className="grid gap-1 sm:grid-cols-4">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-md px-4 py-3 text-sm font-semibold text-[var(--kavya-text-secondary)] transition-colors hover:bg-[var(--kavya-surface-hover)] hover:text-[var(--kavya-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {item.label}
              </a>
            ))}
            <Link
              to="/login"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-4 py-3 text-sm font-semibold text-[var(--kavya-text-secondary)] transition-colors hover:bg-[var(--kavya-surface-hover)] hover:text-[var(--kavya-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:hidden"
            >
              Masuk
            </Link>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
