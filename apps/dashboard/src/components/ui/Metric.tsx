import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
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
 * A labelled thing that does one thing when you press it.
 *
 * The reseller's only, and it has two shapes for one reason. As `card` it is
 * the card it always was: a bordered, lifted, self-contained tile for a page
 * that wants a grid of them.
 *
 * As `bare` it is the same object with the box taken off, for when the tile is
 * already sitting on a surface that is glass -- which is the case now that the
 * overview's quick actions live inside a bento cell. A card inside a glass cell
 * puts a second border, a second background and a second shadow inside the
 * first, and the cell stops reading as one pane of glass. Bare, the four
 * actions are four rows on the pane: the icon plate still lifts its own
 * background so the row has a target, and the arrow gives the row the same
 * "this goes somewhere" signal a border used to give it.
 */
export function ActionCard({ title, description, icon, onClick, variant = "card" }: {
  title: string;
  description: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "card" | "bare";
}) {
  return (
    <button
      type="button"
      className={`ui-action-card${variant === "bare" ? " is-bare" : ""}`}
      onClick={onClick}
    >
      {icon ? <span className="ui-action-card-mark" aria-hidden="true">{icon}</span> : null}
      <div className="ui-action-card-text">
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <ArrowRight className="ui-action-card-go" size={15} aria-hidden="true" />
    </button>
  );
}
