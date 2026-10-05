import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * The merge artifact must not be able to lock the owner out.
 *
 * `artifacts/merge-dashboard-backup-data.mjs` merges a WhatsApp backup into the
 * live database. It used to hardcode the owner password and print it, so it no
 * longer may. An earlier fix removed the plaintext field -- and the *hash*
 * alongside it -- reasoning that the .env value would re-create the credential
 * on the next boot.
 *
 * That holds only while `OWNER_PASSWORD` is set. `.env.example` ships it empty,
 * and when it is empty the cascade in `ensureRuntimeSettings`
 * (server/index.js) has no surviving input:
 *
 *   env owner password  -> falsy, so branches 1 and 3 are skipped
 *   plaintext password  -> deleted by the merge, so branch 2 is skipped
 *   branch 4            -> only deletes, and there is nothing to delete
 *
 * `ownerPasswordHash` stays undefined and no password can authenticate. The
 * artifact removes the last usable credential, on a path whose whole purpose is
 * restoring one.
 *
 * These assertions are on the two facts that keep that from recurring: the
 * artifact leaves the hash alone, and the server still has the plaintext
 * fallback that makes removing the plaintext safe. They are read from source
 * because `ensureRuntimeSettings` is not exported and booting the server would
 * touch the real database.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MERGE_ARTIFACT = path.join(REPO_ROOT, "artifacts", "merge-dashboard-backup-data.mjs");
const SERVER_INDEX = path.join(REPO_ROOT, "apps", "dashboard", "server", "index.js");

test("the merge artifact does not delete the owner password hash", async () => {
  const source = await readFile(MERGE_ARTIFACT, "utf8");

  // The hash is the only credential that survives a boot with no OWNER_PASSWORD.
  assert.ok(
    !/delete\s+[\w.]*ownerPasswordHash\b/.test(source),
    "the merge artifact must not delete ownerPasswordHash: with no OWNER_PASSWORD " +
      "in .env it is the only remaining way to log in",
  );

  // The plaintext is still dropped -- that was the actual secret in the file,
  // and a stale one carried in by the backup spread should not be merged.
  assert.ok(
    /delete\s+[\w.]*ownerPassword\s*;/.test(source),
    "the merge artifact should still drop the plaintext owner password",
  );
});

test("the server can rebuild the hash from the env or a surviving plaintext", async () => {
  const source = await readFile(SERVER_INDEX, "utf8");

  /*
   * The artifact's plaintext delete is only safe because the server re-hashes
   * from a source that is not the plaintext. Assert the cascade still contains
   * both recovery inputs: the environment value, and -- the one the artifact
   * silently removes -- a plaintext field surviving from another path.
   */
  assert.match(
    source,
    /firstUsableSecret\(process\.env\.OWNER_PASSWORD,\s*process\.env\.OWNER_LOGIN_PASSWORD\)/,
    "the owner password should still be read from the environment",
  );

  assert.match(
    source,
    /!settings\.ownerPasswordHash\s*&&\s*storedOwnerPassword/,
    "a plaintext password with no hash should still be promoted to a hash; " +
      "without this branch, deleting the plaintext is a lockout",
  );
});

test("the merge summary reports credential presence without disclosing it", async () => {
  const source = await readFile(MERGE_ARTIFACT, "utf8");

  /*
   * The hash survives now, so the summary's job is to tell the operator
   * whether a usable credential exists after the merge -- and nothing more.
   * `Boolean(...)` says that; echoing the value would put it in terminal
   * scrollback and any CI log that ever runs the script.
   */
  assert.match(
    source,
    /hasOwnerPasswordHash:\s*Boolean\(/,
    "the summary should report whether a hash exists",
  );
  assert.ok(
    !/console\.log[\s\S]{0,400}ownerPasswordHash:\s*active\./.test(source),
    "the summary must not print the hash itself",
  );
});
