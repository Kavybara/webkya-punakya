import crypto from "node:crypto";

const DEFAULT_TTL_MS = 60_000;

function safeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function classifyGmailConnectionError(error) {
  const source = [
    error?.responseText,
    error?.responseStatus,
    error?.code,
    error?.message,
  ].map(safeText).filter(Boolean).join(" ");

  if (/invalid credentials|authentication failed|auth(?:entication)? error|application-specific password|invalid_grant/.test(source)) {
    return {
      code: "invalid_credentials",
      message: "Kredensial Gmail ditolak. Perbarui koneksi Gmail melalui panel Owner.",
    };
  }
  if (/timeout|timed out|etimedout/.test(source)) {
    return {
      code: "timeout",
      message: "Koneksi Gmail melewati batas waktu. Coba periksa kembali.",
    };
  }
  return {
    code: "connection_failed",
    message: "Koneksi Gmail tidak dapat digunakan. Periksa konfigurasi melalui panel Owner.",
  };
}

function configFingerprint(config = {}) {
  return crypto.createHash("sha256").update(JSON.stringify({
    host: config.host || "",
    port: Number(config.port || 0),
    secure: config.secure !== false,
    user: config.auth?.user || "",
    password: config.auth?.pass || "",
  })).digest("hex");
}

export function createGmailHealthService({ createClient, now = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
  let cached = null;

  return {
    async check(config = {}) {
      const configured = Boolean(config.host && config.port && config.auth?.user && config.auth?.pass);
      if (!configured) {
        return { configured: false, connected: false, checked: true, error: "Gmail IMAP belum dikonfigurasi." };
      }

      const fingerprint = configFingerprint(config);
      if (cached && cached.fingerprint === fingerprint && cached.expiresAt > now()) return cached.result;

      const client = createClient(config);
      let result;
      try {
        await client.connect();
        result = { configured: true, connected: true, checked: true, error: "", errorCode: "" };
      } catch (error) {
        const classified = classifyGmailConnectionError(error);
        result = {
          configured: true,
          connected: false,
          checked: true,
          error: classified.message,
          errorCode: classified.code,
        };
      } finally {
        try {
          await client.logout?.();
        } catch {
          // A failed health check can leave the IMAP client disconnected.
        }
      }

      cached = { fingerprint, expiresAt: now() + Math.max(1_000, Number(ttlMs || DEFAULT_TTL_MS)), result };
      return result;
    },
    clear() {
      cached = null;
    },
  };
}
