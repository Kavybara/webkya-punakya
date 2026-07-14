import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(appRoot, "..", "..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const runtimeDir = path.resolve(process.env.RUNTIME_DIR || path.join(projectRoot, "runtime"));
const tmpDir = path.resolve(
  process.env.RUNTIME_TMP_DIR || process.env.WHATSAPP_TMP_DIR || path.join(runtimeDir, "tmp"),
);
const authDir = path.resolve(process.env.BAILEYS_AUTH_DIR || path.join(runtimeDir, "baileys-auth"));
const databaseDir = path.resolve(
  process.env.WHATSAPP_DATABASE_DIR || path.join(runtimeDir, "whatsapp-database"),
);
const backupDir = path.resolve(
  process.env.WHATSAPP_BACKUP_DIR || process.env.RUNTIME_BACKUP_DIR || path.join(runtimeDir, "backups"),
);
const dashboardDatabasePath = path.resolve(
  process.env.DATABASE_PATH ||
    process.env.DASHBOARD_DATABASE_PATH ||
    path.join(projectRoot, "apps/dashboard", "runtime", "kavya-db.json"),
);

function readDashboardSettings() {
  if (!existsSync(dashboardDatabasePath)) return {};
  try {
    const db = JSON.parse(readFileSync(dashboardDatabasePath, "utf8"));
    return db.settings || {};
  } catch {
    return {};
  }
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hoursToMs(value, fallbackHours) {
  const parsed = Number(value);
  const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackHours;
  return Math.max(0, hours * 60 * 60 * 1000);
}

function splitList(value = "") {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWhatsAppNumber(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) {
    return "";
  }
  if (digits.startsWith("62")) {
    return digits;
  }
  if (digits.startsWith("0")) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith("8")) {
    return `62${digits}`;
  }
  return digits;
}

function firstConfigured(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function usableSecret(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find((value) => value && !/^(change-me|change-this|replace-with|your-)/i.test(value)) || "";
}

const dashboardSettings = readDashboardSettings();

export const config = {
  appRoot,
  projectRoot,
  dashboardDatabasePath,
  port: number(process.env.WHATSAPP_PORT || process.env.PORT, 4016),
  token: usableSecret(process.env.WHATSAPP_BOT_TOKEN, dashboardSettings.whatsappBotToken),
  botNumber: normalizeWhatsAppNumber(firstConfigured(process.env.WHATSAPP_BOT_NUMBER, dashboardSettings.baileyBotNumber)),
  publicUrl: firstConfigured(process.env.WHATSAPP_BOT_PUBLIC_URL, dashboardSettings.whatsappBotPublicUrl),
  inboundWebhookUrl: firstConfigured(process.env.WHATSAPP_INBOUND_WEBHOOK_URL, dashboardSettings.baileyWebhookUrl),
  inboundWebhookToken: usableSecret(process.env.WHATSAPP_INBOUND_TOKEN, dashboardSettings.whatsappInboundToken),
  logLevel: String(process.env.LOG_LEVEL || "info").trim(),
  ownerNumbers: splitList(process.env.OWNER_WHATSAPP_NUMBER || process.env.OWNER_NUMBERS || dashboardSettings.ownerWhatsAppNumber).map(
    normalizeWhatsAppNumber,
  ),
  commands: {
    prefixes: splitList(process.env.WHATSAPP_COMMAND_PREFIXES || ". #"),
  },
  paths: {
    appRoot,
    projectRoot,
    runtimeDir,
    tmpDir,
    authDir,
    backupDir,
    pluginsDir: path.join(appRoot, "plugins"),
  },
  database: {
    dir: databaseDir,
  },
  tmp: {
    maxAgeMs: Math.max(60_000, number(process.env.WHATSAPP_TMP_MAX_AGE_MS, 24 * 60 * 60 * 1000)),
  },
  reconnect: {
    delaysMs: [5000, 10000, 15000, 20000, 25000],
  },
  pairing: {
    enabled: bool(process.env.WHATSAPP_PAIRING_CODE || process.env.WA_PAIRING_CODE, false),
    number: normalizeWhatsAppNumber(
      process.env.WHATSAPP_PAIRING_NUMBER ||
        process.env.WA_PAIRING_NUMBER ||
        process.env.OWNER_WHATSAPP_NUMBER ||
        dashboardSettings.baileyBotNumber,
    ),
  },
  backup: {
    auto: bool(process.env.AUTO_BACKUP, true),
    onConnect: bool(process.env.AUTO_BACKUP_ON_CONNECT, false),
    scheduled: bool(process.env.AUTO_BACKUP_SCHEDULE_ENABLED, true),
    intervalMs: Math.max(
      0,
      number(process.env.AUTO_BACKUP_INTERVAL_MS, hoursToMs(process.env.AUTO_BACKUP_INTERVAL_HOURS, 6)),
    ),
    onReconnect: bool(process.env.AUTO_BACKUP_ON_RECONNECT, false),
    minIntervalMs: Math.max(0, number(process.env.AUTO_BACKUP_MIN_INTERVAL_MS, 30 * 60 * 1000)),
    ownerNumber: normalizeWhatsAppNumber(process.env.BACKUP_OWNER_NUMBER || process.env.OWNER_WHATSAPP_NUMBER || dashboardSettings.ownerWhatsAppNumber),
  },
};

process.env.TMPDIR = config.paths.tmpDir;
process.env.TEMP = config.paths.tmpDir;
process.env.TMP = config.paths.tmpDir;
