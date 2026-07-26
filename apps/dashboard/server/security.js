import crypto from "node:crypto";

export const SESSION_COOKIE_NAME = "kavya_session";
const PASSWORD_PREFIX = "scrypt";
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function clean(value = "") {
  return String(value || "").trim();
}

export function isPasswordHash(value = "") {
  return clean(value).startsWith(`${PASSWORD_PREFIX}$`);
}

export function hashPassword(password = "") {
  const value = String(password || "");
  if (!value) throw new Error("Password tidak boleh kosong");
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(value, salt, 64, SCRYPT_OPTIONS);
  return [PASSWORD_PREFIX, SCRYPT_OPTIONS.N, SCRYPT_OPTIONS.r, SCRYPT_OPTIONS.p, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

export function verifyPassword(password = "", stored = "") {
  const value = String(password || "");
  const encoded = clean(stored);
  if (!value || !encoded) return false;
  if (!isPasswordHash(encoded)) {
    const left = Buffer.from(value);
    const right = Buffer.from(encoded);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
  try {
    const [, n, r, p, saltValue, hashValue] = encoded.split("$");
    const expected = Buffer.from(hashValue, "base64url");
    const actual = crypto.scryptSync(value, Buffer.from(saltValue, "base64url"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT_OPTIONS.maxmem,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function parseCookies(header = "") {
  const result = {};
  for (const item of String(header || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

export function requestUsesHttps(req) {
  return Boolean(req?.secure || String(req?.get?.("x-forwarded-proto") || "").split(",")[0].trim() === "https");
}

export function sessionCookie(token, options = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(String(token || ""))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  if (Number(options.maxAgeSeconds || 0) > 0) parts.push(`Max-Age=${Math.floor(Number(options.maxAgeSeconds))}`);
  return parts.join("; ");
}

export function clearSessionCookie(options = {}) {
  return sessionCookie("", { ...options, maxAgeSeconds: 0 }) + "; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

export function configuredOrigins(...values) {
  const origins = new Set();
  for (const value of values.flat(Infinity)) {
    for (const part of String(value || "").split(/[\s,]+/)) {
      const candidate = part.trim().replace(/\/$/, "");
      if (!candidate) continue;
      try {
        const parsed = new URL(candidate);
        origins.add(parsed.origin);
        if (parsed.hostname.startsWith("www.")) {
          parsed.hostname = parsed.hostname.slice(4);
          origins.add(parsed.origin);
        } else if (parsed.protocol === "https:") {
          parsed.hostname = `www.${parsed.hostname}`;
          origins.add(parsed.origin);
        }
      } catch {}
    }
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://127.0.0.1:5174");
    origins.add("http://localhost:5174");
    origins.add("http://127.0.0.1:4174");
    origins.add("http://localhost:4174");
  }
  return origins;
}

export function corsOptions(allowedOrigins) {
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(String(origin).replace(/\/$/, ""))) return callback(null, true);
      const error = new Error("Origin tidak diizinkan");
      error.status = 403;
      return callback(error);
    },
    allowedHeaders: ["Authorization", "Content-Type", "Cache-Control", "Pragma", "X-Kavya-Request", "X-WhatsApp-Token", "X-Pakasir-Secret"],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  };
}

export function assertTrustedBrowserMutation(req, allowedOrigins) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(String(req.method || "").toUpperCase())) return;
  const origin = clean(req.get?.("origin"));
  if (!origin) return;
  let normalized = origin;
  try {
    normalized = new URL(origin).origin;
  } catch {
    const error = new Error("Origin request tidak valid");
    error.status = 403;
    throw error;
  }
  if (!allowedOrigins.has(normalized)) {
    const error = new Error("Origin request tidak diizinkan");
    error.status = 403;
    throw error;
  }
}
