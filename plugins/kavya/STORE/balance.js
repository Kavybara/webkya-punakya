import { findUser, isOwner } from "../../../lib/users.js";
import {
  formatBalance,
  resolveBalanceUser,
  getUserMentionJid,
  getUserMentionText,
} from "../../../lib/storeBalance.js";
import { determineUser } from "../../../lib/utils.js";

async function handle(sock, messageInfo) {
  const {
    remoteJid,
    message,
    sender,
    content,
    prefix,
    command,
    isQuoted,
    mentionedJid,
    senderType,
  } = messageInfo;

  let dataUsers = findUser(sender);
  let mentionJid = sender;

  if (content?.trim()) {
    if (!isOwner(sender)) {
      return await sock.sendMessage(
        remoteJid,
        {
          text:
            `WARNING: hanya owner yang bisa cek balance user lain.\n\n` +
            `Contoh: *${prefix + command} @tag*`,
        },
        { quoted: message }
      );
    }

    const [rawTarget] = content.trim().split(/\s+/);
    const resolved = await resolveBalanceUser(sock, rawTarget);
    dataUsers = resolved.dataUsers;
    mentionJid = resolved.resolvedJid || rawTarget;
  } else if (isOwner(sender)) {
    const targetFromReply = determineUser(mentionedJid, isQuoted, "", senderType);

    if (targetFromReply && targetFromReply !== sender) {
      const resolved = await resolveBalanceUser(sock, targetFromReply);
      dataUsers = resolved.dataUsers;
      mentionJid = resolved.resolvedJid || targetFromReply;
    }
  }

  if (!dataUsers) {
    return await sock.sendMessage(
      remoteJid,
      {
        text:
          "WARNING: user belum ditemukan. Pastikan user sudah pernah chat bot dulu.\n\n" +
          `Tips owner: *${prefix + command} @tag* atau reply chat user lalu kirim *${prefix + command}*`,
      },
      { quoted: message }
    );
  }

  const [, userData] = dataUsers;
  const finalMentionJid = getUserMentionJid(userData, mentionJid) || sender;
  const finalMentionText = getUserMentionText(userData, mentionJid);
  const balance = userData.money || 0;

  await sock.sendMessage(
    remoteJid,
    {
      text:
        `*INFO BALANCE*\n\n` +
        `User : ${finalMentionText}\n` +
        `Balance : *Rp ${formatBalance(balance)}*`,
      contextInfo: {
        mentionedJid: [finalMentionJid],
      },
    },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["balance", "saldo", "ceksaldo", "cekbalance", "cekbal"],
  OnlyPremium: false,
  OnlyOwner: false,
};
