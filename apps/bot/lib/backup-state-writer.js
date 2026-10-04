import fs from "node:fs/promises";
import path from "node:path";

/**
 * Records the outcome of each scheduled backup into the dashboard database, so
 * the owner can see that backups ran without having to ask the bot process.
 *
 * The bot is a second writer on `kavya-db.json`. That file is the money path:
 * orders, balances and reseller accounts live in it, and the dashboard mutates
 * it constantly through `store.js`. A queue inside the dashboard protects the
 * dashboard's own writes from each other and says nothing about ours, so the
 * naive "read, patch, write" here would silently delete a customer's order
 * whenever the two processes happened to overlap.
 *
 * Optimistic concurrency is the only defence available across processes: after
 * computing the patched database but before renaming it over the original, we
 * check the file is still byte-identical to what we read. If it is not, another
 * writer got there first, and we discard our work and start over from their
 * version instead of overwriting it. The write itself is atomic (temp file plus
 * rename), matching `writeJsonFileAtomic` in the dashboard's `store.js`.
 *
 * Two things are deliberately NOT done here:
 *
 * - A missing database is left missing. Creating one would resurrect a database
 *   that has been deleted -- the exact failure the owner needs to hear about --
 *   with an empty catalog and no orders, which is the "looks healthy, data is
 *   gone" state the loss detector warns about.
 * - A corrupt database is left corrupt. Overwriting it with a patched-but-empty
 *   version would destroy the evidence and bury whatever went wrong.
 */

const MAX_ATTEMPTS = 5;
const READ_RETRIES = 3;
const RETRY_DELAY_MS = 25;

/** Same shape the dashboard uses elsewhere, so `formatDateTime` renders it. */
function nowText(date = new Date()) {
  const two = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The dashboard half of this contract. Exported so the Health Center and the
 * loss detector read the same field names the bot writes, and so a rename has
 * one place to happen.
 */
export function readBackupState(db = {}) {
  const state = db?.settings?.backupState;
  if (!state || typeof state !== "object") {
    return { status: "never_run", ranAt: "", sentAt: "", fileName: "", error: "", reason: "" };
  }
  return {
    status: String(state.status || "unknown"),
    ranAt: String(state.ranAt || ""),
    sentAt: String(state.sentAt || ""),
    fileName: String(state.fileName || ""),
    error: String(state.error || ""),
    reason: String(state.reason || ""),
  };
}

async function readDatabaseWithRetry(dbPath) {
  let lastError;
  for (let attempt = 0; attempt < READ_RETRIES; attempt += 1) {
    try {
      return await fs.readFile(dbPath, "utf8");
    } catch (error) {
      lastError = error;
      if (attempt < READ_RETRIES - 1) await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
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

async function fileStillMatches(dbPath, expected) {
  try {
    return (await fs.readFile(dbPath, "utf8")) === expected;
  } catch {
    // Gone or unreadable: treat as changed, so we retry and re-read rather than
    // assume the original content is still valid.
    return false;
  }
}

/**
 * @param {string} dbPath      path to kavya-db.json
 * @param {object} state       `{ status, ranAt, sentAt, fileName, error, reason }`
 * @param {object} [options]   `{ onBeforeWrite }` -- test seam for the race
 * @returns {Promise<{written: boolean, attempts: number, reason?: string}>}
 */
export async function writeBackupState(dbPath, state = {}, options = {}) {
  const target = path.resolve(dbPath);
  if (!dbPath) return { written: false, attempts: 0, reason: "database_path_missing" };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let original;
    try {
      original = await readDatabaseWithRetry(target);
    } catch (error) {
      // Deliberately does not create the file. See the note at the top.
      const reason = error.code === "ENOENT" ? "database_missing" : "database_unreadable";
      return { written: false, attempts: attempt, reason, error: error.message };
    }

    let db;
    try {
      db = JSON.parse(original);
    } catch (error) {
      // Overwriting would destroy the evidence of whatever went wrong.
      return { written: false, attempts: attempt, reason: "database_corrupt", error: error.message };
    }
    if (!db || typeof db !== "object" || Array.isArray(db)) {
      return { written: false, attempts: attempt, reason: "database_unexpected_shape" };
    }

    const patched = {
      ...db,
      settings: {
        ...(db.settings && typeof db.settings === "object" ? db.settings : {}),
        backupState: {
          status: String(state.status || "unknown"),
          ranAt: state.ranAt || nowText(),
          sentAt: state.sentAt || (state.status === "sent" ? state.ranAt || nowText() : db.settings?.backupState?.sentAt || ""),
          fileName: state.fileName || "",
          error: String(state.error || ""),
          reason: String(state.reason || ""),
        },
      },
    };
    const serialized = `${JSON.stringify(patched, null, 2)}\n`;

    if (typeof options.onBeforeWrite === "function") await options.onBeforeWrite({ attempt });

    // The whole point: if the dashboard committed something while we were
    // patching, discard this attempt and start from their version.
    if (serialized === original) {
      return { written: false, attempts: attempt, reason: "no_change" };
    }
    if (!(await fileStillMatches(target, original))) {
      await delay(RETRY_DELAY_MS * attempt);
      continue;
    }

    const tempPath = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      await fs.writeFile(tempPath, serialized, { mode: 0o600 });
      await renameWithRetry(tempPath, target);
      await fs.chmod(target, 0o600).catch(() => undefined);
      return { written: true, attempts: attempt };
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      // A failed write must never take the bot's backup loop down with it.
      return { written: false, attempts: attempt, reason: "write_failed", error: error.message };
    }
  }

  return { written: false, attempts: MAX_ATTEMPTS, reason: "contended" };
}