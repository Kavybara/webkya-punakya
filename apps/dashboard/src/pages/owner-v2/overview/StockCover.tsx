import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { ErrorState, LoadingState } from "../../../components/ui";
import type { StockSummary } from "./analytics";

/**
 * Stock on hand, and what is about to run out.
 *
 * The previous version drew three progress bars: ready was hardcoded to 100%
 * whenever any ready stock existed, and reserved and sold were shares of
 * unrelated denominators. A full bar for "ready" is not a measurement -- it
 * says "some stock exists" and draws it as "stock is full". What is actually
 * worth knowing is which products are close to gone, so that is what the panel
 * is for.
 *
 * "Close to gone" is measured in days of cover, against that product's own
 * demand from the last seven days, rather than a fixed row count. Three left of
 * a product that sells twenty a week is a problem; three left of one that sells
 * once a month is not, and a count-based threshold cannot tell them apart.
 */
export function StockCover({ stock, loading, error, onRetry }: { stock: StockSummary; loading: boolean; error?: string; onRetry: () => void }) {
  if (loading) return <LoadingState label="Memuat status stok" />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  return (
    <>
      <div className="console-stock-counts">
        <div>
          <span>Siap</span>
          <strong>{stock.ready}</strong>
        </div>
        <div>
          <span>Reserved</span>
          <strong>{stock.reserved}</strong>
        </div>
        <div>
          <span>Terjual</span>
          <strong>{stock.sold}</strong>
        </div>
      </div>
      {stock.lowStock.length ? (
        <div className="console-low-stock">
          <p className="console-low-stock-head">
            <strong>{stock.lowStock.length}</strong> produk akan habis
          </p>
          <ul>
            {stock.lowStock.slice(0, 5).map((item) => (
              <li key={item.product}>
                <span>{item.product}</span>
                <b>
                  {item.ready} sisa
                  {item.daysOfCover === null ? " · laju lambat" : ` · ${item.daysOfCover} hari`}
                </b>
              </li>
            ))}
          </ul>
          {stock.lowStock.length > 5 ? <p className="console-low-stock-more">+{stock.lowStock.length - 5} produk lain</p> : null}
        </div>
      ) : (
        <p className="console-queue-empty">Semua produk punya persediaan di atas 3 hari cover.</p>
      )}
      <Link to="/owner-v2/stock" className="console-panel-link">
        Kelola stok akun <ArrowUpRight size={14} />
      </Link>
    </>
  );
}
