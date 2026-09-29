import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDefaultListTemplate } from "../../../packages/shared/whatsapp/templates.mjs";

const DEFAULT_FILES = {
  users: {},
  groups: {},
  lists: {},
  rentals: {},
  settings: {
    list_template: getDefaultListTemplate(),
  },
};

function hasLegacyListShape(group = {}) {
  if (!group || typeof group !== "object" || Array.isArray(group) || !group.list || typeof group.list !== "object") {
    return false;
  }
  const listValue = group.list;
  return !("text" in listValue || "content" in listValue || "media" in listValue || "media_path" in listValue || "updated_at" in listValue);
}

function legacyListEntry(entry = {}) {
  return {
    content: {
      text: String(entry.text || "").trim(),
      media: String(entry.media || entry.media_path || "").trim(),
    },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeKeyword(value = "") {
  return String(value || "").trim().toLowerCase();
}

function listEntryTimestamp(entry = {}) {
  const raw = entry.updatedAt || entry.updated_at || entry.addedAt || entry.added_at || "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizedLegacyEntry(entry = {}) {
  return {
    content: {
      text: String(entry.text || entry.content?.text || "").trim(),
      media: String(entry.media || entry.media_path || entry.content?.media || "").trim(),
    },
    updatedAt: entry.updatedAt || entry.updated_at || entry.addedAt || entry.added_at || new Date().toISOString(),
  };
}

function normalizeListGroup(group = {}) {
  const now = new Date().toISOString();
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    return { createdAt: now, updatedAt: now, list: {} };
  }

  if (hasLegacyListShape(group)) {
    return {
      createdAt: group.createdAt || now,
      updatedAt: group.updatedAt || now,
      list: Object.fromEntries(
        Object.entries(group.list || {}).map(([keyword, entry]) => [normalizeKeyword(keyword), normalizedLegacyEntry(entry)]),
      ),
    };
  }

  const metadataKeys = new Set(["createdAt", "updatedAt", "addedAt", "template", "templatelist", "setlist"]);
  const list = {};
  for (const [keyword, entry] of Object.entries(group)) {
    if (metadataKeys.has(keyword) || !entry || typeof entry !== "object") continue;
    list[normalizeKeyword(keyword)] = normalizedLegacyEntry(entry);
  }
  return {
    createdAt: group.createdAt || now,
    updatedAt: group.updatedAt || now,
    list,
  };
}

function mergeListGroups(primary = null, legacy = null) {
  const base = normalizeListGroup(primary || {});
  const mirror = normalizeListGroup(legacy || {});
  const list = { ...(mirror.list || {}) };
  for (const [keyword, entry] of Object.entries(base.list || {})) {
    const existing = list[keyword];
    if (!existing || listEntryTimestamp(entry) >= listEntryTimestamp(existing)) {
      list[keyword] = entry;
    }
  }
  return {
    createdAt: base.createdAt || mirror.createdAt || new Date().toISOString(),
    updatedAt: base.updatedAt || mirror.updatedAt || new Date().toISOString(),
    list,
  };
}

async function deleteMediaFile(fileName) {
  const mediaName = String(fileName || "").trim();
  if (!mediaName) return;
  const target = path.isAbsolute(mediaName)
    ? mediaName
    : path.join(process.cwd(), "database", "media", path.basename(mediaName));
  try {
    await unlink(target);
  } catch {
    // Best effort only; the list data itself already updated.
  }
}

async function readJsonFile(filePath = "") {
  if (!filePath) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstNonEmptyObject(values = [], fallback = {}) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
      return value;
    }
  }
  return fallback;
}

export class JsonStore {
  constructor(dir) {
    this.dir = dir;
    this.writeQueue = Promise.resolve();
    const inferredProjectRoot = path.resolve(this.dir, "..", "..", "..");
    this.projectRoot = inferredProjectRoot;
    this.legacyListPath = path.resolve(process.env.LEGACY_LIST_FILE || path.join(inferredProjectRoot, "database", "list.json"));
    this.legacyBotListPath = path.resolve(process.env.LEGACY_BOT_LIST_FILE || path.join(inferredProjectRoot, "apps", "bot", "database", "lists.json"));
    this.dashboardDbPath = path.resolve(
      process.env.DATABASE_PATH ||
        process.env.DASHBOARD_DATABASE_PATH ||
        path.join(inferredProjectRoot, "kavya-digital-dashboard", "runtime", "kavya-db.json"),
    );
    this.sharedRentalsPath = path.resolve(
      process.env.WHATSAPP_RENTALS_PATH ||
      process.env.WHATSAPP_RENTAL_PATH ||
      path.join(inferredProjectRoot, "apps", "dashboard", "runtime", "whatsapp-database", "rentals.json"),
    );
  }

  file(name) {
    return path.join(this.dir, `${name}.json`);
  }

  async ensure() {
    await mkdir(this.dir, { recursive: true });
    await Promise.all(
      Object.entries(DEFAULT_FILES).map(async ([name, fallback]) => {
        try {
          await readFile(this.file(name), "utf8");
        } catch {
          await this.write(name, fallback);
        }
      }),
    );
    await this.importLegacyListsIfNeeded();
  }

  async read(name, fallback = {}) {
    if (name === "rentals") {
      const sources = await Promise.all([
        readJsonFile(this.sharedRentalsPath),
        readJsonFile(this.file(name)),
      ]);
      return firstNonEmptyObject(sources, fallback);
    }
    try {
      const raw = await readFile(this.file(name), "utf8");
      return raw.trim() ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  async write(name, value) {
    if (name === "rentals") {
      const targetValue = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      await Promise.all([
        this.writeJsonFile(this.sharedRentalsPath, targetValue),
        this.writeJsonFile(this.file(name), targetValue),
      ]);
      return;
    }
    await mkdir(this.dir, { recursive: true });
    const target = this.file(name);
    const tmp = `${target}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  }

  async writeJsonFile(target, value) {
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  }

  async update(name, fallback, updater) {
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.read(name, fallback);
      const next = await updater(current);
      await this.write(name, next);
      return next;
    });
    return this.writeQueue;
  }

  async getGroupList(groupJid) {
    const lists = await this.read("lists", {});
    return normalizeListGroup(lists[groupJid] || {});
  }

  async setGroupListEntry(groupJid, keyword, entry) {
    const normalizedKeyword = String(keyword || "").trim().toLowerCase();
    if (!groupJid || !normalizedKeyword) {
      throw new Error("group_and_keyword_required");
    }

    let oldMedia = "";
    let nextMedia = "";
    const next = await this.update("lists", {}, (lists) => {
      const group = lists[groupJid] || {};
      if (hasLegacyListShape(group)) {
        oldMedia = String(group.list?.[normalizedKeyword]?.content?.media || "").trim();
        group.list[normalizedKeyword] = legacyListEntry(entry);
        if (normalizedKeyword !== "list") {
          delete group[normalizedKeyword];
        }
        group.updatedAt = new Date().toISOString();
        nextMedia = String(group.list?.[normalizedKeyword]?.content?.media || "").trim();
      } else {
        oldMedia = String(group[normalizedKeyword]?.media_path || group[normalizedKeyword]?.media || "").trim();
        group[normalizedKeyword] = {
          text: String(entry.text || "").trim(),
          media: String(entry.media || "").trim(),
          media_path: String(entry.media_path || "").trim(),
          updated_at: new Date().toISOString(),
        };
        nextMedia = String(group[normalizedKeyword]?.media_path || group[normalizedKeyword]?.media || "").trim();
      }
      lists[groupJid] = group;
      return lists;
    });
    if (oldMedia && oldMedia !== nextMedia) {
      await deleteMediaFile(oldMedia);
    }
    await this.mirrorLegacyListEntry(groupJid, normalizedKeyword, entry);
    await this.mirrorDashboardListEntry(groupJid, normalizedKeyword, entry);
    return next;
  }

  async deleteGroupListEntry(groupJid, keyword) {
    const normalizedKeyword = String(keyword || "").trim().toLowerCase();
    const next = await this.update("lists", {}, (lists) => {
      if (lists[groupJid]) {
        if (hasLegacyListShape(lists[groupJid])) {
          delete lists[groupJid].list[normalizedKeyword];
          if (normalizedKeyword !== "list") {
            delete lists[groupJid][normalizedKeyword];
          }
          lists[groupJid].updatedAt = new Date().toISOString();
          return lists;
        }
        delete lists[groupJid][normalizedKeyword];
      }
      return lists;
    });
    await this.mirrorLegacyListDelete(groupJid, normalizedKeyword);
    await this.mirrorDashboardListDelete(groupJid, normalizedKeyword);
    return next;
  }

  async resetGroupList(groupJid) {
    const next = await this.update("lists", {}, (lists) => {
      const group = lists[groupJid] || {};
      if (hasLegacyListShape(group)) {
        group.list = {};
        group.updatedAt = new Date().toISOString();
        lists[groupJid] = group;
      } else {
        lists[groupJid] = {};
      }
      return lists;
    });
    await this.mirrorLegacyListReset(groupJid);
    await this.mirrorDashboardListReset(groupJid);
    return next;
  }

  async renameGroupListEntry(groupJid, fromKeyword, toKeyword) {
    const from = String(fromKeyword || "").trim().toLowerCase();
    const to = String(toKeyword || "").trim().toLowerCase();
    const next = await this.update("lists", {}, (lists) => {
      const group = lists[groupJid] || {};
      if (hasLegacyListShape(group)) {
        if (!group.list[from]) {
          throw new Error("keyword_not_found");
        }
        group.list[to] = { ...group.list[from], updatedAt: new Date().toISOString() };
        delete group.list[from];
        if (from !== "list") {
          delete group[from];
        }
        group.updatedAt = new Date().toISOString();
        lists[groupJid] = group;
        return lists;
      }
      if (!group[from]) {
        throw new Error("keyword_not_found");
      }
      group[to] = { ...group[from], updated_at: new Date().toISOString() };
      delete group[from];
      lists[groupJid] = group;
      return lists;
    });
    await this.mirrorLegacyListRename(groupJid, from, to);
    await this.mirrorDashboardListRename(groupJid, from, to);
    return next;
  }

  async appendListUpdateAudit(event = {}) {
    const entry = {
      at: new Date().toISOString(),
      command: String(event.command || "").trim().toLowerCase(),
      groupJid: String(event.groupJid || "").trim(),
      keyword: normalizeKeyword(event.keyword),
      sender: String(event.sender || "").trim(),
      senderName: String(event.senderName || "").trim(),
      textPreview: String(event.text || "").trim().slice(0, 240),
      media: String(event.media || "").trim(),
    };
    if (!entry.groupJid || !entry.keyword) return { skipped: true };
    const next = await this.update("list-updates", [], (events) => {
      const list = Array.isArray(events) ? events : [];
      list.push(entry);
      return list.slice(-5000);
    });
    return { count: Array.isArray(next) ? next.length : 0, entry };
  }

  async readLegacyLists() {
    const merged = {};
    for (const legacyPath of [this.legacyBotListPath, this.legacyListPath]) {
      try {
        const raw = await readFile(legacyPath, "utf8");
        const parsed = raw.trim() ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        for (const [groupJid, legacyGroup] of Object.entries(parsed)) {
          merged[groupJid] = mergeListGroups(merged[groupJid] || {}, legacyGroup);
        }
      } catch {
        continue;
      }
    }
    return merged;
  }

  async writeLegacyLists(lists) {
    await Promise.all([this.legacyListPath, this.legacyBotListPath].map(async (target) => {
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${Date.now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(lists, null, 2)}\n`, "utf8");
      await rename(tmp, target);
    }));
  }

  async updateLegacyLists(updater) {
    try {
      const lists = await this.readLegacyLists();
      const next = await updater(lists);
      await this.writeLegacyLists(next);
    } catch {
      // Primary Kavya list storage has already been saved; legacy mirror is best-effort.
    }
  }

  async mirrorLegacyListEntry(groupJid, keyword, entry = {}) {
    const normalizedKeyword = normalizeKeyword(keyword);
    if (!groupJid || !normalizedKeyword) return { groupJid, keyword, entry, skipped: true };
    await this.updateLegacyLists((lists) => {
      const group = normalizeListGroup(lists[groupJid] || {});
      group.list[normalizedKeyword] = legacyListEntry(entry);
      group.updatedAt = new Date().toISOString();
      lists[groupJid] = group;
      return lists;
    });
    return { groupJid, keyword: normalizedKeyword, entry };
  }

  async mirrorLegacyListDelete(groupJid, keyword) {
    const normalizedKeyword = normalizeKeyword(keyword);
    if (!groupJid || !normalizedKeyword) return { groupJid, keyword, skipped: true };
    await this.updateLegacyLists((lists) => {
      const group = normalizeListGroup(lists[groupJid] || {});
      delete group.list[normalizedKeyword];
      group.updatedAt = new Date().toISOString();
      lists[groupJid] = group;
      return lists;
    });
    return { groupJid, keyword: normalizedKeyword };
  }

  async mirrorLegacyListReset(groupJid) {
    if (!groupJid) return { groupJid, skipped: true };
    await this.updateLegacyLists((lists) => {
      const group = normalizeListGroup(lists[groupJid] || {});
      group.list = {};
      group.updatedAt = new Date().toISOString();
      lists[groupJid] = group;
      return lists;
    });
    return { groupJid };
  }

  async mirrorLegacyListRename(groupJid, fromKeyword, toKeyword) {
    const from = normalizeKeyword(fromKeyword);
    const to = normalizeKeyword(toKeyword);
    if (!groupJid || !from || !to) return { groupJid, fromKeyword, toKeyword, skipped: true };
    await this.updateLegacyLists((lists) => {
      const group = normalizeListGroup(lists[groupJid] || {});
      if (!group.list[from]) return lists;
      group.list[to] = { ...group.list[from], updatedAt: new Date().toISOString() };
      delete group.list[from];
      group.updatedAt = new Date().toISOString();
      lists[groupJid] = group;
      return lists;
    });
    return { groupJid, fromKeyword: from, toKeyword: to };
  }

  async updateDashboardGroupLists(updater) {
    try {
      const db = await readJsonFile(this.dashboardDbPath);
      if (!db || typeof db !== "object" || Array.isArray(db)) return { skipped: true, reason: "dashboard_db_missing" };
      db.whatsappGroupLists = Array.isArray(db.whatsappGroupLists) ? db.whatsappGroupLists : [];
      const result = await updater(db);
      await this.writeJsonFile(this.dashboardDbPath, db);
      return result || { ok: true };
    } catch {
      return { skipped: true, reason: "dashboard_db_write_failed" };
    }
  }

  async mirrorDashboardListEntry(groupJid, keyword, entry = {}) {
    const normalizedKeyword = normalizeKeyword(keyword);
    if (!groupJid || !normalizedKeyword) return { groupJid, keyword, skipped: true };
    return this.updateDashboardGroupLists((db) => {
      let row = db.whatsappGroupLists.find((item) => item.groupJid === groupJid);
      if (!row) {
        row = { groupJid, total: 0, updatedAt: new Date().toISOString(), template: "", entries: [] };
        db.whatsappGroupLists.unshift(row);
      }
      row.entries = Array.isArray(row.entries) ? row.entries : [];
      const now = new Date().toISOString();
      const nextEntry = {
        keyword: normalizedKeyword,
        text: String(entry.text || "").trim(),
        media: String(entry.media || entry.media_path || "").trim(),
        updatedAt: now,
      };
      const index = row.entries.findIndex((item) => normalizeKeyword(item.keyword) === normalizedKeyword);
      if (index >= 0) row.entries[index] = { ...row.entries[index], ...nextEntry };
      else row.entries.push(nextEntry);
      row.total = row.entries.length;
      row.updatedAt = now;
      return { ok: true, groupJid, keyword: normalizedKeyword };
    });
  }

  async mirrorDashboardListDelete(groupJid, keyword) {
    const normalizedKeyword = normalizeKeyword(keyword);
    if (!groupJid || !normalizedKeyword) return { groupJid, keyword, skipped: true };
    return this.updateDashboardGroupLists((db) => {
      const row = db.whatsappGroupLists.find((item) => item.groupJid === groupJid);
      if (!row) return { skipped: true, reason: "group_missing" };
      row.entries = (Array.isArray(row.entries) ? row.entries : []).filter((item) => normalizeKeyword(item.keyword) !== normalizedKeyword);
      row.total = row.entries.length;
      row.updatedAt = new Date().toISOString();
      return { ok: true, groupJid, keyword: normalizedKeyword };
    });
  }

  async mirrorDashboardListReset(groupJid) {
    if (!groupJid) return { groupJid, skipped: true };
    return this.updateDashboardGroupLists((db) => {
      const row = db.whatsappGroupLists.find((item) => item.groupJid === groupJid);
      if (!row) return { skipped: true, reason: "group_missing" };
      row.entries = [];
      row.total = 0;
      row.updatedAt = new Date().toISOString();
      return { ok: true, groupJid };
    });
  }

  async mirrorDashboardListRename(groupJid, fromKeyword, toKeyword) {
    const from = normalizeKeyword(fromKeyword);
    const to = normalizeKeyword(toKeyword);
    if (!groupJid || !from || !to) return { groupJid, fromKeyword, toKeyword, skipped: true };
    return this.updateDashboardGroupLists((db) => {
      const row = db.whatsappGroupLists.find((item) => item.groupJid === groupJid);
      if (!row) return { skipped: true, reason: "group_missing" };
      row.entries = Array.isArray(row.entries) ? row.entries : [];
      const item = row.entries.find((entry) => normalizeKeyword(entry.keyword) === from);
      if (!item) return { skipped: true, reason: "keyword_missing" };
      item.keyword = to;
      item.updatedAt = new Date().toISOString();
      row.updatedAt = item.updatedAt;
      return { ok: true, groupJid, fromKeyword: from, toKeyword: to };
    });
  }

  async importLegacyListsIfNeeded() {
    const [modernLists, legacyLists] = await Promise.all([this.read("lists", {}), this.readLegacyLists()]);
    const modern = modernLists && typeof modernLists === "object" ? modernLists : {};
    if (Object.keys(modern).length) {
      return modern;
    }
    const legacy = legacyLists && typeof legacyLists === "object" ? legacyLists : {};
    const merged = { ...modern };
    let changed = false;

    for (const [groupJid, legacyGroup] of Object.entries(legacy)) {
      const primary = modern[groupJid] || {};
      const mergedGroup = mergeListGroups(primary, legacyGroup);
      const baseKeys = new Set(Object.keys(normalizeListGroup(primary).list || {}));
      const legacyKeys = Object.keys(normalizeListGroup(legacyGroup).list || {});
      if (!modern[groupJid] || legacyKeys.some((keyword) => !baseKeys.has(keyword))) {
        changed = true;
      }
      merged[groupJid] = mergedGroup;
    }

    if (changed) {
      await this.write("lists", merged);
    }
    return merged;
  }
}
