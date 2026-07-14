const DEPOSIT_KEYWORD_REGEX =
  /\b(deposit|depo|top\s*up|topup|bukti\s*tf|bukti\s*transfer|transfer)\b/i;

const DEPOSIT_MEDIA_TYPES = new Set(["image", "video", "document"]);

function hasDepositKeyword(text = "") {
  return DEPOSIT_KEYWORD_REGEX.test(String(text || "").trim());
}

function hasDepositMedia(messageInfo = {}) {
  const { type, isQuoted } = messageInfo;

  if (DEPOSIT_MEDIA_TYPES.has(type)) return true;
  if (isQuoted && DEPOSIT_MEDIA_TYPES.has(isQuoted.type)) return true;

  return false;
}

function isDepositProofMessage(messageInfo = {}) {
  const { prefix, fullText } = messageInfo;

  if (prefix) return false;
  if (!hasDepositMedia(messageInfo)) return false;

  return hasDepositKeyword(fullText);
}

export { hasDepositKeyword, isDepositProofMessage };
