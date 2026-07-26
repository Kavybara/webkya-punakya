const CURRENT_SETTINGS_SCHEMA_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function migrateToVersionOne(settings) {
  if (!settings.pakasirMerchantId && settings.pakasirProject) {
    settings.pakasirMerchantId = settings.pakasirProject;
  }
  if (!settings.publicDomain && settings.botPublicUrl) {
    settings.publicDomain = settings.botPublicUrl;
  }
}

export function createSettingsMigrationService(options = {}) {
  const nowText = options.nowText || (() => new Date().toISOString());

  function preview(db = {}) {
    const source = clone(db.settings || {});
    const next = clone(source);
    const fromVersion = Math.max(0, Number(source.settingsSchemaVersion || 0));
    if (fromVersion > CURRENT_SETTINGS_SCHEMA_VERSION) {
      throw new Error(
        `Settings schema ${fromVersion} lebih baru dari versi aplikasi ${CURRENT_SETTINGS_SCHEMA_VERSION}`,
      );
    }
    let version = fromVersion;
    if (version < 1) {
      migrateToVersionOne(next);
      version = 1;
    }
    if (version < CURRENT_SETTINGS_SCHEMA_VERSION) {
      throw new Error(`Settings schema ${version} belum memiliki jalur migrasi ke ${CURRENT_SETTINGS_SCHEMA_VERSION}`);
    }
    next.settingsSchemaVersion = CURRENT_SETTINGS_SCHEMA_VERSION;
    if (fromVersion !== CURRENT_SETTINGS_SCHEMA_VERSION) {
      next.settingsMigratedAt = nowText();
      next.settingsMigrationFromVersion = fromVersion;
    }
    return {
      changed: JSON.stringify(source) !== JSON.stringify(next),
      fromVersion,
      toVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      settings: next,
    };
  }

  function apply(db = {}) {
    const result = preview(db);
    if (!result.changed) return { ...result, changedFields: [] };
    const before = db.settings || {};
    const changedFields = [...new Set([...Object.keys(before), ...Object.keys(result.settings)])]
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(result.settings[key]));
    db.settings = result.settings;
    return { ...result, changedFields };
  }

  return {
    currentVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    preview,
    apply,
  };
}

export { CURRENT_SETTINGS_SCHEMA_VERSION };
