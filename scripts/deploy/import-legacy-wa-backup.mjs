import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const dryRun = process.argv.includes("--dry-run");
const forceRun = process.argv.includes("--force");

function loadRootEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fsSync.existsSync(envPath)) return;
  for (const rawLine of fsSync.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const legacyRootDir = path.resolve(process.env.LEGACY_WA_BACKUP_DIR || rootDir);
const legacyDatabaseDir = path.join(legacyRootDir, "database");
const dashboardDir = path.join(rootDir, "apps/dashboard");
const runtimeDir = path.resolve(process.env.RUNTIME_DIR || path.join(dashboardDir, "runtime"));
const dashboardDbPath = path.resolve(process.env.DATABASE_PATH || path.join(runtimeDir, "kavya-db.json"));
const whatsappRuntimeDbDir = path.resolve(process.env.WHATSAPP_DATABASE_DIR || path.join(runtimeDir, "whatsapp-database"));
const whatsappSourceDbDir = path.join(rootDir, "apps", "bot", "database");
const importStateDir = path.join(runtimeDir, "imports");
const manifestPath = path.join(importStateDir, "legacy-wa-json-import-manifest.json");
const markerPath = path.join(importStateDir, "legacy-wa-json-imported.json");

async function readJsonIfExists(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function mergeJsonObjectFile(filePath, imported = {}) {
  const existing = await readJsonIfExists(filePath, {});
  const merged = { ...(imported || {}) };
  for (const [groupJid, groupData] of Object.entries(existing || {})) {
    if (!groupData || typeof groupData !== "object" || Array.isArray(groupData)) continue;
    const importedGroup = merged[groupJid];
    if (importedGroup && typeof importedGroup === "object" && !Array.isArray(importedGroup)) {
      merged[groupJid] = { ...importedGroup, ...groupData };
    } else {
      merged[groupJid] = groupData;
    }
  }
  await writeJson(filePath, merged);
}

function hasLegacyListShape(group = {}) {
  if (!group || typeof group !== "object" || Array.isArray(group) || !group.list || typeof group.list !== "object") {
    return false;
  }
  const listValue = group.list;
  return !("text" in listValue || "content" in listValue || "media" in listValue || "media_path" in listValue || "updated_at" in listValue);
}

function listEntryTimestamp(entry = {}) {
  const raw = entry.updatedAt || entry.updated_at || entry.addedAt || entry.added_at || "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeListFileEntries(group = {}) {
  const entries = {};
  if (!group || typeof group !== "object" || Array.isArray(group)) return entries;
  if (hasLegacyListShape(group)) {
    for (const [keyword, entry] of Object.entries(group.list || {})) {
      const normalizedKeyword = String(keyword || "").trim().toLowerCase();
      if (!normalizedKeyword) continue;
      entries[normalizedKeyword] = {
        text: String(entry?.content?.text || entry?.text || "").trim(),
        media: String(entry?.content?.media || entry?.media || "").trim(),
        media_path: String(entry?.media_path || entry?.mediaPath || "").trim(),
        updated_at: entry?.updatedAt || entry?.updated_at || entry?.addedAt || entry?.added_at || group.updatedAt || group.createdAt || new Date().toISOString(),
      };
    }
    return entries;
  }

  const metadataKeys = new Set(["createdAt", "updatedAt", "addedAt", "template", "templatelist", "setlist"]);
  for (const [keyword, entry] of Object.entries(group)) {
    if (metadataKeys.has(keyword) || !entry || typeof entry !== "object") continue;
    const normalizedKeyword = String(keyword || "").trim().toLowerCase();
    if (!normalizedKeyword) continue;
    entries[normalizedKeyword] = {
      text: String(entry?.text || entry?.content?.text || "").trim(),
      media: String(entry?.media || entry?.content?.media || "").trim(),
      media_path: String(entry?.media_path || entry?.mediaPath || "").trim(),
      updated_at: entry?.updated_at || entry?.updatedAt || entry?.addedAt || entry?.added_at || group.updatedAt || group.createdAt || new Date().toISOString(),
    };
  }
  return entries;
}

function mergeListFileGroup(importedGroup = {}, existingGroup = {}) {
  const importedEntries = normalizeListFileEntries(importedGroup);
  const existingEntries = normalizeListFileEntries(existingGroup);
  const mergedEntries = { ...importedEntries };
  for (const [keyword, entry] of Object.entries(existingEntries)) {
    const importedEntry = mergedEntries[keyword];
    if (!importedEntry || listEntryTimestamp(entry) >= listEntryTimestamp(importedEntry)) {
      mergedEntries[keyword] = entry;
    }
  }
  return {
    createdAt: existingGroup?.createdAt || importedGroup?.createdAt || new Date().toISOString(),
    updatedAt: existingGroup?.updatedAt || importedGroup?.updatedAt || new Date().toISOString(),
    entries: mergedEntries,
  };
}

async function mergeListJsonFile(filePath, imported = {}, shape = "runtime") {
  const existing = await readJsonIfExists(filePath, {});
  const groupJids = new Set([...Object.keys(imported || {}), ...Object.keys(existing || {})]);
  const merged = {};
  for (const groupJid of groupJids) {
    const group = mergeListFileGroup(imported?.[groupJid] || {}, existing?.[groupJid] || {});
    if (shape === "legacy") {
      merged[groupJid] = {
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        list: Object.fromEntries(Object.entries(group.entries).map(([keyword, entry]) => [keyword, {
          content: {
            text: entry.text || "",
            media: entry.media || "",
          },
          updatedAt: entry.updated_at || group.updatedAt,
        }])),
      };
    } else {
      merged[groupJid] = group.entries;
    }
  }
  await writeJson(filePath, merged);
}

function rentalGroupKey(rental = {}, fallback = "") {
  return String(rental?.groupJid || rental?.id || fallback || "").trim();
}

function activeLegacyRentalFromRuntime(rental = {}) {
  const daysLeft = Number(rental?.daysLeft || 0);
  const status = String(rental?.status || "").toLowerCase();
  const expired = Number(rental?.expired || 0) || (daysLeft > 0 ? Date.now() + daysLeft * 86400000 : 0);
  return {
    linkGrub: String(rental?.linkGrub || "").trim(),
    start: String(rental?.start || rental?.startedAt || "").trim(),
    expired,
    createdAt: rental?.createdAt || new Date().toISOString(),
    updatedAt: rental?.updatedAt || new Date().toISOString(),
    ...(daysLeft ? { daysLeft } : {}),
    ...(status ? { status } : {}),
  };
}

async function mergeRentalJsonFile(filePath, imported = {}, shape = "runtime") {
  const existing = await readJsonIfExists(filePath, {});
  const merged = { ...(imported || {}) };

  for (const [fallbackKey, rental] of Object.entries(existing || {})) {
    if (!rental || typeof rental !== "object" || Array.isArray(rental)) continue;
    const key = rentalGroupKey(rental, fallbackKey);
    if (!key) continue;
    if (shape === "legacy") {
      merged[key] = activeLegacyRentalFromRuntime(rental);
    } else {
      merged[key] = { ...(merged[key] || {}), ...rental };
    }
  }

  await writeJson(filePath, merged);
}

async function fileHash(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(buffer).digest("hex");
  } catch {
    return "";
  }
}

function normalizeGroupJid(value = "") {
  const text = String(value || "").trim();
  if (text.endsWith("@g.us")) return text;
  return "";
}

function dateFromTimestamp(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysLeftFromExpired(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return 0;
  return Math.ceil((timestamp - Date.now()) / 86400000);
}

function normalizeRentalStatus(value = "", daysLeft = 0) {
  const status = String(value || "").trim().toLowerCase();
  if (["active", "paused", "expired"].includes(status)) return status;
  return daysLeft > 0 ? "active" : "expired";
}

function normalizeLegacyLists(legacyLists) {
  const runtimeLists = {};
  const dashboardLists = {};
  let groups = 0;
  let keywords = 0;
  let media = 0;

  for (const [groupJid, groupData] of Object.entries(legacyLists || {})) {
    const normalizedGroupJid = normalizeGroupJid(groupJid);
    if (!normalizedGroupJid) continue;
    const sourceEntries = groupData?.list || {};
    const runtimeEntries = {};
    const dashboardEntries = {};

    for (const [keyword, item] of Object.entries(sourceEntries)) {
      const normalizedKeyword = String(keyword || "").trim().toLowerCase();
      const text = String(item?.content?.text || "").trim();
      const mediaFile = String(item?.content?.media || "").trim();
      if (!normalizedKeyword || (!text && !mediaFile)) continue;

      runtimeEntries[normalizedKeyword] = {
        text,
        media: mediaFile,
        media_path: mediaFile ? path.join(rootDir, "database", "media", mediaFile) : "",
        updated_at: groupData?.updatedAt || groupData?.createdAt || new Date().toISOString(),
      };
      dashboardEntries[normalizedKeyword] = item;
      keywords += 1;
      if (mediaFile) media += 1;
    }

    if (Object.keys(runtimeEntries).length) {
      runtimeLists[normalizedGroupJid] = runtimeEntries;
      dashboardLists[normalizedGroupJid] = {
        createdAt: groupData?.createdAt || new Date().toISOString(),
        updatedAt: groupData?.updatedAt || new Date().toISOString(),
        list: dashboardEntries,
      };
      groups += 1;
    }
  }

  return { runtimeLists, dashboardLists, counts: { list_groups: groups, list_keywords: keywords, media_keywords: media } };
}

function normalizeLegacyRentals(legacyRentals) {
  const activeRentals = {};
  const runtimeRentals = {};
  const dashboardRentals = [];

  for (const [groupJid, rental] of Object.entries(legacyRentals || {})) {
    const normalizedGroupJid = normalizeGroupJid(groupJid);
    if (!normalizedGroupJid) continue;
    const daysLeft = Number.isFinite(Number(rental?.daysLeft)) ? Number(rental?.daysLeft) : daysLeftFromExpired(rental?.expired);
    const status = normalizeRentalStatus(rental?.status, daysLeft);
    if (status === "expired" || daysLeft <= 0) continue;

    const normalized = {
      linkGrub: String(rental?.linkGrub || "").trim(),
      start: String(rental?.start || "").trim(),
      expired: Number(rental?.expired || 0),
      createdAt: rental?.createdAt || new Date().toISOString(),
      updatedAt: rental?.updatedAt || new Date().toISOString(),
      daysLeft,
      status,
    };
    activeRentals[normalizedGroupJid] = normalized;
    runtimeRentals[normalizedGroupJid] = {
      ...normalized,
      daysLeft,
      status,
    };
    dashboardRentals.push({
      id: normalizedGroupJid,
      groupJid: normalizedGroupJid,
      name: String(rental?.name || "").trim() || normalizedGroupJid,
      owner: "",
      contact: "",
      product: "",
      members: 0,
      capacity: 0,
      helpedOrders: 0,
      monthlyPrice: 0,
      startedAt: normalized.start,
      endsAt: dateFromTimestamp(normalized.expired),
      daysLeft,
      sent: 0,
      replies: 0,
      status,
      linkGrub: normalized.linkGrub,
      joinStatus: "legacy-import",
    });
  }

  return { activeRentals, runtimeRentals, dashboardRentals };
}

function normalizeLegacyGroups(legacyGroups) {
  const groups = {};
  for (const [groupJid, settings] of Object.entries(legacyGroups || {})) {
    const normalizedGroupJid = normalizeGroupJid(groupJid);
    if (!normalizedGroupJid) continue;
    groups[normalizedGroupJid] = settings || {};
  }
  return groups;
}

function mergeLegacyGroupSettings(legacyGroups, participantSettings) {
  const merged = { ...(legacyGroups || {}) };
  for (const [groupJid, settings] of Object.entries(participantSettings || {})) {
    if (!groupJid || !settings || typeof settings !== "object") continue;
    merged[groupJid] = {
      ...(merged[groupJid] || {}),
      ...settings,
    };
  }
  return merged;
}

async function mergeDashboardRentals(importedRentals) {
  const db = await readJsonIfExists(dashboardDbPath, null);
  if (!db || typeof db !== "object") return { skipped: true, reason: "dashboard_db_missing" };

  db.whatsappRentals = Array.isArray(db.whatsappRentals) ? db.whatsappRentals : [];
  const byId = new Map();
  for (const rental of db.whatsappRentals) {
    const key = rentalGroupKey(rental);
    if (key) byId.set(key, rental);
  }
  for (const rental of importedRentals) {
    const key = rentalGroupKey(rental);
    if (!key || byId.has(key)) continue;
    byId.set(key, rental);
  }
  db.whatsappRentals = Array.from(byId.values());
  await writeJson(dashboardDbPath, db);
  return { merged: importedRentals.length };
}

function dashboardEntriesFromLegacyGroup(group = {}) {
  return Object.entries(group.list || {}).map(([keyword, item]) => ({
    keyword,
    text: String(item?.content?.text || "").trim(),
    media: String(item?.content?.media || "").trim(),
    updatedAt: item?.updatedAt || item?.addedAt || group.updatedAt || group.createdAt || new Date().toISOString(),
  }));
}

async function mergeDashboardGroupLists(importedLists) {
  const db = await readJsonIfExists(dashboardDbPath, null);
  if (!db || typeof db !== "object") return { skipped: true, reason: "dashboard_db_missing" };

  db.whatsappGroupLists = Array.isArray(db.whatsappGroupLists) ? db.whatsappGroupLists : [];
  const byGroupJid = new Map(db.whatsappGroupLists.map((row) => [row.groupJid, row]));
  for (const [groupJid, importedGroup] of Object.entries(importedLists || {})) {
    const existing = byGroupJid.get(groupJid);
    const importedEntries = dashboardEntriesFromLegacyGroup(importedGroup);
    if (!existing) {
      byGroupJid.set(groupJid, {
        groupJid,
        total: importedEntries.length,
        updatedAt: importedGroup.updatedAt || new Date().toISOString(),
        template: "",
        entries: importedEntries,
      });
      continue;
    }
    const byKeyword = new Map(importedEntries.map((entry) => [String(entry.keyword || "").trim().toLowerCase(), entry]));
    for (const entry of existing.entries || []) {
      const keyword = String(entry.keyword || "").trim().toLowerCase();
      if (!keyword) continue;
      const importedEntry = byKeyword.get(keyword);
      if (!importedEntry || listEntryTimestamp(entry) >= listEntryTimestamp(importedEntry)) {
        byKeyword.set(keyword, entry);
      }
    }
    byGroupJid.set(groupJid, {
      ...existing,
      entries: [...byKeyword.values()],
      total: byKeyword.size,
      updatedAt: existing.updatedAt || importedGroup.updatedAt || new Date().toISOString(),
    });
  }
  db.whatsappGroupLists = Array.from(byGroupJid.values());
  await writeJson(dashboardDbPath, db);
  return { merged: Object.keys(importedLists || {}).length };
}

async function main() {
  const legacyListPath = path.join(legacyDatabaseDir, "list.json");
  const legacySewaPath = path.join(legacyDatabaseDir, "sewa.json");
  const legacyGroupPath = path.join(legacyDatabaseDir, "group.json");
  const legacyGroupBackupPath = path.join(legacyDatabaseDir, "group_backup.json");
  const participantPath = path.join(legacyDatabaseDir, "additional", "group participant.json");

  const [legacyLists, legacyRentals, legacyGroups, legacyGroupBackup, participantSettings, previousMarker] = await Promise.all([
    readJsonIfExists(legacyListPath, {}),
    readJsonIfExists(legacySewaPath, {}),
    readJsonIfExists(legacyGroupPath, {}),
    readJsonIfExists(legacyGroupBackupPath, {}),
    readJsonIfExists(participantPath, {}),
    readJsonIfExists(markerPath, null),
  ]);

  const { runtimeLists, dashboardLists, counts: listCounts } = normalizeLegacyLists(legacyLists);
  const { activeRentals, runtimeRentals, dashboardRentals } = normalizeLegacyRentals(legacyRentals);
  const runtimeGroups = normalizeLegacyGroups(
    mergeLegacyGroupSettings(Object.keys(legacyGroups).length ? legacyGroups : legacyGroupBackup, participantSettings),
  );
  const files = {
    "database/list.json": await fileHash(legacyListPath),
    "database/sewa.json": await fileHash(legacySewaPath),
    "database/group.json": await fileHash(legacyGroupPath),
    "database/group_backup.json": await fileHash(legacyGroupBackupPath),
    "database/additional/group participant.json": await fileHash(participantPath),
  };
  const manifest = {
    success: true,
    dry_run: dryRun,
    force: forceRun,
    skipped: false,
    created_at: new Date().toISOString(),
    source_dir: legacyRootDir,
    runtime_database_dir: whatsappRuntimeDbDir,
    files,
    counts: {
      active_rentals: Object.keys(activeRentals).length,
      group_settings: Object.keys(runtimeGroups).length,
      participant_settings: Object.keys(participantSettings || {}).length,
      ...listCounts,
    },
  };
  const hasLegacyInput =
    Object.values(files).some(Boolean) &&
    (Object.keys(runtimeLists).length || Object.keys(runtimeRentals).length || Object.keys(runtimeGroups).length);

  if (dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (!hasLegacyInput) {
    manifest.skipped = true;
    manifest.skip_reason = "legacy_source_empty";
    await fs.mkdir(importStateDir, { recursive: true });
    await writeJson(manifestPath, manifest);
    await writeJson(markerPath, manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (previousMarker && !forceRun) {
    manifest.skipped = true;
    manifest.skip_reason = "already_imported";
    await fs.mkdir(importStateDir, { recursive: true });
    await writeJson(manifestPath, manifest);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  await Promise.all([
    mergeListJsonFile(path.join(whatsappRuntimeDbDir, "lists.json"), runtimeLists, "runtime"),
    mergeRentalJsonFile(path.join(whatsappRuntimeDbDir, "rentals.json"), runtimeRentals, "runtime"),
    writeJson(path.join(whatsappRuntimeDbDir, "groups.json"), runtimeGroups),
    mergeListJsonFile(path.join(whatsappSourceDbDir, "lists.json"), dashboardLists, "legacy"),
    mergeRentalJsonFile(path.join(whatsappSourceDbDir, "rentals.json"), activeRentals, "legacy"),
    writeJson(path.join(whatsappSourceDbDir, "groups.json"), runtimeGroups),
  ]);

  manifest.dashboard = await mergeDashboardRentals(dashboardRentals);
  manifest.dashboard_lists = await mergeDashboardGroupLists(dashboardLists);
  await fs.mkdir(importStateDir, { recursive: true });
  await writeJson(manifestPath, manifest);
  await writeJson(markerPath, manifest);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
