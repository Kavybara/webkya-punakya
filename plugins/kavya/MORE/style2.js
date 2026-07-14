const font =
  "𝓪 𝓫 𝓬 𝓭 𝓮 𝓯 𝓰 𝓱 𝓲 𝓳 𝓴 𝓵 𝓶 𝓷 𝓸 𝓹 𝓺 𝓻 𝓼 𝓽 𝓾 𝓿 𝔀 𝔁 𝔂 𝔃 0 1 2 3 4 5 6 7 8 9 𝓐 𝓑 𝓒 𝓓 𝓔 𝓕 𝓖 𝓗 𝓘 𝓙 𝓚 𝓛 𝓜 𝓝 𝓞 𝓟 𝓠 𝓡 𝓢 𝓣 𝓤 𝓥 𝓦 𝓧 𝓨 𝓩";
const commandName = "style2";

import { reply, style } from "../../../lib/utils.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, prefix, command, content } = messageInfo;

  try {
    if (!content) {
      return await reply(
        m,
        `_⚠️ Format Penggunaan:_ \n\n_💬 Contoh:_ _*${
          prefix + command
        } resbot*_`
      );
    }

    const result = style(content, font);
    if (!result) {
      return await reply(
        m,
        "⚠️ _Failed to apply style. Please check your input._"
      );
    }

    await sock.sendMessage(remoteJid, { text: result }, { quoted: message });
  } catch (error) {
    console.error("Error in handle function:", error);
    await sock.sendMessage(
      remoteJid,
      { text: `_Error: ${error.message}_` },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: [commandName],
  OnlyPremium: false,
  OnlyOwner: false,
};
