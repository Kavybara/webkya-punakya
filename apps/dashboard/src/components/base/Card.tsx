import type { ReactNode } from "react";

/*
 * The base kit's card. Also predates the shared `ui` kit, and also predates the
 * redesign -- it was an opaque white sheet with a `border-gray-100`, which on
 * the dark 404 page it actually renders on read as a hole.
 *
 * It is glass now, like every other panel in the product: a translucent sheet
 * with the aurora behind it, separated by what is behind it rather than by a
 * line drawn around it. `Card` gets a shadow and no hover -- it is a container,
 * not a control, and the rule the redesign settled on is that only things you
 * can press move.
 *
 * Kept rather than deleted because two surfaces still reach it. Phase 6 removes
 * this file once those callers move to `ui/`.
 */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lift)] backdrop-blur-[var(--glass-blur)] ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`border-b border-[var(--border)] p-5 ${className}`}>{children}</div>;
}

export function CardTitle({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <h2 className={`text-lg font-semibold text-[var(--text-primary)] ${className}`}>{children}</h2>;
}

export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}
