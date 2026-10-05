import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRentalMirror, canonicalRentalMap } from "../services/rental-mirror-service.js";

test("canonical rental projection preserves paused status and never resurrects a deleted group", () => {
  const data = canonicalRentalMap({ whatsappRentals: [{ id: "group@g.us", status: "paused", daysLeft: 15, endsAt: "2030-01-01" }] });
  assert.equal(data["group@g.us"].status, "paused");
  assert.equal(data["group@g.us"].daysLeft, 15);
  assert.deepEqual(canonicalRentalMap({ whatsappRentals: [] }), {});
  assert.throws(() => canonicalRentalMap(), /canonical_rentals_missing/);
  assert.deepEqual(canonicalRentalMap({ whatsappRentals: [{ id: "invalid" }] }), {});
  assert.equal(canonicalRentalMap({ whatsappRentals: [{ groupJid: "g@g.us", expiresAt: 123, start: "old" }] })["g@g.us"].expired, 123);
});

test("missing and corrupt mirrors report pending and transient Windows locks are retried", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-mirror-lock-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "rentals.json");
  let locked = true;
  const mirror = createRentalMirror({ readCanonical: async () => ({ whatsappRentals: [] }), targets: [target], journalPath: path.join(root, "pending.json"), io: { ...fs, rename: async (from, to) => {
    if (locked) { locked = false; throw Object.assign(new Error("busy"), { code: "EBUSY" }); }
    return fs.rename(from, to);
  } } });
  assert.equal((await mirror.health()).status, "pending");
  await fs.writeFile(target, "broken-json");
  assert.equal((await mirror.health()).status, "pending");
  assert.equal((await mirror.reconcile()).status, "synced");
  assert.equal((await mirror.health()).status, "synced");
});

test("rollback failures remain pending and newly created copies are removed on failure", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-mirror-rollback-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const targets = [path.join(root, "first.json"), path.join(root, "second.json")];
  let failRollback = false;
  const mirror = createRentalMirror({ readCanonical: async () => ({ whatsappRentals: [] }), targets, journalPath: path.join(root, "pending.json"), io: { ...fs,
    rename: async (from, to) => {
      if (to === targets[1]) throw new Error("write failed");
      return fs.rename(from, to);
    }, rm: async (file, options) => {
      if (failRollback && file === targets[0]) throw new Error("rollback failed");
      return fs.rm(file, options);
    },
  } });
  assert.equal((await mirror.reconcile()).rollbackFailed, false);
  await assert.rejects(fs.access(targets[0]));
  failRollback = true;
  const result = await mirror.reconcile();
  assert.equal(result.errorCode, "mirror_write_failed");
  assert.equal(result.rollbackFailed, true);
  assert.equal((await mirror.health()).status, "pending");
});

test("partial mirror failure rolls back copies, retains recovery journal, then retries latest canonical data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-rental-mirror-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const targets = [path.join(root, "rentals.json"), path.join(root, "sewa.json")];
  const previous = { "old@g.us": { status: "active" } };
  for (const file of targets) await fs.writeFile(file, JSON.stringify(previous));
  let db = { whatsappRentals: [{ id: "current@g.us", status: "paused", endsAt: "2030-01-01" }] };
  let fail = true;
  const io = { ...fs, rename: async (from, to) => {
    if (fail && to === targets[1]) throw Object.assign(new Error("fixture mirror failure"), { code: "EIO" });
    return fs.rename(from, to);
  } };
  const mirror = createRentalMirror({ readCanonical: async () => db, targets, journalPath: path.join(root, "pending.json"), io });
  const failed = await mirror.reconcile();
  assert.equal(failed.status, "pending");
  for (const file of targets) assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), previous);
  assert.equal((await mirror.health()).status, "pending");
  db = { whatsappRentals: [] };
  fail = false;
  assert.equal((await mirror.reconcile()).status, "synced");
  for (const file of targets) {
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {});
    if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
  await assert.rejects(fs.access(path.join(root, "pending.json")));
  assert.equal((await mirror.health()).status, "synced");
});

test("concurrent reconciliation is serialized and a rejected canonical read does not poison later work", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-rental-retry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const mirror = createRentalMirror({ readCanonical: async () => {
    if (++calls === 1) throw new Error("fixture canonical unavailable");
    return { whatsappRentals: [{ id: "group@g.us", status: "paused" }] };
  }, targets: [path.join(root, "rentals.json")], journalPath: path.join(root, "pending.json") });
  const results = await Promise.allSettled([mirror.reconcile(), mirror.reconcile()]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].value.status, "synced");
});
