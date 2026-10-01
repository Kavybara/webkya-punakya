import { formatRupiah } from "../../../lib/format";
import type { ProductPoint } from "./analytics";

/**
 * What is actually selling.
 *
 * Bars are scaled to the top performer rather than to an absolute maximum,
 * because the point is the ranking between products, not the ratio to some
 * ceiling. A bar that is 8% of the width is still legible at that size; a bar
 * that is 0.8% is not, and a product that earned money would read as having
 * earned none.
 */
export function TopProducts({ products, loading }: { products: ProductPoint[]; loading: boolean }) {
  if (loading) return <div className="console-top-products" aria-busy="true" />;
  if (!products.length) {
    return <p className="console-queue-empty">Belum ada pembayaran yang tercatat, jadi belum ada produk terlaris.</p>;
  }
  const max = Math.max(...products.map((product) => product.revenue), 1);
  return (
    <ol className="console-top-products">
      {products.map((product) => (
        <li key={product.name}>
          <span className="console-top-product-name">{product.name}</span>
          <span className="console-top-product-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, (product.revenue / max) * 100)}%` }} />
          </span>
          <span className="console-top-product-value">
            <strong>{formatRupiah(product.revenue)}</strong>
            <small>{product.orders} order</small>
          </span>
        </li>
      ))}
    </ol>
  );
}
