import { readFile } from "node:fs/promises";
import path from "node:path";

const RENTAL_DIRECTORY_CACHE_MS = 30_000;
const EXPIRED_GROUP_OWNER_COMMANDS = new Set(["ceksewa", "sewabot", "tambahsewa", "delsewa"]);
const INDONESIAN_MONTHS = new Map([
  ["jan", 0],
  ["januari", 0],
  ["feb", 1],
  ["februari", 1],
  ["mar", 2],
  ["maret", 2],
  ["apr", 3],
  ["april", 3],
  ["mei", 4],
  ["jun", 5],
  ["juni", 5],
  ["jul", 6],
  ["juli", 6],
  ["agu", 7],
  ["agustus", 7],
  ["sep", 8],
  ["sept", 8],
  ["september", 8],
  ["okt", 9],
  ["oktober", 9],
  ["nov", 10],
  ["november", 10],
  ["des", 11],
  ["desember", 11],
]);
let rentalDirectoryCache = {
  expiresAt: 0,
  sources: [],
};

function parseLocalDateText(value = "") {
  const text = String(value || "").trim();
  if (!text) return 0;
  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]) - 1;
    const day = Number(isoDate[3]);
    const timestamp = new Date(year, month, day, 23, 59, 59, 999).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  const slashDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashDate) {
    const day = Number(slashDate[1]);
    const month = Number(slashDate[2]) - 1;
    const year = Number(slashDate[3]);
    const timestamp = new Date(year, month, day, 23, 59, 59, 999).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  const localized = text.match(/^(\d{1,2})\s+([A-Za-z\u00C0-\u024F]+)\s+(\d{4})$/i);
  if (localized) {
    const day = Number(localized[1]);
    const monthName = localized[2].toLowerCase();
    const month = INDONESIAN_MONTHS.get(monthName);
    const year = Number(localized[3]);
    if (month !== undefined) {
      const timestamp = new Date(year, month, day, 23, 59, 59, 999).getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    }
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rentalExpirationMs(rental = {}) {
  if (!rental || typeof rental !== "object") return 0;
  const values = [rental.expired, rental.expiresAt, rental.expiredAt, rental.endsAt, rental.endAt, rental.end];
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
      const timestamp = Number(value);
      if (Number.isFinite(timestamp) && timestamp > 0) return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
    }
    const parsed = parseLocalDateText(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

export function rentalDaysLeft(rental = {}) {
  if (!rental || typeof rental !== "object") return 0;
  const expiresAt = rentalExpirationMs(rental);
  if (expiresAt > 0) return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));
  const direct = Number(rental.daysLeft ?? rental.remaining_days ?? rental.remainingDays ?? 0);
  return Number.isFinite(direct) ? Math.max(0, Math.ceil(direct)) : 0;
}

function rentalIsExpired(rental = {}) {
  if (!rental || typeof rental !== "object") return false;
  const status = String(rental.status || "").trim().toLowerCase();
  if (["expired", "paused", "stopped", "disabled", "inactive"].includes(status)) return true;
  const expiresAt = rentalExpirationMs(rental);
  if (expiresAt > 0) return expiresAt <= Date.now();
  const direct = Number(rental.daysLeft ?? rental.remaining_days ?? rental.remainingDays);
  return Number.isFinite(direct) && direct <= 0;
}

async function readJsonObject(filePath = "") {
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function rentalMapFromRows(rows = []) {
  const result = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const groupJid = String(row.groupJid || row.group_jid || row.id || "").trim();
    if (!groupJid.endsWith("@g.us")) continue;
    result[groupJid] = row;
  }
  return result;
}

function rentalDirectoryHasEntries(data = {}) {
  return Boolean(data && typeof data === "object" && Object.keys(data).length > 0);
}

function rentalFromDirectory(data = {}, groupJid = "") {
  if (!data || typeof data !== "object" || !groupJid) return null;
  if (data[groupJid]) return data[groupJid];
  return Object.values(data).find((row) => {
    if (!row || typeof row !== "object") return false;
    return [row.groupJid, row.group_jid, row.id].map((value) => String(value || "").trim()).includes(groupJid);
  }) || null;
}

export function resetRentalGateCache() {
  rentalDirectoryCache = { expiresAt: 0, sources: [] };
}

export async function readDashboardRentalSources(config = {}) {
  const now = Date.now();
  if (!config.dashboardDatabasePath && rentalDirectoryCache.expiresAt > now) return rentalDirectoryCache.sources;

  const projectRoot = config.paths?.projectRoot || process.cwd();
  const sources = [];
  const dashboardDb = await readJsonObject(config.dashboardDatabasePath);
  const dashboardRentals = rentalMapFromRows(dashboardDb?.whatsappRentals || []);
  if (config.dashboardDatabasePath) {
    sources.push({ name: "dashboard-db.whatsappRentals", data: dashboardRentals, authoritative: true });
    rentalDirectoryCache = { expiresAt: now + RENTAL_DIRECTORY_CACHE_MS, sources };
    return sources;
  }

  const candidates = [
    process.env.WHATSAPP_RENTALS_PATH,
    path.join(projectRoot, "apps", "dashboard", "runtime", "whatsapp-database", "rentals.json"),
    path.join(projectRoot, "kavya-digital-dashboard", "runtime", "whatsapp-database", "rentals.json"),
    path.join(projectRoot, "runtime", "whatsapp-database", "rentals.json"),
  ].filter(Boolean);
  for (const filePath of [...new Set(candidates)]) {
    const data = await readJsonObject(filePath);
    if (rentalDirectoryHasEntries(data)) sources.push({ name: filePath, data });
  }

  rentalDirectoryCache = { expiresAt: now + RENTAL_DIRECTORY_CACHE_MS, sources };
  return sources;
}

export async function shouldBlockExpiredGroup({ store, remoteJid, commandInfo, isOwner, config }) {
  const allowOwnerRentalCommand = Boolean(isOwner && EXPIRED_GROUP_OWNER_COMMANDS.has(commandInfo.command));
  const dashboardSources = await readDashboardRentalSources(config);
  const dashboardAuthoritative = dashboardSources.some((source) => source.authoritative);
  const sources = dashboardAuthoritative
    ? dashboardSources
    : [...dashboardSources, { name: "bot-store.rentals", data: await store.read("rentals", {}) }];
  const match = sources
    .map((source) => ({ source: source.name, rental: rentalFromDirectory(source.data, remoteJid) }))
    .find((entry) => entry.rental);
  const rental = match?.rental || null;

  if (!rental) {
    const hasRentalDirectory = sources.some((source) => rentalDirectoryHasEntries(source.data));
    if ((dashboardAuthoritative || hasRentalDirectory) && !allowOwnerRentalCommand) return { block: true, rental: null, reason: "group_rental_missing" };
    return { block: false, rental: null };
  }

  if (!rentalIsExpired(rental)) return { block: false, rental };
  if (allowOwnerRentalCommand) return { block: false, rental };
  return { block: true, rental, reason: "group_rental_expired", source: match?.source || "" };
}
