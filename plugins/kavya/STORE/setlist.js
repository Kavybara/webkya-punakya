import { setList, deleteMessage } from "../../../lib/participants.js";
import { getGroupMetadata } from "../../../lib/cache.js";
import mess from "../../../strings.js";

async function handle(sock, messageInfo) {
  const { remoteJid, isGroup, message, content, sender, command, prefix } =
    messageInfo;

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

  if (!content || !content.trim()) {
    const usageMessage = `⚠️ *Format Penggunaan:*

💬 *Contoh:* 
_${prefix}${command} LIST STORE_

_Berikut daftar list_
⌬ @x

════════════
_Parameter yang bisa dipakai_

✍ @x${global.group.variable}
`;

    await sock.sendMessage(
      remoteJid,
      { text: usageMessage },
      { quoted: message }
    );
    return;
  }

  if (content.toLowerCase() === "reset") {
    await deleteMessage(remoteJid, "setlist");
    await sock.sendMessage(
      remoteJid,
      { text: "_Berhasil reset Setlist_" },
      { quoted: message }
    );
    return;
  }

  await setList(remoteJid, content);

  const successMessage = `✅ _Set List Berhasil Diatur_

_Ketik *.list* untuk melihat daftar list_ atau ketik .setlist reset untuk mengembalikan ke semula`;

  await sock.sendMessage(
    remoteJid,
    { text: successMessage },
    { quoted: message }
  );
}

export default {
  handle,
  Commands: ["setlist"],
  OnlyPremium: false,
  OnlyOwner: false,
};
