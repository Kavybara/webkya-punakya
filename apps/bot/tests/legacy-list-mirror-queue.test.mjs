import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonStore } from "../lib/json-store.js";

/*
 * Two write-safety bugs in the bot's persistent store, both in
 * `apps/bot/lib/json-store.js`.
 *
 * 1. `updateLegacyLists` (`:378`) is an unserialised read-modify-write.
 *
 *    It reads both legacy list files, merges them, runs the caller's mutation
 *    over the result, and writes the whole thing back to both paths. The
 *    sibling `update()` is queued through `this.writeQueue`; this one bypasses
 *    that queue entirely, so the mirror is the unprotected half of an otherwise
 *    protected operation.
 *
 *    Two mirror writes in flight both read the same base, both merge their own
 *    group, both write the whole file back. The second write wins and the first
 *    edit's group is gone, with no error anywhere -- the mirror is deliberately
 *    best-effort, so a lost write is indistinguishable from a skipped one.
 *
 *    These two legacy mirrors are what the dashboard reads via
 *    `readLegacyGroupLists`, so a group that was just edited stops appearing
 *    there even though the bot's primary store still has it.
 *
 * 2. `update()` (`:209`) chains with a single `.then(task)` handler.
 *
 *    One rejected write leaves `this.writeQueue` permanently rejected. Every
 *    later `.then()` on a rejected promise never runs its callback, so the store
 *    stops persisting anything at all -- permanently, for the life of the
 *    process, with no error surfacing to the caller of the *next* call. A
 *    transient disk error becomes a total, silent outage.
 *
 *    `store.js` in the dashboard gets this right with `.then(task, task)`; the
 *    bot's copy does not.
 */

const GROUP_A = "12036300000000000a@g.us";
const GROUP_B = "12036300000000000b@g.us";

async function makeStore(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const legacyListPath = path.join(root, "database", "list.json");
  const legacyBotListPath = path.join(root, "apps", "bot", "database", "lists.json");
  const dashboardDbPath = path.join(root, "kavya-digital-dashboard", "runtime", "kavya-db.json");
  process.env.LEGACY_LIST_FILE = legacyListPath;
  process.env.LEGACY_BOT_LIST_FILE = legacyBotListPath;
  process.env.DATABASE_PATH = dashboardDbPath;
  for (const dir of [
    path.dirname(legacyListPath),
    path.dirname(legacyBotListPath),
    path.dirname(dashboardDbPath),
  ]) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(legacyListPath, JSON.stringify({}, null, 2));
  await writeFile(legacyBotListPath, JSON.stringify({}, null, 2));
  await writeFile(dashboardDbPath, JSON.stringify({ whatsappGroupLists: [] }, null, 2));

  const store = new JsonStore(path.join(root, "runtime", "whatsapp-database"));
  await store.ensure();
  return { store, legacyListPath, legacyBotListPath };
}

test("two concurrent mirror writes both reach the legacy copies", async () => {
  const { store, legacyListPath, legacyBotListPath } = await makeStore("kavya-mirror-race-");

  // Two list edits in flight at once -- what two group members running
  // `.list <keyword>` in different groups amounts to.
  await Promise.all([
    store.mirrorLegacyListEntry(GROUP_A, "picsart", { text: "harga grup A", media: "" }),
    store.mirrorLegacyListEntry(GROUP_B, "canva", { text: "harga grup B", media: "" }),
  ]);

  for (const mirrorPath of [legacyListPath, legacyBotListPath]) {
    const mirror = JSON.parse(await readFile(mirrorPath, "utf8"));
    const label = path.basename(mirrorPath);
    assert.ok(
      mirror[GROUP_A]?.list?.picsart,
      `group A's edit is missing from ${label}; the other edit's whole-file write erased it`,
    );
    assert.ok(
      mirror[GROUP_B]?.list?.canva,
      `group B's edit is missing from ${label}; the other edit's whole-file write erased it`,
    );
  }
});

test("a failed mirror write does not drop the mirror that follows it", async () => {
  const { store, legacyListPath } = await makeStore("kavya-mirror-recover-");

  const originalWrite = store.writeLegacyLists.bind(store);
  let shouldFail = true;
  store.writeLegacyLists = async (lists) => {
    if (shouldFail) {
      shouldFail = false;
      throw new Error("simulated_transient_disk_error");
    }
    return originalWrite(lists);
  };

  // Best-effort by design, so the failing call must not throw.
  await store.mirrorLegacyListEntry(GROUP_A, "picsart", { text: "grup A", media: "" });
  await store.mirrorLegacyListEntry(GROUP_B, "canva", { text: "grup B", media: "" });

  const mirror = JSON.parse(await readFile(legacyListPath, "utf8"));
  assert.ok(
    mirror[GROUP_B]?.list?.canva,
    "the mirror after a failed write must still land; a poisoned queue would silently drop every later edit",
  );
});

test("a failed primary write does not stop the store persisting anything", async () => {
  const { store } = await makeStore("kavya-primary-poison-");

  const originalWrite = store.write.bind(store);
  let shouldFail = true;
  store.write = async (name, value) => {
    if (shouldFail) {
      shouldFail = false;
      throw new Error("simulated_transient_disk_error");
    }
    return originalWrite(name, value);
  };

  // This one is expected to reject -- that is the transient failure.
  await assert.rejects(
    () => store.update("lists", {}, (lists) => ({ ...lists, [GROUP_A]: { list: {} } })),
    /simulated_transient_disk_error/,
  );

  // The next write must still be persisted. With a single-handler `.then`, the
  // queue is still rejected here, so this callback never runs and the store
  // silently stops writing for the rest of the process's life.
  await store.update("lists", {}, (lists) => ({ ...lists, [GROUP_B]: { list: {} } }));

  const persisted = await store.read("lists", {});
  assert.ok(
    persisted[GROUP_B],
    "the store stopped persisting after one failed write; a single-handler .then leaves the queue permanently rejected",
  );
});
