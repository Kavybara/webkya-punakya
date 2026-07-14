import { reply } from "../../../lib/utils.js";
import config from "../../../config.js";

async function handle(sock, messageInfo) {
  const { m } = messageInfo;

  const text = `╭「 𝙎𝘾𝙍𝙄𝙋𝙏 𝘼𝙐𝙏𝙊𝙍𝙀𝙎𝘽𝙊𝙏 」
│
│◧ ᴠᴇʀꜱɪᴏɴ : ${global.version}
│◧ ᴛʏᴘᴇ ᴘʟᴜɢɪɴꜱ ᴇꜱᴍ
│◧ ɴᴏ ᴇɴᴄ 100%
│◧ ɴᴏ ʙᴜɢ & ɴᴏ ᴇʀʀᴏʀ 
│◧ ʜᴀʀɢᴀ ? free
│◧ ꜰʀᴇᴇ ᴀᴘɪᴋᴇʏ
│◧ ꜰʀᴇᴇ ᴜᴘᴅᴀᴛᴇ
│◧ ʙɪꜱᴀ ʀᴜɴ ᴅɪ ᴘᴀɴᴇʟ
╰────────────────────────◧

╭「 Link Download 」

◧ ᴡᴇʙꜱɪᴛᴇ https://autoresbot.com/download`;

  await reply(m, text);
}

export default {
  handle,
  Commands: ["sc", "script"],
  OnlyPremium: false,
  OnlyOwner: false,
};
