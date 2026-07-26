import path from "node:path";

export function createSettingsStartupMigrationService(options) {
  const {
    databasePath,
    fsApi,
    makeId,
    migration,
    now = () => new Date(),
    nowText = () => new Date().toISOString(),
  } = options;

  async function run(db) {
    const preview = migration.preview(db);
    if (!preview.changed) {
      return { ...preview, backupCreated: false, backupPath: "" };
    }

    const backupDirectory = path.join(path.dirname(databasePath), "backups");
    const backupTimestamp = now().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      backupDirectory,
      `kavya-db.settings-v${preview.fromVersion}-to-v${preview.toVersion}.${backupTimestamp}.json`,
    );
    await fsApi.mkdir(backupDirectory, { recursive: true });
    await fsApi.copyFile(databasePath, backupPath);

    const result = migration.apply(db);
    db.activities = db.activities || [];
    db.activities.unshift({
      id: makeId("act"),
      type: "system",
      title: "Migrasi konfigurasi selesai",
      description: `Schema settings diperbarui dari versi ${result.fromVersion} ke ${result.toVersion}.`,
      createdAt: nowText(),
      actorRole: "system",
      actorName: "startup",
    });
    return { ...result, backupCreated: true, backupPath };
  }

  return { run };
}
