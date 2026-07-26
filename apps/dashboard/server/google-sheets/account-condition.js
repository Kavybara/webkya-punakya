export const ACCOUNT_CONDITIONS = Object.freeze([
  "NORMAL",
  "BERMASALAH",
  "DIPERIKSA",
  "REPLACED",
  "DISABLED",
]);

const CONDITION_SET = new Set(ACCOUNT_CONDITIONS);
const BLOCKING_CONDITIONS = new Set(["BERMASALAH", "DIPERIKSA", "REPLACED", "DISABLED"]);

function headerToken(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\r\n/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function findAccountConditionColumn(header = [], startColumn = 0, endColumn = header.length) {
  const aliases = new Set(["KONDISIAKUN", "KONDISI"]);
  for (let index = Math.max(0, startColumn); index < Math.min(header.length, endColumn); index += 1) {
    if (aliases.has(headerToken(header[index]))) return index;
  }
  return -1;
}

function findHeaderColumn(header = [], aliases = [], startColumn = 0, endColumn = header.length) {
  const wanted = new Set(aliases.map(headerToken));
  for (let index = Math.max(0, startColumn); index < Math.min(header.length, endColumn); index += 1) {
    if (wanted.has(headerToken(header[index]))) return index;
  }
  return -1;
}

export function findStockMetadataColumns(header = [], startColumn = 0, endColumn = header.length) {
  return {
    orderId: findHeaderColumn(
      header,
      ["ORDER ID", "ORDER ID / ID MANUAL", "ORDER ID/ID MANUAL", "ORDER", "ID ORDER"],
      startColumn,
      endColumn,
    ),
    accountCondition: findAccountConditionColumn(header, startColumn, endColumn),
    notes: findHeaderColumn(header, ["CATATAN", "NOTE", "NOTES"], startColumn, endColumn),
  };
}

export function normalizeAccountCondition(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { value: "NORMAL", known: true, empty: true };
  const normalized = raw.toUpperCase();
  if (CONDITION_SET.has(normalized)) {
    return { value: normalized, known: true, empty: false };
  }
  return { value: "UNKNOWN", known: false, empty: false, raw };
}

export function accountConditionAvailability({ seller = "", condition = "" } = {}) {
  const normalized = typeof condition === "object" && condition
    ? condition
    : normalizeAccountCondition(condition);
  const sold = Boolean(String(seller || "").trim());
  const blocked = !normalized.known || BLOCKING_CONDITIONS.has(normalized.value);
  return {
    status: sold ? "sold" : blocked ? "blocked" : "available",
    available: !sold && !blocked,
    sold,
    blocked,
    condition: normalized.value,
    conditionKnown: normalized.known,
    conditionEmpty: normalized.empty,
    conditionRaw: normalized.raw || "",
  };
}

export function accountConditionLabel(value = "") {
  const labels = {
    NORMAL: "Normal",
    BERMASALAH: "Bermasalah",
    DIPERIKSA: "Diperiksa",
    REPLACED: "Diganti",
    DISABLED: "Dinonaktifkan",
    UNKNOWN: "Perlu diperiksa",
  };
  return labels[normalizeAccountCondition(value).value] || labels.UNKNOWN;
}

export function stockBlockedByAccountCondition(stock = {}) {
  if (stock.accountConditionKnown === false || stock.accountConditionBlocked === true) return true;
  return accountConditionAvailability({
    seller: "",
    condition: stock.accountCondition || "",
  }).blocked;
}

export function stockStatusAfterReservationRelease(stock = {}) {
  return stockBlockedByAccountCondition(stock) ? "blocked" : "available";
}
