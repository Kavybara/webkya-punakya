import { useEffect, useRef, useState } from "react";
import { api, subscribeRealtime, type CatalogProduct } from "../../lib/api";
import { formatNumber, formatRupiah } from "../../lib/format";

/**
 * The landing page's one copy of the catalogue.
 *
 * It used to be two. The hero fetched `catalogAll()` for its deck of three
 * products, and the catalogue below fetched it again, each into its own
 * `useState`, with nothing shared between them -- so the two could disagree,
 * and every visitor paid for the same `GET /public/catalog?includeEmpty=1`
 * twice. Only the catalogue below listened for the `db-change` SSE event, so
 * the hero's numbers went stale the moment anything was sold and nobody
 * noticed, because the hero's numbers were decoration.
 *
 * One hook, one fetch, one subscription. The hero no longer needs the data at
 * all -- it is four words and a background -- so the strip of real numbers
 * below the fold is now the only other consumer.
 */
export type Catalog = {
  products: CatalogProduct[];
  loading: boolean;
  /** Set when the request failed. A strip of zeroes would be a lie. */
  error: string | null;
  /** Put back in front of the reader by the "Coba Lagi" button. */
  reload: () => void;
};

export function useCatalog(): Catalog {
  const [state, setState] = useState<Omit<Catalog, "reload">>({
    products: [],
    loading: true,
    error: null,
  });

  // The loader is held in a ref so `reload` can reach it without the effect
  // re-subscribing to SSE on every render.
  const loadRef = useRef<(showSkeleton: boolean) => void>(() => undefined);

  useEffect(() => {
    let mounted = true;

    /**
     * `showSkeleton` is the whole reason this takes an argument.
     *
     * The first load and an explicit retry should show the same skeletons the
     * first visit did. A background revalidation must not. Every sale, restock
     * and withdrawal fires `db-change`, and the numbers above the fold would
     * otherwise snap back to four grey bars every time somebody bought
     * something -- the page would flicker at exactly the moment it was telling
     * the truth.
     */
    const load = (showSkeleton: boolean) => {
      if (mounted) {
        setState((current) => ({ ...current, loading: showSkeleton || current.loading, error: null }));
      }

      void api
        .catalogAll()
        .then((catalog) => {
          if (mounted) setState({ products: catalog, loading: false, error: null });
        })
        .catch((reason: unknown) => {
          if (!mounted) return;
          // A failed revalidation must not wipe what is on screen. The visitor
          // is looking at a catalogue that was true a moment ago, and throwing
          // it away for a blip would be worse than showing it slightly stale.
          setState((current) => ({
            ...current,
            loading: false,
            error: current.products.length ? null : reason instanceof Error ? reason.message : "Katalog belum dapat dimuat. Silakan coba lagi.",
          }));
        });
    };

    loadRef.current = load;
    load(true);
    // Anything bought, restocked or withdrawn has to move the numbers on this
    // page too, not just the tiles.
    const stop = subscribeRealtime(() => load(false));

    return () => {
      mounted = false;
      stop();
    };
  }, []);

  return { ...state, reload: () => loadRef.current(true) };
}

/**
 * What the catalogue actually says, as four numbers.
 *
 * This is what replaced the "Preview antarmuka" section, which drew progress
 * bars at 88%, 68% and 48% with no data behind them and a line reading
 * "Nominal pembayaran: Rp --". Those were not placeholders for real figures;
 * they were the only figures on the page, and none of them existed. Every
 * number here is counted out of the response the server already sends.
 */
export type CatalogStats = {
  products: number;
  categories: number;
  stock: number;
  cheapest: number | null;
};

export function catalogStats(products: CatalogProduct[]): CatalogStats {
  const active = products.filter((product) => product.isActive !== false);

  const categories = new Set(
    active.map((product) => product.category?.trim()).filter(Boolean) as string[],
  );

  const stock = active.reduce((total, product) => total + (product.stockCount ?? 0), 0);

  // The lowest price a visitor could actually pay today. `prices` is keyed by
  // duration, so every value in every variant is a price someone can be
  // charged. `null` rather than zero when the catalogue is empty or everything
  // is sold out, because "Rp 0" reads as "it is free".
  const prices = active
    .flatMap((product) => product.variants ?? [])
    .flatMap((variant) => Object.values(variant.prices ?? {}))
    .filter((price) => typeof price === "number" && price > 0);

  return {
    products: active.length,
    categories: categories.size,
    stock,
    cheapest: prices.length ? Math.min(...prices) : null,
  };
}
