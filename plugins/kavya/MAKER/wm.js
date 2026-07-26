import fs from 'fs';
import { downloadQuotedMedia, downloadMedia } from '../../../lib/utils.js';
import { sendImageAsSticker } from '../../../lib/exif.js';

async function sendError(sock, remoteJid, message, errorMessage) {
  await sock.sendMessage(remoteJid, { text: errorMessage }, { quoted: message });
}

async function handle(sock, messageInfo) {
  const { remoteJid, message, content, prefix, command, isQuoted, type } = messageInfo;
  const mediaType = isQuoted ? isQuoted.type : type;

  try {
    const [packname = '', author = ''] = content.split('|').map((s) => s.trim());

    // Validasi tipe media
    if (!['image', 'sticker'].includes(mediaType)) {
      return sendError(
        sock,
        remoteJid,
        message,
        `⚠️ _Kirim/Balas gambar/stiker dengan caption *${prefix + command}*_`,
      );
    }

    // Validasi konten input
    if (!content.trim()) {
      return sendError(
        sock,
        remoteJid,
        message,
        `_Contoh: *wm az creative*_

_Contoh 1: wm nama_
_Contoh 2: wm youtube | creative_`,
      );
    }

    // Unduh media
    const mediaPath = `./tmp/${
      isQuoted ? await downloadQuotedMedia(message) : await downloadMedia(message)
    }`;

    if (!fs.existsSync(mediaPath)) {
      throw new Error('File media tidak ditemukan setelah diunduh.');
    }

    // Buat stiker dengan watermark
    const media = fs.readFileSync(mediaPath);
    await sendImageAsSticker(sock, remoteJid, media, {
      packname,
      author: author,
    }, message);
  } catch (error) {
    await sendError(
      sock,
      remoteJid,
      message,
      `Maaf, terjadi kesalahan saat memproses permintaan Anda. Coba lagi nanti.\n\nError: ${error.message}`,
    );
  }
}

export default {
  handle,
  Commands: ['wm'],
  OnlyPremium: false,
  OnlyOwner: false,
};
