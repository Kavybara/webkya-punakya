import type { ReactNode } from "react";

/**
 * A label, a control, and an optional hint that belong together.
 *
 * The wrapper is a `<label>`, which is what lets the control's `id` be an
 * afterthought: clicking the label text focuses the input, and screen readers
 * announce the label with the field. It also means a hint is part of the label
 * -- announced with the field rather than orphaned next to it.
 */
export function Field({ label, children, hint, required }: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="ui-field">
      <span>{label}{required ? <b aria-hidden="true">*</b> : null}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

/** A standalone read-only row: a label on the left, a value on the right. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ui-detail-row"><dt>{label}</dt><dd>{children}</dd></div>;
}
