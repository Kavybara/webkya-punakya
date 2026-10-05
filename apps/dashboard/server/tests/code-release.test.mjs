import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectReleaseFiles } from "../../../../scripts/deploy/release-files.mjs";

test("code releases contain current code and build, never laptop data or credentials", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-release-test-"));
  try {
    const allowed = ["package.json", "package-lock.json", "apps/dashboard/server/index.js", "apps/dashboard/dist/index.html", "apps/bot/index.js", "lib/safeFetch.js", ".env.example", "packages/shared/runtime-backup.mjs", "scripts/maintenance/runtime-backup.mjs", "apps/dashboard/server/tests/runtime-backup-full-restore.test.mjs"];
    const forbidden = [".npmrc", ".env", "apps/dashboard/.env.production", "apps/dashboard/runtime/kavya-db.json", "runtime-previous/creds.json", "apps/bot/database/lists.json", "database/list.json", "database/media/photo.jpg", "apps/bot/.auth/creds.json", "node_modules/test/index.js", "artifacts/private.json", "apps/dashboard/server/local.pem", "apps/dashboard/test-results/trace.zip", "apps/dashboard/playwright-report/index.html", "apps/bot/coverage/output.json"];
    for (const relative of [...allowed, ...forbidden]) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "fixture");
    }
    const result = await collectReleaseFiles(root);
    assert.deepEqual(result.sort(), allowed.sort());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("quoted custom data paths and comments in env cannot leak into a code release", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-release-custom-"));
  try {
    const custom = "apps/persisted records";
    await fs.mkdir(path.join(root, custom), { recursive: true });
    await fs.writeFile(path.join(root, custom, "kavya-db.json"), "fixture-private-data");
    await fs.writeFile(path.join(root, ".env"), `DATABASE_PATH="${custom}/kavya-db.json" # keep on VPS\n`);
    assert.deepEqual(await collectReleaseFiles(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
