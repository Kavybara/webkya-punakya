import config from "../../../config.js";
import { getGroupMetadata } from "../../../lib/cache.js";
import { listOwner } from "../../../lib/users.js";
import { logTracking } from "../../../lib/utils.js";
import { isDepositProofMessage } from "../../../lib/storeDeposit.js";

function toMentionJid(value) {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  if (raw.includes("@")) {
    return raw;
  }

  const onlyNumber = raw.replace(/\D/g, "");
  if (!onlyNumber) return null;

  return `${onlyNumber}@s.whatsapp.net`;
}

function getMentionText(jid) {
  const raw = String(jid || "").split("@")[0];
  return raw ? `@${raw}` : null;
}

function getMentionKey(jid) {
  return String(jid || "").trim().toLowerCase();
}

function addMention(targets, jid, sender) {
  const mentionJid = toMentionJid(jid);
  if (!mentionJid || mentionJid === sender) return;

  const key = getMentionKey(mentionJid);
  if (!targets.has(key)) {
    targets.set(key, mentionJid);
  }
}

async function process(sock, messageInfo) {
  const { remoteJid, sender, pushName, isGroup, message, fullText, fromMe } =
    messageInfo;

  if (!isGroup || fromMe) return true;
  if (!isDepositProofMessage(messageInfo)) return true;

  const mentionTargets = new Map();

  for (const ownerJid of listOwner()) {
    addMention(mentionTargets, ownerJid, sender);
  }

  const groupMetadata = await getGroupMetadata(sock, remoteJid);
  const participants = groupMetadata?.participants || [];

  for (const participant of participants) {
    if (!participant?.admin) continue;
    addMention(mentionTargets, participant.id || participant.phoneNumber, sender);
  }

  const targetJids = Array.from(mentionTargets.values());
  if (targetJids.length === 0) return true;

  const senderText = getMentionText(sender) || pushName || "User";
  const ownerText = targetJids
    .map((jid) => getMentionText(jid))
    .filter(Boolean)
    .join(" ");
  const defaultPrefix = Array.isArray(config.prefix) && config.prefix.length > 0
    ? config.prefix[0]
    : ".";

  const text =
    "*NOTIF DEPOSIT MASUK*\n\n" +
    `User : ${senderText}\n` +
    `Pesan : ${String(fullText || "").trim()}\n\n` +
    `${ownerText}\n` +
    "Mohon cek bukti transfer/deposit di atas ya.\n" +
    `Jika sudah valid gunakan *${defaultPrefix}addbal ${senderText} nominal*.\n` +
    `Jika perlu koreksi gunakan *${defaultPrefix}removebal ${senderText} nominal*.`;

  await sock.sendMessage(
    remoteJid,
    {
      text,
      contextInfo: {
        mentionedJid: [sender, ...targetJids],
      },
    },
    { quoted: message }
  );

  logTracking(`Deposit notif - ${sender} (${remoteJid})`);
  return false;
}

export default {
  name: "Deposit Notification",
  priority: 4,
  process,
};
