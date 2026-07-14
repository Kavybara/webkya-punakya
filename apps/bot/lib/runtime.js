import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { logSuccess, logWarning } from "./panel-log.js";

export function isInsideOrEqual(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function ensureRuntimeDirs(config) {
  await mkdir(config.paths.runtimeDir, { recursive: true });
  await mkdir(config.paths.tmpDir, { recursive: true });
  await mkdir(config.paths.authDir, { recursive: true });
  await mkdir(config.paths.backupDir, { recursive: true });
  await mkdir(config.database.dir, { recursive: true });
}

export async function cleanupTmpDir(config, logger) {
  await mkdir(config.paths.tmpDir, { recursive: true });
  const entries = await readdir(config.paths.tmpDir, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - config.tmp.maxAgeMs;

  for (const entry of entries) {
    const target = path.resolve(config.paths.tmpDir, entry.name);
    if (!isInsideOrEqual(target, config.paths.tmpDir) || target === config.paths.tmpDir) {
      continue;
    }

    const info = await stat(target).catch(() => null);
    if (!info || info.mtimeMs > cutoff) {
      continue;
    }

    await rm(target, { recursive: true, force: true }).catch((error) => {
      logWarning(`Failed to clean old tmp entry ${target}`, error);
    });
  }
  logSuccess("Cache cleaned successfully.");
}
