import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeBackupState, readBackupState } from "../lib/backup-state-writer.js";

/**
 * The bot writing `kavya-db.json` makes it a second writer on the file the
 * dashboard mutates through `store.js`. That is a money path: a clobbered write
 * loses orders and balances, not a cache.
 *
 * `store.js` serialises its own writes through a promise queue, but a queue in
 * one process says nothing about a second process. The only defence available
 * across processes is optimistic concurrency -- read, compute, then verify the
 * file on disk is still byte-identical to what was read before renaming over
 * it. If it is not, the other writer got there first and we retry instead of
 * destroying their work.
 *
 * These tests drive that window deliberately.
 */
function tempDb(contents) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "backup-state-"));
  const dbPath = path.join(dir, "kavya-db.json");
  writeFileSync(dbPath, JSON.stringify(contents, null, 2));
  return { dir, dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("writes backup state without disturbing existing data", async () => {
  const { dbPath, cleanup } = tempDb({
    resellers: [{ id: "r1", name: "Budi" }],
    orders: [{ id: "o1", total: 50000 }],
    payments: [{ id: "p1" }],
  });

  await writeBackupState(dbPath, { status: "sent", ranAt: "2026-10-04T10:00:00.000Z" });

  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  assert.equal(db.resellers.length, 1);
  assert.equal(db.orders[0].total, 50000);
  assert.equal(db.payments.length, 1);
  assert.equal(db.settings.backupState.status, "sent");
  assert.equal(db.settings.backupState.ranAt, "2026-10-04T10:00:00.000Z");

  cleanup();
});

test("a concurrent write is retried, not clobbered", async () => {
  const { dbPath, cleanup } = tempDb({ orders: [{ id: "o1" }] });

  // Stand in for the dashboard committing an order while the bot is mid-write.
  // The bot must notice and retry rather than overwrite the new order.
  let injected = false;
  const onBeforeWrite = async () => {
    if (injected) return;
    injected = true;
    const current = JSON.parse(readFileSync(dbPath, "utf8"));
    current.orders.push({ id: "o2", total: 75000 });
    current.settings = { ...(current.settings || {}), somethingElse: "dashboard" };
    const tmp = `${dbPath}.other`;
    writeFileSync(tmp, JSON.stringify(current, null, 2));
    renameSync(tmp, dbPath);
  };

  await writeBackupState(dbPath, { status: "sent" }, { onBeforeWrite });

  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  assert.deepEqual(
    db.orders.map((order) => order.id),
    ["o1", "o2"],
    "the dashboard's order was destroyed by the bot's write",
  );
  assert.equal(db.settings.somethingElse, "dashboard", "unrelated settings were destroyed");
  assert.equal(db.settings.backupState.status, "sent", "the bot's state should still land after the retry");

  cleanup();
});

test("does not invent a settings object when the database has none", async () => {
  const { dbPath, cleanup } = tempDb({ orders: [] });

  await writeBackupState(dbPath, { status: "failed", error: "whatsapp_not_connected" });

  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  assert.deepEqual(db.orders, []);
  assert.equal(db.settings.backupState.status, "failed");
  assert.equal(db.settings.backupState.error, "whatsapp_not_connected");

  cleanup();
});

test("an unreadable or corrupt database is left alone", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "backup-state-corrupt-"));
  const dbPath = path.join(dir, "kavya-db.json");
  writeFileSync(dbPath, "{ this is not json");

  const result = await writeBackupState(dbPath, { status: "sent" });

  assert.equal(result.written, false, "a corrupt database must not be overwritten with a backup-state-only file");
  assert.ok(result.reason, "the caller needs to know why nothing was written");
  assert.match(readFileSync(dbPath, "utf8"), /not json/, "the corrupt file must survive untouched");

  rmSync(dir, { recursive: true, force: true });
});

test("a missing database is reported, not created", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "backup-state-missing-"));
  const dbPath = path.join(dir, "kavya-db.json");

  const result = await writeBackupState(dbPath, { status: "sent" });

  assert.equal(result.written, false);
  assert.equal(result.reason, "database_missing");
  assert.equal(existsSync(dbPath), false, "the bot must not bring a database into existence");

  rmSync(dir, { recursive: true, force: true });
});

test("the timestamp is recorded in the same shape the dashboard reads", async () => {
  // The dashboard renders this with `formatDateTime`, which expects the
  // `YYYY-MM-DD HH:MM` shape used elsewhere in the database, not an ISO string.
  const { dbPath, cleanup } = tempDb({ orders: [] });

  await writeBackupState(dbPath, { status: "sent" });

  const state = readBackupState(JSON.parse(readFileSync(dbPath, "utf8")));
  assert.match(state.ranAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  cleanup();
});

test("readBackupState returns a neutral shape for a database that never recorded one", async () => {
  // The dashboard renders this before the first scheduled run has happened, so
  // it must not have to guard every field.
  const state = readBackupState({ orders: [] });
  assert.equal(state.status, "never_run");
  assert.equal(state.error, "");
  assert.ok("ranAt" in state);
});