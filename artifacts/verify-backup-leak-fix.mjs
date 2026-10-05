/*
 * Proves the backup leak is closed, against a real fixture on disk.
 *
 * Not source inspection. This builds an actual payload in a throwaway directory
 * and reads back what the walker put in it, because the whole failure was that
 * the exclusion lists were never checked at runtime -- `.env` looked excluded by
 * inspection and was in fact swept in by the recursive walk.
 *
 * No real credential appears anywhere below. The fixture `.env` holds the string
 * "canary-secret-value", which is not a secret and exists only to be searched for.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import {
  createRuntimeBackupPayload,
  encryptBackupForTransport,
} from "../packages/shared/runtime-backup.mjs";

const CANARY = "canary-secret-value";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-backup-test-"));
  const runtimeDir = path.join(root, "apps/dashboard/runtime");
  const baileysAuthDir = path.join(runtimeDir, "baileys-auth");

  await fs.mkdir(path.join(root, "apps/bot"), { recursive: true });
  await fs.mkdir(baileysAuthDir, { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });

  // The file that leaked. Real backups ship this verbatim.
  await fs.writeFile(path.join(root, ".env"), `AUTH_SECRET=${CANARY}\n`);
  await fs.writeFile(path.join(root, "src", "index.js"), "export const ok = true;\n");
  // A nested .env, to prove exclusion is by basename and not only at the root.
  await fs.mkdir(path.join(root, "packages/nested"), { recursive: true });
  await fs.writeFile(path.join(root, "packages/nested/.env"), `NESTED=${CANARY}\n`);

  await fs.writeFile(
    path.join(runtimeDir, "kavya-db.json"),
    JSON.stringify({ orders: [{ id: "o1", total: 100 }] }),
  );
  await fs.writeFile(path.join(baileysAuthDir, "creds.json"), JSON.stringify({ noise: CANARY }));

  return { root, runtimeDir, baileysAuthDir, whatsappDbDir: path.join(runtimeDir, "whatsapp-database") };
}

async function buildPayload(overrides = {}) {
  const fixture = await makeFixture();
  const payload = await createRuntimeBackupPayload({
    rootDir: fixture.root,
    runtimeDir: fixture.runtimeDir,
    baileysAuthDir: fixture.baileysAuthDir,
    whatsappDbDir: fixture.whatsappDbDir,
    ...overrides,
  });
  return { fixture, payload };
}

/* -------------------------------------------------------------------------- */

test(".env never enters the project source bundle", async () => {
  const { payload } = await buildPayload();
  const files = payload.file_bundles.project_source.files;

  assert.ok(!(".env" in files), "the root .env is in the archive");

  // Excluded by basename, so a nested one is caught too -- a path-prefix check
  // would have missed it and the leak would survive in a monorepo subpackage.
  const nested = Object.keys(files).filter((key) => key.toLowerCase().endsWith(".env"));
  assert.deepEqual(nested, [], "a nested .env is in the archive");
});

test("the whole payload contains no secret canary anywhere", async () => {
  const { payload } = await buildPayload();

  // Belt and braces: rather than trusting the exclusion list to be complete,
  // serialise the entire payload and look for the canary. If any future code
  // path reintroduces credential capture, this is the assertion that catches it.
  assert.ok(
    !JSON.stringify(payload).includes(CANARY),
    "a secret canary survived somewhere in the payload",
  );
});

test("the exclusion is reported, not silent", async () => {
  const { payload } = await buildPayload();
  const skipped = payload.file_bundles.project_source.skipped || [];

  // An operator reading the backup manifest has to be able to see that .env was
  // left out on purpose. A silent skip looks identical to a missing file.
  assert.ok(
    skipped.some((entry) => entry.reason === "secret_file"),
    "the .env exclusion is not recorded in `skipped`",
  );
});

test("real source and data still get backed up", async () => {
  const { payload } = await buildPayload();

  // The point of a backup is that it still works. Asserting only that secrets
  // are gone would pass even if the walker backed up nothing at all.
  const source = payload.file_bundles.project_source.files;
  assert.ok("src/index.js" in source, "real source files are missing from the archive");
  assert.ok(
    "kavya-db.json" in payload.file_bundles.dashboard_runtime.files,
    "the dashboard database is missing from the archive",
  );
});

test("the WhatsApp session is excluded by default", async () => {
  const { payload } = await buildPayload();
  const auth = payload.file_bundles.whatsapp_auth;

  assert.equal(auth.count, 0, "the Baileys session is in the archive by default");
  assert.ok(
    (auth.skipped || []).some((entry) => entry.reason === "whatsapp_session_excluded"),
    "the session exclusion is not recorded",
  );
});

test("the WhatsApp session can be opted back in", async () => {
  // Deliberately not removed. An operator with a locked-down VPS may want it,
  // and docs/RESTORE.md:278 already covers re-pairing when it is absent.
  const previous = process.env.RUNTIME_BACKUP_INCLUDE_WHATSAPP_SESSION;
  process.env.RUNTIME_BACKUP_INCLUDE_WHATSAPP_SESSION = "true";
  try {
    const { payload } = await buildPayload();
    assert.ok(
      payload.file_bundles.whatsapp_auth.count > 0,
      "RUNTIME_BACKUP_INCLUDE_WHATSAPP_SESSION=true did not include the session",
    );
  } finally {
    if (previous === undefined) delete process.env.RUNTIME_BACKUP_INCLUDE_WHATSAPP_SESSION;
    else process.env.RUNTIME_BACKUP_INCLUDE_WHATSAPP_SESSION = previous;
  }
});

/* -------------------------------------------------------------------------- */
/* encryption                                                                  */
/* -------------------------------------------------------------------------- */

test("a short or placeholder key is refused rather than used", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-enc-test-"));
  const filePath = path.join(dir, "backup.tar.gz");
  await fs.writeFile(filePath, "payload");
  const backup = { fileName: "backup.tar.gz", filePath };

  // `.env.example:19` ships a 49-character placeholder. A length check alone
  // accepts it, and every backup would be encrypted to a passphrase published
  // in the repository.
  for (const bad of ["", "short", "replace-with-a-separate-long-backup-passphrase", "change-me-to-something-long", "your-long-backup-passphrase-here"]) {
    await assert.rejects(
      encryptBackupForTransport(backup, { passphrase: bad }),
      /BACKUP_ENCRYPTION_KEY/,
      `passphrase ${JSON.stringify(bad)} was accepted`,
    );
  }
});

test("a real key round-trips and the ciphertext hides the plaintext", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-enc-test-"));
  const filePath = path.join(dir, "backup.tar.gz");
  const secretMarker = "plaintext-marker-inside-the-archive";
  await fs.writeFile(filePath, `archive contents ${secretMarker}`);
  const backup = { fileName: "backup.tar.gz", filePath };

  const encrypted = await encryptBackupForTransport(backup, { passphrase: "a-real-owner-passphrase-2026" });

  assert.ok(encrypted.filePath.endsWith(".enc"), "the encrypted file is not a .enc sidecar");
  assert.equal(encrypted.fileName, "backup.tar.gz.enc");

  const ciphertext = await fs.readFile(encrypted.filePath);
  assert.ok(
    !ciphertext.includes(secretMarker),
    "the plaintext survived into the encrypted file",
  );
  assert.ok(ciphertext.includes("KAVYA-BACKUP-V1"), "the format header is missing");

  // Decrypt the way `runtime:backup:decrypt` does, and confirm the original.
  const headerEnd = ciphertext.indexOf("\n", Buffer.byteLength("KAVYA-BACKUP-V1\n")) + 1;
  const header = JSON.parse(ciphertext.subarray(Buffer.byteLength("KAVYA-BACKUP-V1\n"), headerEnd).toString("utf8"));
  const body = ciphertext.subarray(headerEnd);

  const key = crypto.scryptSync("a-real-owner-passphrase-2026", Buffer.from(header.salt, "base64url"), 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(header.tag, "base64url"));
  const recovered = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");

  assert.equal(recovered, `archive contents ${secretMarker}`);
});

test("two encryptions of the same archive differ", async () => {
  // A fixed salt or IV would make the ciphertext a deterministic fingerprint of
  // the plaintext. Random per run is what makes this worth doing at all.
  //
  // Two separate directories, because the `.enc` sidecar is named after its
  // source archive -- writing both to one path would just overwrite the first
  // ciphertext and then compare the file against itself.
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-enc-a-"));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-enc-b-"));
  const fileA = path.join(dirA, "backup.tar.gz");
  const fileB = path.join(dirB, "backup.tar.gz");
  await fs.writeFile(fileA, "same archive");
  await fs.writeFile(fileB, "same archive");
  const passphrase = "a-real-owner-passphrase-2026";

  const first = await encryptBackupForTransport({ fileName: "b.tar.gz", filePath: fileA }, { passphrase });
  const second = await encryptBackupForTransport({ fileName: "b.tar.gz", filePath: fileB }, { passphrase });

  assert.notEqual(first.filePath, second.filePath, "the fixture is not testing two independent encryptions");

  const a = await fs.readFile(first.filePath);
  const b = await fs.readFile(second.filePath);
  assert.ok(!a.equals(b), "encryption is deterministic -- salt or IV is being reused");
});