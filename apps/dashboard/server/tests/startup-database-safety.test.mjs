import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

async function reader(exists, read) {
  const source = await fs.readFile(new URL("../../../../scripts/startup/kavya-start.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function readDashboardDb()");
  const end = source.indexOf("function ensureDashboardRuntimeSettings()", start);
  assert.ok(start >= 0 && end > start);
  return Function("existsSync", "readFileSync", "dashboardDbPath", "logWarn", `${source.slice(start, end)}; return readDashboardDb;`)(exists, read, "fixture-db.json", () => {});
}

test("startup refuses corrupted existing data instead of replacing it with defaults", async () => {
  const load = await reader(() => true, () => "{truncated");
  assert.throws(load, /Database startup tidak dapat dibaca/);
});

test("startup does not treat a denied database read as an empty database", async () => {
  const load = await reader(() => true, () => { throw Object.assign(new Error("read denied"), { code: "EACCES" }); });
  assert.throws(load, /Database startup tidak dapat dibaca/);
});

test("startup can initialise a genuinely missing database and reads existing data unchanged", async () => {
  assert.deepEqual((await reader(() => false, () => { throw new Error("must not read"); }))(), { settings: {} });
  const db = { settings: { publicDomain: "https://example.test" }, resellers: [{ id: "existing" }] };
  assert.deepEqual((await reader(() => true, () => JSON.stringify(db)))(), db);
});
