import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import test from "node:test";

import {
  createRuntimeBackupPayload,
  encryptBackupForTransport,
  writeRuntimeBackupFile,
} from "../../../../packages/shared/runtime-backup.mjs";

async function writeFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
}

test("runtime backup writes a full restore archive with source, dashboard build, and data -- but no .env and no WhatsApp session", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-runtime-backup-full-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const runtimeDir = path.join(rootDir, "apps", "dashboard", "runtime");
  const outputDir = path.join(runtimeDir, "backups");
  const authDir = path.join(runtimeDir, "baileys-auth");
  const whatsappDbDir = path.join(runtimeDir, "whatsapp-database");

  // A placeholder, not a credential -- this fixture exists to be searched for
  // in the archive listing, never to be a working password.
  await writeFile(path.join(rootDir, ".env"), "OWNER_PASSWORD=fixture-placeholder-value\n");
  await writeFile(path.join(rootDir, "package.json"), "{\"name\":\"kavya-test\"}\n");
  await writeFile(path.join(rootDir, "apps", "bot", "index.js"), "console.log('bot')\n");
  await writeFile(path.join(rootDir, "apps", "dashboard", "server", "auto-order.js"), "export const ok = true;\n");
  await writeFile(path.join(rootDir, "apps", "dashboard", "dist", "index.html"), "<div>built</div>\n");
  await writeFile(path.join(rootDir, "node_modules", "left-pad", "index.js"), "module.exports = '';\n");
  await writeFile(path.join(rootDir, "database", "group.json"), "{\"group\":\"ok\"}\n");
  await writeFile(path.join(rootDir, "database", "list.json"), "{\"list\":\"ok\"}\n");
  await writeFile(path.join(rootDir, "database", "sewa.json"), "{\"rental\":\"ok\"}\n");
  await writeFile(path.join(rootDir, "apps", "bot", "database", "rentals.json"), "{\"rental\":\"ok\"}\n");
  await writeFile(path.join(rootDir, "runtime", "legacy.json"), "{\"old\":true}\n");
  await writeFile(path.join(runtimeDir, "kavya-db.json"), JSON.stringify({ resellers: [{ username: "seller", passwordHash: "hash" }] }));
  await writeFile(path.join(whatsappDbDir, "groups.json"), "{\"group\":\"runtime\"}\n");
  await writeFile(path.join(whatsappDbDir, "lists.json"), "{\"list\":\"runtime\"}\n");
  await writeFile(path.join(whatsappDbDir, "rentals.json"), "{\"rental\":\"runtime\"}\n");
  await writeFile(path.join(authDir, "creds.json"), "{\"creds\":\"private\"}\n");

  const payload = await createRuntimeBackupPayload({
    rootDir,
    runtimeDir,
    dashboardDbPath: path.join(runtimeDir, "kavya-db.json"),
    whatsappDbDir,
    baileysAuthDir: authDir,
    reason: "test-full-restore",
  });
  const backup = await writeRuntimeBackupFile({ payload, outputDir });
  // Listed the same way the archive is written: from inside its own directory,
  // by bare name, so no drive letter reaches tar. See the note above the
  // spawnSync in `writeUploadableArchive`.
  const list = spawnSync("tar", ["-tzf", path.basename(backup.filePath)], {
    cwd: path.dirname(backup.filePath),
    encoding: "utf8",
  });

  assert.equal(list.status, 0, list.stderr);
  const entries = list.stdout.split(/\r?\n/).filter(Boolean);
  for (const expected of [
    "./package.json",
    "./apps/bot/index.js",
    "./apps/dashboard/server/auto-order.js",
    "./apps/dashboard/dist/index.html",
    "./apps/dashboard/runtime/kavya-db.json",
    "./apps/dashboard/runtime/whatsapp-database/groups.json",
    "./apps/dashboard/runtime/whatsapp-database/lists.json",
    "./apps/dashboard/runtime/whatsapp-database/rentals.json",
  ]) {
    assert.ok(entries.includes(expected), `${expected} should be included`);
  }

  /*
   * `.env` and the Baileys session are asserted ABSENT, which is the opposite
   * of what this test used to claim.
   *
   * It previously listed both as things that "should be included", which
   * documented the leak as intended behavior -- a restore archive carrying live
   * `OWNER_PASSWORD` and a paired WhatsApp device session, sent over WhatsApp on
   * a 24-hour schedule. `docs/RESTORE.md` already covers re-pairing the bot by
   * QR scan, so the restore path does not need the session.
   */
  for (const excluded of [
    "./.env",
    "./apps/dashboard/runtime/baileys-auth/creds.json",
  ]) {
    assert.equal(entries.includes(excluded), false, `${excluded} must not be included`);
  }

  for (const removedLegacy of [
    "./database/group.json",
    "./database/list.json",
    "./database/sewa.json",
    "./runtime/legacy.json",
    "./apps/bot/database/rentals.json",
  ]) {
    assert.equal(entries.includes(removedLegacy), false, `${removedLegacy} should not be included`);
  }
  assert.equal(entries.some((entry) => entry.includes("node_modules")), false);
});

test("encrypted backup restores latest reseller, list and paused rental data; a wrong key is refused", async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-restore-drill-"));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const runtimeDir = path.join(rootDir, "runtime");
  const whatsappDbDir = path.join(runtimeDir, "whatsapp-database");
  const dashboardDbPath = path.join(runtimeDir, "kavya-db.json");
  const db = { resellers: [{ id: "seller-current", whatsapp: "628111222333", passwordHash: "fixture-hash" }], whatsappRentals: [{ id: "group-current", status: "paused" }] };
  const lists = { "120363000000000000@g.us": { picsart: { content: "latest price 4000", updatedAt: "2026-10-06T10:00:00Z" } } };
  await writeFile(path.join(rootDir, "package.json"), "{}");
  await writeFile(path.join(rootDir, "apps", "bot", "index.js"), "// fixture previous code\n");
  await writeFile(dashboardDbPath, JSON.stringify(db));
  await writeFile(path.join(whatsappDbDir, "lists.json"), JSON.stringify(lists));
  const payload = await createRuntimeBackupPayload({ rootDir, runtimeDir, dashboardDbPath, whatsappDbDir, baileysAuthDir: path.join(runtimeDir, "baileys-auth"), reason: "restore-drill" });
  const backup = await writeRuntimeBackupFile({ payload, outputDir: path.join(rootDir, "backups") });
  const passphrase = "fixture-restore-passphrase-not-a-live-secret";
  const encrypted = await encryptBackupForTransport(backup, { passphrase });
  const decryptScript = fileURLToPath(new URL("../../../../scripts/maintenance/decrypt-runtime-backup.mjs", import.meta.url));
  const decrypted = path.join(rootDir, "restored.tar.gz");
  const badOutput = path.join(rootDir, "wrong-key.tar.gz");
  const invoke = (key, output) => spawnSync(process.execPath, [decryptScript, encrypted.filePath, output], { cwd: rootDir, env: { ...process.env, BACKUP_ENCRYPTION_KEY: key }, encoding: "utf8" });
  assert.notEqual(invoke("fixture-wrong-passphrase", badOutput).status, 0);
  await assert.rejects(fs.access(badOutput));
  const result = invoke(passphrase, decrypted);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await fs.readFile(decrypted), await fs.readFile(backup.filePath));
  const restored = path.join(rootDir, "restored");
  await fs.mkdir(restored);
  const extract = spawnSync("tar", ["-xzf", path.basename(decrypted), "-C", restored], { cwd: rootDir, encoding: "utf8" });
  assert.equal(extract.status, 0, extract.stderr);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(restored, "apps", "dashboard", "runtime", "kavya-db.json"), "utf8")), db);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(restored, "apps", "dashboard", "runtime", "whatsapp-database", "lists.json"), "utf8")), lists);
  await assert.rejects(fs.access(path.join(restored, ".env")));
  const hash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
  const restoredDb = path.join(restored, "apps", "dashboard", "runtime", "kavya-db.json");
  const dataHash = hash(await fs.readFile(restoredDb));
  const restoredData = JSON.parse(await fs.readFile(restoredDb, "utf8"));
  assert.equal(restoredData.resellers.length, db.resellers.length);
  assert.equal(restoredData.whatsappRentals.length, db.whatsappRentals.length);
  const codePath = path.join(restored, "apps", "bot", "index.js");
  const previousCode = await fs.readFile(codePath);
  await fs.writeFile(codePath, "// fixture rejected update\n");
  await fs.writeFile(codePath, previousCode);
  assert.equal(hash(await fs.readFile(codePath)), hash(previousCode));
  assert.equal(hash(await fs.readFile(restoredDb)), dataHash, "code rollback must not roll back live data");
  const damaged = Buffer.from(await fs.readFile(encrypted.filePath));
  damaged[damaged.length - 1] ^= 1;
  const tamperedPath = path.join(rootDir, "tampered.enc");
  await fs.writeFile(tamperedPath, damaged);
  const tamperedOutput = path.join(rootDir, "tampered.tar.gz");
  const tampered = spawnSync(process.execPath, [decryptScript, tamperedPath, tamperedOutput], { cwd: rootDir, env: { ...process.env, BACKUP_ENCRYPTION_KEY: passphrase }, encoding: "utf8" });
  assert.notEqual(tampered.status, 0);
  await assert.rejects(fs.access(tamperedOutput));
});
