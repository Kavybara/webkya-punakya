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
  return Boolean(group && typeof group === "object" && !Array.isArray(group) && group.list && typeof group.list === "object");
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

  const metadataKeys = new Set(["createdAt", "updatedAt", "addedAt", "list", "template", "templatelist", "setlist"]);
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
  return {
    createdAt: base.createdAt || mirror.createdAt || new Date().toISOString(),
    updatedAt: base.updatedAt || mirror.updatedAt || new Date().toISOString(),
    list: {
      ...(mirror.list || {}),
      ...(base.list || {}),
    },
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
    this.legacyListPath = path.resolve(process.env.LEGACY_LIST_FILE || path.join(process.cwd(), "database", "list.json"));
    this.legacyBotListPath = path.resolve(path.join(process.cwd(), "apps", "bot", "database", "lists.json"));
    const inferredProjectRoot = path.resolve(this.dir, "..", "..", "..");
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
        delete group[normalizedKeyword];
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
    return next;
  }

  async deleteGroupListEntry(groupJid, keyword) {
    const normalizedKeyword = String(keyword || "").trim().toLowerCase();
    const next = await this.update("lists", {}, (lists) => {
      if (lists[groupJid]) {
        if (hasLegacyListShape(lists[groupJid])) {
          delete lists[groupJid].list[normalizedKeyword];
          delete lists[groupJid][normalizedKeyword];
          lists[groupJid].updatedAt = new Date().toISOString();
          return lists;
        }
        delete lists[groupJid][normalizedKeyword];
      }
      return lists;
    });
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
        delete group[from];
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
    return next;
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
    await mkdir(path.dirname(this.legacyListPath), { recursive: true });
    const target = this.legacyListPath;
    const tmp = `${target}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(lists, null, 2)}\n`, "utf8");
    await rename(tmp, target);
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
    return { groupJid, keyword, entry };
  }

  async mirrorLegacyListDelete(groupJid, keyword) {
    return { groupJid, keyword };
  }

  async mirrorLegacyListReset(groupJid) {
    return { groupJid };
  }

  async mirrorLegacyListRename(groupJid, fromKeyword, toKeyword) {
    return { groupJid, fromKeyword, toKeyword };
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
