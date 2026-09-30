import { motion } from "framer-motion";
import { formatNumber, formatRupiah } from "../../../lib/format";
import { catalogStats, type Catalog } from "../useCatalog";

/**
 * Four numbers, counted.
 *
 * This section replaces the "Preview antarmuka" bento, which drew three
 * progress bars at 88%, 68% and 48% and a line reading "Nominal pembayaran:
 * Rp --". None of those figures came from anywhere. They were not unfinished
 * placeholders waiting on an API -- they were the only numbers the section
 * had, under headings that said "Stok" and "Paket aktif", so a visitor
 * reading them was being told the business's inventory levels by three
 * invented percentages.
 *
 * Everything here is counted out of the same response the catalogue below is
 * rendered from, so the two can never disagree.
 *
 * The catalogue is a prop rather than a second `useCatalog()` call on purpose.
 * Two components each opening their own subscription would be the same
 * duplicated fetch this section was written to remove, just further down the
 * file.
 */
function figures(stats: ReturnType<typeof catalogStats>) {
  return [
    { label: "Produk tersedia", value: formatNumber(stats.products) },
    { label: "Kategori", value: formatNumber(stats.categories) },
    { label: "Stok siap kirim", value: formatNumber(stats.stock) },
    {
      label: "Mulai dari",
      // `null` rather than "Rp 0" when nothing is priced. Zero reads as free,
      // and "Rp 0" on a page selling paid accounts is the sort of thing that
      // gets screenshotted.
      value: stats.cheapest === null ? "—" : formatRupiah(stats.cheapest),
    },
  ];
}

export function StatsStrip({ catalog }: { catalog: Catalog }) {
  const stats = catalogStats(catalog.products);

  return (
    <section aria-labelledby="angka-heading" className="home-stats">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6 md:px-8 lg:px-10">
        <h2 id="angka-heading" className="sr-only">
          Angka katalog saat ini
        </h2>

        {catalog.error ? (
          /* Stated, not smoothed over. Four zeroes would be a claim about the
             business that nobody has evidence for. */
          <p role="status" className="text-sm text-[var(--text-secondary)]">
            Angka katalog tidak dapat dimuat saat ini.
          </p>
        ) : (
          <motion.dl
            className="home-stats-grid"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.4 }}
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }}
          >
            {figures(stats).map((figure) => (
              <motion.div
                key={figure.label}
                variants={{ hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } }}
                className="home-stat"
              >
                {/* The number has not arrived. A bar, never a zero -- a page
                    that reads "0" while loading has just lied about the
                    catalogue. */}
                <dd className={catalog.loading ? "home-stat-value is-pending" : "home-stat-value"}>
                  {catalog.loading ? <span className="sr-only">sedang dimuat</span> : figure.value}
                </dd>
                <dt className="home-stat-label">{figure.label}</dt>
              </motion.div>
            ))}
          </motion.dl>
        )}
      </div>
    </section>
  );
}
