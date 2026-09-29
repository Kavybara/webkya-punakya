import type { ReactNode } from "react";
import type { Tone } from "./types";

/**
 * A status pill.
 *
 * Two implementations existed. The console's drew its own dot in front of the
 * label; the reseller's did not, so an order status looked like it had lost
 * something next to the same status elsewhere. The dot is the one that carries
 * the meaning -- for anyone who cannot separate the tone from the text -- so it
 * is not optional here.
 */
export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`ui-badge is-${tone}`}><span aria-hidden="true" />{children}</span>;
}
