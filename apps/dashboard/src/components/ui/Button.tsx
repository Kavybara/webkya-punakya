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
 */
export function Button({
  weight = "secondary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { weight?: ButtonWeight; children?: ReactNode }) {
  const classes = `ui-button is-${weight}${className ? ` ${className}` : ""}`;
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}
