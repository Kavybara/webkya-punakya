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
