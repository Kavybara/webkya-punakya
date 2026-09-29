export function isGoogleSheetsQuotaError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("quota exceeded")
    || message.includes("read requests")
    || message.includes("rate limit")
    || message.includes("429")
  );
}

export const GOOGLE_SHEETS_CATALOG_PRECHECK_COOLDOWN_MS = 20_000;
export const GOOGLE_SHEETS_RESELLER_LOOKUP_TTL_MS = 60_000;

function recentTimestamp(value, now, ttlMs) {
  const timestamp = Date.parse(String(value || ""));
  const ttl = Number(ttlMs);
  if (!Number.isFinite(timestamp) || !Number.isFinite(ttl) || ttl <= 0) return false;
  const age = Number(now) - timestamp;
  return Number.isFinite(age) && age >= 0 && age <= ttl;
}

export function googleSheetsProductSyncScope(product = {}, syncKey = "") {
  const key = String(syncKey || "dynamic").trim().toLowerCase() || "dynamic";
  const productId = String(product?.id || "").trim().toLowerCase();
  return productId ? `${key}:${productId}` : "";
}

export function recordGoogleSheetsProductSync(settings = {}, scope = "", result = {}, syncedAt = new Date().toISOString()) {
  const normalizedScope = String(scope || "").trim().toLowerCase();
  if (!normalizedScope) return null;
  settings.googleSheetsProductSyncCache = settings.googleSheetsProductSyncCache || {};
  const entry = {
    ok: result?.ok !== false,
    syncedAt: String(syncedAt || new Date().toISOString()),
  };
  settings.googleSheetsProductSyncCache[normalizedScope] = entry;

  const entries = Object.entries(settings.googleSheetsProductSyncCache)
    .sort((left, right) => Date.parse(right[1]?.syncedAt || "") - Date.parse(left[1]?.syncedAt || ""));
  settings.googleSheetsProductSyncCache = Object.fromEntries(entries.slice(0, 50));
  return entry;
}

export function recentGoogleSheetsProductSync(settings = {}, scope = "", now = Date.now(), ttlMs = GOOGLE_SHEETS_CATALOG_PRECHECK_COOLDOWN_MS) {
  const normalizedScope = String(scope || "").trim().toLowerCase();
  const entry = settings.googleSheetsProductSyncCache?.[normalizedScope];
  if (!normalizedScope || entry?.ok !== true || !recentTimestamp(entry.syncedAt, now, ttlMs)) return null;
  return {
    ok: true,
    skipped: true,
    reused: true,
    reason: "recent_product_sync",
    syncedAt: entry.syncedAt,
  };
}

export function recentGoogleSheetsResellerLookup(settings = {}, now = Date.now(), ttlMs = GOOGLE_SHEETS_RESELLER_LOOKUP_TTL_MS) {
  const sync = settings.googleSheetsResellerSync;
  if (sync?.ok !== true || !Array.isArray(settings.googleSheetsResellerAliases)) return null;
  if (!recentTimestamp(sync.syncedAt, now, ttlMs)) return null;
  return {
    ...sync,
    ok: true,
    reused: true,
    reason: "recent_reseller_lookup",
  };
}

export function friendlyGoogleSheetsError(error) {
  if (!isGoogleSheetsQuotaError(error)) return error;
  if (error?.code === "google_sheets_rate_limited" && Number(error?.status) === 429) return error;

  const friendly = new Error("Stok sedang disinkronkan dengan Google Sheets. Coba lagi dalam 1 menit.");
  friendly.status = 429;
  friendly.code = "google_sheets_rate_limited";
  friendly.cause = error;
  return friendly;
}

export function googleSheetsSectionError(result, syncKey) {
  if (!syncKey) return null;
  const section = result?.[syncKey];
  if (!section || section.ok !== false) return null;

  const sectionMessage = section.error || section.reason || "unknown_error";
  if (isGoogleSheetsQuotaError(sectionMessage)) {
    return friendlyGoogleSheetsError(new Error(String(sectionMessage)));
  }

  const error = new Error(`Sync Google Sheets ${syncKey} gagal: ${sectionMessage}`);
  error.status = 503;
  error.code = "google_sheets_sync_failed";
  return error;
}

export const GOOGLE_SHEETS_SYNC_SECTIONS = Object.freeze([
  "netflix",
  "viu",
  "vidio",
  "canva",
  "linkPools",
  "dynamic",
  "disneyFormat",
  "resellers",
]);

export function googleSheetsSyncFailures(result = {}, sections = GOOGLE_SHEETS_SYNC_SECTIONS) {
  return [...new Set((sections || [])
    .map((key) => String(key || "").trim())
    .filter(Boolean)
    .filter((key) => !result?.[key] || result[key].ok === false))];
}

export function googleSheetsRequiredSectionsError(result = {}, sections = []) {
  for (const key of [...new Set((sections || []).map((item) => String(item || "").trim()).filter(Boolean))]) {
    if (!result?.[key]) {
      const error = new Error(`Sync Google Sheets ${key} tidak menghasilkan status`);
      error.status = 503;
      error.code = "google_sheets_sync_failed";
      return error;
    }
    const sectionError = googleSheetsSectionError(result, key);
    if (sectionError) return sectionError;
  }
  return null;
}

export function applyGoogleSheetsSyncState(settings = {}, result = {}, syncedAt = new Date().toISOString()) {
  const failedSections = googleSheetsSyncFailures(result);
  const health = {
    ok: failedSections.length === 0,
    failedSections,
  };
  settings.googleSheetsLastSyncAttemptAt = syncedAt;
  settings.googleSheetsLastSyncSummary = result;
  settings.googleSheetsLastSyncFailedSections = failedSections;
  if (health.ok) settings.googleSheetsLastSyncAt = syncedAt;
  return health;
}

export function googleSheetsSyncHealth(settings = {}) {
  const failedSections = Array.isArray(settings.googleSheetsLastSyncFailedSections)
    ? settings.googleSheetsLastSyncFailedSections.filter(Boolean)
    : [];
  return {
    healthy: Boolean(settings.googleSheetsLastSyncAt) && failedSections.length === 0,
    lastAttemptAt: settings.googleSheetsLastSyncAttemptAt || settings.googleSheetsLastSyncAt || "",
    lastSuccessAt: settings.googleSheetsLastSyncAt || "",
    failedSections,
  };
}

export function validateSheetPoolReadColumns(columns = {}, options = {}) {
  const required = [
    ["account", "ACCOUNT"],
    ["date", "TANGGAL"],
    ["duration", "DURASI"],
    ["expiresAt", "EXPIRED"],
    ["seller", "SELLER"],
    ["orderId", "ORDER ID"],
    ["stockId", "STOCK ID"],
  ];
  if (options.schema === "split") required.push(["password", "PASSWORD"]);
  if (options.requireProfile === true) {
    required.push(["profile", "PROFIL"], ["pin", "PIN"]);
  }
  const missing = required
    .filter(([key]) => !Number.isInteger(columns[key]) || columns[key] < 0)
    .map(([, label]) => label);
  return { ok: missing.length === 0, missing };
}

export function sheetReadWarningOrThrow(error, sheetName) {
  if (isGoogleSheetsQuotaError(error)) throw error;
  return `${String(sheetName || "Sheet")}: ${error?.message || "gagal dibaca"}`;
}
