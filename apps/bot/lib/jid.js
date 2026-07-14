export function normalizeWhatsAppNumber(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) {
    return "";
  }
  if (digits.startsWith("62")) {
    return digits;
  }
  if (digits.startsWith("0")) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith("8")) {
    return `62${digits}`;
  }
  return digits;
}

export function getJidFromNumber(value = "") {
  const normalized = normalizeWhatsAppNumber(value);
  return normalized ? `${normalized}@s.whatsapp.net` : "";
}

export function getJidFromTarget(value = "") {
  const target = String(value || "").trim();
  if (target.endsWith("@g.us") || target.endsWith("@s.whatsapp.net") || target.endsWith("@lid")) {
    return target;
  }
  return getJidFromNumber(target);
}

export function normalizeGroupJid(value = "") {
  const target = String(value || "").trim();
  if (target.endsWith("@g.us")) {
    return target;
  }
  const digits = target.replace(/[^\d-]/g, "");
  return digits ? `${digits}@g.us` : "";
}

export function isDirectChatJid(value = "") {
  const jidValue = String(value || "").trim();
  return Boolean(jidValue && (jidValue.endsWith("@s.whatsapp.net") || jidValue.endsWith("@lid")));
}

export function isGroupChatJid(value = "") {
  return String(value || "").trim().endsWith("@g.us");
}

export function normalizeInviteLink(value = "") {
  const source = String(value || "").trim().replace(/\?mode=[^\s]+/gi, "");
  const match = source.match(/https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  return match ? `https://chat.whatsapp.com/${match[1]}` : "";
}

export function extractInviteCode(value = "") {
  const link = normalizeInviteLink(value);
  return link.split("/").pop() || "";
}
