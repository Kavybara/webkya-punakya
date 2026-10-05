import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withServer, fixtureDatabase } from "./helpers/boot-server.mjs";

test("existing-runtime boot propagates assertions and never removes caller-owned data", async (t) => {
  const runtime = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-existing-runtime-"));
  t.after(() => fs.rm(runtime, { recursive: true, force: true }));
  const databasePath = path.join(runtime, "kavya-db.json");
  await fs.writeFile(databasePath, JSON.stringify(fixtureDatabase()));
  await assert.rejects(withServer(async () => { throw new Error("fixture assertion must propagate"); }, { runtimeRoot: runtime }), /fixture assertion must propagate/);
  await fs.access(databasePath);
});
