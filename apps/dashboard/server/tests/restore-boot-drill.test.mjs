import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { collectReleaseFiles } from "../../../../scripts/deploy/release-files.mjs";
import { createRuntimeBackupPayload, encryptBackupForTransport, writeRuntimeBackupFile } from "../../../../packages/shared/runtime-backup.mjs";
import { withServer, fixtureDatabase } from "./helpers/boot-server.mjs";
import { hashPassword } from "../security.js";

test("decrypted backup boots restored code, authenticates and survives rejected-code rollback without reseeding data", async (t) => {
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-restored-boot-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  for (const relative of await collectReleaseFiles(repository)) {
    const dest = path.join(source, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(repository, relative), dest);
  }
  const runtime = path.join(source, "apps/dashboard/runtime");
  const whatsapp = path.join(runtime, "whatsapp-database");
  await fs.mkdir(whatsapp, { recursive: true });
  const db = fixtureDatabase();
  db.resellers[0].passwordHash = hashPassword("fixture-restored-login");
  db.whatsappRentals = [{ id: "restore@g.us", groupJid: "restore@g.us", status: "paused", name: "Restored Rental", endsAt: "2030-01-01" }];
  const lists = { "restore@g.us": { picsart: { content: "latest edited price 4000", updatedAt: "2026-10-06" } } };
  await fs.writeFile(path.join(runtime, "kavya-db.json"), JSON.stringify(db));
  await fs.writeFile(path.join(whatsapp, "lists.json"), JSON.stringify(lists));
  const payload = await createRuntimeBackupPayload({ rootDir: source, runtimeDir: runtime, dashboardDbPath: path.join(runtime, "kavya-db.json"), whatsappDbDir: whatsapp });
  const archive = await writeRuntimeBackupFile({ payload, outputDir: path.join(root, "archives") });
  const key = "fixture-restore-boot-encryption-passphrase";
  const encrypted = await encryptBackupForTransport(archive, { passphrase: key });
  const decoded = path.join(root, "decoded.tar.gz");
  const decrypt = spawnSync(process.execPath, [path.join(repository, "scripts/maintenance/decrypt-runtime-backup.mjs"), encrypted.filePath, decoded], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: key }, encoding: "utf8" });
  assert.equal(decrypt.status, 0, decrypt.stderr);
  const restored = path.join(root, "restored");
  await fs.mkdir(restored);
  assert.equal(spawnSync("tar", ["-xzf", decoded, "-C", restored]).status, 0);
  // Dependency reuse is explicit; locked fresh installs are checked separately.
  for (const relative of ["node_modules", "apps/dashboard/node_modules"]) {
    await fs.symlink(path.join(repository, relative), path.join(restored, relative), process.platform === "win32" ? "junction" : "dir");
  }
  const restoredRuntime = path.join(restored, "apps/dashboard/runtime");
  const entry = path.join(restored, "apps/dashboard/server/index.js");
  const verify = async () => withServer(async ({ base, post }) => {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
    const login = await post("/api/auth/login", { email: "kya", password: "fixture-restored-login" });
    assert.equal(login.status, 200);
    const stored = JSON.parse(await fs.readFile(path.join(restoredRuntime, "kavya-db.json"), "utf8"));
    assert.equal(stored.resellers[0].id, "res-kya");
    assert.equal(stored.whatsappRentals[0].status, "paused");
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(restoredRuntime, "whatsapp-database/lists.json"), "utf8")), lists);
    assert.equal((await fetch(`${base}/login`)).status, 200);
  }, { runtimeRoot: restoredRuntime, serverEntry: entry });
  await verify();
  const before = await fs.readFile(entry);
  const dataBefore = await fs.readFile(path.join(restoredRuntime, "kavya-db.json"));
  await fs.writeFile(entry, 'throw new Error("fixture rejected code update");\n');
  assert.notEqual(spawnSync(process.execPath, [entry], { encoding: "utf8" }).status, 0);
  await fs.writeFile(entry, before);
  assert.equal(crypto.createHash("sha256").update(await fs.readFile(entry)).digest("hex"), crypto.createHash("sha256").update(before).digest("hex"));
  assert.deepEqual(await fs.readFile(path.join(restoredRuntime, "kavya-db.json")), dataBefore);
  await verify();
});
