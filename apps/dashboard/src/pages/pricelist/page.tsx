import PublicNavbar from "../../components/feature/PublicNavbar";
import { ownerWhatsappLink } from "../../lib/ownerContact";
import ProductCatalog from "./ProductCatalog";
import { StatsStrip } from "./StatsStrip";
import { useCatalog } from "./useCatalog";
import "./pricelist.css";

/**
 * The price list.
 *
 * This used to be the bottom half of the landing page, which is the only
 * reason the landing page is now able to be a single screen. DelveyFlix -- the
 * reference this page was modelled on -- has the same shape: a homepage with
 * almost nothing in it, and a separate `/pricelist` where the prices live.
 *
 * It had to move rather than simply be deleted, because this is the only
 * surface in the whole product where a price is visible without signing in.
 * `/katalog`, `/products` and `/order` all sit behind the reseller gate, and
 * `/order-tracking` shows order status, not prices. Empty the homepage and the
 * public web stops saying what anything costs.
 *
 * `id="produk"` lives on the catalogue section below and is load-bearing:
 * `/store` redirects here, and the footer still points at it.
 */
export default function PriceListPage() {
  const catalog = useCatalog();

  return (
    <main className="theme-dark flex min-h-screen flex-col font-sans">
      <PublicNavbar />
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-16 sm:px-6 md:px-8 lg:px-10">
        {/* The farm is playing behind this page, so the three blocks of text
            that are not on a surface of their own carry a halo rather than a
            plate. `price-stats` below has a plate because a 4rem figure has no
            glyph edge to hang a shadow off; these do, and a plate here would
            be a box around a heading, which is what this page is trying not
            to be. */}
        <header className="price-header">
          <p className="text-label font-bold uppercase text-[var(--text-muted)]">Katalog</p>
          <h1 className="mt-3 text-display font-extrabold leading-tight tracking-tight text-[var(--text-primary)]">
            Harga.
          </h1>
          <p className="mt-3 max-w-xl text-lede leading-6 text-[var(--text-secondary)]">
            Katalog aktif Kavya. Harga dan ketersediaan mengikuti stok real-time.
          </p>
        </header>

        <StatsStrip catalog={catalog} />
        <ProductCatalog catalog={catalog} />

        <p className="price-note text-small text-[var(--text-secondary)]">
          Butuh harga satuan atau reseller?{" "}
          <a
            href={ownerWhatsappLink()}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-[var(--text-primary)]"
          >
            Chat WhatsApp
          </a>
          .
        </p>
      </div>
    </main>
  );
}
