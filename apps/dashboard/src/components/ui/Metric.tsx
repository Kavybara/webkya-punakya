import type { ReactNode } from "react";
import type { Tone } from "./types";

/**
 * A single number with its label, and the row of them.
 *
 * Two implementations. The console's made the label a `<span>`, the value a
 * `<strong>` and the hint a `<small>`; the reseller's added an icon and split
 * the head into its own element. The icon is kept but made optional -- on a
 * page with eight metrics, eight identical lucide icons are wallpaper, and on
 * the ones where the icon carries meaning the caller can still pass it.
 *
 * A metric with an `onClick` renders as a button, not a card that happens to
 * look clickable.
 */
export function Metric({ label, value, hint, icon, tone = "default", loading, error, active, onClick }: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  /**
   * The number has not arrived. The value area holds a placeholder bar rather
   * than a zero, because a dashboard that reads "Rp 0" while loading is a
   * dashboard that has just lied to the owner about their revenue.
   */
  loading?: boolean;
  /** This one number could not be read. It says so instead of showing a value. */
  error?: string;
  /** This metric is a filter and this is the one currently on. */
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="ui-metric-head">
        <span>{label}</span>
        {icon ? <i className={`is-${tone}`} aria-hidden="true">{icon}</i> : null}
      </div>
      {loading ? (
        <span className="ui-metric-pending" aria-label={`${label} sedang dimuat`} />
      ) : error ? (
        <strong className="ui-metric-missing">Tidak tersedia</strong>
      ) : (
        <strong>{value}</strong>
      )}
      {error ? <small>{error}</small> : hint ? <small>{hint}</small> : null}
    </>
  );
  return onClick
    ? (
      <button
        type="button"
        className={`ui-metric is-interactive${active ? " is-active" : ""}`}
        onClick={onClick}
        // A metric that is also a filter has to say which filter is on, or a
        // reader is left inferring it from a border colour.
        aria-pressed={active}
      >
        {content}
      </button>
    )
    : <article className="ui-metric">{content}</article>;
}

export function MetricRow({ items, label }: {
  items: Array<Omit<Parameters<typeof Metric>[0], "value"> & { value: ReactNode }>;
  label?: string;
}) {
  return (
    <section className="ui-metric-row" aria-label={label ?? "Ringkasan data"}>
      {items.map((item) => <Metric key={item.label} {...item} />)}
    </section>
  );
}

/**
 * A labelled square that does one thing.
 *
 * This is the reseller's only. The owner console has no equivalent -- it puts
 * the same shape inline in a grid of hand-written markup on the overview, so
 * the padding, the icon slot and the title/hint pairing are decided per page.
 */
export function ActionCard({ title, description, icon, onClick }: {
  title: string;
  description: string;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="ui-action-card" onClick={onClick}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
    </button>
  );
}
