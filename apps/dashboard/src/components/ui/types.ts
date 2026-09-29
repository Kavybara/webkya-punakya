/**
 * The one tone vocabulary.
 *
 * It used to exist twice: `ConsoleTone` in the owner console and
 * `ResellerTone` in the reseller. The reseller's carried a "default" the
 * console's did not, so a component that accepted one could not accept the
 * other. `default` is now the neutral of the pair and `muted` stays as the
 * explicit synonym -- nothing should reach for both in the same component.
 */
export type Tone = "default" | "success" | "warning" | "danger" | "info" | "muted";
