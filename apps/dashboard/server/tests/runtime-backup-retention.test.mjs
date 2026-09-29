import assert from "node:assert/strict";
import test from "node:test";

import {
  isRuntimeBackupArtifactName,
  selectRuntimeBackupPostSendRemovals,
  selectRuntimeBackupRemovals,
} from "../../../../packages/shared/runtime-backup-retention.mjs";

test("runtime backup retention recognizes archives and encrypted transport copies", () => {
  assert.equal(isRuntimeBackupArtifactName("File Backup-2026-07-31T00-00-00-000Z-12.tar.gz"), true);
  assert.equal(isRuntimeBackupArtifactName("File Backup-2026-07-31T00-00-00-000Z-12.tar.gz.enc"), true);
  assert.equal(isRuntimeBackupArtifactName("kavya-runtime-backup-2026-07-31.json"), true);
  assert.equal(isRuntimeBackupArtifactName("kavya-db.json"), false);
  assert.equal(isRuntimeBackupArtifactName(".env"), false);
});

test("runtime backup retention preserves newest files and removes old or excess artifacts", () => {
  const now = Date.parse("2026-07-31T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const entries = [
    { name: "File Backup-new.tar.gz", mtimeMs: now - day },
    { name: "File Backup-second.tar.gz.enc", mtimeMs: now - 2 * day },
    { name: "File Backup-excess.tar.gz", mtimeMs: now - 3 * day },
    { name: "File Backup-old.tar.gz", mtimeMs: now - 10 * day },
    { name: "kavya-db.json", mtimeMs: now - 30 * day },
  ];

  const removed = selectRuntimeBackupRemovals(entries, {
    now,
    keep: 2,
    maxAgeMs: 7 * day,
  });

  assert.deepEqual(removed.map((entry) => entry.name), [
    "File Backup-excess.tar.gz",
    "File Backup-old.tar.gz",
  ]);
});

test("runtime backup post-send cleanup deletes transient backup after WhatsApp send succeeds", () => {
  const now = Date.parse("2026-07-31T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const entries = [
    { name: "File Backup-current.tar.gz", mtimeMs: now },
    { name: "File Backup-current.tar.gz.enc", mtimeMs: now },
    { name: "File Backup-old.tar.gz", mtimeMs: now - 3 * day },
    { name: "notes.txt", mtimeMs: now - 4 * day },
  ];

  const removed = selectRuntimeBackupPostSendRemovals(entries, {
    now,
    sent: true,
    deleteAfterSend: true,
    createdNames: ["File Backup-current.tar.gz", "File Backup-current.tar.gz.enc"],
    keep: 1,
    maxAgeMs: 7 * day,
  });

  assert.deepEqual(removed.map((entry) => entry.name), [
    "File Backup-current.tar.gz",
    "File Backup-current.tar.gz.enc",
    "File Backup-old.tar.gz",
  ]);
});

test("runtime backup post-send cleanup keeps the newest failed backup and removes older ones", () => {
  const now = Date.parse("2026-07-31T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const entries = [
    { name: "File Backup-current.tar.gz", mtimeMs: now },
    { name: "File Backup-old.tar.gz", mtimeMs: now - 3 * day },
    { name: "File Backup-older.tar.gz", mtimeMs: now - 4 * day },
  ];

  const removed = selectRuntimeBackupPostSendRemovals(entries, {
    now,
    sent: false,
    deleteAfterSend: true,
    createdNames: ["File Backup-current.tar.gz"],
    keep: 1,
    maxAgeMs: 7 * day,
  });

  assert.deepEqual(removed.map((entry) => entry.name), [
    "File Backup-old.tar.gz",
    "File Backup-older.tar.gz",
  ]);
});
