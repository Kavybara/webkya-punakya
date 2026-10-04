import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { autoBackupOnConnect } from "../lib/backup.js";
import { writeBackupState } from "../lib/backup-state-writer.js";
import { cleanupTmpDir } from "../lib/runtime.js";
import { extractInviteCode, getJidFromTarget, normalizeGroupJid, normalizeWhatsAppNumber } from "../lib/jid.js";
import { logError, logReconnect, logSuccess, logTracking, logWarning } from "../lib/panel-log.js";
import { handleIncomingMessage } from "./messages.js";

function createBaileysLogger(logger) {
  if (typeof logger?.child !== "function") {
    return logger;
  }
  return logger.child({ class: "baileys" }, { level: "silent" });
}

const MAX_RECONNECT_BURST = 5;
const MAX_RECONNECT_DELAY_MS = 120_000;
const SEND_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const SEND_QUEUE_DELAY_MS = 750;
const SEND_ATTEMPT_TIMEOUT_MS = 90_000;
const COMMAND_SEND_RETRY_DELAYS_MS = [];
const COMMAND_SEND_ATTEMPT_TIMEOUT_MS = 120_000;
const STABLE_CONNECT_DELAY_MS = Math.max(5_000, Number(process.env.WHATSAPP_STABLE_CONNECT_DELAY_MS || 90_000));
const GROUP_SYNC_MIN_INTERVAL_MS = 30 * 60 * 1000;
const RECONNECT_WINDOW_MS = 5 * 60 * 1000;
const RECONNECT_CIRCUIT_LIMIT = 3;
const HEAVY_WORK_PAUSE_MS = 10 * 60 * 1000;
const GROUP_SYNC_ON_CONNECT = /^(1|true|yes|on)$/i.test(String(process.env.WHATSAPP_GROUP_SYNC_ON_CONNECT || "").trim());
const OWNER_STABLE_NOTIFY_ENABLED = !/^(0|false|no|off)$/i.test(String(process.env.WHATSAPP_OWNER_STABLE_NOTIFY || "true").trim());
const OWNER_STABLE_NOTIFY_COOLDOWN_MS = Math.max(
  60_000,
  Number(process.env.WHATSAPP_OWNER_STABLE_NOTIFY_COOLDOWN_MS || 30 * 60 * 1000),
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, reason = "operation_timed_out") {
  if (!ms || ms <= 0) {
    return Promise.resolve(promise);
  }
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(reason)), ms);
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer);
    });
  });
}

function reconnectDelayMs(reason, attempt) {
  const code = Number(reason || 0);
  const safeAttempt = Math.max(1, Number(attempt || 1));
  if (code === 403) return 60_000;
  if (code === 428) return Math.min(MAX_RECONNECT_DELAY_MS, 30_000 + ((safeAttempt - 1) * 15000));
  if (code === 408) return Math.min(MAX_RECONNECT_DELAY_MS, 20_000 + ((safeAttempt - 1) * 15000));
  if (code === 515) return Math.min(MAX_RECONNECT_DELAY_MS, 10_000 + ((safeAttempt - 1) * 10000));
  return Math.min(MAX_RECONNECT_DELAY_MS, 15_000 * safeAttempt);
}

function isTemporarySendError(error) {
  const message = String(error?.message || error || "");
  return /whatsapp_bot_not_connected|write EPIPE|EPIPE|socket|closed|not open|connection.*(closed|lost|reset)|timed?\s*out|send_timed_out|send_message_empty_result/i.test(message);
}

function shouldRecoverSendTransport(error) {
  const message = String(error?.message || error || "");
  return /whatsapp_send_timed_out|send_timed_out|send_message_empty_result|whatsapp_bot_not_connected|write EPIPE|EPIPE|Timed Out/i.test(message);
}

function debugSendEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.WHATSAPP_DEBUG_SEND || "").trim());
}

function parseRetryDelays(value = "", fallback = []) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const count = Number(value);
  if (Number.isInteger(count) && count >= 0) {
    return fallback.slice(0, count);
  }
  return String(value)
    .split(/[,\s]+/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

export function createWhatsAppConnection({ config, logger, store, plugins }) {
  let sock = null;
  const baileysLogger = createBaileysLogger(logger);
  let connectionState = "starting";
  let qrDataUrl = "";
  let qrText = "";
  let pairingCode = "";
  let lastError = "";
  let jid = "";
  let isConnecting = false;
  let reconnecting = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let sendQueue = Promise.resolve();
  let lastSendAt = 0;
  let lastReconnectAt = "";
  let warmingUntil = 0;
  let reconnectHistory = [];
  let heavyWorkPausedUntil = 0;
  let nextReconnectDelayMs = 0;
  let pendingReconnectBackupReason = "";
  let lastDisconnectAt = "";
  let lastDisconnectReason = "";
  let lastGroupSyncAt = "";
  let lastGroupSyncError = "";
  let lastGroupSyncCount = 0;
  let groupSyncInFlight = false;
  let scheduledBackupTimer = null;
  let scheduledBackupRunning = false;
  let lastScheduledBackupAt = "";
  let lastScheduledBackupStatus = "idle";
  let lastScheduledBackupError = "";

  /*
   * Publishes each backup outcome into `kavya-db.json` so the owner sees on the
   * Health Center that backups actually ran.
   *
   * Every failure mode below is silent today. `runScheduledBackup` returns
   * early on "not connected" and on "heavy work paused" without ever creating
   * an archive, and the reason lives in a variable inside this process -- the
   * dashboard cannot read it, and if the bot is down there is no process left
   * to ask. That combination is why a broken backup can go unnoticed for
   * weeks: the thing that would report it is the thing that stopped working.
   *
   * Recording the skip as well as the success is the point. "Ran 6 hours ago and
   * was skipped because WhatsApp was down" is actionable; a timestamp alone
   * would look healthy.
   *
   * Failures here are swallowed on purpose: recording the state must never be
   * able to take down the backup loop it is reporting on.
   */
  async function recordBackupOutcome(outcome = {}) {
    if (!config.dashboardDatabasePath) return;
    try {
      await writeBackupState(config.dashboardDatabasePath, outcome);
    } catch (error) {
      logWarning("Gagal menulis status backup ke database dashboard", error);
    }
  }
  let pairingRequestAttempts = 0;
  let pairingRequestTimer = null;
  let lastPairingCodeLogged = "";
  let lastOwnerStableNotifyAt = 0;

  function setLastError(error) {
    lastError = String(error || "");
  }

  function resetReconnectState() {
    reconnectAttempts = 0;
    reconnecting = false;
    nextReconnectDelayMs = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function existingPairingCode(authState = {}) {
    return String(authState?.creds?.pairingCode || authState?.creds?.pairing_code || "").trim();
  }

  function setPairingCode(code = "") {
    const normalized = String(code || "").replace(/\s+/g, "").trim();
    if (!normalized) return false;
    pairingCode = normalized;
    connectionState = "pairing";
    if (lastPairingCodeLogged !== normalized) {
      lastPairingCodeLogged = normalized;
      logTracking(`Pairing code tersedia di halaman web: ${normalized}`);
    }
    return true;
  }

  function isSocketOpen(targetSock = sock) {
    if (!targetSock || connectionState !== "open") return false;
    const readyState = targetSock.ws?.readyState;
    return readyState === undefined || readyState === 1;
  }

  function isWarmingUp() {
    return Date.now() < warmingUntil;
  }

  async function waitForSocketReady(timeoutMs = 30_000) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 0));
    while (Date.now() < deadline) {
      if (isSocketOpen() && !isWarmingUp()) return true;
      await delay(500);
    }
    return false;
  }

  function heavyWorkPaused() {
    return Date.now() < heavyWorkPausedUntil;
  }

  function backupOwnerConfigured() {
    return Boolean(config.backup?.ownerNumber || config.ownerNumbers?.[0]);
  }

  function stableNotifyOwnerNumber() {
    return config.ownerNumbers?.[0] || config.backup?.ownerNumber || "";
  }

  async function notifyOwnerStable(reason = "whatsapp-connect", connectedSock = sock) {
    if (!OWNER_STABLE_NOTIFY_ENABLED) return { skipped: true, reason: "stable_notify_disabled" };
    if (connectedSock !== sock || !isSocketOpen(connectedSock) || isWarmingUp()) {
      return { skipped: true, reason: "connection_not_stable" };
    }
    const ownerNumber = stableNotifyOwnerNumber();
    if (!ownerNumber) return { skipped: true, reason: "owner_not_configured" };
    const now = Date.now();
    if (now - lastOwnerStableNotifyAt < OWNER_STABLE_NOTIFY_COOLDOWN_MS) {
      return { skipped: true, reason: "stable_notify_throttled" };
    }
    const botNumber = normalizeWhatsAppNumber(String(jid || sock?.user?.id || "").split("@")[0].split(":")[0]) || config.botNumber || "-";
    const text = [
      "Kavya WhatsApp stabil.",
      `Bot: ${botNumber}`,
      `Status: ${connectionState}`,
      `Alasan konek: ${reason}`,
      `Cooldown: ${Math.round(STABLE_CONNECT_DELAY_MS / 1000)} detik selesai`,
    ].join("\n");
    await sendMessage(ownerNumber, text, "", "", "", "", {
      timeoutMs: Math.max(60_000, Number(process.env.WHATSAPP_OWNER_STABLE_NOTIFY_TIMEOUT_MS || 120_000)),
      recoverOnTimeout: false,
    });
    lastOwnerStableNotifyAt = now;
    logTracking(`Notif stabil terkirim ke owner ${ownerNumber}`);
    return { sent: true, ownerNumber };
  }

  async function cleanupSocket(targetSock = sock) {
    try {
      targetSock?.ev?.removeAllListeners?.();
      if (targetSock?.ws?.readyState === 1) {
        targetSock.ws.close();
      }
    } catch (error) {
      logWarning("WhatsApp socket cleanup failed", error);
    }
  }

  function recordReconnectPressure() {
    const now = Date.now();
    reconnectHistory = [...reconnectHistory.filter((time) => now - time <= RECONNECT_WINDOW_MS), now];
    if (reconnectHistory.length >= RECONNECT_CIRCUIT_LIMIT) {
      const previousPause = heavyWorkPausedUntil;
      heavyWorkPausedUntil = Math.max(heavyWorkPausedUntil, now + HEAVY_WORK_PAUSE_MS);
      if (previousPause <= now) {
        logWarning("Reconnect terlalu sering. Backup dan sync grup dijeda sementara; cek kemungkinan session ganda atau auth WhatsApp rusak.");
      }
    }
  }

  function scheduleReconnect(reason = "connection_closed") {
    if (reconnecting || reconnectTimer) {
      return;
    }

    reconnecting = true;
    reconnectAttempts += 1;
    recordReconnectPressure();
    const delayMs = reconnectDelayMs(reason, reconnectAttempts);
    nextReconnectDelayMs = delayMs;
    connectionState = "reconnecting";
    logReconnect({
      attempt: reconnectAttempts,
      max: MAX_RECONNECT_BURST,
      reason,
      delayMs,
    });
    if (reconnectAttempts === MAX_RECONNECT_BURST) {
      logWarning("Reconnect WhatsApp sudah berulang. Bot akan tetap mencoba dengan jeda lebih panjang sampai konek lagi.");
    }

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      reconnecting = false;
      lastReconnectAt = new Date().toISOString();
      connect().catch((error) => {
        lastError = error.message || "reconnect_failed";
        scheduleReconnect(lastError);
      });
    }, delayMs);
  }

  function imageSourceFromValue(value = "") {
    const source = String(value || "").trim();
    const match = source.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (match) {
      return Buffer.from(match[1], "base64");
    }
    return { url: source };
  }

  function mimetypeForFileName(value = "") {
    const lower = String(value || "").toLowerCase();
    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.endsWith(".gz")) return "application/gzip";
    if (lower.endsWith(".zip")) return "application/zip";
    if (lower.endsWith(".json")) return "application/json";
    return "application/octet-stream";
  }

  function enqueueSend(task) {
    const run = sendQueue.then(async () => {
      const waitMs = Math.max(0, lastSendAt + SEND_QUEUE_DELAY_MS - Date.now());
      if (waitMs) await delay(waitMs);
      try {
        return await task();
      } finally {
        lastSendAt = Date.now();
      }
    }, async () => {
      const waitMs = Math.max(0, lastSendAt + SEND_QUEUE_DELAY_MS - Date.now());
      if (waitMs) await delay(waitMs);
      try {
        return await task();
      } finally {
        lastSendAt = Date.now();
      }
    });
    sendQueue = run.catch(() => {});
    return run;
  }

  async function sendRawMessage(to, payload = {}, options = {}) {
    const jidValue = getJidFromTarget(to);
    if (!jidValue) {
      throw new Error("invalid_whatsapp_target");
    }

    const commandSend = options.commandReply === true;
    const retryDelays = Array.isArray(options.retryDelaysMs)
      ? options.retryDelaysMs
      : commandSend
        ? parseRetryDelays(process.env.WHATSAPP_COMMAND_SEND_RETRIES, COMMAND_SEND_RETRY_DELAYS_MS)
        : parseRetryDelays(process.env.WHATSAPP_SEND_RETRIES, SEND_RETRY_DELAYS_MS);
    const envTimeout = commandSend ? process.env.WHATSAPP_COMMAND_SEND_TIMEOUT_MS : process.env.WHATSAPP_SEND_TIMEOUT_MS;
    const sendTimeoutMs = Math.max(
      1000,
      Number(options.timeoutMs || envTimeout || (commandSend ? COMMAND_SEND_ATTEMPT_TIMEOUT_MS : SEND_ATTEMPT_TIMEOUT_MS)),
    );
    const recoverOnTimeout = options.recoverOnTimeout !== false && options.recoverOnTimeout === true;
    const {
      commandReply: _commandReply,
      recoverOnTimeout: _recoverOnTimeout,
      retryDelaysMs: _retryDelaysMs,
      timeoutMs: _timeoutMs,
      ...sendOptions
    } = options || {};

    let lastSendError = null;
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        if (isWarmingUp()) {
          await delay(Math.max(0, warmingUntil - Date.now()));
        }
        const sentMessage = await enqueueSend(() => {
          const activeSock = sock;
          if (!isSocketOpen(activeSock)) {
            throw new Error("whatsapp_bot_not_connected");
          }
          return withTimeout(activeSock.sendMessage(jidValue, payload, sendOptions), sendTimeoutMs, "whatsapp_send_timed_out");
        });
        if (!sentMessage?.key) {
          throw new Error("send_message_empty_result");
        }
        if (debugSendEnabled()) {
          logTracking(`Send OK -> ${jidValue} (${sentMessage.key?.id || "no-id"})`);
        }
        return sentMessage;
      } catch (error) {
        lastSendError = error;
        if (debugSendEnabled()) {
          logWarning(`Send retry ${attempt + 1}/${retryDelays.length + 1} -> ${jidValue}`, error);
        }
        if (commandSend && shouldRecoverSendTransport(error)) {
          logWarning(`WhatsApp send command tertahan, reconnect tanpa resend otomatis -> ${jidValue}`, error);
          recoverTransportError(error);
        }
        if (!isTemporarySendError(error) || attempt >= retryDelays.length) {
          throw error;
        }
        if (recoverOnTimeout && shouldRecoverSendTransport(error)) {
          logWarning(`WhatsApp send tertahan, reconnect sebelum retry -> ${jidValue}`, error);
          recoverTransportError(error);
          const ready = await waitForSocketReady(30_000);
          if (ready) {
            continue;
          }
        }
        await delay(retryDelays[attempt]);
      }
    }
    throw lastSendError || new Error("send_message_failed");
  }

  function getRawSocket() {
    return sock;
  }

  async function sendMessage(to, text, imageUrl = "", mediaPath = "", documentPath = "", fileName = "", options = {}) {
    const jidValue = getJidFromTarget(to);
    if (!jidValue) {
      throw new Error("invalid_whatsapp_target");
    }

    const normalizedText = String(text || "").trim();
    const normalizedImageUrl = String(imageUrl || "").trim();
    const normalizedMediaPath = String(mediaPath || "").trim();
    const normalizedDocumentPath = String(documentPath || "").trim();
    const normalizedFileName = String(fileName || "").trim() || normalizedDocumentPath.split(/[\\/]/).pop();

    if (normalizedDocumentPath && !existsSync(normalizedDocumentPath)) {
      throw new Error("document_path_not_found");
    }

    let payload = { text: normalizedText, linkPreview: false };
    if (normalizedImageUrl) {
      payload = {
        image: imageSourceFromValue(normalizedImageUrl),
        caption: normalizedText,
      };
    } else if (normalizedMediaPath) {
      payload = {
        image: { url: normalizedMediaPath },
        caption: normalizedText,
      };
    } else if (normalizedDocumentPath) {
      payload = {
        document: { url: normalizedDocumentPath },
        fileName: normalizedFileName,
        mimetype: mimetypeForFileName(normalizedFileName || normalizedDocumentPath),
        caption: normalizedText,
      };
    }
    if (Array.isArray(options.mentions) && options.mentions.length) {
      payload.mentions = options.mentions;
    }

    return sendRawMessage(jidValue, payload, options);
  }

  async function deleteMessage(to, messageKey) {
    if (!isSocketOpen()) {
      throw new Error("whatsapp_bot_not_connected");
    }

    const jidValue = getJidFromTarget(to);
    if (!jidValue) {
      throw new Error("invalid_whatsapp_target");
    }

    const key =
      typeof messageKey === "string"
        ? {
            remoteJid: jidValue,
            id: messageKey,
            fromMe: true,
          }
        : {
            ...messageKey,
            remoteJid: messageKey?.remoteJid || jidValue,
          };
    if (!key.id) {
      throw new Error("message_key_not_found");
    }
    return sock.sendMessage(jidValue, { delete: key });
  }

  function getGroupSyncEndpointUrl() {
    if (!config.inboundWebhookUrl) {
      return "";
    }
    try {
      const url = new URL(config.inboundWebhookUrl);
      url.pathname = "/api/whatsapp/groups/sync";
      url.search = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function getWebhookHeaders() {
    return {
      "Content-Type": "application/json",
      ...(config.inboundWebhookToken ? { Authorization: `Bearer ${config.inboundWebhookToken}` } : {}),
    };
  }

  /*
   * `includeParticipants: false` returns the same group with the roster left
   * out. It exists because two callers want very different shapes from the same
   * Baileys metadata:
   *
   *   - `getGroupInfo` / `getGroupParticipantInfo` need every member, because
   *     they answer admin checks and the legacy group commands, and that is
   *     answered from live metadata on demand rather than cached.
   *   - `listJoinedGroups` runs over *every* group the bot is in, on every sync,
   *     and used to build a full roster for each one. The dashboard threw the
   *     roster away -- `normalizeSyncedGroup` is a whitelist with no
   *     `participants` key -- so a 1000-member group meant 1000 phone numbers
   *     serialised onto the wire for nothing.
   *
   * The count is still carried, because that is the field anyone actually reads.
   */
  function groupInfoFromMetadata(group = {}, fallbackJid = "", { includeParticipants = true } = {}) {
    const groupJid = normalizeGroupJid(group?.id || group?.jid || fallbackJid || "");
    if (!groupJid) return null;
    const ownerJid = String(group?.owner || group?.subjectOwner || "").trim();
    const ownerNumber = normalizeWhatsAppNumber(ownerJid.split("@")[0].split(":")[0]);
    const participants = includeParticipants && Array.isArray(group?.participants)
      ? group.participants.map((participant) => {
          const id = String(participant?.id || participant?.jid || "").trim();
          const jid = String(participant?.jid || participant?.phoneNumber || participant?.pn || participant?.id || "").trim();
          const lid = String(participant?.lid || participant?.id || "").trim();
          const admin = String(participant?.admin || "").trim();
          return {
            id,
            jid,
            lid,
            number: normalizeWhatsAppNumber(jid || id),
            admin,
            is_admin: Boolean(admin),
            is_super_admin: admin === "superadmin",
          };
        })
      : [];
    return {
      group_jid: groupJid,
      group_name: String(group?.subject || group?.name || "").trim(),
      participant_count: participants.length || Number(group?.size || 0),
      owner_jid: ownerJid,
      owner_number: ownerNumber,
      description: String(group?.desc || group?.description || "").trim(),
      participants,
      synced_at: new Date().toISOString(),
    };
  }

  async function getGroupInfo(groupJid) {
    if (!isSocketOpen()) {
      throw new Error("whatsapp_bot_not_connected");
    }
    const normalized = normalizeGroupJid(groupJid);
    if (!normalized) {
      throw new Error("invalid_group_jid");
    }
    const metadata = await sock.groupMetadata(normalized);
    return groupInfoFromMetadata(metadata, normalized);
  }

  async function getGroupParticipantInfo(groupJid, participantJid = "") {
    const info = await getGroupInfo(groupJid);
    const target = String(participantJid || "").trim();
    const targetNumber = normalizeWhatsAppNumber(target);
    const participant =
      info.participants.find((item) => item.id === target || item.jid === target || item.lid === target) ||
      info.participants.find((item) => targetNumber && item.number === targetNumber) ||
      null;
    if (!participant) {
      return {
        group: info,
        participant: null,
        jid: target,
        number: targetNumber,
        checked: true,
        is_admin: info.owner_number && targetNumber ? info.owner_number === targetNumber : false,
      };
    }
    return {
      group: info,
      participant,
      jid: participant.jid || participant.id || target,
      number: participant.number || targetNumber,
      checked: true,
      is_admin: Boolean(participant.is_admin || (info.owner_number && participant.number === info.owner_number)),
      is_super_admin: Boolean(participant.is_super_admin),
    };
  }

  async function updateGroupSetting(groupJid, setting) {
    if (!isSocketOpen()) {
      throw new Error("whatsapp_bot_not_connected");
    }
    const normalized = normalizeGroupJid(groupJid);
    if (!normalized) {
      throw new Error("invalid_group_jid");
    }
    return sock.groupSettingUpdate(normalized, setting);
  }

  async function updateGroupParticipants(groupJid, participants = [], action = "") {
    if (!isSocketOpen()) {
      throw new Error("whatsapp_bot_not_connected");
    }
    const normalized = normalizeGroupJid(groupJid);
    const targets = Array.from(new Set((participants || []).map((item) => String(item || "").trim()).filter(Boolean)));
    if (!normalized || !targets.length || !action) {
      throw new Error("invalid_group_participant_action");
    }
    return sock.groupParticipantsUpdate(normalized, targets, action);
  }

  async function updateGroupSubject(groupJid, subject = "") {
    if (!isSocketOpen()) {
      throw new Error("whatsapp_bot_not_connected");
    }
    const normalized = normalizeGroupJid(groupJid);
    if (!normalized) {
      throw new Error("invalid_group_jid");
    }
    return sock.groupUpdateSubject(normalized, String(subject || "").trim());
  }

  async function updateGroupDescription(groupJid, description = "") {
    if (!isSocketOpen()) {
      throw new Error("whatsapp_bot_not_connected");
    }
    const normalized = normalizeGroupJid(groupJid);
    if (!normalized) {
      throw new Error("invalid_group_jid");
    }
    return sock.groupUpdateDescription(normalized, String(description || ""));
  }

  async function listJoinedGroups() {
    if (!isSocketOpen()) {
      throw new Error("whatsapp_bot_not_connected");
    }
    if (typeof sock.groupFetchAllParticipating !== "function") {
      throw new Error("group_fetch_not_supported");
    }

    const response = await sock.groupFetchAllParticipating();
    return Object.values(response || {})
      .map((group) => groupInfoFromMetadata(group, "", { includeParticipants: false }))
      .filter(Boolean);
  }

  async function cacheJoinedGroups(groups = []) {
    if (!Array.isArray(groups) || !groups.length) return;
    await store.update("groups", {}, (current) => {
      for (const group of groups) {
        const groupJid = normalizeGroupJid(group.group_jid || group.groupJid || "");
        if (!groupJid) continue;
        const existing = current[groupJid] || {};
        current[groupJid] = {
          ...existing,
          name: group.group_name || group.groupName || existing.name || "",
          groupName: group.group_name || group.groupName || existing.groupName || "",
          owner: group.owner_number || group.ownerNumber || existing.owner || "",
          contact: group.owner_number || group.ownerNumber || existing.contact || "",
          participant_count: Number(group.participant_count || group.participantCount || existing.participant_count || 0),
          description: group.description || existing.description || "",
          synced_at: group.synced_at || group.syncedAt || new Date().toISOString(),
        };
      }
      return current;
    });
  }

  async function syncJoinedGroups(reason = "manual") {
    /*
     * One sync at a time.
     *
     * The two guards below are both skipped for any reason beginning with
     * "manual" -- which is exactly the reason the owner-triggered endpoint uses,
     * and the only manual caller anywhere. So two manual syncs would both pass
     * the throttle, both pass the heavy-work pause, both fetch the group list,
     * and both POST it. The dashboard serialises its writes, so the loser is not
     * an error: it is a silently discarded result, and the owner's second click
     * looks like it did nothing.
     *
     * A second caller is now told so rather than being allowed to race.
     */
    if (groupSyncInFlight) {
      return { success: true, skipped: true, reason: "group_sync_in_flight", group_count: lastGroupSyncCount };
    }
    groupSyncInFlight = true;
    try {
      return await runGroupSync(reason);
    } finally {
      groupSyncInFlight = false;
    }
  }

  async function runGroupSync(reason) {
    const lastSyncMs = lastGroupSyncAt ? new Date(lastGroupSyncAt).getTime() : 0;
    if (!String(reason || "").startsWith("manual") && lastSyncMs && Date.now() - lastSyncMs < GROUP_SYNC_MIN_INTERVAL_MS) {
      return { success: true, skipped: true, reason: "group_sync_throttled", group_count: lastGroupSyncCount };
    }
    if (!String(reason || "").startsWith("manual") && heavyWorkPaused()) {
      lastGroupSyncError = "heavy_work_paused";
      return { success: false, skipped: true, reason: lastGroupSyncError };
    }
    const endpoint = getGroupSyncEndpointUrl();
    if (!endpoint || !config.inboundWebhookToken) {
      lastGroupSyncError = "group_sync_webhook_unconfigured";
      return { success: false, reason: lastGroupSyncError };
    }

    const groups = await listJoinedGroups();
    await cacheJoinedGroups(groups).catch((error) => {
      logWarning("WhatsApp local group cache update failed", error);
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: getWebhookHeaders(),
      body: JSON.stringify({
        source: reason,
        groups,
        synced_at: new Date().toISOString(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    lastGroupSyncAt = new Date().toISOString();
    lastGroupSyncCount = groups.length;
    lastGroupSyncError = "";
    logSuccess(`WhatsApp group directory synced (${groups.length} groups)`);
    return {
      success: true,
      groups,
      result: data.result || {},
    };
  }

  async function requestPairingCodeIfNeeded(authState, { delayMs = 0 } = {}) {
    if (!config.pairing.enabled || !config.pairing.number || authState.creds.registered) {
      return;
    }
    if (pairingCode || existingPairingCode(authState)) {
      setPairingCode(pairingCode || existingPairingCode(authState));
      return;
    }
    if (pairingRequestAttempts >= 5) {
      return;
    }
    if (delayMs > 0) {
      await delay(delayMs);
      if (!sock || authState.creds.registered || pairingCode) return;
    }

    try {
      pairingRequestAttempts += 1;
      pairingCode = await sock.requestPairingCode(config.pairing.number);
      setPairingCode(pairingCode);
    } catch (error) {
      lastError = error.message || "pairing_code_failed";
      logWarning(`Failed to request WhatsApp pairing code (${pairingRequestAttempts}/5)`, error);
      if (!pairingCode && pairingRequestAttempts < 5 && !pairingRequestTimer) {
        pairingRequestTimer = setTimeout(() => {
          pairingRequestTimer = null;
          void requestPairingCodeIfNeeded(authState).catch((retryError) => {
            lastError = retryError.message || "pairing_code_failed";
          });
        }, 5000);
        pairingRequestTimer.unref?.();
      }
    }
  }

  function runAfterConnectJobs(reason = "whatsapp-connect", connectedSock = sock) {
    setTimeout(async () => {
      if (connectedSock !== sock || !isSocketOpen(connectedSock)) return;
      if (heavyWorkPaused()) {
        logWarning("Backup dan sync grup dilewati sementara karena koneksi baru saja reconnect berkali-kali.");
        return;
      }

      if (config.backup?.onConnect) {
        await autoBackupOnConnect({
          config,
          logger,
          store,
          sendMessage,
          isConnected: () => connectedSock === sock && isSocketOpen(connectedSock),
          stableDelayMs: 0,
          reason,
          force: false,
        }).catch((error) => {
          logWarning("Auto backup on connect failed", error);
        });
      }

      if (connectedSock !== sock || !isSocketOpen(connectedSock)) {
        lastGroupSyncError = "connection_not_stable";
        return;
      }
      await notifyOwnerStable(reason, connectedSock).catch((error) => {
        logWarning("Notif stabil WhatsApp ke owner gagal", error);
      });
      if (!GROUP_SYNC_ON_CONNECT) {
        lastGroupSyncError = "group_sync_on_connect_disabled";
        return;
      }
      await syncJoinedGroups("whatsapp-connect").catch((error) => {
        lastGroupSyncError = error.message || "group_sync_failed";
        logWarning("WhatsApp group directory sync failed", error);
      });
    }, STABLE_CONNECT_DELAY_MS);
  }

  async function runScheduledBackup(reason = "whatsapp-scheduled") {
    if (!config.backup?.auto || !config.backup?.scheduled || !config.backup?.intervalMs) {
      lastScheduledBackupStatus = "disabled";
      await recordBackupOutcome({ status: "disabled", reason: "scheduled_backup_disabled" });
      return { skipped: true, reason: "scheduled_backup_disabled" };
    }
    if (scheduledBackupRunning) {
      return { skipped: true, reason: "scheduled_backup_running" };
    }
    if (heavyWorkPaused()) {
      lastScheduledBackupStatus = "skipped";
      lastScheduledBackupError = "heavy_work_paused";
      await recordBackupOutcome({ status: "skipped", reason: "heavy_work_paused" });
      return { skipped: true, reason: "heavy_work_paused" };
    }
    const currentSock = sock;
    if (!isSocketOpen(currentSock)) {
      lastScheduledBackupStatus = "skipped";
      lastScheduledBackupError = connectionState || "whatsapp_not_connected";
      await recordBackupOutcome({ status: "skipped", reason: lastScheduledBackupError });
      return { skipped: true, reason: lastScheduledBackupError };
    }

    scheduledBackupRunning = true;
    lastScheduledBackupAt = new Date().toISOString();
    lastScheduledBackupStatus = "running";
    lastScheduledBackupError = "";
    try {
      const result = await autoBackupOnConnect({
        config,
        logger,
        store,
        sendMessage,
        isConnected: () => currentSock === sock && isSocketOpen(currentSock),
        stableDelayMs: 0,
        reason,
        force: false,
      });
      lastScheduledBackupStatus = result?.skipped ? "skipped" : result?.sent ? "sent" : "created";
      lastScheduledBackupError = result?.sent === false ? result.reason || "send_failed" : "";
      const producedName = String(result?.fileName || result?.filePath || "").split(/[\\/]/).pop();
      await recordBackupOutcome({
        status: lastScheduledBackupStatus,
        error: lastScheduledBackupError,
        reason: result?.reason || "",
        fileName: producedName,
      });
      return result;
    } catch (error) {
      lastScheduledBackupStatus = "failed";
      lastScheduledBackupError = error.message || "scheduled_backup_failed";
      logWarning("Auto backup 6 jam gagal", error);
      await recordBackupOutcome({ status: "failed", error: lastScheduledBackupError, reason });
      return { success: false, error: lastScheduledBackupError };
    } finally {
      scheduledBackupRunning = false;
    }
  }

  function startScheduledBackup() {
    const intervalMs = Number(config.backup?.intervalMs || 0);
    if (!config.backup?.auto || !config.backup?.scheduled || intervalMs <= 0 || scheduledBackupTimer) {
      return;
    }
    const hours = intervalMs / (60 * 60 * 1000);
    logSuccess(`Auto backup WhatsApp aktif tiap ${Number.isInteger(hours) ? hours : hours.toFixed(1)} jam`);
    scheduledBackupTimer = setInterval(() => {
      void runScheduledBackup("whatsapp-scheduled").catch((error) => {
        lastScheduledBackupStatus = "failed";
        lastScheduledBackupError = error.message || "scheduled_backup_failed";
        logWarning("Auto backup 6 jam gagal", error);
      });
    }, intervalMs);
    scheduledBackupTimer.unref?.();
  }

  async function connect() {
    if (isConnecting) {
      return;
    }

    isConnecting = true;
    connectionState = "connecting";
    lastError = "";

    try {
      await cleanupTmpDir(config, logger);
      const { state, saveCreds } = await useMultiFileAuthState(config.paths.authDir);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: baileysLogger,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 20000,
      });

      const saveCredentials = () => {
        void saveCreds().catch((error) => {
          lastError = error.message || "save_creds_failed";
          logWarning("WhatsApp auth save failed", error);
        });
      };

      async function handleConnectionUpdate(update) {
        if (update.qr && !config.pairing.enabled) {
          qrText = update.qr;
          qrDataUrl = await QRCode.toDataURL(update.qr, {
            errorCorrectionLevel: "M",
            margin: 1,
            scale: 6,
          });
          connectionState = "qr";
        }

        if (update.connection === "open") {
          connectionState = "open";
          reconnecting = false;
          warmingUntil = Date.now() + STABLE_CONNECT_DELAY_MS;
          qrDataUrl = "";
          qrText = "";
          pairingCode = "";
          jid = sock?.user?.id || "";
          const backupReason = pendingReconnectBackupReason || "whatsapp-connect";
          pendingReconnectBackupReason = "";
          resetReconnectState();
          logTracking("Koneksi Terhubung");
          runAfterConnectJobs(backupReason, sock);
        }

        if (update.connection === "close") {
          if (reconnecting) return;
          const statusCode =
            update.lastDisconnect?.error?.output?.statusCode ||
            update.lastDisconnect?.error?.statusCode ||
            0;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          lastDisconnectAt = new Date().toISOString();
          lastDisconnectReason = String(update.lastDisconnect?.error?.message || statusCode || "connection_closed");

          connectionState = shouldReconnect ? "reconnecting" : "logged_out";
          lastError = String(update.lastDisconnect?.error?.message || "connection_closed");
          pendingReconnectBackupReason = shouldReconnect ? "whatsapp-reconnect" : "whatsapp-logged-out";
          jid = "";
          const closedSock = sock;
          sock = null;
          await cleanupSocket(closedSock);

          if (shouldReconnect) {
            scheduleReconnect(statusCode || lastError);
          } else {
            logWarning("Session Logged Out. Stop reconnect.");
            resetReconnectState();
          }
        }
      }

      sock.ev.on("creds.update", saveCredentials);

      sock.ev.on("connection.update", (update) => {
        if (update.qr && config.pairing.enabled) {
          void requestPairingCodeIfNeeded(state).catch((error) => {
            lastError = error.message || "pairing_code_failed";
            logWarning("WhatsApp pairing retry failed", error);
          });
        }
        void handleConnectionUpdate(update).catch((error) => {
          lastError = error.message || "connection_update_failed";
          logWarning("WhatsApp connection update failed", error);
        });
      });

      void requestPairingCodeIfNeeded(state, { delayMs: 3000 }).catch((error) => {
        lastError = error.message || "pairing_code_failed";
        logWarning("WhatsApp pairing retry failed", error);
      });

      sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const message of messages || []) {
          try {
            await handleIncomingMessage({
              message,
              config,
              logger,
              plugins,
              store,
              sendMessage,
              sendRawMessage,
              getRawSocket,
              getGroupInfo,
              getGroupParticipantInfo,
              deleteMessage,
              updateGroupSetting,
              updateGroupParticipants,
              updateGroupSubject,
              updateGroupDescription,
              isWhatsAppReady: () => isSocketOpen() && !isWarmingUp(),
              botJid: jid || sock?.user?.id || "",
            });
          } catch (error) {
            if (isTemporarySendError(error)) {
              logWarning("Inbound WhatsApp command dilewati karena koneksi belum siap", error);
              continue;
            }
            logWarning("Failed to process inbound WhatsApp message", error);
          }
        }
      });
    } catch (error) {
      connectionState = "error";
      lastError = error.message || "failed_to_initialize";
      logError("Failed to initialize WhatsApp bot", error);
      const failedSock = sock;
      sock = null;
      await cleanupSocket(failedSock);
      scheduleReconnect(lastError);
    } finally {
      isConnecting = false;
    }
  }

  async function inspectGroupInvite(inviteLink = "") {
    if (!isSocketOpen()) {
      throw new Error("whatsapp_bot_not_connected");
    }

    const inviteCode = extractInviteCode(inviteLink);
    if (!inviteCode) {
      throw new Error("invalid_group_invite_link");
    }

    const response = await sock.query({
      tag: "iq",
      attrs: { type: "get", xmlns: "w:g2", to: "@g.us" },
      content: [{ tag: "invite", attrs: { code: inviteCode } }],
    });

    const attrs = response?.content?.[0]?.attrs || {};
    const groupJid = normalizeGroupJid(attrs.id || "");
    if (!groupJid) {
      throw new Error("group_not_found");
    }

    return {
      group_jid: groupJid,
      group_name: String(attrs.subject || "").trim(),
      invite_link: inviteLink,
      invite_code: inviteCode,
    };
  }

  async function joinGroupInvite(inviteLink = "") {
    const info = await inspectGroupInvite(inviteLink);
    try {
      await sock.groupAcceptInvite(info.invite_code);
    } catch (error) {
      const message = String(error?.message || "");
      if (!/already|409|conflict/i.test(message)) {
        throw error;
      }
    }
    const metadata = await getGroupInfo(info.group_jid).catch(() => null);
    return { ...info, ...(metadata || {}) };
  }

  function recoverTransportError(error = "") {
    lastError = String(error?.message || error || "whatsapp_transport_error");
    if (connectionState === "logged_out" || reconnecting || reconnectTimer) {
      return;
    }
    const failedSock = sock;
    sock = null;
    connectionState = "reconnecting";
    void cleanupSocket(failedSock).finally(() => {
      scheduleReconnect("transport_error");
    });
  }

  function getStatusPayload() {
    const connected = isSocketOpen();
    return {
      success: true,
      connected,
      state: connectionState,
      jid,
      qr_available: Boolean(qrDataUrl),
      pairing_available: Boolean(pairingCode),
      pairing_code: pairingCode,
      public_qr_url: config.publicUrl ? `${config.publicUrl.replace(/\/$/, "")}/session/qr` : "",
      last_error: lastError || "",
      runtime_dir: config.paths.runtimeDir,
      tmp_dir: config.paths.tmpDir,
      auth_dir: config.paths.authDir,
      database_dir: config.database.dir,
      reconnect_attempts: reconnectAttempts,
      last_reconnect_at: lastReconnectAt,
      next_reconnect_delay_ms: nextReconnectDelayMs,
      last_disconnect_at: lastDisconnectAt,
      last_disconnect_reason: lastDisconnectReason,
      warming_up: isWarmingUp(),
      heavy_work_paused: heavyWorkPaused(),
      group_sync: {
        last_synced_at: lastGroupSyncAt,
        last_error: lastGroupSyncError,
        group_count: lastGroupSyncCount,
      },
      auto_backup: {
        enabled: Boolean(config.backup?.auto),
        scheduled: Boolean(config.backup?.scheduled),
        interval_ms: Number(config.backup?.intervalMs || 0),
        owner_configured: backupOwnerConfigured(),
        running: scheduledBackupRunning,
        last_run_at: lastScheduledBackupAt,
        last_status: lastScheduledBackupStatus,
        last_error: lastScheduledBackupError,
      },
    };
  }

  function getHealthPayload() {
    const connected = isSocketOpen();
    return {
      success: true,
      connected,
      state: connectionState,
      qr_available: Boolean(qrDataUrl),
      pairing_available: Boolean(pairingCode),
    };
  }

  function renderQrPage() {
    const escapedState = String(connectionState || "unknown").replace(/[<>&"]/g, "");
    const escapedPairing = String(pairingCode || "").replace(/[<>&"]/g, "");
    if (pairingCode) {
      return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Pairing WhatsApp</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#17110d;color:#fff4e5;font-family:Inter,Arial,sans-serif}main{width:min(520px,calc(100vw - 32px));border:1px solid rgba(235,214,186,.18);border-radius:12px;background:#241a14;padding:28px;text-align:center;box-shadow:0 22px 70px rgba(0,0,0,.32)}h1{margin:0 0 10px;font-size:30px;line-height:1.1}p{margin:0 0 20px;color:#d8c7b3;line-height:1.6}.code{font-size:34px;font-weight:800;letter-spacing:4px;background:#fff4e5;color:#17110d;border-radius:10px;padding:16px;margin-top:10px}.pill{display:inline-flex;margin-bottom:18px;border:1px solid rgba(235,214,186,.2);border-radius:999px;padding:6px 10px;color:#e8d3ba;font-size:13px}</style></head>
<body><main><div class="pill">Status: ${escapedState}</div><h1>Pairing Code WhatsApp</h1><p>Buka WhatsApp di HP, pilih perangkat tertaut, lalu pilih tautkan dengan nomor telepon.</p><div class="code">${escapedPairing}</div></main></body>
</html>`;
    }

    if (!qrDataUrl) {
      return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>WhatsApp QR</title><meta http-equiv="refresh" content="5" />
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#17110d;color:#fff4e5;font-family:Inter,Arial,sans-serif}main{width:min(520px,calc(100vw - 32px));border:1px solid rgba(235,214,186,.18);border-radius:12px;background:#241a14;padding:28px;box-shadow:0 22px 70px rgba(0,0,0,.32)}h1{margin:0 0 10px;font-size:28px;line-height:1.1}p{margin:0;color:#d8c7b3;line-height:1.6}.pill{display:inline-flex;margin-bottom:18px;border:1px solid rgba(235,214,186,.2);border-radius:999px;padding:6px 10px;color:#e8d3ba;font-size:13px}</style></head>
<body><main><div class="pill">Status: ${escapedState}</div><h1>QR WhatsApp belum tersedia</h1><p>Halaman ini refresh otomatis. Kalau terlalu lama, cek panel Auto Order untuk status reconnect.</p></main></body>
</html>`;
    }

    return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Scan QR WhatsApp</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#17110d;color:#fff4e5;font-family:Inter,Arial,sans-serif}main{width:min(520px,calc(100vw - 32px));border:1px solid rgba(235,214,186,.18);border-radius:12px;background:#241a14;padding:28px;text-align:center;box-shadow:0 22px 70px rgba(0,0,0,.32)}h1{margin:0 0 10px;font-size:30px;line-height:1.1}p{margin:0 0 20px;color:#d8c7b3;line-height:1.6}img{display:block;width:min(340px,100%);margin:0 auto;background:#fff;padding:14px;border-radius:10px}.pill{display:inline-flex;margin-bottom:18px;border:1px solid rgba(235,214,186,.2);border-radius:999px;padding:6px 10px;color:#e8d3ba;font-size:13px}</style></head>
<body><main><div class="pill">Status: ${escapedState}</div><h1>Scan QR WhatsApp</h1><p>Buka WhatsApp di HP, pilih perangkat tertaut, lalu scan kode ini.</p><img src="${qrDataUrl}" alt="WhatsApp QR" /></main></body>
</html>`;
  }

  startScheduledBackup();

  return {
    connect,
    sendMessage,
    sendRawMessage,
    getRawSocket,
    deleteMessage,
    syncJoinedGroups,
    getGroupInfo,
    getGroupParticipantInfo,
    updateGroupSetting,
    updateGroupParticipants,
    updateGroupSubject,
    updateGroupDescription,
    inspectGroupInvite,
    joinGroupInvite,
    getStatusPayload,
    getHealthPayload,
    renderQrPage,
    setLastError,
    recoverTransportError,
  };
}
