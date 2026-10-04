function durationRank(label = "") {
  const value = String(label || "").trim().toLowerCase();
  const amount = Number(value.match(/\d+/)?.[0] || 0);
  if (/bulan|month|\bb\b/.test(value)) return amount || 999;
  if (/tahun|year|\by\b/.test(value)) return (amount || 999) * 12;
  if (/minggu|week|\bw\b/.test(value)) return 10_000 + (amount || 999) * 7;
  if (/hari|day|\bd\b|\bh\b/.test(value)) return 20_000 + (amount || 999);
  return 99_000 + (amount || 999);
}

export type DurationModes = {
  daily?: boolean;
  monthly?: boolean;
};

export function normalizedDurationModes(modes?: DurationModes) {
  return {
    daily: modes?.daily !== false,
    monthly: modes?.monthly !== false,
  };
}

export function isDailyDuration(label = "") {
  const value = String(label || "").trim().toLowerCase();
  return /\d+\s*(?:d|h)\b/.test(value) || value.includes("hari") || value.includes("day");
}

export function isMonthlyDuration(label = "") {
  const value = String(label || "").trim().toLowerCase();
  return (
    value.includes("bulan") ||
    value.includes("month") ||
    value.includes("tahun") ||
    value.includes("year") ||
    value.includes("lifetime") ||
    /\d+\s*(?:b|y)\b/.test(value)
  );
}

export function durationAllowedByModes(label = "", modes?: DurationModes) {
  const normalized = normalizedDurationModes(modes);
  if (isDailyDuration(label)) return normalized.daily;
  if (isMonthlyDuration(label)) return normalized.monthly;
  return true;
}

export function filterPricesByDurationModes(prices: Record<string, number> = {}, modes?: DurationModes) {
  return Object.fromEntries(Object.entries(prices).filter(([duration]) => durationAllowedByModes(duration, modes)));
}

export function sortedPriceEntries(prices: Record<string, number> = {}) {
  return Object.entries(prices).sort(([leftDuration], [rightDuration]) => {
    const rankDiff = durationRank(leftDuration) - durationRank(rightDuration);
    return rankDiff || leftDuration.localeCompare(rightDuration, "id", { numeric: true, sensitivity: "base" });
  });
}

export function firstPriceEntry(prices: Record<string, number> = {}) {
  return sortedPriceEntries(prices)[0] || ["1 Bulan", 0];
}

export function sortedAllowedPriceEntries(prices: Record<string, number> = {}, modes?: DurationModes) {
  return sortedPriceEntries(filterPricesByDurationModes(prices, modes));
}

export function firstAllowedPriceEntry(prices: Record<string, number> = {}, modes?: DurationModes) {
  return sortedAllowedPriceEntries(prices, modes)[0] || firstPriceEntry(prices);
}

/**
 * Whole days, or nothing.
 *
 * The daily-assign form guards its duration field with
 * `Number(value) <= 0`, which `"0.5"` passes -- and `Math.floor(0.5)` is `0`,
 * so the request goes out asking for a zero-day rental. The server clamps that
 * back up to 1 (`Math.max(1, Math.floor(Number(body.durationDays || 1)))`), so
 * the owner got a full day and no indication that the number they typed had
 * been rounded away.
 *
 * Flooring first and then checking the *floored* value is the only order that
 * agrees with what the server will store. Returning 0 rather than throwing lets
 * the caller own the message, because "this field is wrong" needs the field's
 * own vocabulary, not a generic exception.
 */
export function parsedDurationDays(value: string): number {
  const days = Math.floor(Number(value));
  return Number.isFinite(days) && days >= 1 ? days : 0;
}

/**
 * The date a daily assignment expires, as `YYYY-MM-DD`.
 *
 * `buildDailyStockAssignment` derives `expiresAt` with
 * `addAccountDaysText(durationDayCount, startedAt, { keepTime: true })`, which
 * is `date + days * 86400000`. This mirrors that rather than inventing its own
 * rule, because the preview shown in the form becomes a promise to the reseller,
 * and a preview that disagrees with what the server stores is worse than none.
 *
 * The start date is split into plain `YYYY-MM-DD` parts and rebuilt locally for
 * the same reason `formatCalendarDate` does it: `new Date("2026-01-02")`
 * parses as UTC, which lands on the previous day for anyone west of Greenwich.
 *
 * The parts are then checked against the Date they produced, because the
 * `Date` constructor normalises overflow rather than rejecting it: month 13
 * becomes January of the next year, and 30 February becomes 2 March. A
 * `<input type="date">` will not emit either, but a hand-edited or restored
 * form value can, and a preview that quietly shows January is worse than no
 * preview at all.
 *
 * Returns "" when either input is unusable, so the caller hides the preview
 * rather than rendering a date nobody should believe.
 */
export function dailyEndDate(startedAt: string, durationDays: string): string {
  const days = parsedDurationDays(durationDays);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startedAt || "").trim());
  if (!days || !parts) return "";

  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) return "";

  const end = new Date(year, month - 1, day + days);
  if (Number.isNaN(end.getTime())) return "";
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
}
