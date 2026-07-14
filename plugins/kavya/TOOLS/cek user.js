import { reply } from "../../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, prefix, command, content } = messageInfo;

  try {
    // Cek jika tidak ada input
    if (!content || !content.trim()) {
      return await reply(
        m,
        `_⚠️ Format Penggunaan:_\n\n📌 *${
          prefix + command
        } <nomor>*\n\n💬 *Contoh:* ${prefix + command} 6281234567890`
      );
    }

    // Ambil dan bersihkan input
    let phoneNumber = content.trim().replace(/[^0-9]/g, "");

    // Validasi nomor HP internasional
    if (!/^\d{10,15}$/.test(phoneNumber)) {
      return await reply(
        m,
        `_❌ Nomor tidak valid._\nPastikan menggunakan format internasional tanpa + atau karakter lain. Contoh: 6281234567890`
      );
    }

    // Pastikan JID WhatsApp valid
    const userJid = phoneNumber.includes("@s.whatsapp.net")
      ? phoneNumber
      : `${phoneNumber}@s.whatsapp.net`;

    const result = await sock.onWhatsApp(userJid);

    if (result?.[0]?.exists) {
      return await reply(
        m,
        `✅ _Nomor *${phoneNumber}* terdaftar di WhatsApp._`
      );
    } else {
      return await reply(
        m,
        `❌ _Nomor *${phoneNumber}* tidak ditemukan di WhatsApp._`
      );
    }
  } catch (error) {
    console.error("Kesalahan di fungsi handle:", error);
    const errorMessage = error?.message || "Terjadi kesalahan tak dikenal.";
    return await sock.sendMessage(
      remoteJid,
      { text: `_⚠️ Error: ${errorMessage}_` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["cekuser"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1, // Jumlah limit yang akan dikurangi
};
