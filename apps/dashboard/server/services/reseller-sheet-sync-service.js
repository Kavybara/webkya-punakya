export function normalizeResellerSheetUsername(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function resellerSheetWhatsapp(value = "") {
  return String(value || "").trim();
}

export function planResellerSheetSync(resellers = [], sheetRows = []) {
  const byUsername = new Map();
  const duplicateUsernames = new Set();
  const phoneOwners = new Map();
  for (const row of sheetRows) {
    const username = normalizeResellerSheetUsername(row.seller);
    if (!username) continue;
    const list = byUsername.get(username) || [];
    list.push(row);
    byUsername.set(username, list);
    if (list.length > 1) duplicateUsernames.add(username);
    const whatsapp = resellerSheetWhatsapp(row.whatsapp);
    if (whatsapp) {
      const owners = phoneOwners.get(whatsapp) || new Set();
      owners.add(username);
      phoneOwners.set(whatsapp, owners);
    }
  }

  const result = {
    checked: 0,
    added: [],
    updated: [],
    skipped: [],
    conflicts: [],
  };
  const seenDbUsernames = new Set();
  for (const reseller of resellers) {
    result.checked += 1;
    const username = normalizeResellerSheetUsername(reseller.username);
    const whatsapp = resellerSheetWhatsapp(reseller.whatsapp);
    if (!username) {
      result.conflicts.push({ type: "missing_username", resellerId: reseller.id || "" });
      continue;
    }
    if (seenDbUsernames.has(username)) {
      result.conflicts.push({ type: "duplicate_database_username", username, resellerId: reseller.id || "" });
      continue;
    }
    seenDbUsernames.add(username);
    if (!whatsapp) {
      result.skipped.push({ type: "missing_whatsapp", username, resellerId: reseller.id || "" });
      continue;
    }
    const rows = byUsername.get(username) || [];
    if (rows.length > 1 || duplicateUsernames.has(username)) {
      result.conflicts.push({ type: "duplicate_sheet_username", username, rows: rows.map((row) => row.rowNumber) });
      continue;
    }
    const phoneUsers = phoneOwners.get(whatsapp);
    if (phoneUsers && [...phoneUsers].some((owner) => owner !== username)) {
      result.conflicts.push({ type: "shared_whatsapp", username, whatsapp, usernames: [...phoneUsers] });
      continue;
    }
    if (!rows.length) {
      result.added.push({ username, whatsapp, resellerId: reseller.id || "" });
      continue;
    }
    const current = resellerSheetWhatsapp(rows[0].whatsapp);
    if (current !== whatsapp) {
      result.updated.push({ username, whatsapp, previousWhatsapp: current, rowNumber: rows[0].rowNumber, resellerId: reseller.id || "" });
    } else {
      result.skipped.push({ type: "unchanged", username, rowNumber: rows[0].rowNumber, resellerId: reseller.id || "" });
    }
  }
  return result;
}
