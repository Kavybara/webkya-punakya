import PublicNavbar from "../../components/feature/PublicNavbar";
import { ownerWhatsappDisplay, ownerWhatsappLink } from "../../lib/ownerContact";
import { HeroSection } from "./components/HeroSection";
import "./home.css";

/**
 * The landing page. One screen, and that is the whole design.
 *
 * The reference this was rebuilt against has five things in it: a brand, a
 * sentence, one button, an image, and a contact line. This has the first four
 * and a contact line. The image is the one omission -- there is no asset to
 * put there, and a grey rectangle standing in for a picture of someone's cat
 * would be worse than an empty space.
 *
 * Everything that used to live here moved to `/harga`: the counted figures,
 * the live catalogue, and the brand strip. It had to move rather than be cut,
 * because the catalogue is the only place a price is visible without signing
 * in -- `/katalog`, `/products` and `/order` all sit behind the reseller gate.
 * A simpler homepage is a design decision; an empty one is a dead end.
 *
 * The steps section and the closing CTA are gone outright. The CTA repeated
 * the two buttons the navbar already carries, and the steps explained a
 * checkout the visitor cannot see yet.
 */
const whatsappUrl = ownerWhatsappLink();

export default function HomePage() {
  return (
    <main className="theme-dark flex min-h-screen flex-col font-sans">
      <PublicNavbar />
      <HeroSection />
      <Footer />
    </main>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-4 py-7 text-small text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 md:px-8 lg:px-10">
        {/* A contact line, not a link farm. The navbar already carries every
            destination, and a "Harga" link here only repeated the page you are
            standing on. The label is formatted from the constant rather than
            typed, because the typed copy had drifted from the number the link
            actually dials. */}
        <p>
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--text-primary)]">
            {ownerWhatsappDisplay()}
          </a>
        </p>
        <p>© 2026 Kavya.</p>
      </div>
    </footer>
  );
}
