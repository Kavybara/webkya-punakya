const verificationCodeLengths = new Set([6]);

function normalizeDigits(value = "") {
  return String(value || "")
    .replace(/[\uFF10-\uFF19]/g, (digit) => String(digit.codePointAt(0) - 0xff10))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.codePointAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.codePointAt(0) - 0x06f0))
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function normalizeCode(value = "") {
  return normalizeDigits(value).replace(/[\s-]+/g, "").trim();
}

function isVerificationCode(value = "") {
  const code = normalizeCode(value);
  if (!/^\d+$/.test(code) || !verificationCodeLengths.has(code.length)) return false;
  return true;
}

function verificationCandidates(value = "") {
  const source = normalizeDigits(value);
  return Array.from(source.matchAll(/(?:^|[^\d])((?:\d[\s-]*){6})(?=[^\d]|$)/g))
    .map((match) => normalizeCode(match[1]))
    .filter(isVerificationCode);
}

function firstExplicitCode(source = "", patterns = []) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const code = normalizeCode(match?.[1] || "");
    if (isVerificationCode(code)) return code;
  }
  return "";
}

export function extractNetflixVerificationCode(text = "") {
  const source = normalizeDigits(text);
  const explicit = firstExplicitCode(source, [
    /(?:verifikasi\s+dengan\s+kode\s+ini|verify\s+with\s+this\s+code)[^\d]{0,220}?((?:\d[\s-]*){6})(?=[^\d]|$)/i,
    /(?:kode\s+verifikasi|verification\s+code|kode\s+keamanan|security\s+code)[^\d]{0,180}?((?:\d[\s-]*){6})(?=[^\d]|$)/i,
    /((?:\d[\s-]*){6})(?=[^\d]|$)[\s\S]{0,260}?(?:kode\s+ini\s+akan\s+(?:kedaluwarsa|kadaluarsa|berakhir)|you(?:'|\u2019)?ll\s+have\s+15\s+minutes|kode\s+verifikasi|verification\s+code|kedaluwarsa|kadaluarsa|expires?|valid)/i,
  ]);
  if (explicit) return explicit;

  const headlinePattern = /(?:verifikasi\s+dengan\s+kode\s+ini|verify\s+with\s+this\s+code)/gi;
  const headlineMatches = Array.from(source.matchAll(headlinePattern));
  for (let index = headlineMatches.length - 1; index >= 0; index -= 1) {
    const headline = headlineMatches[index];
    const afterHeadline = source.slice(
      (headline.index || 0) + headline[0].length,
      (headline.index || 0) + headline[0].length + 260,
    );
    const directLine = afterHeadline
      .split(/\r?\n/)
      .map(normalizeCode)
      .find(isVerificationCode);
    if (directLine) return directLine;
    const candidate = verificationCandidates(afterHeadline)[0];
    if (candidate) return candidate;
  }

  const hints = [
    "kode verifikasi",
    "verification code",
    "kode keamanan",
    "security code",
  ];
  const lower = source.toLowerCase();
  for (const hint of hints) {
    const hintIndex = lower.indexOf(hint);
    if (hintIndex < 0) continue;
    const nearby = source.slice(Math.max(0, hintIndex - 80), hintIndex + hint.length + 220);
    const candidate = verificationCandidates(nearby)[0];
    if (candidate) return candidate;
  }
  return "";
}

/* The words Netflix uses to say a code has an expiry, in one place.
 *
 * `berlaku` is here because this product's own OTP mail uses it -- see
 * `sendOtpEmail`, which writes "Kode berlaku 10 menit" -- and it is the word
 * Indonesian Netflix reaches for first. It was missing from this list, which
 * had the opposite of the intended effect: an access email saying "Kode ini
 * berlaku selama 15 menit" did not register as having a fifteen-minute expiry,
 * and then the ten-minute rule below read that same email as a
 * change-your-account mail and threw the whole thing away. A legitimate code,
 * discarded because the word explaining it was not in the list.
 *
 * Every spelling is deliberately loose on the inside. Which one arrives is
 * Netflix's business; whether this function recognises it is ours. */
const ACCESS_CODE_EXPIRY_WORDS =
  "kedaluwarsa|kadaluarsa|berakhir|berlaku|masa\\s+berlaku|expired|expires|expir(?:e|es)|valid(?:\\s+for)?";

/** Does this message say its code lives for `minutes`?
 *
 * Both orders are matched because the word and the number arrive in either
 * order: "berlaku selama 15 menit" puts the expiry word first, while "expires
 * in 15 minutes" puts it last. The gap between them is bounded so a message
 * carrying two separate windows does not read one as the other.
 */
function hasWindowedExpiry(text = "", minutes) {
  const source = String(text || "");
  const span = `\\s*(?:mnt|menit|min|mins|minutes?)`;
  return new RegExp(
    `(?:${ACCESS_CODE_EXPIRY_WORDS})[\\s\\S]{0,80}?${minutes}${span}`
    + `|${minutes}${span}[\\s\\S]{0,80}?(?:${ACCESS_CODE_EXPIRY_WORDS})`,
    "i",
  ).test(source);
}

/** Fifteen minutes is Netflix's sign-in and access window. */
export function hasFifteenMinuteExpiry(text = "") {
  return hasWindowedExpiry(text, 15);
}

/** Ten minutes is what this product's own OTP mail, and Netflix's account-change mail, uses. */
export function hasTenMinuteExpiry(text = "") {
  return hasWindowedExpiry(text, 10);
}

/**
 * Is this Netflix's *account change* mail rather than its sign-in mail?
 *
 * The ten-minute window used to be one of the alternatives here, so any message
 * mentioning "10 minutes" anywhere was rejected as an account-change mail --
 * including a sign-in mail that mentioned both ten and fifteen minutes. That
 * also made the `&& !hasFifteenMinuteExpiry` clause at the call site
 * unreachable, because this function had already answered true before it was
 * ever consulted. The clause and the ten-minute question are both alive now:
 * this one answers on the *language* of changing an account, and the call site
 * asks about the window.
 */
export function isNetflixAccountChangeVerification(text = "") {
  const source = String(text || "");
  return /konfirmasikan\s+perubahan\s+akun|perubahan\s+akun(?:mu)?|mengubah\s+informasi\s+akun|kode\s+ini\s+untuk\s+mengonfirmasi|confirm(?:asikan)?\s+(?:(?:your|account)\s+){0,2}(?:perubahan|change)|change\s+(?:your\s+)?account|account\s+information/i.test(source);
}
