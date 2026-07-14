import { reply } from "../../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, prefix, command, content } = messageInfo;

  try {
    // Validasi input
    if (!content) {
      return await reply(
        m,
        `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _${
          prefix + command
        } https://chat.whatsapp.com/xxxxxxxxxxxxxxxx_`
      );
    }

    // Validasi link grup WhatsApp
    const regex = /https:\/\/chat\.whatsapp\.com\/([\w\d]+)/;
    const match = content.match(regex);
    if (!match || !match[1]) {
      return await reply(
        m,
        `_❌ Link grup tidak valid. Pastikan link seperti ini:_\nhttps://chat.whatsapp.com/xxxxxxxxxxxxxxxx`
      );
    }

    const inviteCode = match[1];

    // Ambil informasi grup tanpa join
    const groupInfo = await sock.groupGetInviteInfo(inviteCode);

    const info = [
      `🆔 ID Grup: ${groupInfo.id}`,
      `📛 Nama: ${groupInfo.subject}`,
      `👥 Jumlah Member: ${groupInfo.size}`,
    ].join("\n");

    return await reply(m, `_✅ Informasi Grup:_\n${info}`);
  } catch (error) {
    console.error("Kesalahan di fungsi handle:", error);

    const errorMessage = error.message || "Terjadi kesalahan tak dikenal.";
    return await sock.sendMessage(
      remoteJid,
      { text: `_❌ Error: ${errorMessage}_` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["cekidgc"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1,
};
