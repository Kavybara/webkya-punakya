import { AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { LoadingState } from "../ui";
import { attentionTotal, type AttentionItem } from "./attention";
import "./attention.css";

/**
 * The queue, ordered by what breaks money first.
 *
 * A zero row is not hidden. The reader needs to see "delivery failed: 0" as
 * much as "delivery failed: 4" -- the difference is whether a class of failure
 * is silently not happening, or quietly not being noticed. Only the trailing
 * `info` rows (payments still inside their window) are cut once they are
 * empty, because those are a normal state rather than a thing that could
 * silently be wrong.
 *
 * This used to live under `pages/owner-v2/overview/`, which meant the reseller
 * console could not have one. The rows themselves are console-agnostic -- each
 * carries its own `path`, so the owner queue links into `/owner-v2/*` and a
 * reseller queue links into `/reseller-v2/*` with no branching in here.
 */
export function AttentionQueue({ items, loading, error }: { items: AttentionItem[]; loading: boolean; error?: string }) {
  if (loading) return <LoadingState label="Memuat antrean prioritas" />;
  if (error) {
    return (
      <p className="attention-queue-error" role="status">
        Antrean tidak dapat dihitung: {error}
      </p>
    );
  }
  const actionable = attentionTotal(items);
  const visible = items.filter((item) => item.count > 0 || item.tone !== "info");
  return (
    <>
      <div className="attention-summary">
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
      <div className="attention-list">
        {visible.map((item) => (
          <Link key={item.id} to={item.path} className={item.count ? "has-issue" : ""}>
            <span className={`attention-dot is-${item.tone}`}>{item.count ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
              {/* The reason, when there is one to give. `hint` explains what the
                  row is; this explains why it is happening now, and it is
                  usually the part only the reader can fix -- a product missing a
                  customer email, an account nobody owns. Without it the row was
                  a number to act on blindly. */}
              {item.detail ? <em className="attention-reason">{item.detail}</em> : null}
            </span>
            {/* Who can fix it, said on the row rather than only in the total.
                A reader who lands here from a badge has one question, and it is
                whether the thing in front of them is theirs to do. */}
            <span className={`attention-side is-${item.side}`}>
              {item.side === "you" ? "Kamu" : "Sistem"}
            </span>
            <b>{item.count}</b>
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        ))}
      </div>
      {visible.length === 0 ? <p className="attention-queue-empty">Tidak ada antrean yang aktif di halaman ini.</p> : null}
    </>
  );
}
