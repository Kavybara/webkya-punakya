import mess from "../../../strings.js";
import { getGroupMetadata } from "../../../lib/cache.js";
import { sendMessageWithMention, logTracking } from "../../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message, isGroup, sender, senderType } = messageInfo;

  // ✅ Cek apakah permainan hanya untuk grup
  if (!isGroup) {
    return sock.sendMessage(
      remoteJid,
      { text: mess.game.isGroup },
      { quoted: message }
    );
  }

  try {
    logTracking(`jadian.js - groupMetadata (${remoteJid})`);
    const groupMetadata = await getGroupMetadata(sock, remoteJid);

    if (!groupMetadata) {
      console.error("❌ Gagal mendapatkan metadata grup");
      return;
    }

    const groupName = groupMetadata.subject;
    const participants = groupMetadata?.participants || [];

    // ✅ Pilih peserta acak (bukan pengirim)
    let randomParticipant;
    do {
      randomParticipant =
        participants[Math.floor(Math.random() * participants.length)];
    } while (
      randomParticipant?.id === sender ||
      randomParticipant?.phoneNumber === sender
    );

    const targetJid = randomParticipant.phoneNumber || randomParticipant.id;
    const senderClean = sender.split("@")[0];
    const targetClean =
      typeof targetJid === "string" ? targetJid.split("@")[0] : "unknown";

    // ✅ Pesan lucu/kreatif acak
    const randomMessages = [
      "Cocok banget, jodoh sejati! 😍💖 Jangan lupa kasih tau teman-teman kalian yang lagi cari jodoh!",
      "Hati-hati, jangan sampai kalian baper ya! 😜",
      "Wah, ini sih pasangan yang bikin iri banyak orang! 💕",
      "Saling cocok, jangan sampai lepas! 💘",
      "Kalian cocok banget, siap-siap jadi couple goals! 🔥",
      "Jangan lupa ngajak mereka jalan bareng ya! 🚶‍♂️🚶‍♀️",
      "Buat kalian yang jomblo, jangan khawatir! Mungkin jodoh masih nunggu! 😂",
    ];

    const randomMessage =
      randomMessages[Math.floor(Math.random() * randomMessages.length)];

    // ✅ Buat pesan akhir
    const jadianMessage = `@${senderClean} ❤️ @${targetClean}\n\n${randomMessage}`;

    // ✅ Kirim dengan mention
    await sendMessageWithMention(sock, remoteJid, jadianMessage, message, senderType, {
      mentions: [sender, targetJid],
    });
  } catch (error) {
    console.error("❌ Error saat mengambil metadata grup:", error);
    await sock.sendMessage(
      remoteJid,
      { text: "Terjadi kesalahan saat mengambil data grup." },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["jadian"],
  OnlyPremium: false,
  OnlyOwner: false,
};
