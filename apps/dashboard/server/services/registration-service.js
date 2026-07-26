export function normalizeRegistrationWhatsapp(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export function normalizeRegistrationInput(body = {}) {
  return {
    name: String(body.name || "").trim().replace(/\s+/g, " "),
    username: String(body.username || "").trim().toLowerCase(),
    email: String(body.email || "").trim().toLowerCase(),
    whatsapp: normalizeRegistrationWhatsapp(body.whatsapp || body.phone || ""),
    password: String(body.password || ""),
    confirmPassword: String(body.confirmPassword || ""),
  };
}

export function validateRegistrationInput(input = {}) {
  if (input.name.length < 2 || input.name.length > 80) return "Nama harus 2-80 karakter.";
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(input.username)) {
    return "Username harus 3-32 karakter dan hanya boleh memakai huruf kecil, angka, titik, garis bawah, atau strip.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 160) return "Email tidak valid.";
  if (!/^62\d{8,13}$/.test(input.whatsapp)) return "Nomor WhatsApp tidak valid.";
  if (input.password.length < 8 || input.password.length > 128) return "Password harus 8-128 karakter.";
  if (input.password !== input.confirmPassword) return "Konfirmasi password tidak sama.";
  return "";
}

export function cleanupRegistrationOtps(db, now = Date.now()) {
  db.registrationOtps = (db.registrationOtps || []).filter((item) => {
    return Number(item.createdAtMs || 0) > now - 24 * 60 * 60 * 1000;
  });
}

export function registrationRateLimit(records = [], whatsapp = "", now = Date.now(), options = {}) {
  const resendMs = Number(options.resendMs || 60_000);
  const windowMs = Number(options.windowMs || 60 * 60 * 1000);
  const maxRequests = Number(options.maxRequests || 5);
  const recent = records
    .filter((item) => item.whatsapp === whatsapp && Number(item.createdAtMs || 0) > now - windowMs)
    .sort((left, right) => Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0));
  if (recent.length >= maxRequests) return { allowed: false, reason: "hourly_limit", retryAfterSeconds: Math.ceil(windowMs / 1000) };
  const elapsed = recent.length ? now - Number(recent[0].createdAtMs || 0) : resendMs;
  if (elapsed < resendMs) return { allowed: false, reason: "resend_wait", retryAfterSeconds: Math.ceil((resendMs - elapsed) / 1000) };
  return { allowed: true, reason: "", retryAfterSeconds: 0 };
}

function formatRegistrationBalance(value = 0) {
  return `Rp ${Math.max(0, Number(value || 0)).toLocaleString("id-ID")}`;
}

export function selfRegistrationWelcomeMessage(reseller = {}) {
  const displayName = String(reseller.name || reseller.username || "Kak").trim();
  return [
    `Welcome (๑•ᴗ•๑)♡, ${displayName}!`,
    "akun kamu berhasil dibuat———☆",
    "",
    ` Username : ${reseller.username || "-"}`,
    ` Email    : ${reseller.email || "-"}`,
    ` Status   : ${reseller.isActive === false ? "Nonaktif" : "Aktif"}`,
    ` Saldo    : ${formatRegistrationBalance(reseller.deposit)}`,
    "",
    ".・゜-: ✧ :»»————>",
    "○ note: password tidak ditampilkan demi keamanan",
    "○ email dan profil bisa diedit melalui Settings",
  ].join("\n");
}
