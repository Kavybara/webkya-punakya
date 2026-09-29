import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { readFile } from "node:fs/promises";
import { normalizeWhatsAppNumber, isDirectChatJid, isGroupChatJid } from "../lib/jid.js";
import { logCommand, logTracking, logWarning } from "../lib/panel-log.js";
import * as rentalGate from "../lib/rental-gate.js";

function isWhatsAppTransportError(error = "") {
  const message = String(error?.message || error || "");
  return /whatsapp_bot_not_connected|whatsapp_send_timed_out|send_timed_out|send_message_empty_result|write EPIPE|EPIPE|socket|closed|not open|connection.*(closed|lost|reset)|timed?\s*out/i.test(message);
}

function unwrapMessage(message = {}) {
  let current = message || {};
  for (let index = 0; index < 8; index += 1) {
    const next =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.protocolMessage?.editedMessage ||
      current?.editedMessage?.message?.protocolMessage?.editedMessage;

    if (!next || next === current) {
      break;
    }
    current = next;
  }
  return current || {};
}

function readInteractiveResponseText(message = {}) {
  const nativeParams = String(message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || "").trim();
  if (nativeParams) {
    try {
      const parsed = JSON.parse(nativeParams);
      return String(
        parsed?.id ||
          parsed?.name ||
          parsed?.title ||
          parsed?.display_text ||
          parsed?.selected_display_text ||
          "",
      ).trim();
    } catch (_error) {
      return "";
    }
  }

  return String(
    message?.interactiveResponseMessage?.body?.text ||
      message?.interactiveResponseMessage?.buttonReply?.displayText ||
      message?.interactiveResponseMessage?.buttonReply?.id ||
      "",
  ).trim();
}

export function extractTextFromMessage(message = {}) {
  const unwrapped = unwrapMessage(message);
  return (
    String(unwrapped?.conversation || "").trim() ||
    String(unwrapped?.extendedTextMessage?.text || "").trim() ||
    String(unwrapped?.imageMessage?.caption || "").trim() ||
    String(unwrapped?.videoMessage?.caption || "").trim() ||
    String(unwrapped?.documentMessage?.caption || "").trim() ||
    String(unwrapped?.buttonsResponseMessage?.selectedDisplayText || "").trim() ||
    String(unwrapped?.buttonsResponseMessage?.selectedButtonId || "").trim() ||
    String(unwrapped?.templateButtonReplyMessage?.selectedDisplayText || "").trim() ||
    String(unwrapped?.templateButtonReplyMessage?.selectedId || "").trim() ||
    String(unwrapped?.listResponseMessage?.singleSelectReply?.selectedRowId || "").trim() ||
    String(unwrapped?.listResponseMessage?.title || "").trim() ||
    readInteractiveResponseText(unwrapped) ||
    ""
  );
}

function messageContextInfo(message = {}) {
  const unwrapped = unwrapMessage(message);
  return (
    unwrapped?.extendedTextMessage?.contextInfo ||
    unwrapped?.imageMessage?.contextInfo ||
    unwrapped?.videoMessage?.contextInfo ||
    unwrapped?.documentMessage?.contextInfo ||
    unwrapped?.buttonsResponseMessage?.contextInfo ||
    unwrapped?.templateButtonReplyMessage?.contextInfo ||
    unwrapped?.listResponseMessage?.contextInfo ||
    unwrapped?.interactiveResponseMessage?.contextInfo ||
    {}
  );
}

function mediaEnvelopeFromMessage(message = {}) {
  const unwrapped = unwrapMessage(message);
  if (unwrapped?.imageMessage) return { kind: "image", message: { imageMessage: unwrapped.imageMessage } };
  if (unwrapped?.videoMessage) return { kind: "video", message: { videoMessage: unwrapped.videoMessage } };
  if (unwrapped?.documentMessage) return { kind: "document", message: { documentMessage: unwrapped.documentMessage } };
  return null;
}

function quotedMediaEnvelopeFromMessage(message = {}) {
  const contextInfo = messageContextInfo(message);
  if (!contextInfo?.quotedMessage || typeof contextInfo.quotedMessage !== "object") return null;
  return mediaEnvelopeFromMessage(contextInfo.quotedMessage);
}

function quotedMessageKeyFromMessage(rawMessage = {}) {
  const contextInfo = messageContextInfo(rawMessage?.message);
  const stanzaId = String(contextInfo?.stanzaId || "").trim();
  if (!stanzaId) return null;
  return {
    remoteJid: String(rawMessage?.key?.remoteJid || "").trim(),
    id: stanzaId,
    participant: String(contextInfo?.participant || "").trim() || undefined,
    fromMe: false,
  };
}

function extensionFromMediaEnvelope(mediaEnvelope = {}) {
  const targetMessage =
    mediaEnvelope?.message?.imageMessage ||
    mediaEnvelope?.message?.videoMessage ||
    mediaEnvelope?.message?.documentMessage ||
    {};
  const fileName = String(targetMessage?.fileName || "").trim().toLowerCase();
  if (fileName.includes(".")) {
    const ext = path.extname(fileName).trim().toLowerCase();
    if (ext) return ext;
  }
  const mimetype = String(targetMessage?.mimetype || "").trim().toLowerCase();
  if (mimetype.startsWith("image/")) return `.${mimetype.split("/")[1].split(";")[0] || "jpg"}`;
  if (mimetype.startsWith("video/")) return `.${mimetype.split("/")[1].split(";")[0] || "mp4"}`;
  if (mimetype === "application/pdf") return ".pdf";
  if (mimetype.includes("zip")) return ".zip";
  if (mimetype.includes("json")) return ".json";
  if (mediaEnvelope?.kind === "image") return ".jpg";
  if (mediaEnvelope?.kind === "video") return ".mp4";
  return ".bin";
}

function sanitizeMediaBaseName(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "list-media";
}

async function saveIncomingMedia({
  rawMessage,
  getRawSocket,
  projectRoot,
  preferredBaseName = "",
  source = "auto",
} = {}) {
  const currentMediaEnvelope = mediaEnvelopeFromMessage(rawMessage?.message);
  const quotedMediaEnvelope = quotedMediaEnvelopeFromMessage(rawMessage?.message);
  const mediaEnvelope =
    source === "quoted"
      ? quotedMediaEnvelope
      : source === "current"
        ? currentMediaEnvelope
        : currentMediaEnvelope || quotedMediaEnvelope;
  if (!mediaEnvelope) {
    return { saved: false, reason: "media_not_found" };
  }

  const socket = typeof getRawSocket === "function" ? getRawSocket() : null;
  if (!socket) {
    return { saved: false, reason: "socket_not_ready" };
  }

  const buffer = await downloadMediaMessage(
    mediaEnvelope === quotedMediaEnvelope
      ? { key: quotedMessageKeyFromMessage(rawMessage), message: quotedMediaEnvelope?.message || {} }
      : rawMessage,
    "buffer",
    {},
    {
      reuploadRequest: socket.updateMediaMessage,
      logger: undefined,
    },
  ).catch(async () => {
    if (source === "auto") {
      return downloadMediaMessage(
        { key: rawMessage?.key, message: mediaEnvelope.message },
        "buffer",
        {},
        {
          reuploadRequest: socket.updateMediaMessage,
          logger: undefined,
        },
      );
    }
    throw new Error("media_download_failed");
  });

  if (!buffer || !(buffer instanceof Uint8Array) || !buffer.byteLength) {
    return { saved: false, reason: "media_buffer_empty" };
  }

  const mediaDir = path.join(projectRoot || process.cwd(), "database", "media");
  await mkdir(mediaDir, { recursive: true });
  const extension = extensionFromMediaEnvelope(mediaEnvelope);
  const fileName = `${sanitizeMediaBaseName(preferredBaseName)}-${Date.now()}${extension}`;
  const filePath = path.join(mediaDir, fileName);
  await writeFile(filePath, Buffer.from(buffer));
  return {
    saved: true,
    fileName,
    filePath,
    source: mediaEnvelope.kind,
  };
}

function parseCommand(text = "", prefixes = [".", "#"]) {
  const source = String(text || "").trim();
  const prefix = prefixes.find((item) => source.startsWith(item));
  if (!prefix) {
    return { prefix: "", command: "", args: "" };
  }

  const body = source.slice(prefix.length).trim();
  const match = body.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const command = match?.[1] || "";
  return {
    prefix,
    command: command.toLowerCase(),
    args: String(match?.[2] || "").trim(),
  };
}

const DASHBOARD_AUTO_ORDER_COMMANDS = new Set([
  "addbalance",
  "addsaldo",
  "adddeposit",
  "balance",
  "saldo",
  "deposit",
  "stock",
  "stok",
  "buynow",
]);

const EXPIRED_GROUP_OWNER_COMMANDS = new Set(["ceksewa", "sewabot", "tambahsewa", "delsewa"]);
const recentExpiredGroupWarnings = new Map();
const RENTAL_DIRECTORY_CACHE_MS = 3000;
let rentalDirectoryCache = {
  expiresAt: 0,
  sources: [],
};
const recentMessageFingerprints = new Map();

function cleanupRecentMessageFingerprints(now = Date.now()) {
  for (const [key, timestamp] of recentMessageFingerprints.entries()) {
    if (now - timestamp > 5000) {
      recentMessageFingerprints.delete(key);
    }
  }
}

function shouldSkipDuplicateMessage({ message, remoteJid, text, pushName, senderJid, senderAliases = [] }) {
  const now = Date.now();
  cleanupRecentMessageFingerprints(now);
  const messageId = String(message?.key?.id || "").trim();
  const timestamp = String(message?.messageTimestamp || "").trim();
  const body = String(text || "").trim().toLowerCase();
  const aliasKey = Array.isArray(senderAliases) && senderAliases.length ? senderAliases.join(",") : String(senderJid || "").trim();
  const fingerprints = [
    messageId ? `id:${remoteJid}:${messageId}` : "",
    timestamp && body ? `body-generic:${remoteJid}:${timestamp}:${body}` : "",
    timestamp && body && pushName ? `body:${remoteJid}:${timestamp}:${String(pushName || "").trim().toLowerCase()}:${body}` : "",
    timestamp && body && aliasKey ? `sender-body:${remoteJid}:${timestamp}:${aliasKey}:${body}` : "",
  ].filter(Boolean);

  if (fingerprints.some((fingerprint) => recentMessageFingerprints.has(fingerprint))) {
    return true;
  }
  for (const fingerprint of fingerprints) {
    recentMessageFingerprints.set(fingerprint, now);
  }
  return false;
}

function isDashboardAutoOrderText(text = "", commandInfo = {}) {
  const command = String(commandInfo?.command || "").trim().toLowerCase();
  return (
    DASHBOARD_AUTO_ORDER_COMMANDS.has(command)
  );
}

function rentalExpirationMs(rental = {}) {
  if (!rental || typeof rental !== "object") return 0;
  const values = [
    rental.expired,
    rental.expiresAt,
    rental.expiredAt,
    rental.endsAt,
    rental.endAt,
    rental.end,
  ];

  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
      const timestamp = Number(value);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
      }
    }
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function rentalDaysLeft(rental = {}) {
  if (!rental || typeof rental !== "object") return 0;
  const expiresAt = rentalExpirationMs(rental);
  if (expiresAt > 0) {
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));
  }
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

export async function readDashboardRentalSources(config = {}) {
  const now = Date.now();
  if (rentalDirectoryCache.expiresAt > now) return rentalDirectoryCache.sources;

  const projectRoot = config.paths?.projectRoot || process.cwd();
  const sources = [];
  const dashboardDb = await readJsonObject(config.dashboardDatabasePath);
  const dashboardRentals = rentalMapFromRows(dashboardDb?.whatsappRentals || []);
  if (rentalDirectoryHasEntries(dashboardRentals)) {
    sources.push({ name: "dashboard-db.whatsappRentals", data: dashboardRentals, authoritative: true });
    if (!/^(1|true|yes|on)$/i.test(String(process.env.WHATSAPP_RENTAL_ALLOW_STORE_FALLBACK || "").trim())) {
      rentalDirectoryCache = {
        expiresAt: now + RENTAL_DIRECTORY_CACHE_MS,
        sources,
      };
      return sources;
    }
  }

  const candidates = [
    process.env.WHATSAPP_RENTALS_PATH,
    path.join(projectRoot, "apps", "dashboard", "runtime", "whatsapp-database", "rentals.json"),
    path.join(projectRoot, "kavya-digital-dashboard", "runtime", "whatsapp-database", "rentals.json"),
    path.join(projectRoot, "runtime", "whatsapp-database", "rentals.json"),
  ].filter(Boolean);

  for (const filePath of [...new Set(candidates)]) {
    const data = await readJsonObject(filePath);
    if (rentalDirectoryHasEntries(data)) {
      sources.push({ name: filePath, data });
    }
  }

  rentalDirectoryCache = {
    expiresAt: now + RENTAL_DIRECTORY_CACHE_MS,
    sources,
  };
  return sources;
}

function shouldWarnExpiredGroup(groupJid = "") {
  const now = Date.now();
  const last = recentExpiredGroupWarnings.get(groupJid) || 0;
  if (now - last < 60_000) return false;
  recentExpiredGroupWarnings.set(groupJid, now);
  return true;
}

export async function shouldBlockExpiredGroup({ store, remoteJid, commandInfo, isOwner, config }) {
  const rentals = await store.read("rentals", {});
  const allowOwnerRentalCommand = Boolean(isOwner && EXPIRED_GROUP_OWNER_COMMANDS.has(commandInfo.command));
  const sources = [
    ...(await readDashboardRentalSources(config)),
    { name: "bot-store.rentals", data: rentals },
  ];
  const match = sources
    .map((source) => ({ source: source.name, rental: rentalFromDirectory(source.data, remoteJid) }))
    .find((entry) => entry.rental);
  const rental = match?.rental || null;

  if (!rental) {
    const hasRentalDirectory = sources.some((source) => rentalDirectoryHasEntries(source.data));
    if (hasRentalDirectory && !allowOwnerRentalCommand) {
      return { block: true, rental: null, reason: "group_rental_missing" };
    }
    return { block: false, rental: null };
  }

  if (!rentalIsExpired(rental)) return { block: false, rental };
  if (allowOwnerRentalCommand) {
    return { block: false, rental };
  }
  return { block: true, rental, reason: "group_rental_expired", source: match?.source || "" };
}

function shouldForwardPrivateText(text = "", commandInfo = {}) {
  if (isDashboardAutoOrderText(text, commandInfo)) return true;
  const source = String(text || "").trim();
  if (!source) return false;
  if (commandInfo.prefix) return true;
  return /^(buy|order|beli|saldo|deposit|stok|stock)\b/i.test(source);
}

function getAuthorizedWebhookHeaders(config) {
  return {
    "Content-Type": "application/json",
    ...(config.inboundWebhookToken ? { Authorization: `Bearer ${config.inboundWebhookToken}` } : {}),
  };
}

function shouldLogInbound(text = "") {
  return /^(1|true|yes|on)$/i.test(String(process.env.WHATSAPP_DEBUG_INBOUND || "").trim());
}

function normalizeNumberFromJid(jid = "") {
  const user = String(jid || "")
    .trim()
    .split("@")[0]
    .split(":")[0];
  return normalizeWhatsAppNumber(user);
}

async function currentOwnerNumbers(config) {
  const values = [...(config.ownerNumbers || []), process.env.OWNER_WHATSAPP_NUMBER, process.env.OWNER_NUMBERS];
  if (config.dashboardDatabasePath) {
    try {
      const db = JSON.parse(await readFile(config.dashboardDatabasePath, "utf8"));
      values.push(db.settings?.ownerWhatsAppNumber);
    } catch {
      // Dashboard database may not exist during first boot.
    }
  }
  return new Set(
    values
      .flatMap((value) => String(value || "").split(/[,\s]+/))
      .map((value) => normalizeWhatsAppNumber(value))
      .filter(Boolean),
  );
}

function extractBackendReply(result = {}) {
  const body = result?.body || {};
  const reply = String(body?.reply || body?.message || "").trim();
  return reply;
}

function extractBackendSnk(result = {}) {
  const body = result?.body || {};
  return String(body?.snkText || body?.snk_text || body?.order?.snkText || "").trim();
}

function getBackendQrText(body = {}) {
  return String(
    body.qrText ||
      body.qr_text ||
      body.qrisText ||
      body.qris_text ||
      body.paymentUrl ||
      body.payment_url ||
      body.order?.qrisUrl ||
      "",
  ).trim();
}

async function getBackendQrImage(body = {}) {
  const imageUrl = String(body.qrImageUrl || body.qr_image_url || "").trim();
  if (imageUrl) return imageUrl;
  const qrText = getBackendQrText(body);
  if (!qrText) return "";
  return QRCode.toDataURL(qrText, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 7,
  });
}

function getPaymentMessageUrl(config, orderId = "") {
  if (!config.inboundWebhookUrl || !orderId) return "";
  try {
    const url = new URL(config.inboundWebhookUrl);
    url.pathname = `/api/whatsapp/orders/${encodeURIComponent(orderId)}/payment-message`;
    url.search = "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function extractMessageKey(sentMessage = {}) {
  return sentMessage?.key || sentMessage?.message_key || sentMessage?.messageKey || null;
}

function numberAliasesFromValues(...values) {
  return Array.from(
    new Set(
      values
        .flat(Infinity)
        .map((value) => normalizeWhatsAppNumber(value))
        .filter(Boolean),
    ),
  );
}

async function savePaymentMessageKey(config, logger, body = {}, remoteJid = "", sentMessage = {}) {
  const orderId = String(body.orderId || body.order_id || body.order?.id || "").trim();
  const messageKey = extractMessageKey(sentMessage);
  const url = getPaymentMessageUrl(config, orderId);
  if (!url || !messageKey) return { saved: false, skipped: true };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getAuthorizedWebhookHeaders(config),
      body: JSON.stringify({
        chatJid: remoteJid,
        messageKey,
      }),
    });
    if (!response.ok) {
      logWarning(`Failed to save WhatsApp payment message key (${response.status})`);
      return { saved: false, status: response.status };
    }
    return { saved: true };
  } catch (error) {
    logWarning("Failed to save WhatsApp payment message key", error);
    return { saved: false, error: error.message || "payment_message_key_save_failed" };
  }
}

export async function forwardInboundMessage(config, logger, payload) {
  if (!config.inboundWebhookUrl) {
    return { ok: false, skipped: true, reason: "missing_inbound_webhook_url" };
  }

  try {
    const response = await fetch(config.inboundWebhookUrl, {
      method: "POST",
      headers: getAuthorizedWebhookHeaders(config),
      body: JSON.stringify(payload),
    });
    const bodyText = await response.text().catch(() => "");
    let body = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch (_error) {
      body = { raw: bodyText.slice(0, 500) };
    }

    if (!response.ok || body?.success === false) {
      logWarning(`Inbound WhatsApp webhook rejected message (${response.status})`);
      return { ok: false, status: response.status, body };
    }

    if (shouldLogInbound(payload.text)) {
      logTracking(`Inbound webhook accepted (${response.status})`);
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    logWarning("Failed to forward inbound WhatsApp message", error);
    return { ok: false, error: error.message || "webhook_fetch_failed" };
  }
}

export async function handleIncomingMessage({
  message,
  config,
  logger,
  plugins,
  store,
  sendMessage,
  sendRawMessage,
  getRawSocket,
  deleteMessage,
  getGroupInfo,
  getGroupParticipantInfo,
  updateGroupSetting,
  updateGroupParticipants,
  updateGroupSubject,
  updateGroupDescription,
  isWhatsAppReady = () => true,
  botJid = "",
}) {
  if (!message?.message) {
    return { handled: false, ignored: true };
  }

  const fromMe = Boolean(message.key?.fromMe);
  const remoteJid = String(message.key?.remoteJid || "").trim();
  const isGroup = isGroupChatJid(remoteJid);
  if (!isDirectChatJid(remoteJid) && !isGroup) {
    return { handled: false, ignored: true };
  }

  const text = extractTextFromMessage(message.message);
  if (!text) {
    return { handled: false, ignored: true };
  }

  const commandInfo = parseCommand(text, config.commands.prefixes);
  if (fromMe && !commandInfo.prefix) {
    return { handled: false, ignored: true, own_message: true };
  }
  if (commandInfo.prefix && !isWhatsAppReady()) {
    if (shouldLogInbound(text)) {
      logTracking(`Command skipped while WhatsApp reconnecting: ${text.slice(0, 120)}`);
    }
    return { handled: false, ignored: true, reason: "whatsapp_not_ready" };
  }

  const participant = String(
    message.key?.participantPn ||
      message.participantPn ||
      message.key?.participant ||
      message.participant ||
      (fromMe && isGroup ? botJid : "") ||
      "",
  ).trim();
  const groupParticipant = null;
  const senderJid = isGroup ? participant : remoteJid;
  const sender = normalizeNumberFromJid(message.key?.participantPn || message.participantPn || senderJid);
  const from = isGroup ? (fromMe ? sender : "") : normalizeNumberFromJid(remoteJid);
  const senderAliases = numberAliasesFromValues(
    sender,
    from,
    senderJid,
    participant,
    message.key?.participantPn,
    message.participantPn,
    groupParticipant?.number,
    groupParticipant?.jid,
    groupParticipant?.participant?.jid,
    groupParticipant?.participant?.phoneNumber,
    groupParticipant?.participant?.pn,
  );
  const pushName = String(message.pushName || message.verifiedBizName || message.notifyName || "").trim();
  const contextInfo = messageContextInfo(message.message);
  const mentionedJids = Array.isArray(contextInfo.mentionedJid) ? contextInfo.mentionedJid.filter(Boolean) : [];
  const quotedMessageKey = contextInfo.stanzaId
    ? {
        remoteJid,
        id: contextInfo.stanzaId,
        participant: contextInfo.participant || undefined,
        fromMe: false,
      }
    : null;
  const owners = await currentOwnerNumbers(config);
  const isOwner = senderAliases.some((number) => owners.has(number));
  const isGroupAdmin = Boolean(isOwner);
  const groupAdminChecked = Boolean(!isGroup);
  if (shouldSkipDuplicateMessage({ message, remoteJid, text, pushName, senderJid, senderAliases })) {
    if (shouldLogInbound(text)) {
      logTracking(`Duplicate message skipped: ${text.slice(0, 120)}`);
    }
    return { handled: false, ignored: true, duplicate: true };
  }

  if (isGroup) {
    const expiredGate = await rentalGate.shouldBlockExpiredGroup({ store, remoteJid, commandInfo, isOwner, config });
    if (expiredGate.block) {
      if (shouldWarnExpiredGroup(remoteJid)) {
        const daysLeft = rentalGate.rentalDaysLeft(expiredGate.rental);
        const reasonLabel = expiredGate.reason === "group_rental_missing" ? "rental tidak aktif/tidak ditemukan" : `${daysLeft} hari tersisa`;
        const sourceLabel = expiredGate.source ? ` dari ${expiredGate.source}` : "";
        logWarning(`Pesan grup tidak aktif diblokir: ${remoteJid} (${reasonLabel}${sourceLabel})`);
      }
      return { handled: false, ignored: true, reason: expiredGate.reason || "group_rental_expired" };
    }
  }

  const payload = {
    from,
    sender,
    sender_aliases: senderAliases,
    senderAliases,
    push_name: pushName,
    pushName,
    sender_jid: senderJid,
    raw_sender_jid: participant,
    chat_jid: remoteJid,
    remote_jid: remoteJid,
    is_group: isGroup,
    is_group_admin: isGroupAdmin,
    group_admin_checked: groupAdminChecked,
    from_me: fromMe,
    mentioned_jids: mentionedJids,
    mentionedJids,
    is_quoted: Boolean(quotedMessageKey),
    quoted_message_key: quotedMessageKey,
    text,
    message_id: message.key?.id || "",
    sent_at: message.messageTimestamp
      ? new Date(Number(message.messageTimestamp) * 1000).toISOString()
      : null,
  };

  if (commandInfo.prefix) {
    const displayName = pushName || "Unknown";
    const displayNumber = sender || from || senderAliases[0] || "unknown";
    const scope = isGroup ? `${displayName}/${displayNumber} @ ${remoteJid}` : `${displayName}/${displayNumber}`;
    logCommand(scope, text);
  }

  const context = {
    ...payload,
    ...commandInfo,
    message,
    rawMessage: message,
    isGroup,
    isOwner,
    isGroupAdmin,
    groupAdminChecked,
    config,
    logger,
    store,
    plugins,
    services: {
      sendMessage,
      sendRawMessage,
      getRawSocket,
      saveIncomingMedia: (options = {}) =>
        saveIncomingMedia({
          rawMessage: message,
          getRawSocket,
          projectRoot: config.projectRoot || process.cwd(),
          ...options,
        }),
      deleteMessage,
      getGroupInfo,
      getGroupParticipantInfo,
      updateGroupSetting,
      updateGroupParticipants,
      updateGroupSubject,
      updateGroupDescription,
      plugins,
    },
    reply: (replyText, options = {}) =>
      sendMessage(remoteJid, replyText, options.imageUrl || "", options.mediaPath || "", "", "", {
        commandReply: true,
        ...options,
      }),
  };

  let pluginResult;
  try {
    pluginResult = await plugins.dispatch(context);
  } catch (error) {
    logWarning(`Plugin dispatch gagal untuk ${commandInfo.command || text || "unknown_message"}`, error);
    if (isWhatsAppTransportError(error)) {
      return { handled: true, plugin_error: true, transport_error: true };
    }
    if (commandInfo.prefix || isGroup) {
      await context.reply("Terjadi kesalahan saat memproses pesan. Coba kirim ulang sekali lagi.");
      return { handled: true, plugin_error: true };
    }
    return { handled: false, plugin_error: true };
  }
  if (pluginResult.handled) {
    return pluginResult;
  }

  if (isGroup) {
    if (shouldLogInbound(text)) {
      logTracking(`Group message ignored: ${text.slice(0, 120)}`);
    }
    return { handled: false, ignored: true, reason: "private_chat_only" };
  }

  if (!shouldForwardPrivateText(text, commandInfo)) {
    return { handled: false, ignored: true, reason: "private_text_not_command" };
  }

  if (shouldLogInbound(text)) {
    logTracking(`Forwarding inbound message: ${text.slice(0, 120)}`);
  }

  const forwardResult = await forwardInboundMessage(config, logger, payload);
  const backendReply = extractBackendReply(forwardResult);
  if (forwardResult?.ok && backendReply) {
    const qrImage = await getBackendQrImage(forwardResult.body);
    const sentMessage = await sendMessage(remoteJid, backendReply, qrImage);
    if (qrImage) {
      await savePaymentMessageKey(config, logger, forwardResult.body, remoteJid, sentMessage);
    }
    const snkText = extractBackendSnk(forwardResult);
    if (snkText) {
      await sendMessage(remoteJid, snkText);
    }
    return {
      handled: true,
      forwarded: true,
      replied: true,
      forward_result: forwardResult,
    };
  }
  if (isDashboardAutoOrderText(text, commandInfo)) {
    const fallbackText = forwardResult?.ok
      ? "Auto order diterima dashboard, tapi belum ada balasan yang bisa dikirim."
      : "Auto order belum tersambung ke dashboard. Cek Webhook URL dan Inbound Webhook Token di Settings WhatsApp Bailey.";
    await sendMessage(remoteJid, fallbackText);
    return {
      handled: true,
      forwarded: Boolean(forwardResult?.ok),
      replied: true,
      forward_result: forwardResult,
    };
  }
  return { handled: false, forwarded: Boolean(forwardResult?.ok), forward_result: forwardResult };
}
