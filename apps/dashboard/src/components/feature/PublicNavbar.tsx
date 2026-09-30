import { useEffect, useRef, useState } from "react";
import { Menu, ShieldCheck, X } from "lucide-react";
import { Link } from "react-router-dom";
import { ownerWhatsappLink } from "../../lib/ownerContact";

/**
 * The floating navbar.
 *
 * It used to be a full-width bar that went from nothing to glass the moment
 * you scrolled 20px. On a 100vh hero that reads as a bar that is waiting to
 * appear, and it takes the full width of the screen to do it -- so the first
 * screen was framed by a chrome edge rather than floating over the
 * background. It is inset now, and always glass, so the aurora is visible
 * behind and around it and the hero is a composition rather than a page with a
 * header stuck to the top.
 *
 * On the links: the design this replaced pointed at "About", "Products" and
 * "FAQ". There is no About page and there is no FAQ, and inventing two would
 * be inventing two empty pages to hang links off. Every destination below
 * exists. A real FAQ is a separate piece of work with real answers in it,
 * and it should not be faked with a heading.
 */
const navItems = [
  { label: "Produk", href: "#produk" },
  { label: "Cara Kerja", href: "#cara-pemesanan" },
  { label: "Lacak", href: "/order-tracking", internal: true },
  { label: "Bantuan", href: ownerWhatsappLink(), external: true },
];

export default function PublicNavbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  /* A menu left open behind a scroll is a menu floating over content it no
     longer describes. Escape closes it because a disclosure that swallows
     Escape strands a keyboard user who cannot see where focus went, and focus
     returns to the button that opened it so Tab picks up from the bar again
     rather than from wherever the last link happened to be. */
  useEffect(() => {
    if (!menuOpen) return;

    const close = () => setMenuOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      toggleRef.current?.focus();
    };

    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <nav aria-label="Navigasi utama" className="home-nav">
      <div className="home-nav-inner">
        <Link
          to="/"
          aria-label="Kavya, kembali ke beranda"
          className="home-nav-brand"
        >
          <span className="home-nav-mark">
            <ShieldCheck size={15} aria-hidden="true" />
          </span>
          <span className="text-base font-extrabold">Kavya</span>
        </Link>

        <div className="home-nav-links">
          {navItems.map((item) => (
            <NavLink key={item.label} item={item} />
          ))}
        </div>

        <div className="home-nav-actions">
          <Link to="/login" className="home-nav-login">
            Masuk
          </Link>
          <Link to="/register" className="home-nav-signup">
            <span className="hidden sm:inline">Daftar Reseller</span>
            <span className="sm:hidden">Daftar</span>
          </Link>
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            aria-label={menuOpen ? "Tutup menu navigasi" : "Buka menu navigasi"}
            aria-expanded={menuOpen}
            aria-controls="home-nav-menu"
            className="home-nav-toggle"
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div id="home-nav-menu" className="home-nav-sheet">
          {navItems.map((item) => (
            <NavLink key={item.label} item={item} onNavigate={() => setMenuOpen(false)} />
          ))}
          <Link to="/login" onClick={() => setMenuOpen(false)} className="home-nav-sheet-link">
            Masuk
          </Link>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * One link, three destinations.
 *
 * `external` is the case that was a bug: the WhatsApp link had no
 * `target="_blank"`, so "Bantuan" navigated the reader's own tab away from
 * the site to wa.me, with no way back. `noreferrer` alongside it because
 * wa.me is a third party and the referrer is not the link's business.
 */
function NavLink({
  item,
  onNavigate,
}: {
  item: (typeof navItems)[number];
  onNavigate?: () => void;
}) {
  const className = onNavigate ? "home-nav-sheet-link" : "home-nav-link";

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={className} onClick={onNavigate}>
        {item.label}
      </a>
    );
  }

  if (item.internal) {
    return (
      <Link to={item.href} className={className} onClick={onNavigate}>
        {item.label}
      </Link>
    );
  }

  return (
    <a href={item.href} className={className} onClick={onNavigate}>
      {item.label}
    </a>
  );
}
