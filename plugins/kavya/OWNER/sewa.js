import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import config from "../../../config.js";
import { deleteCache } from "../../../lib/globalCache.js";

const OWNER_SEWA_COMMANDS = [
  "sewabot",
  "sewabotid",
  "tambahsewa",
  "delsewa",
  "listsewa",
  "listsewa2",
  "listnosewa",
  "outnosewa",
  "totalsewa",
];

function cleanText(value = "") {
  return String(value || "").trim();
}

function legacySewaPath() {
  return path.join(process.cwd(), "database", "sewa.json");
}

async function readLegacyRentals() {
  try {
    const raw = await readFile(legacySewaPath(), "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeLegacyRentals(rentals = {}) {
  const target = legacySewaPath();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(rentals, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayText() {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function selisihHari(endDate) {
  const timeDifference = new Date(Number(endDate || 0)).getTime() - Date.now();
  const daysLeft = Math.floor(timeDifference / 86400000);
  const hoursLeft = Math.floor((timeDifference % 86400000) / 3600000);
  const minutesLeft = Math.floor((timeDifference % 3600000) / 60000);
  const secondsLeft = Math.floor((timeDifference % 60000) / 1000);
  if (daysLeft === 0) return `Hari ini, tersisa ${hoursLeft} jam ${minutesLeft} menit ${secondsLeft} detik lagi`;
  if (daysLeft === 1) return `Besok, tersisa 1 Hari ${hoursLeft} jam ${minutesLeft} menit ${secondsLeft} detik lagi`;
  if (daysLeft === -1) return "Kemarin";
  if (daysLeft > 1) return `${daysLeft} hari mendatang`;
  if (daysLeft < -1) return `${Math.abs(daysLeft)} hari yang lalu`;
  return "0 hari";
}

async function reply(sock, remoteJid, message, text) {
  return sock.sendMessage(remoteJid, { text }, { quoted: message });
}

function parseDays(value = "") {
  const days = Number.parseInt(cleanText(value), 10);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function expiryFromDays(days) {
  return Date.now() + days * 24 * 60 * 60 * 1000 + 60 * 60 * 1000;
}

function daysLeftFromRental(rental = {}) {
  const direct = Number(rental.daysLeft ?? rental.remaining_days ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct);
  const expired = Number(rental.expired || 0);
  if (!expired) return 0;
  return Math.max(0, Math.ceil((expired - Date.now()) / 86400000));
}

async function readRentals(messageInfo = {}) {
  if (messageInfo.store?.read) {
    return messageInfo.store.read("rentals", {});
  }
  return readLegacyRentals();
}

async function upsertRental(messageInfo = {}, groupId, patch = {}) {
  const normalizedGroupId = cleanText(groupId);
  if (!normalizedGroupId) return null;
  const daysLeft = Number(patch.daysLeft ?? daysLeftFromRental(patch));
  const expired = Number(patch.expired || expiryFromDays(daysLeft));
  const nextPatch = {
    ...patch,
    daysLeft,
    expired,
    start: patch.start || todayText(),
    startedAt: patch.startedAt || patch.start || todayText(),
    status: patch.status || "active",
    updatedAt: new Date().toISOString(),
  };

  if (messageInfo.store?.update) {
    let snapshot = {};
    await messageInfo.store.update("rentals", {}, (rentals) => {
      const current = rentals[normalizedGroupId] || {};
      snapshot = {
        ...current,
        ...nextPatch,
        createdAt: current.createdAt || new Date().toISOString(),
      };
      rentals[normalizedGroupId] = snapshot;
      return rentals;
    });
    return snapshot;
  }

  const rentals = await readLegacyRentals();
  rentals[normalizedGroupId] = {
    ...(rentals[normalizedGroupId] || {}),
    linkGrub: patch.linkGrub,
    start: nextPatch.start,
    expired,
    updatedAt: new Date().toISOString(),
    createdAt: rentals[normalizedGroupId]?.createdAt || new Date().toISOString(),
  };
  await writeLegacyRentals(rentals);
  return { id: normalizedGroupId, groupJid: normalizedGroupId, ...nextPatch };
}

async function findRental(messageInfo = {}, groupId) {
  const rentals = await readRentals(messageInfo);
  return rentals[cleanText(groupId)] || null;
}

async function removeRental(messageInfo = {}, groupId) {
  const normalizedGroupId = cleanText(groupId);
  if (!normalizedGroupId) return false;
  if (messageInfo.store?.update) {
    let existed = false;
    await messageInfo.store.update("rentals", {}, (rentals) => {
      existed = Boolean(rentals[normalizedGroupId]);
      delete rentals[normalizedGroupId];
      return rentals;
    });
    return existed;
  }
  const rentals = await readLegacyRentals();
  const existed = Boolean(rentals[normalizedGroupId]);
  delete rentals[normalizedGroupId];
  await writeLegacyRentals(rentals);
  return existed;
}

function normalizeWhatsAppNumber(value = "") {
  const digits = String(value || "").split("@")[0].split(":")[0].replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function ownerTargets(messageInfo = {}, rental = {}) {
  const values = [
    rental.contact,
    rental.ownerNumber,
    rental.ownerWhatsapp,
    rental.ownerWhatsAppNumber,
    rental.owner,
    ...(messageInfo.config?.ownerNumbers || []),
    process.env.OWNER_WHATSAPP_NUMBER,
    process.env.OWNER_NUMBERS,
    process.env.BACKUP_OWNER_NUMBER,
  ];
  return Array.from(new Set(values.flatMap((value) => String(value || "").split(/[,\s]+/)).map(normalizeWhatsAppNumber).filter(Boolean)));
}

function rentalOwnerNumber(messageInfo = {}, rental = {}) {
  return ownerTargets(messageInfo, rental)[0] || "-";
}

function rentalDayChangeLines({ addedDays, previousDays, days } = {}) {
  let delta = Number(addedDays || 0);
  if (!Number.isFinite(delta) || delta === 0) {
    const before = Number(previousDays || 0);
    const after = Number(days || 0);
    if (Number.isFinite(before) && Number.isFinite(after) && before !== after) {
      delta = after - before;
    }
  }
  if (!Number.isFinite(delta) || delta === 0) return [];
  const label = delta > 0 ? "Penambahan Hari" : "Pengurangan Hari";
  return [`${label} : *${Math.abs(delta)} hari*`];
}

async function notifyOwner(sock, messageInfo = {}, { title, groupName, rental = {}, days, addedDays, previousDays }) {
  const targets = ownerTargets(messageInfo, rental);
  if (!targets.length) return [];
  const text = [
    `_*${title}*_`,
    "",
    `Name Grub : *${groupName || rental.name || rental.groupName || rental.groupJid || rental.id || "Grup WhatsApp"}*`,
    `Nomor Owner : *${rentalOwnerNumber(messageInfo, rental)}*`,
    ...rentalDayChangeLines({ addedDays, previousDays, days }),
    `Expired : *${Math.max(0, Number(days ?? daysLeftFromRental(rental) ?? 0))} hari*`,
    "",
    "_Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut_",
  ].join("\n");

  const results = [];
  for (const target of targets) {
    try {
      await sock.sendMessage(target, { text });
      results.push({ target, sent: true });
    } catch (error) {
      results.push({ target, sent: false, error: error.message || "send_failed" });
    }
  }
  return results;
}

async function fetchAllGroups(sock) {
  if (typeof sock.groupFetchAllParticipating !== "function") return {};
  return (await sock.groupFetchAllParticipating()) || {};
}

function inviteCodeFromLink(link = "") {
  return cleanText(link).replace(/\?mode=[^ ]+/gi, "").split("https://chat.whatsapp.com/")[1] || "";
}

async function inspectInvite(sock, inviteCode) {
  const response = await sock.query({
    tag: "iq",
    attrs: { type: "get", xmlns: "w:g2", to: "@g.us" },
    content: [{ tag: "invite", attrs: { code: inviteCode } }],
  });
  const attrs = response?.content?.[0]?.attrs || {};
  return {
    groupId: attrs.id ? `${attrs.id}@g.us` : "",
    subject: attrs.subject || "Nama Grup Tidak Ditemukan",
  };
}

async function acceptInviteIfNeeded(sock, inviteCode) {
  try {
    await sock.groupAcceptInvite(inviteCode);
  } catch {
    // Bot may already be in the group; sewa data can still be updated.
  }
}

function rentalSuccessText({ title, groupName = "", botNumber = config.phone_number_bot, expired }) {
  return [
    `_*${title}*_`,
    "",
    groupName ? `Name Grub : *${groupName}*` : "",
    `Nomor Bot : ${botNumber}`,
    `Expired : *${selisihHari(expired)}*`,
    "",
    "_Untuk Mengecek status sewa ketik *.ceksewa* pada grub tersebut_",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function parseLinkAndDays(content = "") {
  const args = cleanText(content).replace(/\?mode=[^ ]+/gi, "").split(/\s+/).filter(Boolean);
  return {
    link: args[0] || "",
    days: parseDays(args[1]),
  };
}

async function sewabot(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  if (!cleanText(content)) {
    return reply(
      sock,
      remoteJid,
      message,
      `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} https://chat.whatsapp.com/xxx 30*_\n\n_*30* artinya 30 hari, bot otomatis akan keluar apabila waktu habis_\n\n_Jika Bot Sudah Bergabung ke Grup Sewa dan untuk perpanjang silakan ketik *.tambahsewa*_`,
    );
  }

  const { link, days } = parseLinkAndDays(content);
  if (!link.includes("chat.whatsapp.com") || !days) {
    return reply(sock, remoteJid, message, `⚠️ Format tidak valid. Contoh penggunaan:\n\n_*${prefix + command} https://chat.whatsapp.com/xxx 30*_`);
  }

  try {
    const inviteCode = inviteCodeFromLink(link);
    const { groupId, subject } = await inspectInvite(sock, inviteCode);
    if (!groupId) throw new Error("group_id_not_found");
    await acceptInviteIfNeeded(sock, inviteCode);
    const expired = expiryFromDays(days);
    const rental = await upsertRental(messageInfo, groupId, {
      id: groupId,
      groupJid: groupId,
      name: subject,
      groupName: subject,
      linkGrub: link,
      start: todayText(),
      daysLeft: days,
      expired,
    });
    deleteCache(`sewa-${remoteJid}`);
    await notifyOwner(sock, messageInfo, { title: "Bot Sudah Bergabung", groupName: subject, rental, days, addedDays: days, previousDays: 0 });
    return reply(sock, remoteJid, message, rentalSuccessText({ title: "Bot Sudah Bergabung", groupName: subject, expired }));
  } catch (error) {
    const info = error instanceof Error && error.message.includes("not-authorized")
      ? "_Kemungkinan Anda pernah dikeluarkan dari grup. Solusi: undang bot kembali atau masukkan secara manual._"
      : "_Pastikan link grup valid._";
    return reply(sock, remoteJid, message, `⚠️ _Gagal bergabung ke grup._\n\n${info}`);
  }
}

async function sewabotId(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  const { link: groupId, days } = parseLinkAndDays(content);
  if (!groupId || !groupId.includes("@g.us") || !days) {
    return reply(sock, remoteJid, message, `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} xxxx@g.us 30*_`);
  }

  const expired = expiryFromDays(days);
  const rental = await upsertRental(messageInfo, groupId, {
    id: groupId,
    groupJid: groupId,
    linkGrub: groupId,
    start: todayText(),
    daysLeft: days,
    expired,
  });
  deleteCache(`sewa-${remoteJid}`);
  await notifyOwner(sock, messageInfo, { title: "Bot Sudah Bergabung", groupName: groupId, rental, days, addedDays: days, previousDays: 0 });
  return reply(sock, remoteJid, message, rentalSuccessText({ title: "Bot Sudah Bergabung", expired }));
}

async function tambahSewa(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  if (!cleanText(content)) {
    return reply(
      sock,
      remoteJid,
      message,
      `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${prefix + command} https://chat.whatsapp.com/xxx 30*_\n\n_*30* artinya penambahan 30 hari dihitung dari sisa waktu sewabot_\n\n_Jika Bot Belum Bergabung ke Grub Sewa Silakan ketik *.sewabot*_`,
    );
  }

  const { link, days } = parseLinkAndDays(content);
  if (!link.includes("chat.whatsapp.com") || !days) {
    return reply(sock, remoteJid, message, `⚠️ Format tidak valid. Contoh penggunaan:\n\n_*${prefix + command} https://chat.whatsapp.com/xxx 30*_`);
  }

  try {
    const inviteCode = inviteCodeFromLink(link);
    const { groupId, subject } = await inspectInvite(sock, inviteCode);
    if (!groupId) throw new Error("group_id_not_found");
    const current = await findRental(messageInfo, groupId);
    if (!current) {
      return reply(sock, remoteJid, message, "⚠️ _*Nomor Bot Belum Pernah Bergabung*_\n\n_Silakan Ketik *.sewabot* untuk membuat Sewa Baru_");
    }

    await acceptInviteIfNeeded(sock, inviteCode);
    const previousDays = daysLeftFromRental(current);
    const totalDays = previousDays + days;
    const expired = expiryFromDays(totalDays);
    const rental = await upsertRental(messageInfo, groupId, {
      ...current,
      id: groupId,
      groupJid: groupId,
      name: current.name || subject,
      groupName: current.groupName || subject,
      linkGrub: link,
      daysLeft: totalDays,
      expired,
    });
    await notifyOwner(sock, messageInfo, { title: "Bot Sewa Bertambah", groupName: subject, rental, days: totalDays, addedDays: days, previousDays });
    return reply(sock, remoteJid, message, rentalSuccessText({ title: "Perpanjangan Berhasil", groupName: subject, expired }));
  } catch (error) {
    const info = error instanceof Error && error.message.includes("not-authorized")
      ? "_Kemungkinan Anda pernah dikeluarkan dari grup. Solusi: undang bot kembali atau masukkan secara manual._"
      : "_Pastikan link grup valid._";
    return reply(sock, remoteJid, message, `⚠️ _Gagal bergabung ke grup._\n\n${info}`);
  }
}

async function delSewa(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command } = messageInfo;
  const groupId = cleanText(content);
  if (!groupId) {
    return reply(sock, remoteJid, message, `_⚠️ Format Penggunaan:_\n\n_💬 Contoh:_ _*${prefix + command} 123xxxxx@g.us*_\n\n_Untuk mendapatkan ID grup, silakan ketik *.listsewa*_`);
  }
  if (!groupId.includes("@g.us")) {
    return reply(sock, remoteJid, message, `_⚠️ Format tidak valid!_\n\n_Pastikan ID grup mengandung '@g.us'._`);
  }

  const current = await findRental(messageInfo, groupId);
  const deleted = await removeRental(messageInfo, groupId);
  if (deleted) {
    await notifyOwner(sock, messageInfo, {
      title: "Bot Sewa Dihapus",
      groupName: current?.name || current?.groupName || groupId,
      rental: current || { id: groupId, groupJid: groupId },
      days: 0,
      addedDays: 0,
      previousDays: daysLeftFromRental(current || {}),
    });
  }
  return reply(
    sock,
    remoteJid,
    message,
    deleted
      ? `✅ _Berhasil menghapus data sewa untuk ID grup:_ *${groupId}*`
      : `⚠️ _ID grup tidak ditemukan:_ *${groupId}*\n\n_Pastikan ID grup benar atau tersedia di daftar sewa._`,
  );
}

async function listSewaText(sock, messageInfo, cleanupMissing = false) {
  const sewa = await readRentals(messageInfo);
  if (!Object.keys(sewa).length) return "⚠️ _Tidak Ada daftar sewa ditemukan_";

  const allGroups = await fetchAllGroups(sock);
  const sortedSewa = Object.entries(sewa).sort(([, a], [, b]) => Number(a.expired || 0) - Number(b.expired || 0));
  let count = 0;
  let text = "*▧ 「 LIST SEWA 」*\n\n";

  for (const [groupId, data] of sortedSewa) {
    const subject = allGroups[groupId]?.subject || "Nama Grup Tidak Ditemukan";
    if (cleanupMissing && subject === "Nama Grup Tidak Ditemukan") {
      await removeRental(messageInfo, groupId);
      continue;
    }

    text += `╭─
│ Subject : ${subject}
│ ID Grup : ${groupId}
│ Expired : ${daysLeftFromRental(data)} hari
╰────────────────────────\n`;
    count += 1;
  }

  return `${text}\n*Total : ${count}*`;
}

async function listNoSewaText(sock, messageInfo) {
  const sewa = await readRentals(messageInfo);
  const allGroups = await fetchAllGroups(sock);
  let count = 0;
  let text = "*▧ 「 LIST GRUP NON-SEWA 」*\n\n";

  for (const [groupId, groupData] of Object.entries(allGroups)) {
    if (sewa[groupId]) continue;
    text += `╭─
│ Subject : ${groupData.subject}
│ ID Grup : ${groupId}
╰────────────────────────\n`;
    count += 1;
  }

  return count ? `${text}\n*Total : ${count}*` : "✅ _Semua grup merupakan grup sewa._";
}

async function outNoSewa(sock, messageInfo) {
  const sewa = await readRentals(messageInfo);
  const allGroups = await fetchAllGroups(sock);
  let count = 0;
  let text = "*▧ 「 LIST GRUP NON-SEWA 」*\n\n";

  for (const [groupId, groupData] of Object.entries(allGroups)) {
    if (sewa[groupId]) continue;
    try {
      await sock.groupLeave(groupId);
      await sleep(2000);
      text += `╭───────────────
│ *Subject* : ${groupData.subject}
│ *ID Grup* : ${groupId}
╰───────────────\n\n`;
      count += 1;
    } catch {
      text += `⚠️ *Gagal keluar dari grup: ${groupData.subject} (${groupId})*\n\n`;
    }
  }

  return count ? `${text}*Total keluar: ${count} grup.*` : "✅ _Semua grup merupakan grup sewa._";
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, command } = messageInfo;
  switch (cleanText(command).toLowerCase()) {
    case "sewabot":
      return sewabot(sock, messageInfo);
    case "sewabotid":
      return sewabotId(sock, messageInfo);
    case "tambahsewa":
      return tambahSewa(sock, messageInfo);
    case "delsewa":
      return delSewa(sock, messageInfo);
    case "listsewa":
      return sock.sendMessage(remoteJid, { text: await listSewaText(sock, messageInfo, false) }, { quoted: message });
    case "listsewa2":
      return sock.sendMessage(remoteJid, { text: await listSewaText(sock, messageInfo, true) }, { quoted: message });
    case "listnosewa":
      return sock.sendMessage(remoteJid, { text: await listNoSewaText(sock, messageInfo) }, { quoted: message });
    case "outnosewa":
      return sock.sendMessage(remoteJid, { text: await outNoSewa(sock, messageInfo) }, { quoted: message });
    case "totalsewa": {
      const sewa = await readRentals(messageInfo);
      const total = Object.keys(sewa).length;
      return sock.sendMessage(remoteJid, { text: total ? `*Total : ${total}*` : "⚠️ _Tidak Ada daftar sewa ditemukan_" }, { quoted: message });
    }
    default:
      return null;
  }
}

export default {
  handle,
  Commands: OWNER_SEWA_COMMANDS,
  OnlyPremium: false,
  OnlyOwner: true,
};
