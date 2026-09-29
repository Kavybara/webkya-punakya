const DAY_MS = 86400000;
export const RENTAL_MONTH_DAYS = 30;

function finitePositiveInteger(value, fallback = 0) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function dateFromText(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    date.setHours(0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function dateInputText(value = "") {
  const date = dateFromText(value);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysToDateText(startedAt = "", days = 0) {
  const date = dateFromText(startedAt) || new Date();
  date.setHours(0, 0, 0, 0);
  date.setTime(date.getTime() + Math.trunc(Number(days || 0)) * DAY_MS);
  return dateInputText(date.toISOString());
}

export function daysFromRentalDuration({ months = 0, days = 0 } = {}) {
  const monthCount = Math.min(12, finitePositiveInteger(months, 0));
  const dayCount = finitePositiveInteger(days, 0);
  return monthCount * RENTAL_MONTH_DAYS + dayCount;
}

export function rentalAdjustmentDays(payload = {}) {
  const unit = String(payload.unit || payload.adjustmentUnit || "day").toLowerCase();
  const amount = finitePositiveInteger(payload.amount ?? payload.adjustmentAmount, 0);
  const direction = String(payload.direction || payload.adjustmentDirection || "add").toLowerCase();
  if (!amount) return 0;
  const multiplier = unit === "month" || unit === "months" || unit === "bulan" ? RENTAL_MONTH_DAYS : 1;
  const delta = amount * multiplier;
  return direction === "subtract" || direction === "reduce" || direction === "minus" ? -delta : delta;
}

export function rentalAdjustmentLabel(payload = {}) {
  const delta = rentalAdjustmentDays(payload);
  if (!delta) return "";
  const unit = String(payload.unit || payload.adjustmentUnit || "day").toLowerCase();
  const amount = finitePositiveInteger(payload.amount ?? payload.adjustmentAmount, Math.abs(delta));
  const label = unit === "month" || unit === "months" || unit === "bulan" ? "bulan" : "hari";
  return `${delta > 0 ? "+" : "-"}${amount} ${label}`;
}
