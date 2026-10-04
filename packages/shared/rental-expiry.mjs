const DAY_MS = 86400000;

/*
 * Shared between the bot plugin and the dashboard's notification service, which
 * are the two places that tell someone when their rental runs out. They used to
 * print only a countdown (`Expired : 95 hari`), which is unreadable a day
 * later: a person who saw that message last week cannot tell what date it
 * pointed at, and `daysLeft` has already moved on since.
 */

const INDONESIAN_MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/*
 * Jakarta, not the server's zone. Rentals are sold and counted in WIB, and the
 * bot already writes every rental timestamp through this zone. Reading an epoch
 * in the server's zone instead would say the 25th on a rental that ends at
 * 23:00 WIB on the 25th, which in UTC is already the 26th.
 */
const JAKARTA_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function jakartaDateParts(ms) {
  const parts = {};
  for (const part of JAKARTA_PARTS.formatToParts(new Date(ms))) parts[part.type] = part.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

/*
 * A bare `YYYY-MM-DD` is a date someone typed, not an instant, so it is read
 * digit by digit. `new Date("2026-09-04")` parses as UTC midnight and lands on
 * the 3rd everywhere west of Greenwich -- an off-by-one on the one number the
 * recipient cannot verify for themselves.
 */
function calendarDateParts(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function calendarDateText(rental = {}) {
  return rental.endsAt ?? rental.endAt ?? rental.expiry ?? "";
}

function epochValue(rental = {}) {
  const raw = rental.expired ?? rental.expiresAt ?? rental.expiredAt;
  const epoch = Number(raw);
  return Number.isFinite(epoch) && epoch > 0 ? epoch : 0;
}

function remainingDays(rental = {}) {
  const days = Math.trunc(Number(rental.daysLeft ?? 0));
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/*
 * Precedence is calendar date, then epoch, then day count -- in that order
 * everywhere. A real date on the record always beats re-deriving one from
 * `daysLeft`, because `daysLeft` is a countdown that is stale the moment it is
 * written, and a date the owner typed is not.
 */
function rentalEndDateParts(rental = {}, now = Date.now()) {
  const calendar = calendarDateParts(calendarDateText(rental));
  if (calendar) return calendar;

  const epoch = epochValue(rental);
  if (epoch) return jakartaDateParts(epoch);

  const days = remainingDays(rental);
  if (days) return jakartaDateParts(now + days * DAY_MS);

  return null;
}

/** "4 September 2026", or "" when the record holds no usable date. */
export function formatRentalEndDate(rental = {}, now = Date.now()) {
  const parts = rentalEndDateParts(rental, now);
  if (!parts) return "";
  return `${parts.day} ${INDONESIAN_MONTHS[parts.month - 1]} ${parts.year}`;
}

/** The end date as an epoch, or 0 when the record holds no usable date. */
export function rentalEndDateMs(rental = {}, now = Date.now()) {
  const calendar = calendarDateParts(calendarDateText(rental));
  if (calendar) return new Date(calendar.year, calendar.month - 1, calendar.day).getTime();

  const epoch = epochValue(rental);
  if (epoch) return epoch;

  const days = remainingDays(rental);
  return days ? now + days * DAY_MS : 0;
}

/** The invite link, or "" -- the one field a rental may legitimately lack. */
export function rentalInviteLink(rental = {}) {
  return String(rental.linkGrub ?? rental.link ?? "").trim();
}