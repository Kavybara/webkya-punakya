const font =
  "𝘢 𝘣 𝘤 𝘥 𝘦 𝘧 𝘨 𝘩 𝘪 𝘫 𝘬 𝘭 𝘮 𝘯 𝘰 𝘱 𝘲 𝘳 𝘴 𝘵 𝘶 𝘷 𝘸 𝘹 𝘺 𝘻 0 1 2 3 4 5 6 7 8 9 𝘈 𝘉 𝘊 𝘋 𝘌 𝘍 𝘎 𝘏 𝘐 𝘑 𝘒 𝘓 𝘔 𝘕 𝘖 𝘗 𝘘 𝘙 𝘚 𝘛 𝘜 𝘝 𝘞 𝘟 𝘠 𝘡";
const commandName = "style7";

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
