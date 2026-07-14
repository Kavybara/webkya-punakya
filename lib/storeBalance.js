import { findUser, registerUser, saveUsers } from "./users.js";
import { convertToJid, determineUser } from "./utils.js";

function formatBalance(amount = 0) {
  return new Intl.NumberFormat("id-ID").format(Number(amount) || 0);
}

function parsePositiveAmount(rawAmount) {
  const cleaned = String(rawAmount || "").replace(/[^\d]/g, "");
  if (!cleaned) return null;

  const amount = parseInt(cleaned, 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function toDefaultJid(rawTarget, senderType = "user") {
  const target = String(rawTarget || "").trim();
  if (!target) return null;

  if (target.includes("@")) {
    return target;
  }

  const digits = target.replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  return `${digits}${senderType === "lid" ? "@lid" : "@s.whatsapp.net"}`;
}

async function resolveBalanceUser(sock, rawTarget, senderType = "user") {
  const target = String(rawTarget || "").trim();
  if (!target) {
    return { dataUsers: null, resolvedJid: null };
  }

  let dataUsers = findUser(target);
  if (dataUsers) {
    const [, userData] = dataUsers;
    return {
      dataUsers,
      resolvedJid: userData.aliases?.[0] || target,
    };
  }

  const defaultJid = toDefaultJid(target, senderType);
  if (defaultJid) {
    dataUsers = findUser(defaultJid);
    if (dataUsers) {
      return {
        dataUsers,
        resolvedJid: defaultJid,
      };
    }
  }

  const convertedJid = await convertToJid(sock, target).catch(() => null);
  const resolvedJid = convertedJid || defaultJid;

  if (!resolvedJid) {
    return { dataUsers: null, resolvedJid: null };
  }

  dataUsers = findUser(resolvedJid);
  return {
    dataUsers: dataUsers || null,
    resolvedJid,
  };
}

async function ensureBalanceUser(sock, rawTarget, senderType = "user") {
  const resolved = await resolveBalanceUser(sock, rawTarget, senderType);
  if (resolved.dataUsers || !resolved.resolvedJid) {
    return resolved;
  }

  const username = `user_${resolved.resolvedJid.toLowerCase()}`;
  registerUser(resolved.resolvedJid, username);
  await saveUsers();

  return {
    dataUsers: findUser(resolved.resolvedJid),
    resolvedJid: resolved.resolvedJid,
  };
}

function getTargetFromMessage(messageInfo, fallbackContent = null) {
  const { content, mentionedJid, isQuoted, senderType } = messageInfo;
  const targetText =
    fallbackContent === null ? String(content || "").trim() : String(fallbackContent || "").trim();

  return determineUser(mentionedJid, isQuoted, targetText, senderType) || targetText || null;
}

function getTargetAndAmountFromMessage(messageInfo) {
  const parts = String(messageInfo.content || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return { rawTarget: null, rawAmount: null };
  }

  const rawAmount = parts[parts.length - 1];
  const rawTargetText = parts.slice(0, -1).join(" ");
  const rawTarget = getTargetFromMessage(messageInfo, rawTargetText);

  return {
    rawTarget,
    rawAmount,
  };
}

function getUserMentionJid(userData, fallbackJid = "") {
  return userData?.aliases?.[0] || fallbackJid || null;
}

function getUserMentionText(userData, fallbackJid = "") {
  const jid = getUserMentionJid(userData, fallbackJid) || "";
  const number = jid.split("@")[0];
  return number ? `@${number}` : "@user";
}

export {
  ensureBalanceUser,
  formatBalance,
  getTargetAndAmountFromMessage,
  getTargetFromMessage,
  getUserMentionJid,
  getUserMentionText,
  parsePositiveAmount,
  resolveBalanceUser,
};
