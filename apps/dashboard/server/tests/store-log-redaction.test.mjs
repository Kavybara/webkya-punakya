import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { redactLogValue } from "../../../../packages/shared/observability.mjs";

test("new settings secrets are redacted immediately after writes, including cached updates", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-store-redaction-"));
  const previous = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(root, "db.json");
  t.after(async () => {
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  const { writeDb, updateDb, readDbSnapshot } = await import(`../store.js?fixture=${Date.now()}`);
  const first = "fixture-new-provider-opaque";
  await writeDb({ settings: { pakasirApiKey: first } });
  assert.equal(redactLogValue(`provider failed: ${first}`).includes(first), false);
  const second = "fixture-updated-provider-opaque";
  await updateDb((db) => { db.settings.pakasirApiKey = second; });
  await readDbSnapshot();
  assert.equal(redactLogValue(`provider failed: ${second}`).includes(second), false);
});
