import assert from "node:assert/strict";
import test from "node:test";

import { createSettingsMigrationService } from "../services/settings-migration-service.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("legacy settings migrate to the current version while preserving unknown fields", () => {
  const db = {
    settings: {
      pakasirProject: "merchant-legacy",
      botPublicUrl: "https://legacy.example",
      unknownLegacyField: { keep: true },
      secretValue: "do-not-log",
    },
  };
  const migration = createSettingsMigrationService({ nowText: () => "2026-07-26T12:00:00.000Z" });
  const preview = migration.preview(db);

  assert.equal(preview.changed, true);
  assert.equal(preview.settings.pakasirMerchantId, "merchant-legacy");
  assert.equal(preview.settings.publicDomain, "https://legacy.example");
  assert.deepEqual(preview.settings.unknownLegacyField, { keep: true });
  assert.equal(db.settings.settingsSchemaVersion, undefined);

  const result = migration.apply(db);
  assert.equal(result.toVersion, 1);
  assert.equal(db.settings.settingsSchemaVersion, 1);
});

test("settings migration is idempotent", () => {
  const db = { settings: { settingsSchemaVersion: 1, custom: "preserved" } };
  const before = clone(db);
  const migration = createSettingsMigrationService();
  const result = migration.apply(db);

  assert.equal(result.changed, false);
  assert.deepEqual(db, before);
});

test("failed settings migration does not partially mutate the source", () => {
  const db = { settings: { settingsSchemaVersion: -1, custom: "preserved" } };
  const before = clone(db);
  const migration = createSettingsMigrationService({
    nowText: () => {
      throw new Error("clock failed");
    },
  });

  assert.throws(() => migration.apply(db), /clock failed/);
  assert.deepEqual(db, before);
});

test("a newer settings schema is never downgraded", () => {
  const db = { settings: { settingsSchemaVersion: 2, custom: "preserved" } };
  const before = clone(db);
  const migration = createSettingsMigrationService();

  assert.throws(() => migration.apply(db), /lebih baru/);
  assert.deepEqual(db, before);
});
