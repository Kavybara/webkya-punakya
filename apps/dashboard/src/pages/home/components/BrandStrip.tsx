import { motion } from "framer-motion";
import { productBrandAsset } from "../../../lib/productBrandAssets";
import type { Catalog } from "../useCatalog";

/**
 * The brands, named.
 *
 * Every tile is a monogram on that brand's own gradient rather than its logo
 * fetched from Google's favicon service. Thirty third-party requests is a
 * real cost on the connection this audience is likely to be on, and the
 * landing page does not need to be right about a logo to be right about the
 * catalogue -- so the logos stay in the catalogue grid, where there are four
 * of them and they are the point of the tile.
 *
 * `tone` per brand already existed in `productBrandAssets` and was unused on
 * this page. It is the one piece of brand art the project already owns.
 */
const MAX_BRANDS = 14;

export function BrandStrip({ catalog }: { catalog: Catalog }) {
  const brands = catalog.products
    .filter((product) => product.isActive !== false)
    .map((product) => ({ asset: productBrandAsset(product), stock: product.stockCount ?? 0 }))
    .slice(0, MAX_BRANDS);

  /* Nothing to say yet. An empty marquee is a strip of blank cards, which
     reads as a rendering fault rather than as "no stock". */
  if (catalog.loading || !brands.length) return null;

  return (
    <section aria-labelledby="brand-heading" className="home-brands">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6 md:px-8 lg:px-10">
        <h2 id="brand-heading" className="sr-only">
          Brand yang tersedia
        </h2>
        <motion.ul
          className="home-brands-list"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.035 } } }}
        >
          {brands.map(({ asset, stock }) => (
            <motion.li
              key={asset.label}
              variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
              className="home-brand"
            >
              <span
                aria-hidden="true"
                className={`home-brand-mark bg-gradient-to-br ${asset.tone}`}
              >
                {asset.label.slice(0, 1).toUpperCase()}
              </span>
              <span className="home-brand-name">{asset.label}</span>
              {/* The dot is the only thing here that is live data, so it is the
                  only thing that can go stale -- and it is below the fold and
                  updates on the same SSE event as everything else. */}
              <span
                className={stock > 0 ? "home-brand-dot" : "home-brand-dot is-empty"}
                title={stock > 0 ? `${stock} stok` : "Stok habis"}
              />
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
