import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Why a rental save could silently undo another rental's save.
 *
 * `upsertLegacyRental` is a read-modify-write over one whole JSON file, and it
 * is reached from three different HTTP routes (`whatsapp-routes.js:281`, `:343`,
 * `:394`). Nothing serialised it and nothing wrote it atomically.
 *
 * Two overlapping requests each read the same base object, each merged its own
 * group into it, and each wrote the whole file back. The second write won. The
 * first request's group went back to its previous value, with no error anywhere
 * -- the response to request A was a success carrying the value that request B
 * then erased.
 *
 * The write was also a bare `fs.writeFile`, which truncates the target before
 * writing. These files are read by a different process -- the bot, via
 * `readDashboardRentalSources` -- so a bot read landing in that window sees
 * invalid JSON, and the whole rental map reads as empty for one poll interval.
 *
 * This is source inspection rather than a behavioural test because
 * `server/index.js` calls `app.listen()` at import time (`:9317`), so importing
 * it would bind a port. Every other server test injects dependencies into a
 * separately importable module; this function has no such seam.
 */

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readIndex() {
  return readFile(path.join(serverDir, "index.js"), "utf8");
}

/** Strips comments so an assertion cannot be satisfied by prose in this file's
 *  own explanatory blocks -- or by the test's own comments above. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("legacy rental writes are serialised through a queue", async () => {
  const source = stripComments(await readIndex());

  assert.match(
    source,
    /let legacyRentalWriteQueue = Promise\.resolve\(\)/,
    "a dedicated queue for legacy rental writes must exist",
  );
  assert.match(
    source,
    /function queueLegacyRentalMutation\(task\)/,
    "the queue helper must exist",
  );

  // `then(task, task)` rather than `then(task)`: with a single handler, one
  // rejected write would reject the chain, and every later rental write would
  // fail too -- turning a transient disk error into a permanent outage.
  assert.match(
    source,
    /const run = legacyRentalWriteQueue\.then\(task, task\)/,
    "the queue must survive a rejected predecessor",
  );
  assert.match(
    source,
    /legacyRentalWriteQueue = run\.catch\(\(\) => undefined\)/,
    "the chain itself must never be left rejected",
  );
});

test("the read is inside the queue, not just the write", async () => {
  const source = stripComments(await readIndex());

  const upsert = source.slice(
    source.indexOf("async function upsertLegacyRental"),
    source.indexOf("async function joinGroupThroughBot"),
  );
  assert.ok(upsert.length > 0, "upsertLegacyRental must be present");

  const queueIndex = upsert.indexOf("queueLegacyRentalMutation");
  const readIndexInUpsert = upsert.indexOf("readLegacyRentals");
  const writeIndexInUpsert = upsert.indexOf("writeLegacyRentals(rentals)");

  assert.ok(queueIndex >= 0, "upsertLegacyRental must go through the queue");
  assert.ok(readIndexInUpsert > 0, "upsertLegacyRental must still read");
  assert.ok(writeIndexInUpsert > 0, "upsertLegacyRental must still write");

  /*
   * This is the assertion that matters, and it is the one a queue added around
   * the wrong half would fail. If the read sat before the queue and only the
   * write was serialised, the writes would be ordered but both requests would
   * still have merged into the same stale base -- the race, unchanged.
   */
  assert.ok(
    readIndexInUpsert > queueIndex,
    "readLegacyRentals must run inside the queued task, or the queue only orders writes and the race survives",
  );
  assert.ok(
    writeIndexInUpsert > queueIndex,
    "writeLegacyRentals must run inside the queued task",
  );
});

test("legacy rental writes are atomic, not a truncating overwrite", async () => {
  const source = stripComments(await readIndex());

  const write = source.slice(
    source.indexOf("async function writeLegacyRentals"),
    source.indexOf("async function upsertLegacyRental"),
  );
  assert.ok(write.length > 0, "writeLegacyRentals must be present");

  assert.match(
    write,
    /writeJsonFileAtomic\(targetPath, rentals\)/,
    "rentals.json must be written through the atomic writer",
  );
  assert.doesNotMatch(
    write,
    /fs\.writeFile\(/,
    "a direct fs.writeFile truncates the target before writing; the bot reads this file from another process",
  );

  // The atomic writer itself: temp file, then rename. Rename is the step that
  // makes a reader see either the old file or the new one, never a partial one.
  const atomic = source.slice(
    source.indexOf("async function writeJsonFileAtomic"),
    source.indexOf("async function writeLegacyRentals"),
  );
  assert.match(atomic, /\.tmp`?\s*,?\s*\n?\s*\)/, "must write to a temp file first");
  assert.match(atomic, /renameWithRetry\(tempPath, filePath\)/, "must rename into place");

  // Windows keeps a rename busy while an antivirus or indexer has the file
  // open, and store.js already retries exactly these three codes (`store.js:66`).
  // Renames are the single most common failure here on the deploy target.
  const rename = source.slice(
    source.indexOf("async function renameWithRetry"),
    source.indexOf("async function writeJsonFileAtomic"),
  );
  assert.match(
    rename,
    /\["EACCES", "EBUSY", "EPERM"\]\.includes\(error\.code\)/,
    "the rename must retry the transient Windows file-lock codes",
  );
});

test("a failed write does not leave a temp file behind or poison the queue", async () => {
  const source = stripComments(await readIndex());

  const atomic = source.slice(
    source.indexOf("async function writeJsonFileAtomic"),
    source.indexOf("async function writeLegacyRentals"),
  );
  assert.match(
    atomic,
    /catch \(error\)[\s\S]*fs\.rm\(tempPath, \{ force: true \}\)[\s\S]*throw error/,
    "a failed rename must clean up its temp file and rethrow, rather than leaving .tmp litter next to the data file",
  );
});
