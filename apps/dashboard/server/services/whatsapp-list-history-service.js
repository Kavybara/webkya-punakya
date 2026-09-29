function normalizeKeyword(value = "") {
  return String(value || "").trim().toLowerCase();
}

function timeMs(value = "") {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sameGroup(row = {}, groupId = "") {
  const id = String(groupId || "").trim();
  if (!id) return true;
  return [row.groupJid, row.groupId, row.id].some((value) => String(value || "").trim() === id);
}

function groupKey(row = {}) {
  return String(row.groupJid || row.id || row.groupId || "").trim();
}

export function buildWhatsappListHistory({ rentals = [], groupLists = [], auditEvents = [], groupId = "" } = {}) {
  const groups = new Map();
  for (const rental of rentals || []) {
    const key = groupKey(rental);
    if (!key) continue;
    groups.set(key, {
      id: rental.id || key,
      groupJid: rental.groupJid || key,
      name: rental.name || key,
      owner: rental.owner || "",
      contact: rental.contact || "",
    });
  }
  for (const list of groupLists || []) {
    const key = groupKey(list);
    if (!key || groups.has(key)) continue;
    groups.set(key, {
      id: key,
      groupJid: key,
      name: list.groupName || list.name || key,
      owner: "",
      contact: "",
    });
  }

  const items = [];
  for (const event of Array.isArray(auditEvents) ? auditEvents : []) {
    if (!sameGroup(event, groupId)) continue;
    const groupJid = groupKey(event);
    const keyword = normalizeKeyword(event.keyword);
    if (!groupJid || !keyword) continue;
    items.push({
      id: `audit-${timeMs(event.at)}-${groupJid}-${keyword}`,
      source: "audit",
      action: String(event.command || "updatelist").trim().toLowerCase(),
      groupJid,
      groupName: groups.get(groupJid)?.name || groupJid,
      keyword,
      sender: String(event.sender || "").trim(),
      senderName: String(event.senderName || "").trim(),
      textPreview: String(event.textPreview || event.text || "").trim(),
      media: String(event.media || "").trim(),
      updatedAt: event.at || event.createdAt || "",
    });
  }

  const seenAudit = new Set(items.map((item) => `${item.groupJid}:${item.keyword}`));
  for (const group of groupLists || []) {
    if (!sameGroup(group, groupId)) continue;
    const groupJid = groupKey(group);
    for (const entry of group.entries || []) {
      const keyword = normalizeKeyword(entry.keyword);
      if (!groupJid || !keyword || seenAudit.has(`${groupJid}:${keyword}`)) continue;
      items.push({
        id: `snapshot-${groupJid}-${keyword}`,
        source: "snapshot",
        action: "current",
        groupJid,
        groupName: groups.get(groupJid)?.name || group.groupName || group.name || groupJid,
        keyword,
        sender: "",
        senderName: "",
        textPreview: String(entry.text || "").trim().slice(0, 240),
        media: String(entry.media || "").trim(),
        updatedAt: entry.updatedAt || group.updatedAt || "",
      });
    }
  }

  const sortedItems = items
    .sort((left, right) => timeMs(right.updatedAt) - timeMs(left.updatedAt) || left.keyword.localeCompare(right.keyword))
    .slice(0, 100);
  const selectedGroup = groupId ? groups.get(groupId) || sortedItems.find((item) => item.groupJid === groupId) || null : null;

  return {
    group: selectedGroup,
    total: sortedItems.length,
    items: sortedItems,
  };
}
