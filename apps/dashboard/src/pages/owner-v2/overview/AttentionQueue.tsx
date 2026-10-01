import { AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { LoadingState } from "../../../components/ui";
import { attentionTotal, type AttentionItem } from "./analytics";

/**
 * The queue, ordered by what breaks money first.
 *
 * A zero row is not hidden. The owner needs to see "delivery failed: 0" as much
 * as "delivery failed: 4" -- the difference is whether a class of failure is
 * silently not happening, or quietly not being noticed. Only the trailing
 * `info` rows (payments still inside their window) are cut once they are
 * empty, because those are a normal state rather than a thing that could
 * silently be wrong.
 */
export function AttentionQueue({ items, loading, error }: { items: AttentionItem[]; loading: boolean; error?: string }) {
  if (loading) return <LoadingState label="Memuat antrean prioritas" />;
  if (error) {
    return (
      <p className="console-queue-error" role="status">
        Antrean tidak dapat dihitung: {error}
      </p>
    );
  }
  const actionable = attentionTotal(items);
  const visible = items.filter((item) => item.count > 0 || item.tone !== "info");
  return (
    <>
      <div className="console-attention-summary">
        {actionable > 0 ? (
          <p>
            <strong>{actionable}</strong> hal perlu ditangani
          </p>
        ) : (
          <p className="is-clear">
            <CheckCircle2 size={15} /> Semua antrean bersih
          </p>
        )}
      </div>
      <div className="console-attention-list">
        {visible.map((item) => (
          <Link key={item.id} to={item.path} className={item.count ? "has-issue" : ""}>
            <span className={`console-attention-dot is-${item.tone}`}>{item.count ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </span>
            <b>{item.count}</b>
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        ))}
      </div>
      {visible.length === 0 ? <p className="console-queue-empty">Tidak ada antrean yang aktif. Semua orderpaid sudah terkirim dan stok masih aman.</p> : null}
    </>
  );
}
