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
