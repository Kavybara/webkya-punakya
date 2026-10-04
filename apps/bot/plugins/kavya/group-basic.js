import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { applyTemplate } from "../../../../database/templates/list.js";
import { isValidListTemplate, WHATSAPP_STRINGS } from "../../../../packages/shared/whatsapp/templates.mjs";
import { formatRentalEndDate, rentalInviteLink } from "../../../../packages/shared/rental-expiry.mjs";
import { logWarning } from "../../lib/panel-log.js";

const COMMANDS = [
  "bot",
  "owner",
  "menu",
  "allmenu",
  "list",
  "addlist",
  "updatelist",
  "renamelist",
  "dellist",
  "deletelist",
  "delete",
  "resetlist",
  "reset",
  "setlist",
  "grub",
  "group",
  "grup",
  "groub",
  "gc",
  "hidetag",
  "hidetak",
  "h",
  "tagall",
  "listadmin",
  "kick",
  "promote",
  "demote",
  "editsubjek",
  "editsubject",
  "editsubjeck",
  "editjudul",
  "editdesk",
  "editdeskripsi",
  "ceksewa",
  "listsewa",
  "sewabot",
  "tambahsewa",
  "delsewa",
  "backup",
];

const GROUP_SETTING_COMMANDS = new Set(["grub", "group", "grup", "groub", "gc"]);
const HIDETAG_COMMANDS = new Set(["hidetag", "hidetak", "h"]);
const GROUP_SUBJECT_COMMANDS = new Set(["editsubjek", "editsubject", "editsubjeck", "editjudul"]);
const GROUP_DESCRIPTION_COMMANDS = new Set(["editdesk", "editdeskripsi"]);
const LEGACY_RENTAL_LINK_COMMANDS = new Set(["sewabot", "tambahsewa"]);
let legacyMenuCache = { loadedAt: 0, data: {} };
const LEGACY_MENU_CATEGORY_ORDER = [
  "admin",
  "auto order",
  "ai",
  "anime",
  "berita",
  "download",
  "editor",
  "games",
  "group",
  "information",
  "islami",
  "kerang ajaib",
  "maker",
  "more",
  "owner",
  "panel",
  "pushkontak",
  "random",
  "store",
  "textpro",
  "tools",
];
const DASHBOARD_STORE_COMMANDS = new Set([
  "addbalance",
  "addbal",
  "addsaldo",
  "adddeposit",
  "tambahsaldo",
  "balance",
  "saldo",
  "ceksaldo",
  "cekbalance",
  "cekbal",
  "deposit",
  "stock",
  "stok",
  "buynow",
]);
const OWNER_ONLY_DASHBOARD_STORE_COMMANDS = new Set([
  "addbalance",
  "addbal",
  "addsaldo",
  "adddeposit",
  "tambahsaldo",
]);
const DASHBOARD_MENU_CATEGORIES = {
  "auto order": ["buynow", "stock", "balance"],
};
const API_PLUGIN_PATTERN = /api-autoresbot/i;
function cleanText(value = "") {
  return String(value || "").trim();
}

function hasAutoresbotApiKey() {
  return Boolean(cleanText(process.env.AUTORESBOT_APIKEY || process.env.APIKEY || process.env.API_KEY));
}

function isGroupJid(value = "") {
  return /@g\.us$/i.test(String(value || "").trim());
}

function usableDisplayName(value = "") {
  const text = cleanText(value);
  if (!text || isGroupJid(text) || /^pending-/i.test(text) || /^menunggu join/i.test(text)) {
    return "";
  }
  return text;
}

function senderDisplayName(context) {
  const name = usableDisplayName(context.pushName || context.push_name || context.name || "");
  if (name && !/^unknown$/i.test(name)) {
    return `@${name.replace(/^@+/, "")}`;
  }
  const number = normalizeWhatsAppNumber(
    context.sender ||
      context.from ||
      context.sender_jid ||
      context.raw_sender_jid ||
      context.senderAliases?.[0] ||
      context.sender_aliases?.[0] ||
      "",
  );
  return number ? `@${number}` : "@kak";
}

function groupDisplayNameForContext(context, groupSettings = {}, rental = {}) {
  return (
    usableDisplayName(groupSettings.name) ||
    usableDisplayName(groupSettings.groupName) ||
    usableDisplayName(groupSettings.subject) ||
    usableDisplayName(rental.name) ||
    usableDisplayName(rental.groupName) ||
    usableDisplayName(rental.subject) ||
    "grup ini"
  );
}

function normalizeWhatsAppNumber(value = "") {
  const digits = String(value || "").split("@")[0].split(":")[0].replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function userJidFromValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.endsWith("@s.whatsapp.net") || raw.endsWith("@lid")) return raw;
  const number = normalizeWhatsAppNumber(raw);
  return number ? `${number}@s.whatsapp.net` : "";
}

function participantJid(participant = {}) {
  return (
    String(participant.jid || participant.id || participant.phoneNumber || participant.pn || "").trim() ||
    userJidFromValue(participant.number)
  );
}

async function groupInfoForAdminCommand(context) {
  if (typeof context.services?.getGroupInfo !== "function") {
    throw new Error("group_info_not_available");
  }
  return context.services.getGroupInfo(context.chat_jid);
}

function participantMentions(groupInfo = {}) {
  return (groupInfo.participants || []).map(participantJid).filter(Boolean);
}

function targetJidsFromContext(context) {
  const targets = [];
  if (Array.isArray(context.mentioned_jids)) targets.push(...context.mentioned_jids);
  if (Array.isArray(context.mentionedJids)) targets.push(...context.mentionedJids);
  if (context.quoted_message_key?.participant) targets.push(context.quoted_message_key.participant);
  const argMatches = String(context.args || "").match(/(?:\d[\d\s()+-]{6,}\d)/g) || [];
  targets.push(...argMatches.map(userJidFromValue));
  return Array.from(new Set(targets.map((item) => String(item || "").trim()).filter(Boolean)));
}

function formatDays(value) {
  const days = Number(value || 0);
  return `${Number.isFinite(days) ? Math.max(0, days) : 0} hari`;
}

function rentalExpirationMs(rental = {}) {
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
  const expiresAt = rentalExpirationMs(rental);
  if (expiresAt > 0) {
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));
  }
  const direct = Number(rental.daysLeft ?? rental.remaining_days ?? 0);
  return Number.isFinite(direct) ? Math.max(0, Math.ceil(direct)) : 0;
}

function rentalExpiredFromDays(days) {
  return Date.now() + Math.max(0, Number(days || 0)) * 86400000;
}

function rentalStartText() {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function normalizeKeyword(value = "") {
  return cleanText(value).toLowerCase();
}

function shouldUseLegacyRentalLinkCommand(context) {
  return LEGACY_RENTAL_LINK_COMMANDS.has(context.command) && /chat\.whatsapp\.com|@g\.us/i.test(String(context.args || ""));
}

function getWibDate() {
  const date = new Date();
  const day = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", month: "long" }).format(date);
  const year = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", year: "numeric" }).format(date);
  return `${day} ${month} ${year}`;
}

function getWibTime() {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date()).replaceAll(".", ":");
}

function getWibDay() {
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long" }).format(new Date());
}

function getGreeting() {
  const hour = Number(new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "numeric",
    hour12: false,
  }).format(new Date()));
  if (hour >= 5 && hour <= 10) return "Pagi";
  if (hour >= 11 && hour < 15) return "Siang";
  if (hour >= 15 && hour <= 18) return "Sore";
  if (hour > 18 && hour <= 19) return "Petang";
  return "Malam";
}

function legacyStyle(text = "") {
  const source = String(text || "");
  const from = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const to = "ᴀ ʙ ᴄ ᴅ ᴇ ꜰ ɢ ʜ ɪ ᴊ ᴋ ʟ ᴍ ɴ ᴏ ᴘ Q ʀ ꜱ ᴛ ᴜ ᴠ ᴡ x ʏ ᴢ 0 1 2 3 4 5 6 7 8 9 ᴀ ʙ ᴄ ᴅ ᴇ ꜰ ɢ ʜ ɪ ᴊ ᴋ ʟ ᴍ ɴ ᴏ ᴘ Q ʀ ꜱ ᴛ ᴜ ᴠ ᴡ x ʏ ᴢ".split(" ");
  const map = {};
  [...from].forEach((char, index) => {
    map[char] = to[index] || char;
  });
  return [...source.trim()].map((char) => map[char] || char).join("");
}

function parseCommandsFromSource(source = "") {
  const match = String(source || "").match(/\bCommands\s*(?::|=)\s*\[([\s\S]*?)\]/m);
  if (!match) return [];

  const constants = {};
  for (const item of String(source || "").matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    constants[item[1]] = cleanText(item[2]).toLowerCase();
  }

  const body = match[1]
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const literalCommands = Array.from(body.matchAll(/["'`]([^"'`]+)["'`]/g))
    .map((item) => cleanText(item[1]).toLowerCase())
    .filter(Boolean);
  const identifierCommands = Array.from(body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g))
    .map((item) => constants[item[1]])
    .filter(Boolean);
  return [...literalCommands, ...identifierCommands];
}

function orderedLegacyMenu(menu = {}) {
  const combined = { ...menu, ...DASHBOARD_MENU_CATEGORIES };
  const ordered = {};
  for (const category of LEGACY_MENU_CATEGORY_ORDER) {
    if (combined[category]?.length) ordered[category] = combined[category];
  }
  for (const category of Object.keys(combined).sort((a, b) => a.localeCompare(b))) {
    if (!ordered[category] && combined[category]?.length) ordered[category] = combined[category];
  }
  return ordered;
}

async function legacyMenu(context) {
  const now = Date.now();
  if (now - legacyMenuCache.loadedAt < 30_000 && Object.keys(legacyMenuCache.data).length) {
    return legacyMenuCache.data;
  }

  const projectRoot = context.config.projectRoot || process.cwd();
  const pluginsDir = existsSync(path.join(projectRoot, "plugins/kavya"))
    ? path.join(projectRoot, "plugins/kavya")
    : path.join(projectRoot, "plugins");
  const menu = {};
  const categories = await readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
  for (const categoryEntry of categories) {
    if (!categoryEntry.isDirectory()) continue;
    const category = categoryEntry.name.toLowerCase();
    const categoryDir = path.join(pluginsDir, categoryEntry.name);
    const files = await readdir(categoryDir, { withFileTypes: true }).catch(() => []);
    const commands = [];
    for (const fileEntry of files) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".js")) continue;
      const source = await readFile(path.join(categoryDir, fileEntry.name), "utf8").catch(() => "");
      if (!hasAutoresbotApiKey() && API_PLUGIN_PATTERN.test(source)) continue;
      commands.push(...parseCommandsFromSource(source));
    }
    if (commands.length) menu[category] = Array.from(new Set(commands));
  }

  const orderedMenu = orderedLegacyMenu(menu);
  legacyMenuCache = { loadedAt: now, data: orderedMenu };
  return orderedMenu;
}

function formatLegacyCategory(title, commands = []) {
  const formattedItems = commands.map((command) => `┣⌬ ${command}`);
  return `┏━『 *${title.toUpperCase()}* 』\n┃\n${formattedItems.join("\n")}\n┗━━━━━━━◧`;
}

function formatLegacyMainMenu(menu = {}) {
  const categories = Object.keys(menu);
  return `┏━『 *MENU UTAMA* 』\n┃\n${categories.map((category) => `┣⌬ ${category}`).join("\n")}\n┗━━━━━━━◧\n            \n_Ketik nama kategori untuk melihat isinya._\n_Contoh: *.menu ai* atau *.allmenu* untuk menampilkan semua menu_`;
}

function formatLegacyAllMenu(menu = {}, context = {}) {
  const categories = Object.keys(menu);
  return `╭─────────────\n│ ᴺᵃᵐᵉ  : *${context.pushName || "Unknown"}*\n│ ˢᵗᵃᵗᵘˢ : *${context.isOwner ? "Owner" : "user"}*\n│ ᴰᵃᵗᵉ   : *${getWibDate()}*\n├────\n╰──────────────\n\n${categories.map((category) => formatLegacyCategory(category, menu[category])).join("\n\n")}`;
}

function splitPipe(value = "") {
  const parts = String(value || "").split("|");
  const left = cleanText(parts.shift() || "");
  const right = cleanText(parts.join("|"));
  return [left, right];
}

function listMediaBaseName(chatJid = "", keyword = "") {
  const groupPart = String(chatJid || "")
    .split("@")[0]
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const keywordPart = String(keyword || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return [groupPart || "group", keywordPart || "list"].join("-");
}

async function saveListMedia(context, keyword = "") {
  if (typeof context.services?.saveIncomingMedia !== "function") {
    return { saved: false, reason: "media_service_unavailable" };
  }
  return context.services.saveIncomingMedia({
    preferredBaseName: listMediaBaseName(context.chat_jid, keyword),
    source: "auto",
  });
}

function ownerOnly(context) {
  if (context.isOwner) return false;
  logWarning(`Command owner ditolak: ${context.command || "unknown"} dari ${context.pushName || context.sender || "unknown"}`);
  context.reply(WHATSAPP_STRINGS.ownerOnly);
  return true;
}

async function groupAdminOnly(context) {
  const getParticipantInfo = context.services?.getGroupParticipantInfo;
  if (!context.isGroup || typeof getParticipantInfo !== "function") {
    logWarning(`Admin grup belum bisa diverifikasi untuk ${context.command}; command list diblokir.`);
    context.reply("Status admin grup belum bisa diverifikasi. Coba lagi setelah bot selesai sinkron grup.");
    return true;
  }

  const participantJid = context.sender_jid || context.raw_sender_jid || context.sender;
  const info = await getParticipantInfo(context.chat_jid, participantJid).catch(() => null);
  context.groupAdminChecked = Boolean(info?.checked);
  context.isGroupAdmin = Boolean(info?.checked && (info?.is_admin || info?.is_super_admin));

  if (context.isGroupAdmin) return false;
  if (!context.groupAdminChecked) {
    logWarning(`Admin grup belum bisa diverifikasi untuk ${context.command}; command list diblokir.`);
    context.reply("Status admin grup belum bisa diverifikasi. Coba lagi setelah bot selesai sinkron grup.");
    return true;
  }
  logWarning(`Command admin grup ditolak: ${context.command || "unknown"} dari ${context.pushName || context.sender || "unknown"}`);
  context.reply("Perintah ini hanya dapat digunakan oleh admin atau owner grup.");
  return true;
}

function groupOnly(context) {
  if (context.isGroup) return false;
  context.reply(WHATSAPP_STRINGS.groupOnly);
  return true;
}

async function saveListEntry(context, command) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  const [keyword, text] = splitPipe(context.args);
  const entries = normalizeEntries(await context.store.getGroupList(context.chat_jid), context.config);
  const existingEntry = findEntry(entries, keyword);
  const mediaResult = await saveListMedia(context, keyword);
  const savedText = cleanText(text) || entryText(existingEntry?.entry);
  if (!keyword || (!savedText && !mediaResult.saved)) {
    await context.reply(WHATSAPP_STRINGS.addListFormat.replace("{command}", command));
    return { handled: true, plugin: "group-basic" };
  }
  const nextEntry = {
    text: savedText,
    media: mediaResult.saved ? mediaResult.fileName : cleanText(existingEntry?.entry?.media || existingEntry?.entry?.content?.media),
    media_path: mediaResult.saved ? mediaResult.filePath : cleanText(existingEntry?.entry?.media_path || existingEntry?.entry?.mediaPath),
  };
  await context.store.setGroupListEntry(context.chat_jid, keyword, nextEntry);
  const refreshedEntries = normalizeEntries(await context.store.getGroupList(context.chat_jid), context.config);
  const savedEntry = findEntry(refreshedEntries, keyword);
  const textMismatch = savedEntry && entryText(savedEntry.entry) !== savedText;
  const mediaMismatch =
    mediaResult.saved &&
    savedEntry &&
    mediaPathForEntry(savedEntry.entry, context.config) !== nextEntry.media_path;
  if (textMismatch || mediaMismatch) {
    logWarning(`List ${keyword} belum sinkron setelah update; menulis ulang entry.`);
    await context.store.setGroupListEntry(context.chat_jid, keyword, nextEntry);
  }
  const reply =
    command === "updatelist"
      ? `${keyword} berhasil di perbarui${mediaResult.saved ? " beserta gambar" : ""}\n\nKetik list untuk melihat daftar list.`
      : WHATSAPP_STRINGS.listSaved.replace("{keyword}", keyword);
  await context.store.appendListUpdateAudit?.({
    command,
    groupJid: context.chat_jid,
    keyword,
    sender: context.sender || context.raw_sender_jid || "",
    senderName: context.pushName || context.push_name || "",
    text: savedText,
    media: nextEntry.media || nextEntry.media_path || "",
  });
  await context.reply(mediaResult.saved ? `${reply}\n\n_Gambar list juga sudah tersimpan._` : reply);
  return { handled: true, plugin: "group-basic", keyword };
}

async function renameListEntry(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  const [from, to] = splitPipe(context.args);
  if (!from || !to) {
    await context.reply(WHATSAPP_STRINGS.renameListFormat);
    return { handled: true, plugin: "group-basic" };
  }
  try {
    await context.store.renameGroupListEntry(context.chat_jid, from, to);
    await context.reply(WHATSAPP_STRINGS.listRenamed.replace("{from}", from).replace("{to}", to));
  } catch {
    await context.reply(`List "${from}" tidak ditemukan.`);
  }
  return { handled: true, plugin: "group-basic" };
}

async function deleteListEntry(context, keywordArg = "") {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  const keyword = cleanText(keywordArg || context.args);
  if (!keyword) {
    await context.reply(WHATSAPP_STRINGS.deleteListFormat);
    return { handled: true, plugin: "group-basic" };
  }
  await context.store.deleteGroupListEntry(context.chat_jid, keyword);
  await context.reply(WHATSAPP_STRINGS.listDeleted.replace("{keyword}", keyword));
  return { handled: true, plugin: "group-basic" };
}

async function resetList(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  await context.store.resetGroupList(context.chat_jid);
  await context.reply(WHATSAPP_STRINGS.listReset);
  return { handled: true, plugin: "group-basic" };
}

async function setListTemplate(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  const template = cleanText(context.args);
  if (!template) {
    await context.reply(WHATSAPP_STRINGS.setListFormat);
    return { handled: true, plugin: "group-basic" };
  }
  if (template.toLowerCase() === "reset") {
    await context.store.update("groups", {}, (groups) => ({
      ...groups,
      [context.chat_jid]: {
        ...(groups[context.chat_jid] || {}),
        setlist: "",
      },
    }));
    await context.reply("_Berhasil reset Setlist_");
    return { handled: true, plugin: "group-basic" };
  }
  if (!isValidListTemplate(template)) {
    await context.reply(WHATSAPP_STRINGS.listTemplateInvalid);
    return { handled: true, plugin: "group-basic" };
  }
  await context.store.update("groups", {}, (groups) => ({
    ...groups,
    [context.chat_jid]: {
      ...(groups[context.chat_jid] || {}),
      setlist: template,
    },
  }));
  await context.reply("✅ _Set List Berhasil Diatur_\n\n_Ketik *.list* untuk melihat daftar list_ atau ketik .setlist reset untuk mengembalikan ke semula");
  return { handled: true, plugin: "group-basic" };
}

async function updateGroupOpenClose(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  const action = normalizeKeyword(context.args).split(/\s+/)[0] || "";
  if (!action) {
    await context.reply(`_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${context.prefix + context.command} open*_`);
    return { handled: true, plugin: "group-basic" };
  }
  if (!["open", "close"].includes(action)) {
    await context.reply(`⚠️ Format tidak valid!\n_Silahkan Ketik:_\n_${context.command} open_\n_${context.command} close_`);
    return { handled: true, plugin: "group-basic" };
  }
  try {
    await context.services.updateGroupSetting(context.chat_jid, action === "open" ? "not_announcement" : "announcement");
    await context.reply(action === "open" ? "✅ Grup berhasil dibuka" : "✅ Grup berhasil ditutup");
  } catch {
    await context.reply("⚠️ Terjadi kesalahan. Pastikan bot memiliki izin admin untuk mengelola grup.");
  }
  return { handled: true, plugin: "group-basic" };
}

async function hideTag(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  try {
    const groupInfo = await groupInfoForAdminCommand(context);
    await context.reply(cleanText(context.args) || "kosong", { mentions: participantMentions(groupInfo) });
  } catch (error) {
    await context.reply(`⚠️ Terjadi kesalahan: ${error.message || error}`);
  }
  return { handled: true, plugin: "group-basic" };
}

async function tagAll(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  try {
    const groupInfo = await groupInfoForAdminCommand(context);
    const mentions = participantMentions(groupInfo);
    const messageContent = cleanText(context.args) || "kosong";
    let text = `══✪〘 *👥 Tag All* 〙✪══\n➲ *Pesan: ${messageContent}*\n\n`;
    for (const jid of mentions) {
      text += `⭕ @${jid.split("@")[0]}\n`;
    }
    await context.reply(text.trim(), { mentions });
  } catch (error) {
    await context.reply(`⚠️ Terjadi kesalahan: ${error.message || error}`);
  }
  return { handled: true, plugin: "group-basic" };
}

async function listAdmins(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  try {
    const groupInfo = await groupInfoForAdminCommand(context);
    const admins = (groupInfo.participants || []).filter((participant) => participant.is_admin || participant.is_super_admin || participant.admin);
    if (!admins.length) {
      await context.reply("⚠️ _Tidak ada admin dalam grup ini._");
      return { handled: true, plugin: "group-basic" };
    }
    const mentions = admins.map(participantJid).filter(Boolean);
    const text = `📋 *Daftar Admin Grup:*\n\n${mentions.map((jid) => `◧ @${jid.split("@")[0]}`).join("\n")}`;
    await context.reply(text, { mentions });
  } catch {
    await context.reply("⚠️ Terjadi kesalahan saat menampilkan daftar admin.");
  }
  return { handled: true, plugin: "group-basic" };
}

async function deleteQuotedMessage(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  if (normalizeKeyword(context.args).startsWith("list ")) {
    return deleteListEntry(context, context.args.replace(/^list\s+/i, ""));
  }
  if (!context.quoted_message_key) {
    await context.reply("⚠️ _Balas pesan yang mau di hapus_");
    return { handled: true, plugin: "group-basic" };
  }
  try {
    await context.services.deleteMessage(context.chat_jid, context.quoted_message_key);
  } catch {
    await context.reply("Terjadi kesalahan. Silakan coba lagi.");
  }
  return { handled: true, plugin: "group-basic" };
}

async function updateGroupSubject(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  const content = cleanText(context.args);
  if (!content) {
    await context.reply(`_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${context.prefix + context.command} judul baru*_`);
    return { handled: true, plugin: "group-basic" };
  }
  try {
    await context.services.updateGroupSubject(context.chat_jid, content);
    await context.reply("✅ _Nama grup berhasil diganti!_");
  } catch {
    await context.reply("⚠️ Terjadi kesalahan saat mencoba mengganti nama grup. Pastikan format benar dan Anda memiliki izin.");
  }
  return { handled: true, plugin: "group-basic" };
}

async function updateGroupDescription(context) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  const content = cleanText(context.args);
  if (!content) {
    await context.reply(`_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${context.prefix + context.command} deskripsi baru*_`);
    return { handled: true, plugin: "group-basic" };
  }
  try {
    await context.services.updateGroupDescription(context.chat_jid, content);
    await context.reply(`✅ _Deskripsi Grub Berhasil diganti_ \n\n${content}`);
  } catch {
    await context.reply("⚠️ Terjadi kesalahan saat mencoba mengganti nama grup. Pastikan format benar dan Anda memiliki izin.");
  }
  return { handled: true, plugin: "group-basic" };
}

async function updateParticipantRole(context, action) {
  if (groupOnly(context) || await groupAdminOnly(context)) return { handled: true, plugin: "group-basic" };
  const targets = targetJidsFromContext(context);
  if (!targets.length) {
    await context.reply(`_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${context.prefix + context.command} @NAME*_`);
    return { handled: true, plugin: "group-basic" };
  }
  try {
    await context.services.updateGroupParticipants(context.chat_jid, targets, action);
    if (action === "remove") {
      await context.reply("✅ _Berhasil mengeluarkan peserta dari grup._");
      return { handled: true, plugin: "group-basic" };
    }
    const target = targets[0];
    const text = action === "promote"
      ? `@${target.split("@")[0]} Telah Menjadi admin grub`
      : `@${target.split("@")[0]} _telah diturunkan dari admin._`;
    await context.reply(text, { mentions: targets });
  } catch {
    const fallback = action === "remove"
      ? "⚠️ Terjadi kesalahan saat mencoba mengeluarkan pengguna. Pastikan bot memiliki izin."
      : action === "promote"
        ? "⚠️ Terjadi kesalahan saat mencoba menaikkan menjadi admin."
        : "⚠️ Terjadi kesalahan saat mencoba menurunkan admin.";
    await context.reply(fallback);
  }
  return { handled: true, plugin: "group-basic" };
}

async function rentalForGroup(context) {
  const rentals = await context.store.read("rentals", {});
  return rentals[context.chat_jid] || null;
}

async function checkRental(context) {
  if (groupOnly(context)) return { handled: true, plugin: "group-basic" };
  const rental = await rentalForGroup(context);
  if (!rental) {
    await context.reply("Sewa bot grup ini belum terdata di runtime.");
    return { handled: true, plugin: "group-basic" };
  }
  const daysLeft = rentalDaysLeft(rental);
  const groups = await context.store.read("groups", {});
  await context.reply(
    rentalMessageText({
      title: "Status Sewa Bot",
      groupName: groupDisplayNameForContext(context, groups[context.chat_jid] || {}, rental),
      ownerNumber: ownerNumberForContext(context, rental),
      days: daysLeft,
      // `.ceksewa` is not admin-only, so this reply is readable by every member.
      // The date is safe to print here; the invite link is not, and it is
      // deliberately absent.
      endText: formatRentalEndDate({ ...rental, daysLeft }),
    }),
  );
  return { handled: true, plugin: "group-basic" };
}

async function listRentals(context) {
  if (ownerOnly(context)) return { handled: true, plugin: "group-basic" };
  const rentals = await context.store.read("rentals", {});
  const rows = Object.entries(rentals)
    .map(([groupJid, rental]) => ({ groupJid, daysLeft: rentalDaysLeft(rental), status: rental.status || "active" }))
    .sort((a, b) => b.daysLeft - a.daysLeft)
    .slice(0, 30);
  if (!rows.length) {
    await context.reply("Belum ada data sewa aktif di runtime.");
    return { handled: true, plugin: "group-basic" };
  }
  await context.reply(["*LIST SEWA BOT*", "", ...rows.map((row, index) => `${index + 1}. ${row.groupJid} - ${row.daysLeft} hari (${row.status})`)].join("\n"));
  return { handled: true, plugin: "group-basic" };
}

async function deleteRental(context) {
  if (ownerOnly(context)) return { handled: true, plugin: "group-basic" };
  const target = cleanText(context.args || context.chat_jid);
  if (!target) {
    await context.reply("Format salah.\n\nPakai: .delsewa group_jid");
    return { handled: true, plugin: "group-basic" };
  }
  let rentalSnapshot = {};
  await context.store.update("rentals", {}, (rentals) => {
    rentalSnapshot = rentals[target] || {};
    delete rentals[target];
    return rentals;
  });
  await context.reply(`Data sewa ${target} dihapus dari runtime WhatsApp.`);
  await notifyStoreOwnerRentalChanged(context, {
    mode: "delsewa",
    addedDays: 0,
    previousDays: rentalDaysLeft(rentalSnapshot),
    totalDays: 0,
    groupName: rentalSnapshot.name || rentalSnapshot.groupName || target,
    rental: { ...rentalSnapshot, id: target, groupJid: target },
  });
  return { handled: true, plugin: "group-basic" };
}

function storeOwnerNotificationTargets(context, rental = {}) {
  const targets = [
    rental.contact,
    rental.ownerNumber,
    rental.ownerWhatsapp,
    rental.ownerWhatsAppNumber,
    rental.owner,
    ...(context.config?.ownerNumbers || []),
    process.env.OWNER_WHATSAPP_NUMBER,
    context.config?.backup?.ownerNumber,
    process.env.BACKUP_OWNER_NUMBER,
  ];
  return Array.from(new Set(targets.map(normalizeWhatsAppNumber).filter(Boolean)));
}

function ownerContactText(context) {
  const targets = storeOwnerNotificationTargets(context);
  if (!targets.length) {
    return "_Nomor owner belum disetting._";
  }
  return ["_*Owner Bot*_", "", ...targets.map((target, index) => `${index + 1}. wa.me/${target}`)].join("\n");
}

function ownerNumberForContext(context, rental = {}) {
  return normalizeWhatsAppNumber(
    rental.contact ||
      rental.ownerNumber ||
      rental.ownerWhatsapp ||
      rental.ownerWhatsAppNumber ||
      rental.owner ||
      process.env.OWNER_WHATSAPP_NUMBER ||
      context.config?.backup?.ownerNumber ||
      context.config?.ownerNumbers?.[0] ||
      process.env.BACKUP_OWNER_NUMBER ||
    "",
  ) || "-";
}

function formatRentalDays(value) {
  return `${Math.max(0, Number(value || 0))} hari`;
}

function rentalDayChangeLines({ mode, addedDays, previousDays, totalDays } = {}) {
  let delta = Number(addedDays || 0);
  if ((!Number.isFinite(delta) || delta === 0) && mode === "delsewa") {
    delta = -Math.max(0, Number(previousDays || 0));
  }
  if (!Number.isFinite(delta) || delta === 0) {
    const before = Number(previousDays || 0);
    const after = Number(totalDays || 0);
    if (Number.isFinite(before) && Number.isFinite(after) && before !== after) {
      delta = after - before;
    }
  }
  if (!Number.isFinite(delta) || delta === 0) return [];
  const label = delta > 0 ? "Penambahan Hari" : "Pengurangan Hari";
  return [`${label} : *${Math.abs(delta)} hari*`];
}

/*
 * `endText` and `linkGrub` are separate arguments on purpose.
 *
 * This one function builds the message that goes into the group chat AND the
 * one that goes privately to the person who rents. Only the second may carry
 * the invite link: a WhatsApp invite is the key to the group, and anything
 * printed in the chat is readable by every member and forwardable to anyone.
 * Splitting the arguments means the in-group caller has no link to pass, so
 * leaking it is not a decision someone has to remember not to make.
 */
function rentalMessageText({ title, groupName, ownerNumber, days, mode, addedDays, previousDays, endText = "", linkGrub = "" }) {
  return [
    `_*${title}*_`,
    "",
    `Name Grub : *${groupName}*`,
    `Nomor Owner : *${ownerNumber}*`,
    ...rentalDayChangeLines({ mode, addedDays, previousDays, totalDays: days }),
    `Expired : *${formatRentalDays(days)}*`,
    ...(endText ? [`Berakhir : *${endText}*`] : []),
    ...(linkGrub ? [`Link Grub : *${linkGrub}*`] : []),
    "",
    "_Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut_",
  ].join("\n");
}

function rentalStoreOwnerMessage({ context, rental = {}, groupName, mode, addedDays, previousDays, totalDays }) {
  const title = mode === "sewabot" ? "Bot Sudah Bergabung" : mode === "delsewa" ? "Bot Sewa Dihapus" : "Bot Sewa Bertambah";
  return rentalMessageText({
    title,
    groupName: groupName || context.chat_jid,
    ownerNumber: ownerNumberForContext(context, rental),
    days: totalDays,
    mode,
    addedDays,
    previousDays,
    endText: formatRentalEndDate({ ...rental, daysLeft: totalDays || rental.daysLeft }),
    // The only place in the bot that hands out the invite link.
    linkGrub: rentalInviteLink(rental),
  });
}

async function notifyStoreOwnerRentalChanged(context, payload) {
  const sendMessage = context.services?.sendMessage;
  if (typeof sendMessage !== "function") return [];
  const targets = storeOwnerNotificationTargets(context, payload.rental || {});
  const groupName = cleanText(payload.groupName || payload.rental?.name || payload.rental?.groupName || context.chat_jid);
  const text = rentalStoreOwnerMessage({ context, groupName, ...payload });
  const results = [];
  for (const target of targets) {
    try {
      await sendMessage(target, text);
      results.push({ target, sent: true });
    } catch (error) {
      logWarning(`Failed to send rental update notification to ${target}`, error);
      results.push({ target, sent: false, error: error.message || "send_failed" });
    }
  }
  return results;
}

async function upsertCurrentGroupRental(context, mode) {
  if (groupOnly(context) || ownerOnly(context)) return { handled: true, plugin: "group-basic" };
  const days = Number(cleanText(context.args).match(/\d+/)?.[0] || 30);
  if (!Number.isFinite(days) || days <= 0) {
    await context.reply(`Format salah.\n\nPakai: .${mode} jumlah_hari`);
    return { handled: true, plugin: "group-basic" };
  }
  const now = new Date().toISOString();
  let previousDays = 0;
  let totalDays = days;
  let rentalSnapshot = {};
  await context.store.update("rentals", {}, (rentals) => {
    const current = rentals[context.chat_jid] || {};
    const currentDays = rentalDaysLeft(current);
    previousDays = Math.max(0, Number.isFinite(currentDays) ? currentDays : 0);
    totalDays = mode === "tambahsewa" ? previousDays + days : days;
    rentalSnapshot = {
      ...current,
      daysLeft: totalDays,
      expired: rentalExpiredFromDays(totalDays),
      start: current.start || current.startedAt || rentalStartText(),
      startedAt: current.startedAt || current.start || rentalStartText(),
      status: "active",
      updatedAt: now,
      createdAt: current.createdAt || now,
    };
    rentals[context.chat_jid] = rentalSnapshot;
    return rentals;
  });
  const groups = await context.store.read("groups", {});
  const groupName = groupDisplayNameForContext(context, groups[context.chat_jid] || {}, rentalSnapshot);
  await context.reply(
    rentalMessageText({
      title: mode === "tambahsewa" ? "Bot Sewa Bertambah" : "Bot Sudah Bergabung",
      groupName,
      ownerNumber: ownerNumberForContext(context, rentalSnapshot),
      days: totalDays,
      mode,
      addedDays: days,
      previousDays,
      // Date yes, invite link no: this one is posted where the whole group reads it.
      endText: formatRentalEndDate(rentalSnapshot),
    }),
  );
  await notifyStoreOwnerRentalChanged(context, {
    mode,
    addedDays: days,
    previousDays,
    totalDays,
    groupName,
    rental: rentalSnapshot,
  });
  return { handled: true, plugin: "group-basic" };
}

function runBackupCommand(context) {
  return new Promise((resolve) => {
    const script = path.join(context.config.projectRoot || process.cwd(), "scripts", "maintenance", "runtime-backup.mjs");
    if (!existsSync(script)) {
      resolve({ ok: false, reason: "backup_script_missing" });
      return;
    }
    const child = spawn(process.execPath, [script, "--send-whatsapp", "--reason=whatsapp-command"], {
      cwd: context.config.projectRoot || process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (code) => resolve({ ok: code === 0, code, output: output.slice(-800) }));
  });
}

async function backupRuntime(context) {
  if (ownerOnly(context)) return { handled: true, plugin: "group-basic" };
  const result = await runBackupCommand(context);
  if (!result.ok) {
    await context.reply(`Backup gagal: ${result.reason || result.output || result.code}`);
  }
  return { handled: true, plugin: "group-basic" };
}

function entryText(entry = {}) {
  return cleanText(entry.text || entry.content?.text || "");
}

function mediaPathForEntry(entry = {}, config = {}) {
  const configured = cleanText(entry.media_path || entry.mediaPath);
  if (configured) return configured;

  const mediaName = cleanText(entry.media || entry.content?.media);
  if (!mediaName) return "";

  const candidate = path.join(config.projectRoot || process.cwd(), "database", "media", mediaName);
  return existsSync(candidate) ? candidate : "";
}

function listEntryMap(entries = {}) {
  const legacyListShape =
    entries &&
    typeof entries === "object" &&
    !Array.isArray(entries) &&
    entries.list &&
    typeof entries.list === "object" &&
    !("text" in entries.list || "content" in entries.list || "media" in entries.list || "media_path" in entries.list || "updated_at" in entries.list);
  if (legacyListShape) {
    const metadataKeys = new Set(["createdAt", "updatedAt", "addedAt", "template", "templatelist", "setlist"]);
    const topLevelEntries = Object.fromEntries(
      Object.entries(entries).filter(([key, value]) => {
        if (metadataKeys.has(key)) return false;
        return value && typeof value === "object";
      }),
    );
    return { ...entries.list, ...topLevelEntries };
  }
  return entries || {};
}

function normalizeEntries(entries = {}, config = {}) {
  return Object.fromEntries(
    Object.entries(listEntryMap(entries)).map(([keyword, entry]) => {
      const normalizedEntry = entry && typeof entry === "object" ? entry : { text: cleanText(entry) };
      return [
        normalizeKeyword(keyword),
        {
          ...normalizedEntry,
          text: entryText(normalizedEntry),
          media_path: mediaPathForEntry(normalizedEntry, config),
        },
      ];
    }),
  );
}

async function groupEntries(context) {
  if (!context.isGroup) return {};
  return normalizeEntries(await context.store.getGroupList(context.chat_jid), context.config);
}

function findEntry(entries = {}, keyword = "") {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return null;
  if (entries[normalized]) return { keyword: normalized, entry: entries[normalized] };
  const matchedKeyword = Object.keys(entries).find((item) => item.toLowerCase() === normalized);
  return matchedKeyword ? { keyword: matchedKeyword, entry: entries[matchedKeyword] } : null;
}

async function sendListEntry(context, match) {
  const mediaName = cleanText(match.entry.media || match.entry.content?.media);
  const mediaPath = mediaPathForEntry(match.entry, context.config);
  const missingMediaNote = mediaName && !mediaPath ? `\n\n_Catatan: media ${mediaName} belum ada di folder database/media._` : "";
  const text = `${entryText(match.entry) || `List ${match.keyword}`}${missingMediaNote}`.trim();
  await context.reply(text, mediaPath ? { mediaPath } : {});
  return { handled: true, plugin: "group-basic", keyword: match.keyword };
}

function legacyListEmptyMessage() {
  return "_Tidak Ada List Di Grup Ini, silakan ketik *addlist* untuk membuat baru_\n\n_Hanya *admin* yang dapat menambah / menghapus list_";
}

function renderCustomLegacyListTemplate(template, data) {
  const sortedList = [...data.list].sort((a, b) => a.localeCompare(b));
  return String(template || "")
    .split("\n")
    .map((line) => {
      if (!line.includes("@x")) return line;
      const prefix = line.replace("@x", "").trim();
      return sortedList.map((item) => `${prefix} ${item}`).join("\n");
    })
    .join("\n")
    .replace(/@name/g, data.name)
    .replace(/@date/g, data.date)
    .replace(/@day/g, data.day)
    .replace(/@desc/g, data.desc)
    .replace(/@group/g, data.group)
    .replace(/@greeting/g, data.greeting)
    .replace(/@size/g, data.size)
    .replace(/@time/g, data.time)
    .replace(/@list/g, sortedList.join("\n"));
}

function extractMessageKey(sentMessage = {}) {
  return sentMessage?.key || sentMessage?.message_key || sentMessage?.messageKey || null;
}

function dashboardWebhookHeaders(context) {
  return {
    "Content-Type": "application/json",
    ...(context.config?.inboundWebhookToken ? { Authorization: `Bearer ${context.config.inboundWebhookToken}` } : {}),
  };
}

function paymentMessageUrl(context, orderId = "") {
  if (!context.config?.inboundWebhookUrl || !orderId) return "";
  try {
    const url = new URL(context.config.inboundWebhookUrl);
    url.pathname = `/api/whatsapp/orders/${encodeURIComponent(orderId)}/payment-message`;
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function saveDashboardPaymentMessage(context, body = {}, sentMessage = null) {
  const orderId = cleanText(body.orderId || body.order_id || body.order?.id || "");
  const messageKey = extractMessageKey(sentMessage);
  const url = paymentMessageUrl(context, orderId);
  if (!url || !messageKey) return;

  await fetch(url, {
    method: "POST",
    headers: dashboardWebhookHeaders(context),
    body: JSON.stringify({
      chatJid: context.chat_jid,
      messageKey,
    }),
  }).catch((error) => {
    logWarning("Failed to save group payment message key", error);
  });
}

async function forwardDashboardStoreCommand(context) {
  if (context.command === "deposit" && context.isGroup) {
    return false;
  }

  if (!context.config?.inboundWebhookUrl) {
    await context.reply("Auto order belum tersambung ke dashboard. Cek Webhook URL di Settings WhatsApp Bailey.");
    return false;
  }

  const senderNumber = normalizeWhatsAppNumber(context.sender || context.from || "");
  const senderAliases = Array.from(
    new Set(
      [
        senderNumber,
        ...(Array.isArray(context.sender_aliases) ? context.sender_aliases : []),
        ...(Array.isArray(context.senderAliases) ? context.senderAliases : []),
        normalizeWhatsAppNumber(context.sender_jid),
        normalizeWhatsAppNumber(context.raw_sender_jid),
      ].filter(Boolean),
    ),
  );
  const response = await fetch(context.config.inboundWebhookUrl, {
    method: "POST",
    headers: dashboardWebhookHeaders(context),
    body: JSON.stringify({
      from: senderNumber,
      sender: senderNumber,
      sender_aliases: senderAliases,
      senderAliases,
      sender_jid: context.sender_jid,
      chat_jid: context.sender_jid || `${senderNumber}@s.whatsapp.net`,
      remote_jid: context.sender_jid || `${senderNumber}@s.whatsapp.net`,
      is_group: false,
      from_me: false,
      push_name: context.push_name || context.pushName || "",
      pushName: context.push_name || context.pushName || "",
      text: context.text,
      body: context.text,
      message: context.text,
    }),
  });
  const bodyText = await response.text().catch(() => "");
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = { reply: bodyText };
  }
  const reply = cleanText(body.reply || body.message || "");
  const qrImageUrl = cleanText(body.qrImageUrl || body.qr_image_url || "");
  if (reply) {
    const sentMessage = await context.reply(reply, { imageUrl: qrImageUrl });
    if (qrImageUrl) await saveDashboardPaymentMessage(context, body, sentMessage);
  }
  if (!response.ok && !reply) {
    await context.reply("Auto order belum tersambung ke dashboard. Cek Webhook URL dan Inbound Webhook Token di Settings WhatsApp Bailey.");
  }
  if (response.ok && !reply) {
    await context.reply("Auto order diterima dashboard, tapi belum ada balasan yang bisa dikirim.");
  }
  return response.ok;
}

async function renderListMenu(context, entries) {
  const keywords = Object.keys(entries || {}).filter(Boolean);
  if (!keywords.length) {
    await context.reply(legacyListEmptyMessage());
    return { handled: true, plugin: "group-basic" };
  }

  const groups = await context.store.read("groups", {});
  const rentals = await context.store.read("rentals", {});
  const groupSettings = groups[context.chat_jid] || {};
  const rental = rentals[context.chat_jid] || {};
  const templateIndex = Math.min(9, Math.max(1, Number(groupSettings.templatelist || 1) || 1));
  const customTemplate = cleanText(groupSettings.setlist || "");
  const data = {
    name: senderDisplayName(context),
    date: getWibDate(),
    day: getWibDay(),
    desc: cleanText(groupSettings.description || ""),
    group: groupDisplayNameForContext(context, groupSettings, rental),
    greeting: getGreeting(),
    size: Number(groupSettings.participant_count || groupSettings.participantCount || groupSettings.members || 0) || keywords.length,
    time: `${getWibTime()} WIB`,
    list: keywords,
  };

  await context.reply(customTemplate ? renderCustomLegacyListTemplate(customTemplate, data) : applyTemplate(templateIndex, data));
  return { handled: true, plugin: "group-basic" };
}

export default {
  name: "group-basic",
  description: "Kavya core group, menu, list, rental, and store commands.",
  commands: COMMANDS,
  priority: 10,
  async shouldHandle(context) {
    if (shouldUseLegacyRentalLinkCommand(context)) return false;
    if (COMMANDS.includes(context.command)) return true;
    if (context.isGroup && context.command === "deposit") return false;
    if (context.prefix && context.command && DASHBOARD_STORE_COMMANDS.has(context.command)) return true;
    if (!context.isGroup || context.prefix) return false;
    const entries = await groupEntries(context);
    return Boolean(findEntry(entries, context.text));
  },
  async execute(context) {
    const isKnownCommand = COMMANDS.includes(context.command);
    if (context.command === "bot") {
      await context.reply("Helo ada yang bisa di bantu ?");
      return { handled: true, plugin: "group-basic" };
    }

    if (context.command === "owner") {
      await context.reply(ownerContactText(context));
      return { handled: true, plugin: "group-basic" };
    }

    if (context.command === "menu") {
      const menu = await legacyMenu(context);
      const category = normalizeKeyword(context.args);
      if (category && menu[category]) {
        await context.reply(legacyStyle(formatLegacyCategory(category, menu[category])));
      } else if (category) {
        await context.reply(legacyStyle(formatLegacyMainMenu(menu)));
      } else {
        await context.reply(legacyStyle(formatLegacyMainMenu(menu)));
      }
      return { handled: true, plugin: "group-basic" };
    }

    if (context.command === "allmenu") {
      const menu = await legacyMenu(context);
      await context.reply(legacyStyle(formatLegacyAllMenu(menu, context)));
      return { handled: true, plugin: "group-basic" };
    }

    if (context.command === "addlist" || context.command === "updatelist") {
      return saveListEntry(context, context.command);
    }

    if (context.command === "renamelist") {
      return renameListEntry(context);
    }

    if (context.command === "dellist" || context.command === "deletelist") {
      return deleteListEntry(context);
    }

    if (context.command === "delete" && normalizeKeyword(context.args).startsWith("list ")) {
      return deleteListEntry(context, context.args.replace(/^list\s+/i, ""));
    }

    if (context.command === "resetlist" || (context.command === "reset" && normalizeKeyword(context.args) === "list")) {
      return resetList(context);
    }

    if (context.command === "setlist") {
      return setListTemplate(context);
    }

    if (GROUP_SETTING_COMMANDS.has(context.command)) {
      return updateGroupOpenClose(context);
    }

    if (HIDETAG_COMMANDS.has(context.command)) {
      return hideTag(context);
    }

    if (context.command === "tagall") {
      return tagAll(context);
    }

    if (context.command === "listadmin") {
      return listAdmins(context);
    }

    if (context.command === "del" || context.command === "delete") {
      return deleteQuotedMessage(context);
    }

    if (GROUP_SUBJECT_COMMANDS.has(context.command)) {
      return updateGroupSubject(context);
    }

    if (GROUP_DESCRIPTION_COMMANDS.has(context.command)) {
      return updateGroupDescription(context);
    }

    if (context.command === "kick") {
      return updateParticipantRole(context, "remove");
    }

    if (context.command === "promote") {
      return updateParticipantRole(context, "promote");
    }

    if (context.command === "demote") {
      return updateParticipantRole(context, "demote");
    }

    if (context.command === "ceksewa") {
      return checkRental(context);
    }

    if (context.command === "listsewa") {
      return listRentals(context);
    }

    if (context.command === "sewabot" || context.command === "tambahsewa") {
      return upsertCurrentGroupRental(context, context.command);
    }

    if (context.command === "delsewa") {
      return deleteRental(context);
    }

    if (context.command === "backup") {
      return backupRuntime(context);
    }

    if (context.prefix && context.command && DASHBOARD_STORE_COMMANDS.has(context.command)) {
      if (OWNER_ONLY_DASHBOARD_STORE_COMMANDS.has(context.command) && ownerOnly(context)) {
        return { handled: true, plugin: "group-basic" };
      }
      const forwarded = await forwardDashboardStoreCommand(context).catch(async (error) => {
        logWarning(`Failed to forward dashboard store command ${context.command}`, error);
        await context.reply("Auto order belum tersambung ke dashboard. Cek Webhook URL dan Inbound Webhook Token di Settings WhatsApp Bailey.").catch((replyError) => {
          logWarning("Failed to send dashboard fallback reply", replyError);
        });
        return false;
      });
      return { handled: true, plugin: "group-basic", forwarded };
    }

    if (context.prefix && context.command && !isKnownCommand) {
      return { handled: false, plugin: "group-basic", legacy_unported: context.command };
    }

    if (!context.isGroup) {
      await context.reply("Command list aktif di grup.");
      return { handled: true, plugin: "group-basic" };
    }

    const entries = await groupEntries(context);
    if (context.command === "list" && context.args) {
      const sortedKeywords = Object.keys(entries).sort((a, b) => a.localeCompare(b));
      const numericIndex = Number(context.args);
      const keyword = Number.isInteger(numericIndex) && numericIndex > 0 ? sortedKeywords[numericIndex - 1] : context.args;
      const match = findEntry(entries, keyword);
      if (match) return sendListEntry(context, match);
    }

    if (!context.prefix) {
      const match = findEntry(entries, context.text);
      if (match) return sendListEntry(context, match);
    }

    return renderListMenu(context, entries);
  },
};
