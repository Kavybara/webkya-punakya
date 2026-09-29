/**
 * Every number and date the owner or a reseller reads, formatted the same
 * way everywhere.
 *
 * The app had four copies of the Indonesian rupiah formatter. Three of them
 * dropped the `IDR` -> `Rp` replacement, so the same balance rendered as
 * "Rp25.000" in the owner console and "IDR 25.000" in the reseller console.
 * Consolidating fixes that, but it is a visible change: the reseller console
 * now shows `Rp` like everywhere else. That is the intended reading, and the
 * redesign absorbs it.
 */

const RUPIAH = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** `Rp25.000` -- the form used for every price, total and balance. */
export function formatRupiah(value: number): string {
  return RUPIAH.format(Number(value) || 0).replace("IDR", "Rp").trim();
}

/**
 * `Rp1,2 jt` / `Rp25 rb` -- for dense tiles where the full amount will not
 * fit. The exact amount stays available on the row it summarises.
 */
export function formatRupiahCompact(value: number): string {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1_000_000) {
    return `Rp${(amount / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `Rp${(amount / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  }
  return formatRupiah(amount);
}

/** A bare grouped number, no currency mark: `25.000`. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

/**
 * The API sends timestamps both as `2026-01-02 03:04:05` and as ISO. The
 * space-separated form parses as local time in some engines and as UTC in
 * others, so normalise before handing it to Date.
 */
function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  const iso = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `02 Jan, 03:04` -- the timestamp format used across both consoles. */
export function formatDateTime(value?: string | null): string {
  const date = toDate(value);
  if (!date) return value || "-";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `02 Jan 2026` -- for dates with no meaningful time of day. */
export function formatDate(value?: string | null): string {
  const date = toDate(value);
  if (!date) return value || "-";
  return date.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * `02 Jan 2026` for a value that may carry a time of day that is not part of
 * what is being shown -- a record's updated-at rendered as a calendar date.
 *
 * The calendar date is read out of the string rather than via `Date`, because
 * parsing first would shift the day for anyone east or west of UTC.
 */
export function formatCalendarDate(value?: string | null): string {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? formatDate(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`) : formatDate(text);
}

/** `02 Jan 2026, 03:04` -- for records where both matter. */
export function formatDateTimeFull(value?: string | null): string {
  const date = toDate(value);
  if (!date) return value || "-";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
