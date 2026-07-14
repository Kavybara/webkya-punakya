import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";

export default function PublicNavbar() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isHome = location.pathname === "/";

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav
      className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "border-b border-kavya-sand/20 bg-white/95 shadow-sm backdrop-blur-md" : ""
      }`}
    >
      <div className="flex w-full items-center justify-between px-4 py-4 md:px-8 lg:px-12">
        <Link to="/" className="group flex items-center gap-2.5" onClick={closeMenu}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-kavya-dark shadow-sm">
            <i className="ri-shield-keyhole-line text-base text-kavya-cream" />
          </div>
          <span className="text-lg font-extrabold tracking-tight text-kavya-dark">Kavya</span>
        </Link>

        <div className="hidden items-center gap-1 rounded-full border border-kavya-sand/30 bg-white/70 px-2 py-1.5 shadow-sm backdrop-blur-md md:flex">
          {isHome ? (
            <>
              <a
                href="#beranda"
                className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-kavya-charcoal transition-all hover:bg-white hover:text-kavya-espresso hover:shadow-sm"
              >
                Beranda
              </a>
              <a
                href="#produk"
                className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-kavya-charcoal transition-all hover:bg-white hover:text-kavya-espresso hover:shadow-sm"
              >
                Produk
              </a>
              <a
                href="#cara-kerja"
                className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-kavya-charcoal transition-all hover:bg-white hover:text-kavya-espresso hover:shadow-sm"
              >
                Cara Kerja
              </a>
              <a
                href="#fitur"
                className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-kavya-charcoal transition-all hover:bg-white hover:text-kavya-espresso hover:shadow-sm"
              >
                Fitur
              </a>
              <a
                href="#kontak"
                className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-kavya-charcoal transition-all hover:bg-white hover:text-kavya-espresso hover:shadow-sm"
              >
                Kontak
              </a>
            </>
          ) : (
            <>
              <Link
                to="/"
                className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-kavya-charcoal transition-all hover:bg-white hover:text-kavya-espresso hover:shadow-sm"
              >
                Beranda
              </Link>
              <Link
                to="/products"
                className="whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-kavya-charcoal transition-all hover:bg-white hover:text-kavya-espresso hover:shadow-sm"
              >
                Produk
              </Link>
            </>
          )}
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <Link
            to="/track-order"
            className="flex items-center gap-1.5 text-sm font-medium text-kavya-charcoal transition-colors hover:text-kavya-espresso"
          >
            <i className="ri-search-line" />
            Track Order
          </Link>
          <Link
            to="/masuk"
            className="whitespace-nowrap rounded-full border border-kavya-sand/50 bg-white px-5 py-2 text-sm font-semibold text-kavya-dark shadow-sm transition-all hover:border-kavya-sand hover:bg-kavya-cream hover:shadow-md"
          >
            Login
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-kavya-sand/50 bg-white text-kavya-dark md:hidden"
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          <i className={menuOpen ? "ri-close-line" : "ri-menu-line"} />
        </button>
      </div>

      {menuOpen ? (
        <div className="mx-4 mb-4 rounded-2xl border border-kavya-sand/40 bg-white p-3 shadow-xl md:hidden">
          {(isHome
            ? [
                ["Beranda", "#beranda"],
                ["Produk", "#produk"],
                ["Cara Kerja", "#cara-kerja"],
                ["Fitur", "#fitur"],
                ["Kontak", "#kontak"],
                ["Track Order", "/track-order"],
                ["Login", "/masuk"],
              ]
            : [
                ["Beranda", "/"],
                ["Produk", "/products"],
                ["Track Order", "/track-order"],
                ["Login", "/masuk"],
              ]
          ).map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={closeMenu}
              className="flex h-11 items-center rounded-xl px-3 text-sm font-semibold text-kavya-charcoal hover:bg-kavya-cream"
            >
              {label}
            </a>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
