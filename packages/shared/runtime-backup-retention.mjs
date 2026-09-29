export function isRuntimeBackupArtifactName(fileName = "") {
  const name = String(fileName || "").trim();
  return /^(?:File Backup(?:-[^/\\]+)?|(?:kavya|vya)-runtime-backup-[^/\\]+)(?:\.json|\.tar\.gz)(?:\.enc)?$/i.test(name);
}

export function selectRuntimeBackupRemovals(entries = [], options = {}) {
  const keep = Math.max(1, Number(options.keep || 30));
  const maxAgeMs = Math.max(1, Number(options.maxAgeMs || 7 * 24 * 60 * 60 * 1000));
  const now = Number(options.now || Date.now());
  const cutoff = now - maxAgeMs;
  const preserveNames = new Set((options.preserveNames || []).map((name) => String(name || "").trim()).filter(Boolean));
  return (entries || [])
    .filter((entry) => isRuntimeBackupArtifactName(entry?.name))
    .filter((entry) => !preserveNames.has(String(entry?.name || "").trim()))
    .sort((left, right) => Number(right.mtimeMs || 0) - Number(left.mtimeMs || 0))
    .filter((entry, index) => index >= keep || Number(entry.mtimeMs || 0) <= cutoff);
}

export function selectRuntimeBackupPostSendRemovals(entries = [], options = {}) {
  const createdNames = new Set((options.createdNames || []).map((name) => String(name || "").trim()).filter(Boolean));
  const sent = Boolean(options.sent);
  const deleteAfterSend = Boolean(options.deleteAfterSend);
  const selected = [];
  const selectedNames = new Set();

  function add(entry) {
    const name = String(entry?.name || "").trim();
    if (!name || selectedNames.has(name) || !isRuntimeBackupArtifactName(name)) return;
    selected.push(entry);
    selectedNames.add(name);
  }

  if (sent && deleteAfterSend) {
    for (const entry of entries || []) {
      if (createdNames.has(String(entry?.name || "").trim())) add(entry);
    }
  }

  const preserveNames = sent && deleteAfterSend ? new Set() : createdNames;
  for (const entry of selectRuntimeBackupRemovals(entries, options)) {
    if (preserveNames.has(String(entry?.name || "").trim())) continue;
    add(entry);
  }

  return selected;
}
