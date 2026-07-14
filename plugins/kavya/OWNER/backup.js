import { createBackup } from "../../../lib/utils.js";
import config from "../../../config.js";

async function handle(sock, messageInfo) {
  const { remoteJid, message } = messageInfo;

  try {
    const backupFilePath = await createBackup();
    const documentPath = backupFilePath.path;

    await sock.sendMessage(`${config.phone_number_bot}@s.whatsapp.net`, {
      document: { url: documentPath },
      fileName: "File Backup",
      mimetype: "application/zip",
    });
  } catch (err) {
    console.error("Backup failed:", err);

    await sock.sendMessage(
      remoteJid,
      {
        text: `Gagal melakukan backup: ${err.message}`,
      },
      { quoted: message },
    );
  }
}

export default {
  handle,
  Commands: ["backup"],
  OnlyPremium: false,
  OnlyOwner: true,
};
