import { Menu, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { ownerWhatsappLink } from "../../lib/ownerContact";
import "./PublicNavbar.css";

/**
 * The public navbar.
 *
 * Three passes ago this was a full-width bar that turned from nothing into
 * frosted glass 20px into the scroll, and then it was rebuilt as a floating
 * glass pill, because the hero needed something to float over. The hero is now
 * a single flat screen, and glass on a flat background is invisible -- all
 * that survives is the `backdrop-filter` cost and the pill silhouette, neither
 * of which is earning anything. So the bar is plain text on the background
 * now, which is what the reference does.
 *
 * The mobile menu was a `useState` + `useEffect` pair with a resize listener
 * and manual focus return. It is now `<details>`, which is a disclosure widget
 * the platform already implements: keyboard operable and announced by screen
 * readers, with no state to hold. Escape is not among the free behaviours --
 * see `onMenuKeyDown` below for what had to be written by hand.
 *
 * The three-branch `NavLink` stays. The WhatsApp link without `target="_blank"`
 * used to navigate the reader's own tab off the site -- that was a real bug
 * and `rel="noreferrer"` alongside it is because wa.me is a third party and
 * the referrer is not the link's business.
 */
const navItems = [
  { label: "Harga", href: "/harga", internal: true },
  { label: "Lacak", href: "/order-tracking", internal: true },
  { label: "Bantuan", href: ownerWhatsappLink(), external: true },
];

export default function PublicNavbar() {
  return (
    <nav aria-label="Navigasi utama" className="home-nav">
      <div className="home-nav-inner">
        <Link to="/" aria-label="Kavya, kembali ke beranda" className="home-nav-brand">
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
            Daftar
          </Link>

          <details className="home-nav-details" onKeyDown={onMenuKeyDown}>
            <summary className="home-nav-toggle">
              <Menu size={18} aria-hidden="true" />
              <span className="sr-only">Buka menu navigasi</span>
            </summary>
            <div className="home-nav-sheet">
              {navItems.map((item) => (
                <NavLink key={item.label} item={item} onNavigate={closeDetails} />
              ))}
              <Link to="/login" onClick={closeDetails} className="home-nav-sheet-link">
                Masuk
              </Link>
            </div>
          </details>
        </div>
      </div>
    </nav>
  );
}

/**
 * `<details>` is uncontrolled, so there is no state to close it -- the link has
 * to reach into the element and do it by hand, or the menu stays open over
 * whatever it just navigated to.
 */
function closeDetails(event: React.MouseEvent<Element>) {
  (event.currentTarget as Element).closest("details")?.removeAttribute("open");
}

/**
 * Escape closes the menu, and puts focus back on the toggle.
 *
 * This was written here as a comment claiming the platform did it for free,
 * which is not true: `<details>` gets keyboard *opening* from the summary but
 * no Escape handling anywhere. `<dialog>` and `<popover>` close on Escape;
 * `<details>` does not, in any browser. So an open menu could only be
 * dismissed by tabbing through it back to the summary, which is the behaviour
 * this replaced.
 *
 * The listener is a React prop rather than a `useEffect`, so there is nothing
 * to clean up and nothing to leak on unmount. Focus goes home to the summary
 * because closing the disclosure while focus sits inside it strands the
 * keyboard user on `<body>`.
 */
function onMenuKeyDown(event: React.KeyboardEvent<HTMLDetailsElement>) {
  if (event.key !== "Escape" || !event.currentTarget.open) return;
  event.currentTarget.removeAttribute("open");
  event.currentTarget.querySelector("summary")?.focus();
}

function NavLink({
  item,
  onNavigate,
}: {
  item: (typeof navItems)[number];
  onNavigate?: (event: React.MouseEvent<Element>) => void;
}) {
  const className = onNavigate ? "home-nav-sheet-link" : "home-nav-link";

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={className} onClick={onNavigate}>
        {item.label}
      </a>
    );
  }

  return (
    <Link to={item.href} className={className} onClick={onNavigate}>
      {item.label}
    </Link>
  );
}
