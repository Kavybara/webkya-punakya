/**
 * What a page owes the person reading it.
 *
 * This started life inside `pages/owner-v2/overview/analytics.ts`, which is the
 * one page that reads five collections at once and has to turn them into a
 * morning's worth of answers. That was a reasonable place for it *there*. It
 * was not a reasonable place for it to stay, because a definition of "what
 * needs attention" that only one page can reach is a definition the other
 * twenty-one pages cannot use -- and so they each grew their own, or grew
 * none.
 *
 * The two shapes that grew, before this file existed:
 *
 *   - Four owner pages passed `systemState={error ? "unknown" : "healthy"}`.
 *     That is a page reporting that the system is fine, on every visit, having
 *     looked at nothing. `products` said "Operasional normal" while sitting on
 *     a frozen order. `activities` said it while showing a security log. Those
 *     are not honest readings; they are a hardcoded default that reads like a
 *     measurement.
 *   - All seven reseller pages passed nothing at all, because `ResellerShell`
 *     did not accept the props. A reseller whose only delivery failed had no
 *     way to learn it from the frame, only by opening the orders page and
 *     reading every row.
 *
 * So the type, the total, and the arithmetic that turns a count into a state
 * live here, and both consoles import them. The state arithmetic in particular
 * was written fourteen times, once per page, and got it subtly different ways
 * each time -- see `systemStateFor` below for the two ways that were wrong.
 */

/** How loud a row is allowed to be. `info` rows never count toward the total. */
export type AttentionTone = "danger" | "warning" | "info";

/**
 * Who can actually make this stop.
 *
 * This is the "kamu vs sistem" distinction, and it exists because lumping the
 * two together is worse than not counting at all. An owner told "4 stock
 * anomalies" goes to Google Sheets, looks for a row they typed wrong, and does
 * not find one -- because three of the four were the system disagreeing with
 * itself, and no edit to a spreadsheet resolves that. The row taught them the
 * queue was not actionable, and every later row had to work harder to be
 * believed.
 *
 * `you` means the fix is a data edit or a decision the reader makes.
 * `system` means nothing they do will change it today; it is a bug report,
 * not a task.
 */
export type AttentionSide = "you" | "system";

export type AttentionItem = {
  id: string;
  label: string;
  count: number;
  hint: string;
  /**
   * The concrete reason behind the count, in the reader's terms, or omitted
   * when the queue cannot name one.
   *
   * `hint` says what the row *is*. `detail` says *why this one is happening
   * right now* -- usually the thing only they can fix, like a product missing
   * a customer email. Without it a count is a number to act on blindly, and
   * the only way to learn the cause was to open each row one by one.
   */
  detail?: string;
  tone: AttentionTone;
  side: AttentionSide;
  /**
   * Where clicking goes, carrying enough state to land on the thing that needs
   * fixing. A path that opens a page of forty unrelated rows and makes the
   * reader find the N again is not a link, it is a rumour.
   */
  path: string;
};

/** The four states a frame can report about itself. */
export type SystemState = "loading" | "healthy" | "warning" | "unknown";

/**
 * Only the rows that need a decision.
 *
 * `info` is excluded because it describes a normal condition rather than a
 * fault -- a QRIS still inside its payment window is working. Counting it
 * would make a healthy system report a number, and a number on a status pill
 * is read as a problem.
 */
export function attentionTotal(items: AttentionItem[]) {
  return items.filter((item) => item.tone !== "info").reduce((sum, item) => sum + item.count, 0);
}

/**
 * The one piece of arithmetic that decides what the status pill says.
 *
 * This is deliberately a function and not fourteen inline ternaries, because
 * the inline versions disagreed with each other in two ways that both made the
 * pill lie:
 *
 *   1. `warranty/page.tsx` counted `activeClaims.length` but branched on
 *      `activeFailures.length`. Four claims open, none failing: the pill went
 *      green while the count beside it read 4. `stock/page.tsx` did the same
 *      shape with reserved stock against maintenance mode.
 *   2. Every page that had no count wrote `: "healthy"` as the fallback, so a
 *      page that computed nothing claimed everything was fine.
 *
 * A caller cannot express either mistake here. The count and the state come
 * from the same number.
 */
export function systemStateFor(count: number, options: { error?: boolean; loading?: boolean } = {}): SystemState {
  if (options.error) return "unknown";
  if (options.loading) return "loading";
  return count > 0 ? "warning" : "healthy";
}

/** The pill's words, in one place so both consoles say the same thing. */
export function systemStateLabel(state: SystemState, count: number) {
  if (state === "loading") return "Memeriksa sistem";
  if (state === "unknown") return "Status belum tersedia";
  if (state === "warning") return `${count} perlu perhatian`;
  return "Operasional normal";
}

/**
 * The four pages that have nothing to measure, and why.
 *
 * A page earns attention from data it actually holds. The two reseller pages
 * are the obvious cases -- `guides` is a help page with no collection behind
 * it, and `settings` is a form whose only inputs are the reader's own. The two
 * owner pages are less obvious and more interesting: `activities` is a log and
 * `settings` is a form, and both *have* collections and both could produce a
 * number. They are on this list because the number would be a lie.
 *
 *   - `activities`: every row is a record of something that already happened and
 *     was already handled. The newest entry is not "next" anything. Counting the
 *     `security` rows -- which the page already badges as noteworthy in the
 *     table -- would turn a log into a to-do list, and the cost of that is worse
 *     than the cost of not counting: the owner learns that an amber pill can be
 *     dismissed without reading it.
 *   - `settings`: a profile form and a password form. There is nothing queued,
 *     blocked, or overdue. The only thing here worth surfacing is a failed
 *     save, and that is already the `Notice` on the page.
 *
 * Neither is lying by omitting the count -- there is nothing to count. What
 * they must not do is *assert* health, so they pass no count at all and the
 * pill does not render, rather than passing zero and having it read as a clean
 * bill of health they never checked for. That distinction is the whole reason
 * both shells render the pill conditionally instead of defaulting.
 *
 * A page that wants out of this list has to name it in its own source --
 * `attention-invariant.test.mjs` greps each page for the string
 * `PAGES_WITHOUT_ATTENTION` and fails if the page is listed here without
 * pointing back, or pointed at without being listed. That way adding a new
 * static page is a visible act rather than a silent default, and a stale entry
 * cannot outlive the reason that justified it.
 */
export const PAGES_WITHOUT_ATTENTION = [
  "pages/owner-v2/activities/page.tsx",
  "pages/owner-v2/settings/page.tsx",
  "pages/reseller-v2/guides/page.tsx",
  "pages/reseller-v2/settings/page.tsx",
] as const;
