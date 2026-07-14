import { getGroupMetadata } from "../../../lib/cache.js";
import { downloadQuotedMedia, downloadMedia } from "../../../lib/utils.js";
import mess from "../../../strings.js";
import fs from "fs";
import path from "path";
import { setProses, deleteMessage } from "../../../lib/participants.js";

async function handle(sock, messageInfo) {
  const {
    remoteJid,
    isGroup,
    message,
    content,
    sender,
    command,
    prefix,
    isQuoted,
    type,
  } = messageInfo;

  if (!isGroup) return;

  const groupMetadata = await getGroupMetadata(sock, remoteJid);
  const participants = groupMetadata.participants;

  const isAdmin = participants.some(
    (p) => (p.phoneNumber === sender || p.id === sender) && p.admin
  );
  if (!isAdmin) {
    await sock.sendMessage(
      remoteJid,
      { text: mess.general.isAdmin },
      { quoted: message }
    );
    return;
  }

  const mediaType = isQuoted ? isQuoted.type : type;

  if (mediaType == "sticker") {
    const media = isQuoted
      ? await downloadQuotedMedia(message, true)
      : await downloadMedia(message, true);
    const mediaPath = path.join("database", "media", media);

    if (!fs.existsSync(mediaPath)) {
      throw new Error("File media tidak ditemukan setelah diunduh.");
    }
    await setProses(remoteJid, mediaPath);

    const successMessage = `✅ _Set proses Berhasil Diatur_

_Ketik .setproses reset untuk mengembalikan ke semula_`;
    await sock.sendMessage(
      remoteJid,
      { text: successMessage },
      { quoted: message }
    );
    return;
  }

  if (!content || !content.trim()) {
    const usageMessage = `⚠️ *Format Penggunaan:*

💬 *Contoh:* 
_${prefix}${command} PROCESS_

Jam : @time
Tanggal : @tanggal
Grub : @grub
Catatan : @catatan

@sender Pesanan sedang di proses
`;

    await sock.sendMessage(
      remoteJid,
      { text: usageMessage },
      { quoted: message }
    );
    return;
  }

  if (content.toLowerCase() === "reset") {
    await deleteMessage(remoteJid, "setproses");
    await sock.sendMessage(
      remoteJid,
      { text: "_Berhasil reset Setproses_" },
      { quoted: message }
    );
    return;
  }

  await setProses(remoteJid, content);

  const successMessage = `✅ _Set Proses Berhasil Diatur_

_Ketik .setproses reset untuk mengembalikan ke semula_`;

  await sock.sendMessage(
    remoteJid,
    { text: successMessage },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["setproses"],
  OnlyPremium: false,
  OnlyOwner: false,
};
