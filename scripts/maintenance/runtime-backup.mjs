import fsSync from "node:fs";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { createRuntimeBackupPayload, writeRuntimeBackupFile } from "../../packages/shared/runtime-backup.mjs";
import { selectRuntimeBackupPostSendRemovals } from "../../packages/shared/runtime-backup-retention.mjs";

const rootDir = process.cwd();
const sendWhatsApp = process.argv.includes("--send-whatsapp");
const encryptOnly = process.argv.includes("--encrypt-only");
const jsonOutput = process.argv.includes("--json");
const reasonArg = process.argv.find((arg) => arg.startsWith("--reason="));
const reason = reasonArg ? reasonArg.slice("--reason=".length) : "manual";
const BACKUP_DISPLAY_FILE_NAME = "File Backup.tar.gz.enc";

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

const dashboardDir = path.join(rootDir, "apps/dashboard");
const runtimeDir = path.resolve(process.env.RUNTIME_DIR || path.join(dashboardDir, "runtime"));
const outputDir = path.resolve(process.env.RUNTIME_BACKUP_DIR || path.join(runtimeDir, "backups"));
const dashboardDbPath = path.resolve(process.env.DATABASE_PATH || path.join(runtimeDir, "kavya-db.json"));
const whatsappDbDir = path.resolve(process.env.WHATSAPP_DATABASE_DIR || path.join(runtimeDir, "whatsapp-database"));
const baileysAuthDir = path.resolve(process.env.BAILEYS_AUTH_DIR || path.join(runtimeDir, "baileys-auth"));

function normalizeWhatsAppNumber(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function usableSecret(...values) {
  return (
    values
      .map((value) => String(value || "").trim())
      .find((value) => value && !/^change-me/i.test(value) && !/^your-/i.test(value) && !/^replace-/i.test(value)) || ""
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function isInsideOrEqual(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function listBackupEntries(dirPath) {
  const dir = path.resolve(dirPath);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const output = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const target = path.resolve(dir, entry.name);
    if (!isInsideOrEqual(target, dir) || target === dir) continue;
    const info = await fs.stat(target).catch(() => null);
    if (info) output.push({ target, name: entry.name, mtimeMs: info.mtimeMs });
  }
  return output;
}

async function cleanupBackupsAfterSendAttempt({ backup, transportBackup, whatsapp }) {
  const createdNames = [backup?.filePath, transportBackup?.filePath]
    .filter(Boolean)
    .map((filePath) => path.basename(filePath));
  const removals = selectRuntimeBackupPostSendRemovals(await listBackupEntries(outputDir), {
    sent: Boolean(whatsapp?.sent),
    deleteAfterSend: enabled(process.env.AUTO_BACKUP_DELETE_AFTER_SEND, false),
    createdNames,
    keep: Math.max(1, Number(process.env.RUNTIME_BACKUP_KEEP || 30)),
    maxAgeMs: Number(process.env.RUNTIME_BACKUP_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000),
  });
  let removed = 0;
  for (const entry of removals) {
    if (!entry?.target || !isInsideOrEqual(entry.target, outputDir)) continue;
    await fs.rm(entry.target, { force: true }).catch(() => {});
    removed += 1;
  }
  return removed;
}

async function waitForWhatsAppBot({ botUrl, token }) {
  const waitMs = Math.max(0, Number(process.env.BACKUP_WHATSAPP_WAIT_MS || 120000));
  const pollMs = Math.max(1000, Number(process.env.BACKUP_WHATSAPP_POLL_MS || 5000));
  const deadline = Date.now() + waitMs;
  let lastReason = "whatsapp_bot_not_ready";

  while (Date.now() <= deadline) {
    try {
      const response = await fetch(new URL("/session/status", botUrl.endsWith("/") ? botUrl : `${botUrl}/`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && (data.connected === true || data.state === "open")) {
        return { ready: true };
      }
      lastReason = data.state ? `whatsapp_state_${data.state}` : data.error || `whatsapp_status_${response.status}`;
    } catch (error) {
      lastReason = error.message || "whatsapp_status_failed";
    }
    if (Date.now() + pollMs > deadline) break;
    await sleep(pollMs);
  }

  return { ready: false, reason: lastReason };
}

async function sendBackupToOwner({ backup, dashboardDb }) {
  const settings = dashboardDb?.settings || {};
  const botUrl = String(process.env.WHATSAPP_BOT_URL || settings.whatsappBotUrl || "http://127.0.0.1:4016").trim();
  const token = usableSecret(process.env.WHATSAPP_BOT_TOKEN, settings.whatsappBotToken);
  const ownerNumber = normalizeWhatsAppNumber(
    process.env.BACKUP_OWNER_NUMBER || process.env.OWNER_WHATSAPP_NUMBER || settings.ownerWhatsAppNumber || settings.baileyBotNumber,
  );
  if (!botUrl || !token || !ownerNumber) {
    return { sent: false, reason: "whatsapp_bot_or_owner_missing" };
  }

  const readiness = await waitForWhatsAppBot({ botUrl, token });
  if (!readiness.ready) {
    return { sent: false, reason: readiness.reason || "whatsapp_bot_not_ready" };
  }

  const response = await fetch(new URL("/messages/send", botUrl.endsWith("/") ? botUrl : `${botUrl}/`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: ownerNumber,
      text: "",
      document_path: backup.filePath,
      file_name: BACKUP_DISPLAY_FILE_NAME,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return { sent: response.ok && data.success !== false, reason: data.error || "" };
}

async function encryptBackupForTransport(backup) {
  const passphrase = usableSecret(process.env.BACKUP_ENCRYPTION_KEY);
  if (passphrase.length < 16) {
    throw new Error("BACKUP_ENCRYPTION_KEY wajib diisi minimal 16 karakter sebelum backup dikirim ke WhatsApp");
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = await fs.readFile(backup.filePath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = Buffer.from(`${JSON.stringify({ version: 1, algorithm: "aes-256-gcm", salt: salt.toString("base64url"), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") })}\n`);
  const encryptedPath = `${backup.filePath}.enc`;
  await fs.writeFile(encryptedPath, Buffer.concat([Buffer.from("KAVYA-BACKUP-V1\n"), header, ciphertext]), { mode: 0o600 });
  return { ...backup, filePath: encryptedPath, fileName: `${backup.fileName}.enc` };
}

async function main() {
  const payload = await createRuntimeBackupPayload({
    rootDir,
    reason,
    runtimeDir,
    dashboardDbPath,
    whatsappDbDir,
    baileysAuthDir,
  });
  const backup = await writeRuntimeBackupFile({ payload, outputDir });
  let transportBackup = null;
  let whatsapp = { sent: false, reason: "send-disabled" };
  if (sendWhatsApp || encryptOnly) {
    transportBackup = await encryptBackupForTransport(backup);
  }
  if (sendWhatsApp) {
    whatsapp = await sendBackupToOwner({ backup: transportBackup, dashboardDb: payload.dashboard })
      .catch((error) => ({ sent: false, reason: error.message || "send_failed" }));
  }
  const removedBackupFiles = await cleanupBackupsAfterSendAttempt({ backup, transportBackup, whatsapp });

  const result = { success: true, ...backup, encryptedFilePath: transportBackup?.filePath || "", whatsapp, removedBackupFiles };
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("[√] File Backup dibuat");
  if (sendWhatsApp) {
    console.log(
      whatsapp.sent
        ? "[√] File Backup terkirim ke owner"
        : `⚠️ File Backup belum terkirim: ${whatsapp.reason || "send_failed"}`,
    );
    if (whatsapp.sent && removedBackupFiles) {
      console.log("[√] File Backup lokal dihapus setelah terkirim ke owner");
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
