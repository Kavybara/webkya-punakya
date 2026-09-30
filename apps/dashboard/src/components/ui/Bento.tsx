import type { CSSProperties, ElementType, ReactNode } from "react";

/*
 * The bento grid, and the cell that goes in it.
 *
 * Both consoles' overviews were a stack of independent sections: a metric row,
 * then a two-by-two panel grid, then a full-width table. Each section chose its
 * own columns, so the three of them together made a page where nothing lined up
 * -- the eye had to re-find the left edge three times, and the widest thing on
 * the screen was the least important one.
 *
 * A bento is one grid. Every panel declares how much of a twelve-column field
 * it wants and how many rows it needs, and the page stops being a stack of
 * boxes and starts being a composition. That is the whole point: the asymmetry
 * is the information. The balance is the biggest cell because it is the number
 * a reseller opens the page for; the order feed is tall and narrow because it
 * is a list; the table is full width because a table needs columns to be a
 * table.
 *
 * The span is a CSS custom property rather than a class name, so a cell's size
 * is a number in the markup instead of one of forty combinations that would all
 * have to be written out in the stylesheet.
 */

type Span = { col?: number; row?: number };

type BentoCellProps = {
  children: ReactNode;
  /** How much of the twelve-column field this cell takes. */
  span?: Span;
  /** Give this cell the page's hero treatment: deeper glass, a lit edge. */
  emphasis?: boolean;
  className?: string;
  as?: ElementType;
} & Record<string, unknown>;

export function Bento({
  children,
  className = "",
  label,
  rows = 4,
  rowHeight,
}: {
  children: ReactNode;
  className?: string;
  /** The grid is a landmark when the cells are the page's main content. */
  label?: string;
  /**
   * How many rows the field is divided into. Cells span within it, so this is
   * the row height, not the row count -- the grid grows past it on its own when
   * a cell's content is taller than the field asked for.
   */
  rows?: number;
  /**
   * The minimum height of one row, in any CSS length. Set as an inline custom
   * property rather than from a page stylesheet, because the token guard treats
   * any `--*` declaration in a stylesheet as a design token and this is a
   * layout parameter, not one.
   */
  rowHeight?: string;
}) {
  return (
    <div
      className={`ui-bento ${className}`}
      style={
        { "--bento-rows": rows, "--bento-row-height": rowHeight } as CSSProperties
      }
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

/**
 * One cell. `span` is how much of the field it takes; `emphasis` marks the one
 * cell on the page that is the reason the reader came, and gives it the
 * stronger glass and the glow the others do not get.
 *
 * `as` exists so a cell can be a `<section>` when it has its own heading and a
 * `<article>` when it does not, without the caller wrapping it in a div that
 * would break the grid.
 */
export function BentoCell({
  children,
  span = {},
  emphasis = false,
  className = "",
  as: Tag = "article",
  ...rest
}: BentoCellProps) {
  return (
    <Tag
      className={`ui-bento-cell${emphasis ? " is-emphasis" : ""} ${className}`}
      style={
        {
          "--bento-col": span.col ?? 12,
          "--bento-row": span.row ?? 1,
        } as CSSProperties
      }
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A number, as a cell.
 *
 * The obvious way to put a metric in a bento is to wrap the existing `Metric`
 * in a `BentoCell`, and it produces a box inside a box: two borders, two
 * backgrounds, two shadows, and a glass cell whose contents are an opaque
 * card, so the cell stops being glass at all. So the metric is not nested --
 * it *is* the cell.
 *
 * Everything visual is inherited from `.ui-bento-cell` plus the two rules for
 * `.ui-bento-stat` below. The number is set in the same display serif and the
 * same tabular figures as `.ui-metric`, because a dashboard whose headline
 * figures change typeface between the row and the panel above it reads as two
 * products sharing a screen.
 */
export function BentoStat({
  label,
  value,
  hint,
  icon,
  span,
  tone,
  loading,
  error,
  emphasis = false,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  span?: Span;
  tone?: "default" | "info" | "success" | "warning" | "danger";
  /**
   * The number has not arrived. The value area holds a placeholder bar rather
   * than a zero, because a console that reads "Rp 0" while loading is a
   * console that has just told the owner their revenue is nothing.
   */
  loading?: boolean;
  /** This one number could not be read. It says so instead of showing a value. */
  error?: string;
  emphasis?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="ui-bento-stat-head">
        <span>{label}</span>
        {icon ? <i aria-hidden="true">{icon}</i> : null}
      </span>
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

  const toneClass = tone && tone !== "default" ? ` is-${tone}` : "";

  if (!onClick) {
    return (
      <BentoCell span={span} emphasis={emphasis} className={`ui-bento-stat${toneClass}`}>
        {content}
      </BentoCell>
    );
  }

  return (
    <BentoCell
      as="button"
      type="button"
      span={span}
      emphasis={emphasis}
      className={`ui-bento-stat is-link${toneClass}`}
      onClick={onClick}
    >
      {content}
    </BentoCell>
  );
}
