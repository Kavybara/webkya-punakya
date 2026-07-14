import mess from "../../../strings.js";
import { getGroupMetadata } from "../../../lib/cache.js";
import { updateUser } from "../../../lib/users.js";
import {
  formatBalance,
  parsePositiveAmount,
  resolveBalanceUser,
  getUserMentionJid,
  getUserMentionText,
} from "../../../lib/storeBalance.js";

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, sender, content, prefix, command } =
    messageInfo;

  if (!isGroup) {
    return await sock.sendMessage(
      remoteJid,
      { text: mess.general.isGroup },
      { quoted: message }
    );
  }

  const groupMetadata = await getGroupMetadata(sock, remoteJid);
  const participants = groupMetadata?.participants || [];
  const isAdmin = participants.some(
    (participant) =>
      (participant.phoneNumber === sender || participant.id === sender) &&
      participant.admin
  );

  if (!isAdmin) {
    return await sock.sendMessage(
      remoteJid,
      { text: mess.general.isAdmin },
      { quoted: message }
    );
  }

  if (!content?.trim()) {
    return await sock.sendMessage(
      remoteJid,
      {
        text:
          `⚠️ _Format: *${prefix + command} @tag 10000*_\n\n` +
          `_Contoh:_ *${prefix + command} 628123456789 50000*`,
      },
      { quoted: message }
    );
  }

  const [rawTarget, rawAmount] = content.trim().split(/\s+/);
  const amount = parsePositiveAmount(rawAmount);

  if (!rawTarget || !amount) {
    return await sock.sendMessage(
      remoteJid,
      {
        text:
          `⚠️ _Format tidak valid._\n\n` +
          `_Contoh:_ *${prefix + command} @tag 10000*`,
      },
      { quoted: message }
    );
  }

  const resolved = await resolveBalanceUser(sock, rawTarget);
  if (!resolved.dataUsers) {
    return await sock.sendMessage(
      remoteJid,
      {
        text: "⚠️ _User belum ditemukan. Pastikan user sudah pernah chat bot dulu._",
      },
      { quoted: message }
    );
  }

  const [, userData] = resolved.dataUsers;
  const targetJid = getUserMentionJid(userData, resolved.resolvedJid);
  const targetText = getUserMentionText(userData, resolved.resolvedJid);
  const newBalance = (userData.money || 0) + amount;

  await updateUser(targetJid, { money: newBalance });

  await sock.sendMessage(
    remoteJid,
    {
      text:
        `✅ *BALANCE BERHASIL DITAMBAHKAN*\n\n` +
        `User : ${targetText}\n` +
        `Nominal : *Rp ${formatBalance(amount)}*\n` +
        `Balance sekarang : *Rp ${formatBalance(newBalance)}*`,
      contextInfo: {
        mentionedJid: targetJid ? [targetJid] : [],
      },
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["addbalance", "addbal", "addsaldo", "tambahsaldo"],
  OnlyPremium: false,
  OnlyOwner: true,
};
