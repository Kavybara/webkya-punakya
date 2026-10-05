import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import { defaultData } from "./default-data.js";
import { registerLogSecrets } from "../../../packages/shared/observability.mjs";

const rootDir = process.cwd();
const runtimeDir = process.env.RUNTIME_PATH || path.join(rootDir, "runtime");
export const databasePath = process.env.DATABASE_PATH || path.join(runtimeDir, "kavya-db.json");
const dbEvents = new EventEmitter();
dbEvents.setMaxListeners(100);
let dbVersion = 0;
let mutationQueue = Promise.resolve();
let cachedDb = null;
let cachedMtimeMs = -1;
let loadInFlight = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeMissing(target, source) {
  let changed = false;
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined) {
      target[key] = clone(value);
      changed = true;
    }
  }
  return changed;
}

function queueMutation(task) {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.catch(() => undefined);
  return run;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFile(filePath) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw = await fs.readFile(filePath, "utf8");
    try {
      return JSON.parse(raw);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await delay(25 * (attempt + 1));
    }
  }
  const error = new Error(`Database JSON is invalid or incomplete at ${filePath}: ${lastError.message}`);
  error.cause = lastError;
  throw error;
}

async function renameWithRetry(source, target) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!["EACCES", "EBUSY", "EPERM"].includes(error.code) || attempt === 9) throw error;
      await delay(15 * (attempt + 1));
    }
  }
  throw lastError;
}

async function writeJsonFileAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
  const payload = JSON.stringify(value, null, 2);
  try {
    await fs.writeFile(tempPath, payload, { mode: 0o600 });
    await renameWithRetry(tempPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => undefined);
    if (filePath === databasePath) {
      registerLogSecrets(value.settings || {});
      cachedDb = clone(value);
      cachedMtimeMs = (await fs.stat(filePath)).mtimeMs;
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function loadDbUnlocked(options = {}) {
  const persistMissing = Boolean(options.persistMissing);
  if (persistMissing) {
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
  }
  try {
    const stat = await fs.stat(databasePath);
    if (cachedDb && cachedMtimeMs === stat.mtimeMs) return clone(cachedDb);
    if (!loadInFlight) {
      loadInFlight = (async () => {
        const db = await readJsonFile(databasePath);
        registerLogSecrets(db.settings || {});
        if (mergeMissing(db, defaultData) && persistMissing) {
          await writeJsonFileAtomic(databasePath, db);
        } else {
          cachedDb = clone(db);
          cachedMtimeMs = stat.mtimeMs;
        }
        return db;
      })().finally(() => {
        loadInFlight = null;
      });
    }
    return clone(await loadInFlight);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const db = clone(defaultData);
    if (persistMissing) await writeJsonFileAtomic(databasePath, db);
    return db;
  }
}

export async function ensureDb() {
  await mutationQueue;
  await loadDbUnlocked({ persistMissing: true });
  await fs.chmod(path.dirname(databasePath), 0o700).catch(() => undefined);
  await fs.chmod(databasePath, 0o600).catch(() => undefined);
}

export async function readDb() {
  return loadDbUnlocked();
}

export async function readDbSnapshot() {
  const db = await loadDbUnlocked();
  return clone(db);
}

export function getDbVersion() {
  return dbVersion;
}

export function onDbChange(listener) {
  dbEvents.on("change", listener);
  return () => dbEvents.off("change", listener);
}

function publishDbChange(reason = "db:update") {
  dbVersion += 1;
  dbEvents.emit("change", {
    type: reason,
    version: dbVersion,
    at: nowText(),
  });
}

export async function writeDb(db, options = {}) {
  return queueMutation(async () => {
    await writeJsonFileAtomic(databasePath, db);
    if (options.notify) publishDbChange(options.reason);
    return db;
  });
}

export async function updateDb(mutator) {
  return queueMutation(async () => {
    const db = await loadDbUnlocked();
    const result = await mutator(db);
    await writeJsonFileAtomic(databasePath, db);
    publishDbChange("db:update");
    return result;
  });
}

export function makeId(prefix) {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${stamp}-${random}`;
}

export function nowText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function todayText() {
  return nowText().slice(0, 10);
}
