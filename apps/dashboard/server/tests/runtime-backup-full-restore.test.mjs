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

test("runtime backup writes a full restore archive with source, dashboard build, env, data, and WhatsApp auth", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-runtime-backup-full-"));
  const runtimeDir = path.join(rootDir, "apps", "dashboard", "runtime");
  const outputDir = path.join(runtimeDir, "backups");
  const authDir = path.join(runtimeDir, "baileys-auth");
  const whatsappDbDir = path.join(runtimeDir, "whatsapp-database");

  await writeFile(path.join(rootDir, ".env"), "OWNER_PASSWORD=private-owner-password\n");
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
  // --force-local stops GNU tar reading the Windows drive letter in
  // backup.filePath ("C:\...") as a remote host name.
  const list = spawnSync("tar", ["--force-local", "-tzf", backup.filePath], { encoding: "utf8" });

  assert.equal(list.status, 0, list.stderr);
  const entries = list.stdout.split(/\r?\n/).filter(Boolean);
  for (const expected of [
    "./.env",
    "./package.json",
    "./apps/bot/index.js",
    "./apps/dashboard/server/auto-order.js",
    "./apps/dashboard/dist/index.html",
    "./apps/dashboard/runtime/kavya-db.json",
    "./apps/dashboard/runtime/whatsapp-database/groups.json",
    "./apps/dashboard/runtime/whatsapp-database/lists.json",
    "./apps/dashboard/runtime/whatsapp-database/rentals.json",
    "./apps/dashboard/runtime/baileys-auth/creds.json",
  ]) {
    assert.ok(entries.includes(expected), `${expected} should be included`);
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
