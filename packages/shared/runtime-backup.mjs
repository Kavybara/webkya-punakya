import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

export function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function readJsonIfExists(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

export async function readJsonDirectory(dirPath) {
  const files = {};
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    files[entry.name] = await readJsonIfExists(path.join(dirPath, entry.name), {});
  }
  return files;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function relativePath(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function isInsideOrEqual(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readFileBundle(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const excludeDirNames = new Set(
    (options.excludeDirNames || [".git", "node_modules", "backups", "tmp"]).map((item) => String(item).toLowerCase()),
  );
  const excludeFileNames = new Set((options.excludeFileNames || []).map((item) => String(item).toLowerCase()));
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
  const files = {};
  const skipped = [];

  if (!fsSync.existsSync(root)) {
    return { root, files, skipped: [{ path: "", reason: "missing_dir" }], count: 0 };
  }

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = relativePath(root, fullPath);
      if (entry.isDirectory()) {
        if (excludeDirNames.has(entry.name.toLowerCase())) {
          skipped.push({ path: rel, reason: "excluded_dir" });
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (excludeFileNames.has(entry.name.toLowerCase())) {
        skipped.push({ path: rel, reason: "excluded_file" });
        continue;
      }
      const stat = await fs.stat(fullPath);
      if (stat.size > maxFileBytes) {
        skipped.push({ path: rel, reason: "file_too_large", size: stat.size });
        continue;
      }

      const buffer = await fs.readFile(fullPath);
      files[rel] = {
        encoding: "base64",
        size: buffer.length,
        sha256: sha256(buffer),
        mtime: stat.mtime.toISOString(),
        content: buffer.toString("base64"),
      };
    }
  }

  await walk(root);
  return { root, files, skipped, count: Object.keys(files).length };
}

/*
 * Files that must never enter a backup archive, by name, in any directory.
 *
 * `.env` was previously swept in by the recursive walk below, which is how a
 * backup that nobody thought of as secret ended up carrying live production
 * credentials: `AUTH_SECRET`, `SESSION_SECRET`, `CLOUDFLARED_TOKEN`,
 * `PAKASIR_API_KEY`, the Gmail app password, `OWNER_PASSWORD`. It left the host
 * over WhatsApp on the scheduler every 24h.
 *
 * The walk excludes these by name rather than by path, because `.env` can sit at
 * any level in a monorepo and only the basename is consistent.
 *
 * Cost of excluding: `GOOGLE_SHEETS_*` no longer travels with the archive, so a
 * restore re-authenticates Sheets. That is the right trade -- `docs/RESTORE.md`
 * already warns that a stale shipped `.env` overwrites newer VPS config, so the
 * file was a restore hazard as much as a leak.
 */
const SECRET_FILE_NAMES = new Set([".env", "backup_encryption_key.txt"]);

async function readProjectSourceBundle(rootDir) {
  const root = path.resolve(rootDir);
  const excludeDirNames = new Set([
    ".git",
    "node_modules",
    "database",
    "runtime",
    "runtime-test-backups",
    "backups",
    "tmp",
    "coverage",
    ".next",
    "pglite",
    "release",
    "outputs",
    "test-results",
  ]);
  const files = {};
  const skipped = [];

  if (!fsSync.existsSync(root)) {
    return { root, files, skipped: [{ path: "", reason: "missing_dir" }], count: 0 };
  }

  async function walk(currentPath, relativeBase = "") {
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const rel = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (excludeDirNames.has(entry.name.toLowerCase())) {
          skipped.push({ path: rel, reason: "excluded_dir" });
          continue;
        }
        await walk(fullPath, rel);
        continue;
      }

      if (!entry.isFile()) continue;
      if (SECRET_FILE_NAMES.has(entry.name.toLowerCase())) {
        skipped.push({ path: rel, reason: "secret_file" });
        continue;
      }
      if (isGeneratedBackupFileName(entry.name) || /\.(?:tar\.gz|tgz|zip|enc)$/i.test(entry.name)) {
        skipped.push({ path: rel, reason: "excluded_file" });
        continue;
      }

      const stat = await fs.stat(fullPath);
      if (stat.size > DEFAULT_MAX_FILE_BYTES) {
        skipped.push({ path: rel, reason: "file_too_large", size: stat.size });
        continue;
      }

      const buffer = await fs.readFile(fullPath);
      files[rel] = {
        encoding: "base64",
        size: buffer.length,
        sha256: sha256(buffer),
        mtime: stat.mtime.toISOString(),
        content: buffer.toString("base64"),
      };
    }
  }

  await walk(root);
  return { root, files, skipped, count: Object.keys(files).length };
}

function activeRentalCount(legacyRentals = {}) {
  return Object.keys(legacyRentals || {}).filter((groupJid) => {
    const rental = legacyRentals[groupJid];
    return String(groupJid).endsWith("@g.us") && Number(rental?.expired || 0) > Date.now();
  }).length;
}

export async function createRuntimeBackupPayload(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const dashboardDir = path.join(rootDir, "apps/dashboard");
  const runtimeDir = path.resolve(options.runtimeDir || process.env.RUNTIME_DIR || path.join(dashboardDir, "runtime"));
  const dashboardDbPath = path.resolve(options.dashboardDbPath || process.env.DATABASE_PATH || path.join(runtimeDir, "kavya-db.json"));
  const whatsappDbDir = path.resolve(options.whatsappDbDir || process.env.WHATSAPP_DATABASE_DIR || path.join(runtimeDir, "whatsapp-database"));
  const baileysAuthDir = path.resolve(options.baileysAuthDir || process.env.BAILEYS_AUTH_DIR || path.join(runtimeDir, "baileys-auth"));
  const whatsappServiceRuntimeDir = path.resolve(options.whatsappServiceRuntimeDir || path.join(rootDir, "apps", "bot", "runtime"));

  const dashboardDb = await readJsonIfExists(dashboardDbPath, {});
  const whatsappRuntime = await readJsonDirectory(whatsappDbDir);
  const includeLegacyData = /^(1|true|yes|on)$/i.test(String(process.env.RUNTIME_BACKUP_INCLUDE_LEGACY_DATA || ""));
  const whatsappSource = includeLegacyData ? await readJsonDirectory(path.join(rootDir, "apps", "bot", "database")) : {};
  const legacyRootRuntime = includeLegacyData ? await readJsonDirectory(path.join(rootDir, "runtime")) : {};
  const legacyDatabase = includeLegacyData
    ? {
        "list.json": await readJsonIfExists(path.join(rootDir, "database", "list.json"), {}),
        "sewa.json": await readJsonIfExists(path.join(rootDir, "database", "sewa.json"), {}),
        "group.json": await readJsonIfExists(path.join(rootDir, "database", "group.json"), {}),
        "group_backup.json": await readJsonIfExists(path.join(rootDir, "database", "group_backup.json"), {}),
        "additional/group participant.json": await readJsonIfExists(path.join(rootDir, "database", "additional", "group participant.json"), {}),
      }
    : {};
  const envExample = await readTextIfExists(path.join(rootDir, ".env.example"));

  /*
   * `baileys-auth` holds a paired WhatsApp device session. Whoever holds it can
   * send as this account, so it is account-takeover material rather than backup
   * data -- and it was shipping over WhatsApp itself, to a chat that cloud-syncs
   * to every paired device.
   *
   * It is opt-in rather than removed. `docs/RESTORE.md:278` already tells the
   * reader to re-scan the QR when `baileys-auth` is absent, so the restore path
   * is designed to survive without it; but a deliberate operator on a locked-down
   * VPS may still want the session captured. So: off unless asked for.
   */
  const includeWhatsAppSession = /^(1|true|yes|on)$/i.test(
    String(process.env.RUNTIME_BACKUP_INCLUDE_WHATSAPP_SESSION || ""),
  );

  const fileBundles = {
    database: includeLegacyData
      ? await readFileBundle(path.join(rootDir, "database"), {
          excludeDirNames: [".git", "node_modules"],
        })
      : { root: path.join(rootDir, "database"), files: {}, skipped: [{ path: "", reason: "legacy_data_disabled" }], count: 0 },
    dashboard_runtime: await readFileBundle(runtimeDir, {
      excludeDirNames: [".git", "node_modules", "backups", "tmp", "pglite", "baileys-auth"],
    }),
    whatsapp_auth: includeWhatsAppSession
      ? await readFileBundle(baileysAuthDir, {
          excludeDirNames: [".git", "node_modules", "backups", "tmp"],
        })
      : {
          root: baileysAuthDir,
          files: {},
          skipped: [{ path: "", reason: "whatsapp_session_excluded" }],
          count: 0,
        },
    whatsapp_service_runtime: await readFileBundle(whatsappServiceRuntimeDir, {
      excludeDirNames: [".git", "node_modules", "backups", "tmp"],
    }),
    project_source: await readProjectSourceBundle(rootDir),
  };

  return {
    backup_version: 4,
    app: "kavya",
    reason: options.reason || "manual",
    created_at: new Date().toISOString(),
    paths: {
      root: rootDir,
      dashboard_db: dashboardDbPath,
      whatsapp_runtime_db: whatsappDbDir,
      whatsapp_auth: baileysAuthDir,
      whatsapp_service_runtime: whatsappServiceRuntimeDir,
    },
    notes: {
      env: "Raw .env ikut disalin agar backup WhatsApp bisa dipakai memulihkan VPS baru tanpa konfigurasi ulang dari nol.",
      excluded_runtime_dirs: "Folder backup/tmp/node_modules/pglite tidak dimasukkan supaya backup tidak rekursif dan tidak membengkak.",
      project_source: "Seluruh source project utama ikut disalin dengan pendekatan full-project backup, kecuali artefak besar, data legacy, dan folder temporary yang memang tidak perlu dibawa dua kali.",
      legacy_data: includeLegacyData
        ? "Data legacy root ikut disalin karena RUNTIME_BACKUP_INCLUDE_LEGACY_DATA aktif."
        : "Data legacy root/database/apps/bot/database tidak ikut; data aktif dipulihkan dari runtime dashboard.",
    },
    dashboard: dashboardDb,
    whatsapp_runtime: whatsappRuntime,
    whatsapp_source: whatsappSource,
    legacy_root_runtime: legacyRootRuntime,
    legacy_database: legacyDatabase,
    file_bundles: fileBundles,
    env_example: envExample,
    counts: {
      products: dashboardDb?.products?.length || 0,
      stock: dashboardDb?.stock?.length || 0,
      orders: dashboardDb?.orders?.length || 0,
      resellers: dashboardDb?.resellers?.length || 0,
      managed_accounts: dashboardDb?.managedAccounts?.length || 0,
      whatsapp_active_rentals: Object.keys(whatsappRuntime?.["rentals.json"] || {}).length,
      database_files: includeLegacyData ? fileBundles.database.count : 0,
      dashboard_runtime_files: fileBundles.dashboard_runtime.count,
      whatsapp_auth_files: fileBundles.whatsapp_auth.count,
      whatsapp_service_runtime_files: fileBundles.whatsapp_service_runtime.count,
      project_source_files: fileBundles.project_source.count,
    },
  };
}

async function writeStagedFile(stageDir, relativeFilePath, content) {
  const normalizedRelative = String(relativeFilePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalizedRelative || normalizedRelative.includes("../")) return;
  const target = path.resolve(stageDir, normalizedRelative);
  if (!isInsideOrEqual(target, stageDir)) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function writeStagedJson(stageDir, relativeFilePath, value) {
  await writeStagedFile(stageDir, relativeFilePath, `${JSON.stringify(value ?? {}, null, 2)}\n`, "utf8");
}

async function writeJsonDirectory(stageDir, baseDir, files = {}) {
  for (const [fileName, value] of Object.entries(files || {})) {
    await writeStagedJson(stageDir, path.join(baseDir, fileName), value);
  }
}

async function writeFileBundle(stageDir, baseDir, bundle = {}) {
  for (const [fileName, entry] of Object.entries(bundle?.files || {})) {
    if (entry?.encoding !== "base64" || !entry?.content) continue;
    await writeStagedFile(stageDir, path.join(baseDir, fileName), Buffer.from(entry.content, "base64"));
  }
}

function isGeneratedBackupFileName(fileName = "") {
  const lower = String(fileName || "").toLowerCase();
  return (
    lower === "file backup" ||
    lower === "file backup.json" ||
    lower === "file backup.zip" ||
    lower === "file backup.tar.gz" ||
    /^file backup-[0-9t-]+\.tar\.gz$/i.test(lower) ||
    lower.startsWith("kavya-runtime-backup-")
  );
}

async function cleanupStaleBackupStages(targetDir) {
  const maxAgeMs = Math.max(60_000, Number(process.env.RUNTIME_BACKUP_STAGE_MAX_AGE_MS || 30 * 60 * 1000));
  const cutoff = Date.now() - maxAgeMs;
  const entries = await fs.readdir(targetDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(".file-backup-stage")) continue;
    const stagePath = path.join(targetDir, entry.name);
    if (!isInsideOrEqual(stagePath, targetDir)) continue;
    const info = await fs.stat(stagePath).catch(() => null);
    if (!info || info.mtimeMs > cutoff) continue;
    await fs.rm(stagePath, { recursive: true, force: true }).catch(() => {});
  }
}

function relativeBundleBase(payload = {}, absolutePath = "", fallback = "") {
  const root = payload.paths?.root || "";
  if (!root || !absolutePath) return fallback;
  const relative = path.relative(root, absolutePath).split(path.sep).join("/");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return fallback;
  return relative;
}

async function writeUploadableArchive({ payload, outputDir, fileName }) {
  const targetDir = path.resolve(outputDir || process.env.RUNTIME_BACKUP_DIR || path.join(process.cwd(), "runtime", "backups"));
  await fs.mkdir(targetDir, { recursive: true });
  const archiveName = path.basename(fileName || process.env.RUNTIME_BACKUP_FILE_NAME || `File Backup-${safeTimestamp()}-${process.pid}.tar.gz`);
  const filePath = path.join(targetDir, archiveName);
  const stageDir = path.join(targetDir, `.file-backup-stage-${process.pid}-${safeTimestamp()}`);
  if (!isInsideOrEqual(stageDir, targetDir)) {
    throw new Error("invalid_backup_stage_dir");
  }

  await cleanupStaleBackupStages(targetDir);
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.mkdir(stageDir, { recursive: true });

  try {
    await writeStagedJson(stageDir, "File Backup.json", payload);
    await writeStagedFile(
      stageDir,
      "BACKUP-README.txt",
      [
        "File Backup Kavya",
        "",
        "Upload dan extract arsip ini ke root aplikasi pada VPS/Linux untuk memulihkan data runtime.",
        "Isi utama: full source project, file .env, database/list, sewa grup, setting grup, produk, stok, order, reseller, deposit, managed account, dan auth WhatsApp jika tersedia.",
        "Folder node_modules, tmp, backup lama, release/output besar, dan runtime test tidak ikut agar file tidak membengkak.",
        "Karena .env ikut disalin, file backup ini harus diperlakukan sebagai file rahasia.",
        "",
      ].join("\n"),
    );
    if (payload.env_example) {
      await writeStagedFile(stageDir, ".env.example", payload.env_example);
    }

    await writeStagedJson(stageDir, "apps/dashboard/runtime/kavya-db.json", payload.dashboard || {});
    await writeJsonDirectory(stageDir, "apps/dashboard/runtime/whatsapp-database", payload.whatsapp_runtime || {});
    if (Object.keys(payload.whatsapp_source || {}).length) {
      await writeJsonDirectory(stageDir, "apps/bot/database", payload.whatsapp_source || {});
    }
    if (Object.keys(payload.legacy_root_runtime || {}).length) {
      await writeJsonDirectory(stageDir, "runtime", payload.legacy_root_runtime || {});
    }
    if (Object.keys(payload.legacy_database || {}).length) {
      await writeJsonDirectory(stageDir, "database", payload.legacy_database || {});
    }

    if (payload.file_bundles?.database?.count) {
      await writeFileBundle(stageDir, "database", payload.file_bundles?.database);
    }
    await writeFileBundle(stageDir, "apps/dashboard/runtime", payload.file_bundles?.dashboard_runtime);
    await writeFileBundle(
      stageDir,
      relativeBundleBase(payload, payload.paths?.whatsapp_auth, "apps/dashboard/runtime/baileys-auth"),
      payload.file_bundles?.whatsapp_auth,
    );
    await writeFileBundle(
      stageDir,
      relativeBundleBase(payload, payload.paths?.whatsapp_service_runtime, "apps/bot/runtime"),
      payload.file_bundles?.whatsapp_service_runtime,
    );
    await writeFileBundle(stageDir, ".", payload.file_bundles?.project_source);

    // The archive is written from inside its own directory, by bare file name,
    // so no Windows drive letter ever reaches tar's argument list. That matters
    // because GNU tar reads "C:\out.tar.gz" as the remote host "C:" and fails
    // with "Cannot connect to C: resolve failed" -- and the obvious remedy,
    // --force-local, is a GNU-only flag that bsdtar rejects outright. bsdtar is
    // the `tar.exe` that ships with Windows and the one that wins PATH
    // resolution by default there, so the flag made this call fail outright on
    // every default Windows install while working fine on the Linux VPS.
    // Keeping the drive letter out of the arguments is correct on both flavors
    // and needs neither the flag nor the GNU assumption.
    const result = spawnSync("tar", ["-czf", path.basename(filePath), "-C", stageDir, "."], {
      cwd: path.dirname(filePath),
      stdio: "pipe",
      shell: false,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString()?.trim() || result.error?.message || "tar_failed");
    }
    await fs.chmod(filePath, 0o600).catch(() => {});
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }

  return { fileName: archiveName, filePath, counts: payload.counts };
}

export async function writeRuntimeBackupFile({ payload, outputDir }) {
  return writeUploadableArchive({ payload, outputDir });
}

/**
 * AES-256-GCM encrypts an archive for transport.
 *
 * This used to live inline in `scripts/maintenance/runtime-backup.mjs`, which
 * meant only the manual path was protected: the bot's 24-hour scheduler called
 * `writeRuntimeBackupFile` and sent the result unencrypted. One implementation,
 * both callers, so the two paths cannot drift apart again.
 *
 * The passphrase is read from the environment rather than from the backup, and
 * `BACKUP_ENCRYPTION_KEY` is now excluded from the payload -- an archive that
 * carries its own decryption key is not encrypted, it is just base64 with a
 * header. It hard-fails below 16 characters rather than sending a weakly keyed
 * file that looks protected.
 */
export async function encryptBackupForTransport(backup, options = {}) {
  const passphrase = String(options.passphrase ?? process.env.BACKUP_ENCRYPTION_KEY ?? "").trim();
  /*
   * Rejects the documented placeholders, not just short values.
   *
   * `.env.example:19` ships `BACKUP_ENCRYPTION_KEY=replace-with-a-separate-long-backup-passphrase`,
   * which is 49 characters and would sail past a length check alone -- so an
   * operator who copied the example and never edited it would encrypt every
   * backup to a passphrase published in the repo. This mirrors `usableSecret`
   * in `scripts/maintenance/runtime-backup.mjs`, which is where the manual path
   * already guarded against exactly this.
   */
  if (passphrase.length < 16 || /^(change-me|your-|replace-)/i.test(passphrase)) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY wajib diisi minimal 16 karakter sebelum backup dikirim ke WhatsApp",
    );
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = await fs.readFile(backup.filePath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = Buffer.from(
    `${JSON.stringify({
      version: 1,
      algorithm: "aes-256-gcm",
      salt: salt.toString("base64url"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    })}\n`,
  );
  const encryptedPath = `${backup.filePath}.enc`;
  await fs.writeFile(encryptedPath, Buffer.concat([Buffer.from("KAVYA-BACKUP-V1\n"), header, ciphertext]), {
    mode: 0o600,
  });
  return { ...backup, filePath: encryptedPath, fileName: `${backup.fileName}.enc` };
}
