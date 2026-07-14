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
    const daysLeft = daysLeftFromExpired(rental?.expired);
    if (daysLeft <= 0) continue;

    const normalized = {
      linkGrub: String(rental?.linkGrub || "").trim(),
      start: String(rental?.start || "").trim(),
      expired: Number(rental?.expired || 0),
      createdAt: rental?.createdAt || new Date().toISOString(),
      updatedAt: rental?.updatedAt || new Date().toISOString(),
    };
    activeRentals[normalizedGroupJid] = normalized;
    runtimeRentals[normalizedGroupJid] = {
      ...normalized,
      daysLeft,
      status: "active",
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
      status: "active",
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
  const byId = new Map(db.whatsappRentals.map((rental) => [rental.id, rental]));
  for (const rental of importedRentals) {
    const existing = byId.get(rental.id);
    byId.set(rental.id, existing ? { ...rental, ...existing, daysLeft: rental.daysLeft, status: rental.status, linkGrub: rental.linkGrub } : rental);
  }
  db.whatsappRentals = Array.from(byId.values());
  await writeJson(dashboardDbPath, db);
  return { merged: importedRentals.length };
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

  if (dryRun) {
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
    writeJson(path.join(whatsappRuntimeDbDir, "lists.json"), runtimeLists),
    writeJson(path.join(whatsappRuntimeDbDir, "rentals.json"), runtimeRentals),
    writeJson(path.join(whatsappRuntimeDbDir, "groups.json"), runtimeGroups),
    writeJson(path.join(whatsappSourceDbDir, "lists.json"), dashboardLists),
    writeJson(path.join(whatsappSourceDbDir, "rentals.json"), activeRentals),
    writeJson(path.join(whatsappSourceDbDir, "groups.json"), runtimeGroups),
  ]);

  manifest.dashboard = await mergeDashboardRentals(dashboardRentals);
  await fs.mkdir(importStateDir, { recursive: true });
  await writeJson(manifestPath, manifest);
  await writeJson(markerPath, manifest);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
