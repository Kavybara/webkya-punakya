import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logWarning } from "../lib/panel-log.js";

const INDEX_TTL_MS = 30_000;
const API_PLUGIN_PATTERN = /api-autoresbot/i;
const SKIP_LEGACY_PLUGIN_DIRS = new Set(["HANDLERS"]);
const OWNER_SCOPED_LEGACY_DIRS = new Set(["OWNER", "PANEL", "PUSHKONTAK"]);

let legacyIndexCache = { loadedAt: 0, rootsKey: "", commands: new Map() };

function cleanText(value = "") {
  return String(value || "").trim();
}

function normalizeCommand(value = "") {
  return cleanText(value).toLowerCase();
}

function legacyFileIsOwnerScoped(file = "") {
  return String(file || "")
    .split(/[\\/]+/)
    .some((segment) => OWNER_SCOPED_LEGACY_DIRS.has(segment.toUpperCase()));
}

function hasAutoresbotApiKey() {
  return Boolean(cleanText(process.env.AUTORESBOT_APIKEY || process.env.APIKEY || process.env.API_KEY));
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

function numberFromJid(value = "") {
  return cleanText(value).split("@")[0].split(":")[0].replace(/[^\d]/g, "");
}

function parseCommandsFromSource(source = "") {
  const constants = {};
  for (const item of String(source || "").matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    constants[item[1]] = normalizeCommand(item[2]);
  }

  const commands = [];
  for (const match of String(source || "").matchAll(/\bCommands\s*(?::|=)\s*\[([\s\S]*?)\]/gm)) {
    const body = match[1]
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    commands.push(
      ...Array.from(body.matchAll(/["'`]([^"'`]+)["'`]/g))
        .map((item) => normalizeCommand(item[1]))
        .filter(Boolean),
    );
    commands.push(
      ...Array.from(body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g))
        .map((item) => constants[item[1]])
        .filter(Boolean),
    );
  }
  return Array.from(new Set(commands));
}

async function listPluginFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_LEGACY_PLUGIN_DIRS.has(entry.name.toUpperCase())) continue;
      files.push(...(await listPluginFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function legacyPluginsRoots(context) {
  const projectRoot = context.config?.projectRoot || process.cwd();
  const candidates = [
    path.join(projectRoot, "plugins/kavya"),
    path.join(projectRoot, "plugins"),
  ];
  const roots = [];
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory()) roots.push(candidate);
  }
  return roots;
}

async function loadLegacyIndex(context) {
  const roots = await legacyPluginsRoots(context);
  const rootsKey = roots.join("|");
  const now = Date.now();
  if (legacyIndexCache.rootsKey === rootsKey && now - legacyIndexCache.loadedAt < INDEX_TTL_MS) {
    return legacyIndexCache.commands;
  }

  const commands = new Map();
  const files = [];
  for (const root of roots) {
    files.push(...(await listPluginFiles(root)));
  }
  const apiKeyActive = hasAutoresbotApiKey();

  for (const file of files) {
    const source = await readFile(file, "utf8").catch(() => "");
    if (!source) continue;
    if (!apiKeyActive && API_PLUGIN_PATTERN.test(source)) continue;

    for (const command of parseCommandsFromSource(source)) {
      if (!commands.has(command)) commands.set(command, []);
      commands.get(command).push(file);
    }
  }

  legacyIndexCache = { loadedAt: now, rootsKey, commands };
  return commands;
}

async function importLegacyPlugin(file) {
  const info = await stat(file).catch(() => null);
  const href = `${pathToFileURL(file).href}?v=${info?.mtimeMs || Date.now()}`;
  const mod = await import(href);
  const plugin = mod.default || mod.plugin || mod;
  if (!plugin || typeof plugin.handle !== "function") {
    throw new Error("legacy_plugin_invalid");
  }
  return plugin;
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

function groupMetadataFromInfo(info = {}, fallbackJid = "") {
  const participants = (info.participants || []).map((participant) => {
    const jid = normalizeJid(participant.jid || participant.id || participant.phoneNumber || participant.pn || participant.number);
    return {
      id: jid,
      jid,
      phoneNumber: jid,
      admin: participant.is_super_admin ? "superadmin" : participant.is_admin ? "admin" : undefined,
    };
  });
  return {
    id: info.group_jid || fallbackJid,
    subject: info.group_name || info.groupName || "",
    desc: info.description || "",
    size: Number(info.participant_count || participants.length || 0),
    owner: info.owner_jid || "",
    participants,
  };
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
      const info = await context.services?.getGroupInfo?.(jid);
      return groupMetadataFromInfo(info, jid);
    },
    async groupFetchAllParticipating() {
      if (typeof rawSocket.groupFetchAllParticipating === "function") return rawSocket.groupFetchAllParticipating();
      return {};
    },
    async groupSettingUpdate(jid, setting) {
      if (typeof rawSocket.groupSettingUpdate === "function") return rawSocket.groupSettingUpdate(jid, setting);
      return context.services?.updateGroupSetting?.(jid, setting);
    },
    async groupParticipantsUpdate(jid, participants, action) {
      if (typeof rawSocket.groupParticipantsUpdate === "function") return rawSocket.groupParticipantsUpdate(jid, participants, action);
      return context.services?.updateGroupParticipants?.(jid, participants, action);
    },
    async groupUpdateSubject(jid, subject) {
      if (typeof rawSocket.groupUpdateSubject === "function") return rawSocket.groupUpdateSubject(jid, subject);
      return context.services?.updateGroupSubject?.(jid, subject);
    },
    async groupUpdateDescription(jid, description) {
      if (typeof rawSocket.groupUpdateDescription === "function") return rawSocket.groupUpdateDescription(jid, description);
      return context.services?.updateGroupDescription?.(jid, description);
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

function createLegacyMessageInfo(context, legacySock) {
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
    content: context.args || "",
    message: rawMessage,
    prefix: context.prefix || "",
    command: context.command || "",
    fullText: context.text || "",
    isQuoted: Boolean(quotedKey),
    quotedMessage: quotedKey
      ? {
          text: "",
          sender: quotedKey.participant || "",
          id: quotedKey.id || "",
        }
      : null,
    mentionedJid: Array.isArray(context.mentioned_jids) && context.mentioned_jids.length ? context.mentioned_jids : false,
    senderType: numberFromJid(senderJid) ? "number" : "unknown",
    isOwner: Boolean(context.isOwner),
    isGroupAdmin: Boolean(context.isGroupAdmin),
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

async function isAdminAllowed(context) {
  if (context.isOwner || context.isGroupAdmin) return true;
  if (!context.isGroup || typeof context.services?.getGroupParticipantInfo !== "function") return false;
  const info = await context.services
    .getGroupParticipantInfo(context.chat_jid, context.sender_jid || context.raw_sender_jid || context.sender)
    .catch(() => null);
  return Boolean(info?.is_admin || info?.is_super_admin);
}

async function guardLegacyPlugin(plugin, context, { ownerScoped = false } = {}) {
  if ((ownerScoped || plugin.OnlyOwner) && !context.isOwner) {
    await context.reply("⚠️ _Perintah ini Hanya Untuk Owner_");
    return false;
  }
  if (plugin.OnlyGroup && !context.isGroup) {
    await context.reply("⚠️ _Perintah ini hanya bisa digunakan di grup_");
    return false;
  }
  if (plugin.OnlyPrivate && context.isGroup) {
    await context.reply("⚠️ _Perintah ini hanya bisa digunakan di private chat_");
    return false;
  }
  if ((plugin.OnlyAdmin || plugin.OnlyAdmins) && !(await isAdminAllowed(context))) {
    await context.reply("⚠️ _Perintah ini Hanya Untuk Admin_");
    return false;
  }
  if (plugin.OnlyPremium && !context.isOwner) {
    await context.reply("⚠️ _Perintah ini khusus pengguna premium_");
    return false;
  }
  return true;
}

export default {
  name: "legacy-autoresbot",
  description: "Adapter command plugin Autoresbot lama.",
  commands: [],
  priority: 50,
  async shouldHandle(context) {
    if (!context.prefix || !context.command) return false;
    const commands = await loadLegacyIndex(context);
    return commands.has(normalizeCommand(context.command));
  },
  async execute(context) {
    const commands = await loadLegacyIndex(context);
    const files = commands.get(normalizeCommand(context.command)) || [];
    if (!files.length) return { handled: false, plugin: "legacy-autoresbot" };

    const legacySock = createLegacySock(context);
    const messageInfo = createLegacyMessageInfo(context, legacySock);
    let lastError = null;

    for (const file of files) {
      try {
        const plugin = await importLegacyPlugin(file);
        const pluginCommands = Array.isArray(plugin.Commands) ? plugin.Commands.map(normalizeCommand) : [];
        if (pluginCommands.length && !pluginCommands.includes(normalizeCommand(context.command))) continue;
        if (!(await guardLegacyPlugin(plugin, context, { ownerScoped: legacyFileIsOwnerScoped(file) }))) {
          return { handled: true, plugin: "legacy-autoresbot", legacy_file: file };
        }
        await plugin.handle(legacySock, messageInfo);
        return { handled: true, plugin: "legacy-autoresbot", legacy_file: file };
      } catch (error) {
        lastError = error;
        logWarning(`Legacy plugin gagal (${context.command}: ${path.basename(file)})`, error);
      }
    }

    await context.reply(`⚠️ Plugin lama .${context.command} belum bisa dijalankan: ${lastError?.message || "unknown_error"}`);
    return { handled: true, plugin: "legacy-autoresbot", failed: true };
  },
};
