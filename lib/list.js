import fs, { unlink } from "fs/promises";
import path from "path";
import { deleteCache, getCache, setCache } from "./globalCache.js";
import { cleanText, logWithTime } from "./utils.js";

const projectRoot = process.cwd();
const legacyListFilePaths = [
  path.resolve(process.env.LEGACY_LIST_FILE || path.join(projectRoot, "database", "list.json")),
  path.resolve(path.join(projectRoot, "apps", "bot", "database", "lists.json")),
];
const modernListFilePath = path.resolve(
  process.env.WHATSAPP_LIST_FILE ||
    path.join(process.env.WHATSAPP_DATABASE_DIR || path.join(projectRoot, "apps", "bot", "database"), "lists.json"),
);

const metadataKeys = new Set(["createdAt", "updatedAt", "addedAt", "list", "template", "templatelist", "setlist"]);
let modernWriteQueue = Promise.resolve();
let legacyImportDone = false;

function normalizeKeyword(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeContent(content = {}) {
  return {
    text: cleanText(String(content?.text || content?.content?.text || "")),
    media: cleanText(String(content?.media || content?.media_path || content?.mediaPath || content?.content?.media || "")),
  };
}

function hasLegacyListShape(group = {}) {
  return Boolean(group && typeof group === "object" && !Array.isArray(group) && group.list && typeof group.list === "object");
}

function toLegacyEntry(entry = {}) {
  return {
    content: normalizeContent(entry),
    updatedAt: entry?.updatedAt || entry?.updated_at || new Date().toISOString(),
  };
}

function normalizeGroupToLegacy(group = {}) {
  const now = new Date().toISOString();
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    return { createdAt: now, updatedAt: now, list: {} };
  }

  if (hasLegacyListShape(group)) {
    return {
      createdAt: group.createdAt || now,
      updatedAt: group.updatedAt || now,
      list: Object.fromEntries(
        Object.entries(group.list || {}).map(([keyword, entry]) => [normalizeKeyword(keyword), toLegacyEntry(entry)]),
      ),
    };
  }

  const list = {};
  for (const [keyword, entry] of Object.entries(group)) {
    if (metadataKeys.has(keyword) || !entry || typeof entry !== "object") continue;
    list[normalizeKeyword(keyword)] = toLegacyEntry(entry);
  }

  return {
    createdAt: group.createdAt || now,
    updatedAt: group.updatedAt || now,
    list,
  };
}

function mergeLegacyGroups(primary = null, secondary = null) {
  const base = normalizeGroupToLegacy(primary || {});
  const mirror = normalizeGroupToLegacy(secondary || {});
  return {
    createdAt: base.createdAt || mirror.createdAt || new Date().toISOString(),
    updatedAt: base.updatedAt || mirror.updatedAt || new Date().toISOString(),
    list: {
      ...(mirror.list || {}),
      ...(base.list || {}),
    },
  };
}

async function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${Date.now()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

async function deleteMediaFile(fileName) {
  const mediaName = String(fileName || "").trim();
  if (!mediaName) return;
  const target = path.join(process.cwd(), "database", "media", mediaName);
  try {
    await unlink(target);
  } catch {
    // Best effort only; the list entry has already been replaced.
  }
}

async function queueModernWrite(task) {
  modernWriteQueue = modernWriteQueue.then(task, task);
  return modernWriteQueue;
}

async function readModernList() {
  return readJsonFile(modernListFilePath, {});
}

async function readLegacyListSources() {
  const sources = [];
  for (const filePath of legacyListFilePaths) {
    const value = await readJsonFile(filePath, {});
    if (value && typeof value === "object" && !Array.isArray(value)) {
      sources.push(value);
    }
  }
  return sources;
}

function groupHasLegacyImport(primary = {}, legacy = {}) {
  const base = normalizeGroupToLegacy(primary || {});
  const mirror = normalizeGroupToLegacy(legacy || {});
  return Object.keys(mirror.list || {}).some((keyword) => !base.list[keyword]);
}

async function importLegacyListsIfNeeded(modernLists = {}) {
  if (legacyImportDone) {
    return modernLists && typeof modernLists === "object" && !Array.isArray(modernLists) ? modernLists : {};
  }

  const modern = modernLists && typeof modernLists === "object" && !Array.isArray(modernLists) ? modernLists : {};
  const legacySources = await readLegacyListSources();
  if (!legacySources.some((source) => Object.keys(source || {}).length)) {
    legacyImportDone = true;
    return modern;
  }

  const merged = { ...modern };
  let changed = false;
  for (const legacyGroups of legacySources) {
    for (const [groupId, legacyGroup] of Object.entries(legacyGroups)) {
      const currentGroup = merged[groupId];
      const nextGroup = mergeLegacyGroups(currentGroup, legacyGroup);
      merged[groupId] = nextGroup;
      if (!currentGroup || groupHasLegacyImport(currentGroup, legacyGroup)) {
        changed = true;
      }
    }
  }

  legacyImportDone = true;
  if (changed) {
    await queueModernWrite(async () => {
      await writeJsonFile(modernListFilePath, merged);
      return merged;
    });
    deleteCache("list-group");
  }

  return merged;
}

async function readList() {
  try {
    const cachedData = getCache("list-group");
    if (cachedData) {
      return cachedData.data;
    }
    const currentList = await importLegacyListsIfNeeded(await readModernList());
    setCache("list-group", currentList);
    return currentList;
  } catch (error) {
    console.error("Error reading list file:", error);
    throw error;
  }
}

async function getDataByGroupId(groupId) {
  try {
    const currentList = await readList();
    const group = currentList[groupId];
    return group ? mergeLegacyGroups(group, null) : null;
  } catch (error) {
    console.error("Error membaca data grup:", error);
    throw error;
  }
}

async function saveList(data) {
  try {
    const next = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    await queueModernWrite(async () => {
      await writeJsonFile(modernListFilePath, next);
      return next;
    });
    deleteCache("list-group");
    logWithTime("UPDATE CACHE FILE", "lists.json", "biru");
  } catch (error) {
    console.error("Error saving list file:", error);
    throw error;
  }
}

async function addList(id_grub, keyword, content) {
  try {
    const groups = await readList();
    const normalizedKeyword = normalizeKeyword(keyword);
    const currentGroup = await getDataByGroupId(id_grub);

    if (!groups[id_grub]) {
      groups[id_grub] = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        list: {},
      };
    }
    groups[id_grub].list = groups[id_grub].list && typeof groups[id_grub].list === "object" ? groups[id_grub].list : {};

    if (currentGroup?.list?.[normalizedKeyword]) {
      return {
        success: false,
        message: `Keyword "${normalizedKeyword}" already exists.`,
      };
    }
    if (content && content.text) {
      content.text = cleanText(content.text);
    }

    groups[id_grub].list[normalizedKeyword] = {
      content,
      addedAt: new Date().toISOString(),
    };
    groups[id_grub].updatedAt = new Date().toISOString();

    await saveList(groups);
    return { success: true, message: "Keyword added successfully." };
  } catch (error) {
    console.error("Error adding to list:", error);
    return { success: false, message: "Error adding to list." };
  }
}

async function updateList(id_grub, keyword, content) {
  try {
    const groups = await readList();
    const normalizedKeyword = normalizeKeyword(keyword);
    const currentGroup = await getDataByGroupId(id_grub);
    const existingMedia = String(currentGroup?.list?.[normalizedKeyword]?.content?.media || "").trim();
    const nextMedia = String(content?.media || "").trim();

    if (!groups[id_grub]) {
      groups[id_grub] = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        list: {},
      };
    }
    groups[id_grub].list = groups[id_grub].list && typeof groups[id_grub].list === "object" ? groups[id_grub].list : {};

    if (currentGroup?.list?.[normalizedKeyword]) {
      groups[id_grub].list[normalizedKeyword] = {
        content,
        updatedAt: new Date().toISOString(),
      };
      if (existingMedia && existingMedia !== nextMedia) {
        await deleteMediaFile(existingMedia);
      }
    } else {
      return {
        success: false,
        message: `Keyword "${normalizedKeyword}" tidak ditemukan!`,
      };
    }

    groups[id_grub].updatedAt = new Date().toISOString();
    await saveList(groups);
    return {
      success: true,
      message: `Keyword "${normalizedKeyword}" processed successfully.`,
    };
  } catch (error) {
    console.error("Error updating list:", error);
    return { success: false, message: "Error updating list." };
  }
}

async function updateKeyword(id_grub, oldKeyword, newKeyword) {
  try {
    const groups = await readList();
    const oldKey = normalizeKeyword(oldKeyword);
    const newKey = normalizeKeyword(newKeyword);
    const currentGroup = await getDataByGroupId(id_grub);

    if (!currentGroup) {
      return {
        success: false,
        message: `Group with ID "${id_grub}" does not exist.`,
      };
    }

    if (!currentGroup.list[oldKey]) {
      return {
        success: false,
        message: `Keyword "${oldKey}" tidak ditemukan`,
      };
    }

    if (currentGroup.list[newKey]) {
      return {
        success: false,
        message: `Keyword "${newKey}" sudah digunakan.`,
      };
    }

    if (!groups[id_grub]) {
      groups[id_grub] = {
        createdAt: currentGroup.createdAt || new Date().toISOString(),
        updatedAt: currentGroup.updatedAt || new Date().toISOString(),
        list: {},
      };
    }
    groups[id_grub].list = groups[id_grub].list && typeof groups[id_grub].list === "object" ? groups[id_grub].list : {};
    groups[id_grub].list[oldKey] = groups[id_grub].list[oldKey] || currentGroup.list[oldKey];
    groups[id_grub].list[newKey] = {
      ...groups[id_grub].list[oldKey],
      updatedAt: new Date().toISOString(),
    };
    delete groups[id_grub].list[oldKey];
    groups[id_grub].updatedAt = new Date().toISOString();

    await saveList(groups);
    return { success: true, message: "Keyword berhasil di perbarui" };
  } catch (error) {
    return { success: false, message: "Error memperbarui keyword" };
  }
}

async function deleteList(id_grub, keyword) {
  try {
    const groups = await readList();
    const normalizedKeyword = normalizeKeyword(keyword);
    const currentGroup = await getDataByGroupId(id_grub);

    if (!currentGroup) {
      return { success: false, message: `Group "${id_grub}" does not exist.` };
    }

    if (!currentGroup.list[normalizedKeyword]) {
      return {
        success: false,
        message: `Keyword "${normalizedKeyword}" does not exist in group "${id_grub}".`,
      };
    }

    const media = currentGroup.list[normalizedKeyword].content.media;
    if (media) {
      const filePath = `./database/media/${media}`;
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error.code === "ENOENT") {
          console.log(`File ${media} tidak ditemukan.`);
        } else {
          console.error(`Gagal menghapus file ${media}:`, error);
        }
      }
    }

    if (!groups[id_grub]) {
      groups[id_grub] = {
        createdAt: currentGroup.createdAt || new Date().toISOString(),
        updatedAt: currentGroup.updatedAt || new Date().toISOString(),
        list: {},
      };
    }
    groups[id_grub].list = groups[id_grub].list && typeof groups[id_grub].list === "object" ? groups[id_grub].list : {};
    delete groups[id_grub].list[normalizedKeyword];
    groups[id_grub].updatedAt = new Date().toISOString();

    await saveList(groups);
    return {
      success: true,
      message: `Keyword "${normalizedKeyword}" deleted successfully.`,
    };
  } catch (error) {
    console.error("Error deleting from list:", error);
    return { success: false, message: "Error deleting from list." };
  }
}

async function deleteAllListInGroup(id_grub) {
  try {
    const groups = await readList();
    const currentGroup = await getDataByGroupId(id_grub);

    if (!currentGroup) {
      return { success: false, message: `Group "${id_grub}" does not exist.` };
    }

    const list = currentGroup.list;
    const mediaDir = "./database/media/";

    for (const keyword in list) {
      const media = list[keyword]?.content?.media;
      if (media) {
        const filePath = path.join(mediaDir, media);
        try {
          await fs.unlink(filePath);
          console.log(`File media "${media}" berhasil dihapus.`);
        } catch (error) {
          if (error.code !== "ENOENT") {
            console.error(`Gagal menghapus file media "${media}":`, error);
          } else {
            console.log(`File "${media}" tidak ditemukan.`);
          }
        }
      }
    }

    if (!groups[id_grub]) {
      groups[id_grub] = {
        createdAt: currentGroup.createdAt || new Date().toISOString(),
        updatedAt: currentGroup.updatedAt || new Date().toISOString(),
        list: {},
      };
    }
    groups[id_grub].list = {};
    groups[id_grub].updatedAt = new Date().toISOString();

    await saveList(groups);
    return {
      success: true,
      message: `Semua keyword dalam group "${id_grub}" berhasil dihapus.`,
    };
  } catch (error) {
    console.error("Error deleting all list in group:", error);
    return { success: false, message: "Gagal menghapus semua keyword." };
  }
}

export {
  readList,
  addList,
  getDataByGroupId,
  deleteList,
  updateKeyword,
  updateList,
  deleteAllListInGroup,
};
