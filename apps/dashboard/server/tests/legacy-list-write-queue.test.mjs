import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Why an expired-group cleanup could erase list entries the bot had just saved.
 *
 * `cleanupExpiredRentalGroupLists` deletes whole group entries from three list
 * files. Two of them are not the dashboard's alone:
 *
 *   - apps/bot/database/lists.json  (index.js:2111)
 *   - database/list.json            (index.js:2112)
 *
 * The bot reads exactly those two paths in `readLegacyLists`
 * (`apps/bot/lib/json-store.js:354`) and writes them itself in
 * `writeLegacyLists` (`json-store.js:369`).
 *
 * So the old code had a cross-process lost update. It read a file, deleted some
 * keys, and wrote the whole thing back with no serialisation. A bot
 * `writeLegacyLists` landing in that window was silently undone -- the bot saved
 * a pricelist, and it vanished with no error in either process. Worse, it
 * deleted from the same file that `readLegacyGroupLists` backfills, so a cleanup
 * could remove a group and the next read could put it straight back.
 *
 * The write was also a bare `fs.writeFile`, which truncates before writing. The
 * bot's `readLegacyLists` catches a parse failure per path and skips it
 * (`json-store.js:362`), so a torn read is not an error there -- the group
 * simply reports no list entries for one poll.
 *
 * Source inspection rather than behavioural testing, for the same reason as
 * `rental-legacy-write-queue.test.mjs`: `server/index.js` calls `app.listen()` at
 * import time, so importing it would bind a port. These functions have no
 * dependency-injection seam the way the route modules do.
 */

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readIndex() {
  return readFile(path.join(serverDir, "index.js"), "utf8");
}

/** Strips comments so an assertion cannot be satisfied by prose in this file's
 *  own explanatory blocks -- several of which name these exact functions. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `${start} must be present`);
  assert.ok(to > from, `${end} must follow ${start}`);
  const slice = source.slice(from, to);
  assert.ok(slice.trim().length > 0, `slice between ${start} and ${end} must not be empty`);
  return slice;
}

test("expired-group cleanup runs inside a write queue", async () => {
  const source = stripComments(await readIndex());

  assert.match(
    source,
    /let legacyListWriteQueue = Promise\.resolve\(\)/,
    "a dedicated queue for legacy list writes must exist",
  );

  // `then(task, task)` rather than `then(task)`: with a single handler, one
  // rejected write rejects the chain and every later list write fails too,
  // turning a transient disk error into a permanent outage.
  assert.match(
    source,
    /const run = legacyListWriteQueue\.then\(task, task\)/,
    "the queue must survive a rejected predecessor",
  );
  assert.match(
    source,
    /legacyListWriteQueue = run\.catch\(\(\) => undefined\)/,
    "the chain itself must never be left rejected",
  );

  const cleanup = sliceBetween(
    source,
    "async function cleanupExpiredRentalGroupLists",
    "async function readActiveLegacyGroupLists",
  );

  const queueIndex = cleanup.indexOf("queueLegacyListMutation");
  const readIndexInCleanup = cleanup.indexOf("readJsonIfExists(listPath");
  const writeIndexInCleanup = cleanup.indexOf("writeJsonFilePretty(listPath");

  assert.ok(queueIndex >= 0, "cleanupExpiredRentalGroupLists must go through the queue");

  /*
   * These two are the assertions that matter. A queue wrapped around only the
   * write would order the writes while both callers still merged into the same
   * stale base -- the race, unchanged while looking serialised.
   */
  assert.ok(
    readIndexInCleanup > queueIndex,
    "the per-file read must run inside the queued task, or the queue only orders writes and the race survives",
  );
  assert.ok(
    writeIndexInCleanup > queueIndex,
    "the per-file write must run inside the queued task",
  );
});

test("all three list copies are rewritten inside one queued task", async () => {
  const source = stripComments(await readIndex());

  const cleanup = sliceBetween(
    source,
    "async function cleanupExpiredRentalGroupLists",
    "async function readActiveLegacyGroupLists",
  );

  // Two of these three are read by the bot (json-store.js:354). If the loop
  // escaped the queue, a group could be deleted from one copy and survive in
  // another -- the copies are supposed to converge.
  for (const target of [
    /whatsappDatabasePath\("lists\.json"\)/,
    /"apps",\s*"bot",\s*"database",\s*"lists\.json"/,
    /"database",\s*"list\.json"/,
  ]) {
    assert.match(cleanup, target, "each list copy must still be rewritten");
  }

  const loopIndex = cleanup.indexOf("for (const listPath of listPaths)");
  const queueIndex = cleanup.indexOf("queueLegacyListMutation");
  assert.ok(
    loopIndex > queueIndex,
    "the copy loop must sit inside the queued task so all three copies stay consistent",
  );
});

test("the legacy list backfill shares that queue and re-checks before writing", async () => {
  const source = stripComments(await readIndex());

  const readLists = sliceBetween(
    source,
    "async function readLegacyGroupLists",
    "async function readLegacyRentals",
  );

  assert.match(
    readLists,
    /queueLegacyListMutation\(/,
    "the backfill writes the same lists.json the cleanup rewrites, so it must share the queue",
  );

  const queueIndex = readLists.indexOf("queueLegacyListMutation");
  // Search from the queue onward. There is an earlier `readJsonIfExists(
  // modernListPath` in the initial `Promise.all`, and that one belongs *before*
  // the queue -- it is the read that decides whether a backfill is needed at
  // all. Matching the first occurrence would assert the wrong ordering.
  const rereadIndex = readLists.indexOf("readJsonIfExists(modernListPath", queueIndex);

  assert.ok(
    rereadIndex > queueIndex,
    "the backfill must re-read the modern file under the queue; without it, a concurrent writer's newer data is overwritten with the older legacy merge",
  );

  // Still best-effort: a read must not start failing because a cache-warming
  // write could not land. The caller has a usable value either way.
  assert.match(
    readLists,
    /queueLegacyListMutation\([\s\S]*?\n\s*\}\)\.catch\(\(\) => \{\}\)/,
    "the backfill must stay best-effort",
  );
});

test("list writes are atomic, so the bot cannot read a half-written file", async () => {
  const source = stripComments(await readIndex());

  const pretty = sliceBetween(
    source,
    "async function writeJsonFilePretty",
    "async function readFirstNonEmptyJson",
  );

  assert.match(
    pretty,
    /writeJsonFileAtomic\(filePath, value\)/,
    "list writes must go through the atomic writer",
  );
  assert.doesNotMatch(
    pretty,
    /fs\.writeFile\(/,
    "a direct fs.writeFile truncates the target before writing, and the bot reads these exact paths from another process",
  );

  // No direct write to a list file may remain anywhere in the server entrypoint.
  const allWrites = [...source.matchAll(/fs\.writeFile\(([^)]*)\)/g)].map((match) => match[0]);
  for (const call of allWrites) {
    assert.match(
      call,
      /tempPath/,
      `every remaining fs.writeFile must target a temp file, found: ${call}`,
    );
  }
});
