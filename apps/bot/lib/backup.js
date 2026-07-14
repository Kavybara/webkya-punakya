import { createRuntimeBackupPayload, writeRuntimeBackupFile } from "../../../packages/shared/runtime-backup.mjs";
import { logSuccess, logWarning } from "./panel-log.js";

let lastBackupAt = 0;
const BACKUP_DISPLAY_FILE_NAME = "File Backup.tar.gz";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

export async function createJsonDatabaseBackup({ config, store, reason = "manual" }) {
  const payload = await createRuntimeBackupPayload({
    rootDir: config.projectRoot,
    reason,
    runtimeDir: config.paths.runtimeDir,
    whatsappDbDir: store.dir,
    baileysAuthDir: config.paths.authDir,
  });
  return { ...(await writeRuntimeBackupFile({ payload, outputDir: config.paths.backupDir })), payload };
}

async function createAutoBackup({ config, store, reason, force = false, announce = false, stableDelayMs = 0, isConnected = null }) {
  if (!config.backup.auto) {
    return { skipped: true, reason: "auto_backup_disabled" };
  }

  const now = Date.now();
  if (!force && config.backup.minIntervalMs && now - lastBackupAt < config.backup.minIntervalMs) {
    return { skipped: true, reason: "auto_backup_throttled" };
  }

  if (announce) {
    console.log("Membuat backup data...");
  }
  if (stableDelayMs) {
    await delay(stableDelayMs);
  }
  if (typeof isConnected === "function" && !isConnected()) {
    return { skipped: true, reason: "connection_not_stable" };
  }
  const backup = await createJsonDatabaseBackup({ config, store, reason });
  lastBackupAt = now;
  return backup;
}

export async function autoBackupSnapshot({ config, logger, store, reason = "whatsapp-connection-reset", force = false }) {
  return { skipped: true, reason: "backup_on_close_disabled" };
}

export async function autoBackupOnConnect({ config, logger, store, sendMessage, isConnected, stableDelayMs = 15_000, reason = "whatsapp-connect", force = false }) {
  const backup = await createAutoBackup({ config, store, reason, force, announce: true, stableDelayMs, isConnected });
  if (backup.skipped) {
    if (backup.reason === "connection_not_stable") {
      logWarning("Auto backup dilewati karena koneksi belum stabil");
    }
    return backup;
  }

  const owner = config.backup.ownerNumber || config.ownerNumbers[0] || "";
  if (!owner) {
    logWarning("File Backup dibuat, tapi nomor owner backup belum disetting");
    logSuccess("File Backup dibuat");
    return { ...backup, sent: false, reason: "owner_number_missing" };
  }

  const reconnectBackup = /reconnect/i.test(String(reason || ""));
  if (reconnectBackup && !enabled(process.env.AUTO_BACKUP_SEND_ON_RECONNECT, false)) {
    logSuccess("File Backup dibuat");
    return { ...backup, sent: false, reason: "send_skipped_on_reconnect" };
  }

  if (typeof isConnected === "function" && !isConnected()) {
    return { ...backup, sent: false, reason: "connection_not_stable" };
  }

  let sent = true;
  let sendReason = "";
  await sendMessage(
    owner,
    "",
    "",
    "",
    backup.filePath,
    BACKUP_DISPLAY_FILE_NAME,
    { retryDelaysMs: [2000], timeoutMs: 15_000 },
  ).catch((error) => {
    sent = false;
    sendReason = error.message || "send_failed";
    if (sendReason === "whatsapp_bot_not_connected" || /EPIPE|closed|socket/i.test(sendReason)) {
      logWarning("File Backup dibuat, tapi kirim ke owner dilewati karena koneksi belum stabil");
      return;
    }
    logWarning("Auto backup created but failed to send", error);
  });

  logSuccess(sent ? "File Backup terkirim ke owner" : "File Backup dibuat");
  return { ...backup, sent, reason: sendReason };
}
