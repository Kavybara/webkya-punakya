import assert from "node:assert/strict";
import test from "node:test";

import { createSettingsMigrationService } from "../services/settings-migration-service.js";
import { createSettingsStartupMigrationService } from "../services/settings-startup-migration-service.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFixture(overrides = {}) {
  const events = [];
  const fsApi = {
    mkdir: async () => events.push("mkdir"),
    copyFile: async () => events.push("backup"),
    ...overrides.fsApi,
  };
  const migration = createSettingsMigrationService({ nowText: () => "2026-07-26T10:00:00.000Z" });
  return {
    events,
    service: createSettingsStartupMigrationService({
      databasePath: "C:/runtime/kavya-db.json",
      fsApi,
      makeId: () => "act-migration",
      migration,
      now: () => new Date("2026-07-26T10:00:00.000Z"),
      nowText: () => "2026-07-26T10:00:00.000Z",
    }),
  };
}

test("startup migration creates a backup before mutating settings", async () => {
  const db = { settings: { pakasirProject: "legacy" }, activities: [] };
  const { events, service } = createFixture();

  const result = await service.run(db);

  assert.deepEqual(events, ["mkdir", "backup"]);
  assert.equal(result.backupCreated, true);
  assert.equal(db.settings.settingsSchemaVersion, 1);
  assert.equal(db.settings.pakasirMerchantId, "legacy");
  assert.equal(db.activities[0].id, "act-migration");
  assert.equal(JSON.stringify(db.activities[0]).includes("legacy"), false);
});

test("backup failure leaves settings and activities byte-equivalent", async () => {
  const db = { settings: { pakasirProject: "legacy" }, activities: [{ id: "existing" }] };
  const before = clone(db);
  const { service } = createFixture({
    fsApi: {
      copyFile: async () => {
        throw new Error("backup failed");
      },
    },
  });

  await assert.rejects(() => service.run(db), /backup failed/);
  assert.deepEqual(db, before);
});

test("current schema is idempotent and creates no backup or activity", async () => {
  const db = { settings: { settingsSchemaVersion: 1 }, activities: [] };
  const before = clone(db);
  const { events, service } = createFixture();

  const result = await service.run(db);

  assert.equal(result.changed, false);
  assert.equal(result.backupCreated, false);
  assert.deepEqual(events, []);
  assert.deepEqual(db, before);
});
