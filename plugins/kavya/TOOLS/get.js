import { reply, isURL } from "../../../lib/utils.js";
import { safeGet, SsrfBlockedError, truncate } from "../../../lib/safeFetch.js";

async function handle(sock, messageInfo) {
  const { m, remoteJid, message, prefix, command, content } = messageInfo;
  const startTime = performance.now();

  try {
    // Validasi input
    if (!content || !isURL(content)) {
      return await reply(
        m,
        `_⚠️ Format Penggunaan:_ \n\n💬 _Contoh:_ _${
          prefix + command
        } https://autoresbot.com_`
      );
    }

    // Mengirim reaksi loading
    await sock.sendMessage(remoteJid, {
      react: { text: "⏰", key: message.key },
    });

    /*
     * Fetch goes through `safeGet`, never a bare `axios.get`.
     *
     * This command is `OnlyOwner: false` and TOOLS is not in the adapter's
     * OWNER_SCOPED_LEGACY_DIRS, so any group member can call it, and the result
     * is posted back to the group. A direct fetch therefore turns the group into
     * a request proxy aimed at whatever the bot host can reach: the cloud
     * metadata endpoint, admin panels, internal databases. `safeGet` refuses
     * those, re-checks every redirect hop, and bounds time and size.
     */
    const response = await safeGet(content);
    const endTime = performance.now();
    const responseTime = (endTime - startTime).toFixed(2);

    // Body arrives as bytes; decode for the title/meta extraction below.
    const html = response.data.toString("utf8");

    // Cek tipe konten dari header respons
    const contentType = response.contentType || "";
    if (contentType.includes("application/json")) {
      // Jika JSON, tampilkan isi JSON
      const jsonData = JSON.stringify(JSON.parse(html), null, 2);
      const jsonResponse = `Website Info:
- Status: ${response.status}
- Response Time: ${responseTime} ms

JSON Data:
${truncate(jsonData)}`;
      return await reply(m, jsonResponse);
    }

    // Jika bukan JSON, parsing HTML untuk mengambil title dan meta description
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const metaMatch = html.match(
      /<meta\s+name="description"\s+content="(.*?)"/i
    );

    const title = titleMatch ? titleMatch[1] : "Tidak ditemukan";
    const metaDescription = metaMatch ? metaMatch[1] : "Tidak ditemukan";

    const infoGet = `Website Info:
- Title: ${truncate(title)}
- Meta Description: ${truncate(metaDescription)}
- Status: ${response.status}
- Response Time: ${responseTime} ms`;

    await reply(m, infoGet);
  } catch (error) {
    /*
     * A blocked target is the user's mistake, not an internal fault, and it is
     * reported plainly so the command is not just mysteriously silent. Any other
     * error keeps the generic wording -- `error.message` from a failed fetch can
     * carry internal hostnames, addresses and connection strings, and this reply
     * goes into a group chat.
     */
    if (error instanceof SsrfBlockedError) {
      return await sock.sendMessage(
        remoteJid,
        { text: `⚠️ _Alamat tujuan tidak diizinkan:_ ${error.message}` },
        { quoted: message }
      );
    }

    // Menangani kesalahan
    const errorMessage = `Maaf, terjadi kesalahan saat memproses permintaan Anda. Coba lagi nanti.\n\nDetail Kesalahan: ${error.message}`;
    await sock.sendMessage(
      remoteJid,
      { text: errorMessage },
      { quoted: message }
    );
  }
}

export default {
  handle,
  Commands: ["get"],
  OnlyPremium: false,
  OnlyOwner: false,
  limitDeduction: 1, // Jumlah limit yang akan dikurangi
};
