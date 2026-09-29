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
export function Metric({ label, value, hint, icon, tone = "default", onClick }: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="ui-metric-head">
        <span>{label}</span>
        {icon ? <i className={`is-${tone}`} aria-hidden="true">{icon}</i> : null}
      </div>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </>
  );
  return onClick
    ? <button type="button" className="ui-metric is-interactive" onClick={onClick}>{content}</button>
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
