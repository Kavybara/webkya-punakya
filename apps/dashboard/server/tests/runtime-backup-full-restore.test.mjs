import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createRuntimeBackupPayload,
  writeRuntimeBackupFile,
} from "../../../../packages/shared/runtime-backup.mjs";

async function writeFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
}

test("runtime backup writes a full restore archive with source, dashboard build, and data -- but no .env and no WhatsApp session", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-runtime-backup-full-"));
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
