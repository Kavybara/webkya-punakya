import { reply, fetchJson, getBuffer } from "../../../lib/utils.js";
import { sendImageAsSticker } from "../../../lib/exif.js";
import sharp from "sharp";

import config from "../../../config.js";

/*
 * Tenor API key.
 *
 * This was a literal pasted into the request URL, which published it to anyone
 * who cloned the repository and made rotation mean a code change plus a history
 * rewrite. It now comes from the environment, so rotating it is one edit in .env.
 *
 * Read lazily rather than at import so that merely loading the plugin does not
 * require the variable to be set -- the loader walks every plugin directory at
 * startup, and a top-level throw here would take down the whole bot for anyone
 * who does not use this command.
 */
function tenorApiKey() {
  const key = process.env.TENOR_API_KEY?.trim();
  if (!key) {
    throw new Error("TENOR_API_KEY belum diatur di .env.");
  }
  return key;
}

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, prefix, command, content } = messageInfo;

  try {
    // Validasi input
    if (!content || !content.includes("+")) {
      return await reply(m, `_*Contoh:*_ ${prefix + command} 😅+🤔`);
    }

    let [emoji1, emoji2] = content.split("+").map((e) => e.trim());
    if (!emoji1 || !emoji2) {
      return await reply(m, `_*Contoh:*_ ${prefix + command} 😅+🤔`);
    }

    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    // Ambil data dari API Emoji Kitchen

    const apiResponse = await fetchJson(
      `https://tenor.googleapis.com/v2/featured?key=${encodeURIComponent(
        tenorApiKey()
      )}&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(
        emoji1.trim()
      )}_${encodeURIComponent(emoji2.trim())}`
    );

    if (
      !apiResponse ||
      !apiResponse.results ||
      apiResponse.results.length === 0
    ) {
      throw new Error(
        `Tidak ditemukan hasil untuk kombinasi emoji ${emoji1} dan ${emoji2}.`
      );
    }
    const imageUrl = apiResponse.results[0].url;
    const imageBuffer = await getBuffer(imageUrl);
    const webpBuffer = await sharp(imageBuffer).webp().toBuffer();

    // Kirim stiker
    const options = {
      packname: config.sticker_packname,
      author: config.sticker_author,
    };
    await sendImageAsSticker(sock, remoteJid, webpBuffer, options, message);
  } catch (error) {
    console.error("Kesalahan di fungsi handle:", error);

    /*
     * The API key now travels in the request URL, and a failed request can
     * surface that URL inside `error.message`. This reply goes into a group
     * chat, so the key would be handed to anyone who asks for a bad emoji combo.
     * Redact before sending rather than after -- once it is in the chat log it
     * is already exposed.
     */
    const safeMessage = (error.message || "Terjadi kesalahan tak dikenal.").replace(
      /([?&]key=)[^&\s]+/gi,
      "$1[redacted]",
    );

    return await reply(m, `_Error: ${safeMessage}_`);
  }
}

export default {
  handle,
  Commands: ["emojimix"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1, // Jumlah limit yang akan dikurangi
};
