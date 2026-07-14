import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.resolve(process.env.RUNTIME_DIR || path.join(root, "apps/dashboard", "runtime"));
const tmpDir = path.resolve(process.env.RUNTIME_TMP_DIR || path.join(runtimeDir, "tmp"));
const backupDir = path.resolve(process.env.RUNTIME_BACKUP_DIR || path.join(runtimeDir, "backups"));
const tmpMaxAgeMs = Math.max(60_000, Number(process.env.RUNTIME_TMP_MAX_AGE_MS || 24 * 60 * 60 * 1000));
const backupMaxAgeMs = Math.max(
  24 * 60 * 60 * 1000,
  Number(process.env.RUNTIME_BACKUP_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000),
);
const backupKeep = Math.max(1, Number(process.env.RUNTIME_BACKUP_KEEP || 30));

function isInsideOrEqual(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function listEntries(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const output = [];
  for (const entry of entries) {
    const target = path.resolve(dir, entry.name);
    if (!isInsideOrEqual(target, dir) || target === dir) {
      continue;
    }
    const info = await stat(target).catch(() => null);
    if (info) {
      output.push({ target, name: entry.name, mtimeMs: info.mtimeMs, isDirectory: entry.isDirectory() });
    }
  }
  return output;
}

async function cleanOldTmp() {
  const cutoff = Date.now() - tmpMaxAgeMs;
  let removed = 0;
  for (const entry of await listEntries(tmpDir)) {
    if (entry.mtimeMs <= cutoff) {
      await rm(entry.target, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

async function cleanOldBackups() {
  const entries = (await listEntries(backupDir))
    .filter((entry) => /^(kavya|vya)-runtime-backup-.*\.json$/i.test(entry.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cutoff = Date.now() - backupMaxAgeMs;
  let removed = 0;

  for (const [index, entry] of entries.entries()) {
    if (index >= backupKeep || entry.mtimeMs <= cutoff) {
      await rm(entry.target, { recursive: true, force: true });
      removed += 1;
    }
  }

  return removed;
}

async function main() {
  await mkdir(runtimeDir, { recursive: true });
  const [tmpRemoved, backupRemoved] = await Promise.all([cleanOldTmp(), cleanOldBackups()]);
  console.log(
    JSON.stringify(
      {
        success: true,
        runtime_dir: runtimeDir,
        tmp_removed: tmpRemoved,
        backup_removed: backupRemoved,
        protected: ["runtime/pglite", "runtime/baileys-auth"],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
