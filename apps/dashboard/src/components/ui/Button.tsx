import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * How loud a button is -- not what it means.
 *
 * This is deliberately not the kit's `Tone`. `Tone` answers "how bad is this"
 * and is used for badges and notices; `ButtonWeight` answers "how much should
 * this compete with the thing next to it". A destructive action is both
 * danger-coloured and quiet by default, which is the whole point of keeping
 * them apart: the two vocabularies answer different questions and conflating
 * them is how a "delete" ends up styled as an ordinary call to action.
 */
export type ButtonWeight = "primary" | "secondary" | "danger" | "quiet";

/**
 * The one button.
 *
 * The kit has carried `.ui-button` styles for a while with no component to go
 * with them, so every caller assembled the class list by hand -- and a page
 * that wanted a destructive action and a quiet one in the same row had to
 * remember the modifier names.
 *
 * `type="button"` is the default rather than the HTML default of `submit`.
 * Both consoles are forms, and a button that was meant to close a panel and
 * silently submits the form behind it is a bug that only shows up for the
 * reader who happens to click it last. Pass `type` explicitly to override.
 *
 * `loading` exists so the busy state cannot be half-declared. Every async
 * button in the app needs the same three things -- disabled, `aria-busy`, and
 * a label that says what is happening -- and the one that gets forgotten is
 * `aria-busy`. Without it a screen reader announces a greyed-out button and
 * stops: the reader is told the control is unavailable but not told that work
 * is underway, which is different information and the reason a reader gives up
 * and presses it a second time. Deriving all three from one prop makes the
 * omission impossible rather than merely discouraged.
 *
 * `aria-busy` is omitted entirely when false, not set to `"false"`: an
 * explicit `aria-busy="false"` is the same as saying nothing, and leaving the
 * attribute off keeps the rendered markup honest about which buttons are
 * actually doing anything.
 */
export function Button({
  weight = "secondary",
  className = "",
  children,
  loading = false,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  weight?: ButtonWeight;
  children?: ReactNode;
  /** A request is in flight for this button. Disables it and marks it busy. */
  loading?: boolean;
}) {
  const classes = `ui-button is-${weight}${className ? ` ${className}` : ""}`;
  return (
    // `type` and `className` before the spread, so an explicit `type` from a
    // caller still wins. `disabled` and `aria-busy` come after it, which is
    // safe precisely because both were destructured out of `rest` above: there
    // is nothing left in `rest` for them to clobber.
    <button type="button" className={classes} {...rest} disabled={disabled || loading} aria-busy={loading || undefined}>
      {children}
    </button>
  );
}
