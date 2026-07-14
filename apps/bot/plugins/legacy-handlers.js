import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logWarning } from "../lib/panel-log.js";

const INDEX_TTL_MS = 30_000;
let handlersCache = { loadedAt: 0, root: "", handlers: [] };
const DISABLED_LEGACY_HANDLERS = new Set([
  // Kavya has a native list handler backed by apps/bot/database/lists.json.
  // The legacy handler reads database/list.json and can serve stale replies after .updatelist.
  "list.js",
]);

function activeHandlerGroups() {
  const groups = String(process.env.LEGACY_HANDLER_GROUPS || "GAMES")
    .split(/[,\n;]+/)
    .map((item) => cleanText(item).toUpperCase())
    .filter(Boolean);
  return groups.length ? groups : ["GAMES"];
}

async function listHandlerFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listHandlerFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function handlersRoot(context) {
  return path.join(context.config?.projectRoot || process.cwd(), "plugins/kavya", "HANDLERS");
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function normalizeJid(value = "") {
  const raw = cleanText(value);
  if (!raw) return "";
  if (raw.endsWith("@s.whatsapp.net") || raw.endsWith("@g.us") || raw.endsWith("@lid")) return raw;
  const digits = raw.split("@")[0].split(":")[0].replace(/[^\d]/g, "");
  if (!digits) return raw;
  const number = digits.startsWith("0") ? `62${digits.slice(1)}` : digits.startsWith("8") ? `62${digits}` : digits;
  return `${number}@s.whatsapp.net`;
}

function legacyTypeFromMessage(rawMessage = {}) {
  const body =
    rawMessage?.message?.ephemeralMessage?.message ||
    rawMessage?.message?.viewOnceMessage?.message ||
    rawMessage?.message?.viewOnceMessageV2?.message ||
    rawMessage?.message ||
    {};
  const key = Object.keys(body)[0] || "";
  const map = {
    conversation: "text",
    extendedTextMessage: "text",
    imageMessage: "image",
    videoMessage: "video",
    stickerMessage: "sticker",
    audioMessage: "audio",
    documentMessage: "document",
    contactMessage: "contact",
    locationMessage: "location",
    reactionMessage: "reaction",
    templateButtonReplyMessage: "button_reply",
    viewOnceMessageV2: "viewonce",
    pollCreationMessage: "poll",
  };
  return map[key] || "unknown";
}

function createLegacySock(context) {
  const rawSocket = context.services?.getRawSocket?.() || {};
  const fallback = {
    async sendMessage(jid, payload = {}, options = {}) {
      if (typeof context.services?.sendRawMessage === "function") {
        return context.services.sendRawMessage(jid, payload, options);
      }
      return rawSocket.sendMessage(jid, payload, options);
    },
    async groupMetadata(jid) {
      if (typeof rawSocket.groupMetadata === "function") return rawSocket.groupMetadata(jid);
      return context.services?.getGroupInfo?.(jid);
    },
    async groupParticipantsUpdate(jid, participants, action) {
      if (typeof rawSocket.groupParticipantsUpdate === "function") return rawSocket.groupParticipantsUpdate(jid, participants, action);
      return context.services?.updateGroupParticipants?.(jid, participants, action);
    },
  };

  return new Proxy(rawSocket, {
    get(target, property) {
      if (property in fallback) return fallback[property];
      const value = target?.[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function legacyMessageInfo(context, legacySock) {
  const rawMessage = context.rawMessage || context.message || {};
  const remoteJid = context.chat_jid || context.remote_jid || rawMessage?.key?.remoteJid || "";
  const senderJid = normalizeJid(
    context.sender_jid ||
      context.raw_sender_jid ||
      rawMessage?.key?.participant ||
      rawMessage?.participant ||
      context.sender ||
      context.from ||
      "",
  );
  const quotedKey = context.quoted_message_key || null;

  return {
    id: rawMessage?.key?.id || context.message_id || "",
    timestamp: rawMessage?.messageTimestamp || "",
    sender: senderJid,
    pushName: context.pushName || context.push_name || "",
    isGroup: Boolean(context.isGroup),
    fromMe: Boolean(context.from_me),
    remoteJid,
    type: legacyTypeFromMessage(rawMessage),
    content: context.args || (!context.prefix ? context.text || "" : ""),
    message: rawMessage,
    isTagSw: Boolean(context.isTagSw),
    prefix: context.prefix || "",
    command: context.command || "",
    fullText: context.text || "",
    isQuoted: Boolean(quotedKey),
    quotedMessage: quotedKey ? { text: "", sender: quotedKey.participant || "", id: quotedKey.id || "" } : null,
    mentionedJid: Array.isArray(context.mentioned_jids) && context.mentioned_jids.length ? context.mentioned_jids : false,
    isBot: false,
    isTagMeta: false,
    isForwarded: false,
    senderType: senderJid.endsWith("@lid") ? "lid" : "number",
    config: context.config,
    store: context.store,
    services: context.services,
    m: {
      remoteJid,
      key: rawMessage?.key || {},
      message: rawMessage,
      sock: legacySock,
      isDeleted: false,
      isEdited: {},
      m: rawMessage,
    },
  };
}

async function loadHandlers(context) {
  const root = handlersRoot(context);
  const now = Date.now();
  const groups = activeHandlerGroups();
  const cacheKey = `${root}|${groups.join(",")}`;
  if (handlersCache.root === cacheKey && now - handlersCache.loadedAt < INDEX_TTL_MS) {
    return handlersCache.handlers;
  }

  const files = [];
  for (const group of groups) {
    const groupDir = path.join(root, group);
    const groupInfo = await stat(groupDir).catch(() => null);
    if (!groupInfo?.isDirectory()) continue;
    files.push(...(await listHandlerFiles(groupDir)));
  }
  const handlers = [];
  for (const file of files) {
    if (DISABLED_LEGACY_HANDLERS.has(path.basename(file).toLowerCase())) {
      continue;
    }
    try {
      const info = await stat(file).catch(() => null);
      const mod = await import(`${pathToFileURL(file).href}?v=${info?.mtimeMs || now}`);
      const handler = mod.default || mod;
      if (typeof handler.process !== "function") continue;
      handlers.push({
        name: handler.name || mod.name || path.basename(file),
        priority: Number(handler.priority ?? mod.priority ?? 100),
        process: handler.process,
        file,
      });
    } catch (error) {
      logWarning(`Legacy handler gagal dimuat (${path.basename(file)})`, error);
    }
  }

  handlers.sort((a, b) => a.priority - b.priority);
  handlersCache = { loadedAt: now, root: cacheKey, handlers };
  return handlers;
}

export default {
  name: "legacy-handlers",
  description: "Pre-process handler game Autoresbot lama.",
  commands: [],
  priority: 1,
  async shouldHandle(context) {
    if (!context.text) return false;
    if (context.prefix) return false;
    const handlers = await loadHandlers(context);
    return handlers.length > 0;
  },
  async execute(context) {
    const handlers = await loadHandlers(context);
    const legacySock = createLegacySock(context);
    const messageInfo = legacyMessageInfo(context, legacySock);

    for (const handler of handlers) {
      try {
        const result = await handler.process(legacySock, messageInfo);
        if (result === false) {
          return { handled: true, plugin: "legacy-handlers", handler: handler.name };
        }
      } catch (error) {
        logWarning(`Legacy handler error (${handler.name})`, error);
      }
    }

    return { handled: false, continue: true, plugin: "legacy-handlers" };
  },
};
