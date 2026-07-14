import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const launcherDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

function hasProjectShape(dir) {
  return existsSync(path.join(dir, "package.json"))
    && existsSync(path.join(dir, "apps", "dashboard"))
    && existsSync(path.join(dir, "apps", "bot"));
}

function findProjectRoot() {
  let candidate = launcherDir;
  while (true) {
    if (hasProjectShape(candidate)) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }

  let entries = [];
  try {
    entries = readdirSync(launcherDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(launcherDir, entry.name);
    if (hasProjectShape(candidate)) return candidate;
  }
  return launcherDir;
}

const root = findProjectRoot();
const dashboardDir = path.join(root, "apps/dashboard");
const whatsappDir = path.join(root, "apps", "bot");
const importLegacyScript = path.join(root, "scripts", "deploy", "import-legacy-wa-backup.mjs");
const runtimeBackupScript = path.join(root, "scripts", "maintenance", "runtime-backup.mjs");

const CHECK = "[√]";
const CROSS = "[×]";
const WARN = "⚠️";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function useColor() {
  return !process.env.NO_COLOR;
}

function color(value, ansi) {
  return useColor() ? `${ansi}${value}${RESET}` : value;
}

function logOk(message) {
  console.log(`${color(CHECK, GREEN)} ${message}`);
}

function logWarn(message) {
  console.warn(`${color(WARN, YELLOW)} ${message}`);
}

function logFail(message) {
  console.error(`${color(CROSS, RED)} ${message}`);
}

function stripAnsi(value = "") {
  return String(value).replace(/\x1b\[[0-9;]*m/g, "");
}

function serviceLabel(name) {
  return {
    DASHBOARD: "Dashboard",
    WHATSAPP: "WhatsApp",
    TUNNEL: "Tunnel",
    BACKUP: "Backup",
  }[name] || name;
}

if (root !== launcherDir) {
  logOk(`Project root terdeteksi di folder nested: ${root}`);
}

function loadRootEnvFile() {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function isDisabled(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return /^(0|false|no|off)$/i.test(String(value).trim());
}

function isEnabled(value, fallback = false) {
  return !isDisabled(value, !fallback);
}

function usableSecret(value) {
  const text = String(value || "").trim();
  if (!text || /^(change-me|change-this|replace-with|your-)/i.test(text)) return "";
  return text;
}

function firstConfigured(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function cleanUrl(value, fallback) {
  const text = firstConfigured(value, fallback).replace(/\/$/, "");
  if (!text || /your-domain\.example/i.test(text)) return String(fallback || "").replace(/\/$/, "");
  return text;
}

function randomSecret(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function describeRootContents() {
  try {
    return readdirSync(root, { withFileTypes: true })
      .slice(0, 40)
      .map((entry) => `${entry.isDirectory() ? "[dir] " : "[file]"} ${entry.name}`)
      .join("\n");
  } catch (error) {
    return `Tidak bisa membaca folder root: ${error.message}`;
  }
}

function assertProjectTree() {
  const missing = [
    ["apps/dashboard", dashboardDir],
    ["apps/bot", whatsappDir],
  ].filter(([, target]) => !existsSync(target));
  if (!missing.length) return;
  logFail("Struktur upload tidak lengkap. Folder wajib tidak ditemukan:");
  for (const [name] of missing) console.error(`- ${name}`);
  logFail(`Root yang dibaca launcher: ${root}`);
  logFail("Isi root saat ini:");
  console.error(describeRootContents());
  logFail("Hapus file upload lama di Pterodactyl, upload zip/tar terbaru, lalu extract ke /home/container.");
  process.exit(1);
}

function npmCommand() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return { command: process.execPath, prefixArgs: [process.env.npm_execpath] };
  }
  const unixNpm = "/usr/local/bin/npm";
  if (process.platform !== "win32" && existsSync(unixNpm)) {
    return { command: unixNpm, prefixArgs: [] };
  }
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", prefixArgs: [] };
}

function runSetupStep(name, command, args, options = {}) {
  logOk(name);
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    const detail = result.error?.message || result.signal || result.status;
    logFail(`${name} failed with ${detail}`);
    if (options.required === false) return false;
    process.exit(result.status || 1);
  }
  return true;
}

function summarizeLegacyImportOutput(rawOutput = "") {
  const text = String(rawOutput || "").trim();
  if (!text) return `${CHECK} Import legacy selesai.`;
  try {
    const result = JSON.parse(text);
    const counts = result.counts || {};
    const status = result.skipped ? `dilewati (${result.skip_reason || "skipped"})` : "selesai";
    const dashboard = result.dashboard?.merged !== undefined ? `, dashboard ${result.dashboard.merged}` : "";
    return `${CHECK} Import legacy ${status}: ${counts.list_keywords || 0} list, ${counts.active_rentals || 0} sewa aktif, ${counts.group_settings || 0} grup${dashboard}`;
  } catch {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-6)
      .join("\n");
  }
}

function runLegacyImportStep(args, options = {}) {
  logOk("Import legacy WhatsApp lists/sewa");
  const result = spawnSync("node", args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === "win32",
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) {
    const detail = result.error?.message || result.signal || result.status;
    logFail(`Import legacy failed with ${detail}`);
    if (output.trim()) console.error(summarizeLegacyImportOutput(output));
    if (options.required === false) return false;
    process.exit(result.status || 1);
  }
  console.log(summarizeLegacyImportOutput(output));
  return true;
}

function runNpmSetupStep(name, args, options = {}) {
  const npm = npmCommand();
  return runSetupStep(name, npm.command, [...npm.prefixArgs, ...args], options);
}

function ensureExecutable(command) {
  if (process.platform === "win32" || !command || !existsSync(command)) return;
  try {
    chmodSync(command, 0o755);
  } catch (error) {
    logWarn(`Gagal set executable permission untuk ${command}: ${error.message}`);
  }
}

function packageDependenciesReady(packageDir) {
  const modulesDir = path.join(packageDir, "node_modules");
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!existsSync(modulesDir) || !existsSync(packageJsonPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const dependencyNames = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    return dependencyNames.every((name) => existsSync(path.join(modulesDir, ...name.split("/"))));
  } catch {
    return false;
  }
}

let shuttingDown = false;
const children = [];
const restartCounters = new Map();

function nextRestartDelayMs(name) {
  const count = (restartCounters.get(name) || 0) + 1;
  restartCounters.set(name, count);
  return Math.min(60_000, 5000 * count);
}

function scheduleServiceRestart(name, command, args, options = {}) {
  const delayMs = nextRestartDelayMs(name);
  logWarn(`${serviceLabel(name)} restart in ${Math.ceil(delayMs / 1000)}s`);
  setTimeout(() => {
    if (shuttingDown) return;
    if (options.isolated) {
      spawnIsolatedService(name, command, args, options);
      return;
    }
    spawnService(name, command, args, options);
  }, delayMs).unref();
}

function shouldWriteServiceLine(name, line) {
  const text = stripAnsi(String(line || "").trimEnd());
  if (!text) return false;
  if (name === "WHATSAPP") {
    if (/^(Closing session:|Opening session:|Removing old closed session:|Migrating session to:)/i.test(text)) return false;
    if (/^SessionEntry\s*\{|^\s*(_chains|registrationId|currentRatchet|indexInfo|ephemeralKeyPair|pubKey|privKey|lastRemoteEphemeralKey|previousCounter|rootKey|baseKey|baseKeyType|closed|used|created|remoteIdentityKey|chainKey|chainType|messageKeys):/i.test(text)) return false;
    if (/^\s*[{}]},?\s*$/.test(text)) return false;
    if (/Decrypted message with closed session|Failed to decrypt message with any known session|Session error:|Bad MAC|No matching sessions found for message/i.test(text)) return false;
    if (/node_modules\/libsignal\/src\/(crypto|session_cipher|queue_job)\.js/i.test(text)) return false;
    if (/^\s*at\s+.*node_modules\/libsignal\//i.test(text)) return false;
  }
  if (name !== "TUNNEL") return true;
  if (/\b(ERR|WRN|WARN|ERROR)\b|^WARNING:/i.test(text)) return true;
  if (/provided tunnel token is not valid|failed|invalid|error=/i.test(text)) return true;
  return false;
}

function shouldSkipServicePrefix(name, line) {
  const text = stripAnsi(line);
  if (name === "WHATSAPP") {
    return /^(\[[0-2]\d:[0-5]\d\]|\[[0-2]\d:[0-5]\d:[0-5]\d WIB\]|\[(START|HANDLER|OK|WARN|ERROR)\]|\[√\]|\[×\]|⚠️|Reconnect\b|Membuat backup data|=+| _|[|\\/ ]+\||◧ |Version Sc:|API Key :|------------------)/.test(text);
  }
  if (name === "BACKUP") {
    return /^\[(OK|WARN|ERROR)\]|\[√\]|\[×\]|⚠️/.test(text);
  }
  return false;
}

function writeServiceOutput(name, chunk, stream = process.stdout) {
  const text = chunk.toString();
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) continue;
    const line = rawLine.trimEnd();
    if (!shouldWriteServiceLine(name, line)) continue;
    if (shouldSkipServicePrefix(name, line)) {
      stream.write(`${line}\n`);
    } else {
      stream.write(`[${serviceLabel(name)}] ${line}\n`);
    }
  }
}

function spawnService(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let startFailed = false;
  const stableTimer = setTimeout(() => {
    restartCounters.set(name, 0);
  }, Number(options.stableRestartAfterMs || 120000));
  stableTimer.unref?.();
  child.stdout.on("data", (chunk) => writeServiceOutput(name, chunk, process.stdout));
  child.stderr.on("data", (chunk) => writeServiceOutput(name, chunk, process.stderr));
  child.on("error", (error) => {
    startFailed = true;
    clearTimeout(stableTimer);
    logFail(`${serviceLabel(name)} failed to start: ${error.message}`);
    if (!shuttingDown && options.restartOnExit) {
      scheduleServiceRestart(name, command, args, options);
      return;
    }
    if (!shuttingDown) shutdown(1);
  });
  child.on("exit", (code, signal) => {
    clearTimeout(stableTimer);
    if (startFailed) return;
    logWarn(`${serviceLabel(name)} exited with ${signal || code}`);
    if (!shuttingDown && options.restartOnExit) {
      scheduleServiceRestart(name, command, args, options);
      return;
    }
    if (!shuttingDown) shutdown(code || 1);
  });
  children.push(child);
  return child;
}

function spawnIsolatedService(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let startFailed = false;
  const stableTimer = setTimeout(() => {
    restartCounters.set(name, 0);
  }, Number(options.stableRestartAfterMs || 120000));
  stableTimer.unref?.();
  child.stdout.on("data", (chunk) => writeServiceOutput(name, chunk, process.stdout));
  child.stderr.on("data", (chunk) => writeServiceOutput(name, chunk, process.stderr));
  child.on("error", (error) => {
    startFailed = true;
    clearTimeout(stableTimer);
    logFail(`${serviceLabel(name)} failed to start: ${error.message}`);
    if (!shuttingDown && options.restartOnExit) {
      scheduleServiceRestart(name, command, args, { ...options, isolated: true });
    }
  });
  child.on("exit", (code, signal) => {
    clearTimeout(stableTimer);
    if (startFailed) return;
    logWarn(`${serviceLabel(name)} exited with ${signal || code}`);
    if (!shuttingDown && options.restartOnExit) {
      scheduleServiceRestart(name, command, args, { ...options, isolated: true });
    }
  });
  child.unref?.();
  return child;
}

function runDetachedUtility(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => writeServiceOutput(name, chunk, process.stdout));
  child.stderr.on("data", (chunk) => writeServiceOutput(name, chunk, process.stderr));
  child.on("exit", (code) => {
    if (code) logWarn(`${serviceLabel(name)} exited with ${code}`);
  });
}

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 800).unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

loadRootEnvFile();

const webPort = String(process.env.SERVER_PORT || process.env.DASHBOARD_API_PORT || process.env.PORT || "1912");
const whatsappPort = String(process.env.WHATSAPP_PORT || "4016");
const runtimeDir = path.resolve(process.env.RUNTIME_DIR || path.join(dashboardDir, "runtime"));
const runtimeTmpDir = path.resolve(process.env.RUNTIME_TMP_DIR || path.join(runtimeDir, "tmp"));
const runtimeBackupDir = path.resolve(process.env.RUNTIME_BACKUP_DIR || path.join(runtimeDir, "backups"));
const dashboardDbPath = path.resolve(process.env.DATABASE_PATH || path.join(runtimeDir, "kavya-db.json"));
const whatsappAuthDir = path.resolve(process.env.BAILEYS_AUTH_DIR || path.join(runtimeDir, "baileys-auth"));
const whatsappDatabaseDir = path.resolve(process.env.WHATSAPP_DATABASE_DIR || path.join(runtimeDir, "whatsapp-database"));
const dashboardNodeModules = path.join(dashboardDir, "node_modules");
const whatsappNodeModules = path.join(whatsappDir, "node_modules");
const dashboardDistPath = path.join(dashboardDir, "dist", "index.html");

assertProjectTree();

for (const dir of [runtimeDir, runtimeTmpDir, runtimeBackupDir, path.dirname(dashboardDbPath), whatsappAuthDir, whatsappDatabaseDir]) {
  mkdirSync(dir, { recursive: true });
}

function readDashboardDb() {
  if (!existsSync(dashboardDbPath)) return { settings: {} };
  try {
    return JSON.parse(readFileSync(dashboardDbPath, "utf8"));
  } catch (error) {
    logWarn(`Dashboard database belum bisa dibaca: ${error.message}`);
    return { settings: {} };
  }
}

function ensureDashboardRuntimeSettings() {
  const db = readDashboardDb();
  db.settings = { ...(db.settings || {}) };
  const settings = db.settings;
  let changed = false;
  const setDefault = (key, value) => {
    if (settings[key]) return;
    const normalized = String(value || "").trim();
    if (!normalized) return;
    settings[key] = normalized;
    changed = true;
  };

  const publicDomain = cleanUrl(settings.publicDomain || process.env.PUBLIC_DOMAIN, "https://vya.baby");
  const localDashboardUrl = `http://127.0.0.1:${webPort}`;
  const envCloudflaredToken = usableSecret(process.env.CLOUDFLARED_TOKEN);

  if (envCloudflaredToken) {
    if (settings.cloudflareTunnelToken !== envCloudflaredToken) {
      settings.cloudflareTunnelToken = envCloudflaredToken;
      changed = true;
    }
  } else if (settings.cloudflareTunnelToken) {
    delete settings.cloudflareTunnelToken;
    changed = true;
  }

  setDefault("publicDomain", publicDomain);
  setDefault("botPublicUrl", publicDomain);
  const envOwnerPassword = usableSecret(process.env.OWNER_PASSWORD) || usableSecret(process.env.OWNER_LOGIN_PASSWORD);
  if (settings.ownerPassword === "admin12345" && envOwnerPassword) {
    settings.ownerPassword = envOwnerPassword;
    changed = true;
  } else {
    setDefault("ownerPassword", envOwnerPassword);
  }
  setDefault("baileySessionId", process.env.WHATSAPP_BAILEY_SESSION_ID || "kavya-main");
  setDefault("baileyBotNumber", process.env.WHATSAPP_BOT_NUMBER || settings.ownerWhatsAppNumber || process.env.OWNER_WHATSAPP_NUMBER || "");
  setDefault("whatsappBotPublicUrl", process.env.WHATSAPP_BOT_PUBLIC_URL || `${publicDomain}/whatsapp-bot`);
  setDefault("baileyWebhookUrl", process.env.WHATSAPP_INBOUND_WEBHOOK_URL || `${localDashboardUrl}/api/whatsapp/inbound`);
  setDefault("baileyQrisGenerateUrl", `${publicDomain}/api/orders`);
  setDefault("gmailRedirectUri", process.env.GMAIL_REDIRECT_URI || `${publicDomain}/api/gmail/oauth/callback`);
  setDefault("whatsappBotToken", usableSecret(process.env.WHATSAPP_BOT_TOKEN) || randomSecret("wabot"));
  setDefault("whatsappInboundToken", usableSecret(process.env.WHATSAPP_INBOUND_TOKEN) || randomSecret("wain"));
  setDefault("pakasirApiKey", usableSecret(process.env.PAKASIR_API_KEY));
  setDefault("pakasirWebhookSecret", usableSecret(process.env.PAKASIR_WEBHOOK_SECRET));
  setDefault("gmailClientSecret", usableSecret(process.env.GMAIL_CLIENT_SECRET));

  if (changed) {
    writeFileSync(dashboardDbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
    logOk("Runtime dashboard settings disiapkan dari database dashboard.");
  }

  return settings;
}

const settings = ensureDashboardRuntimeSettings();
const publicDomain = cleanUrl(settings.publicDomain, "https://vya.baby");
const whatsappBotUrl = firstConfigured(process.env.WHATSAPP_BOT_URL, `http://127.0.0.1:${whatsappPort}`);
const cloudflaredToken = usableSecret(process.env.CLOUDFLARED_TOKEN);
const localCloudflaredBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "cloudflared.cmd" : "cloudflared",
);
const resolveCloudflaredBin = () => firstConfigured(process.env.CLOUDFLARED_BIN, existsSync(localCloudflaredBin) ? localCloudflaredBin : "cloudflared");
let cloudflaredBin = resolveCloudflaredBin();

const commonEnv = {
  PUBLIC_DOMAIN: publicDomain,
  NEXT_PUBLIC_CREATE_APP_URL: process.env.NEXT_PUBLIC_CREATE_APP_URL || publicDomain,
  AUTH_URL: process.env.AUTH_URL || publicDomain,
  AUTH_SECRET: usableSecret(process.env.AUTH_SECRET) || usableSecret(process.env.SESSION_SECRET) || randomSecret("auth"),
  RUNTIME_DIR: runtimeDir,
  RUNTIME_PATH: runtimeDir,
  DATABASE_PATH: dashboardDbPath,
  RUNTIME_TMP_DIR: runtimeTmpDir,
  RUNTIME_BACKUP_DIR: runtimeBackupDir,
  BAILEYS_AUTH_DIR: whatsappAuthDir,
  WHATSAPP_DATABASE_DIR: whatsappDatabaseDir,
  LOCAL_DATABASE_DIR: path.resolve(process.env.LOCAL_DATABASE_DIR || path.join(runtimeDir, "pglite")),
  TMPDIR: runtimeTmpDir,
  TEMP: runtimeTmpDir,
  TMP: runtimeTmpDir,
  WHATSAPP_PORT: whatsappPort,
  WHATSAPP_BOT_URL: whatsappBotUrl,
  WHATSAPP_BOT_PUBLIC_URL: firstConfigured(settings.whatsappBotPublicUrl, `${publicDomain}/whatsapp-bot`),
  WHATSAPP_BOT_TOKEN: settings.whatsappBotToken,
  WHATSAPP_INBOUND_WEBHOOK_URL: firstConfigured(settings.baileyWebhookUrl, `http://127.0.0.1:${webPort}/api/whatsapp/inbound`),
  WHATSAPP_INBOUND_TOKEN: settings.whatsappInboundToken,
  OWNER_WHATSAPP_NUMBER: firstConfigured(process.env.OWNER_WHATSAPP_NUMBER, settings.ownerWhatsAppNumber),
  BACKUP_OWNER_NUMBER: firstConfigured(process.env.BACKUP_OWNER_NUMBER, process.env.OWNER_WHATSAPP_NUMBER, settings.ownerWhatsAppNumber),
  PAKASIR_PROJECT: firstConfigured(settings.pakasirMerchantId, settings.pakasirProject, process.env.PAKASIR_PROJECT),
  PAKASIR_API_KEY: firstConfigured(settings.pakasirApiKey, process.env.PAKASIR_API_KEY),
  PAKASIR_WEBHOOK_SECRET: firstConfigured(settings.pakasirWebhookSecret, process.env.PAKASIR_WEBHOOK_SECRET),
  GMAIL_CLIENT_ID: firstConfigured(settings.gmailClientId, process.env.GMAIL_CLIENT_ID),
  GMAIL_CLIENT_SECRET: firstConfigured(settings.gmailClientSecret, process.env.GMAIL_CLIENT_SECRET),
  GMAIL_REDIRECT_URI: firstConfigured(settings.gmailRedirectUri, `${publicDomain}/api/gmail/oauth/callback`),
  GMAIL_INBOX_EMAIL: firstConfigured(settings.gmailInboxEmail, process.env.GMAIL_INBOX_EMAIL),
  CLOUDFLARED_TOKEN: cloudflaredToken,
};

if (!isDisabled(process.env.AUTO_INSTALL_ON_START, false)) {
  if (!packageDependenciesReady(root)) runNpmSetupStep("Install root dependencies", ["install"]);
  if (!packageDependenciesReady(dashboardDir)) runNpmSetupStep("Install dashboard dependencies", ["install"], { cwd: dashboardDir });
  if (!packageDependenciesReady(whatsappDir)) runNpmSetupStep("Install WhatsApp dependencies", ["install"], { cwd: whatsappDir });
}
cloudflaredBin = resolveCloudflaredBin();
ensureExecutable(cloudflaredBin);

if (!existsSync(dashboardDistPath)) {
  if (isDisabled(process.env.AUTO_BUILD_ON_START, false)) {
    logFail("Dashboard build belum ada dan AUTO_BUILD_ON_START=false. Jalankan npm run ptero:build.");
    process.exit(1);
  }
  runNpmSetupStep("Build dashboard production", ["run", "web:build"], { cwd: dashboardDir });
}

if (!isDisabled(process.env.AUTO_IMPORT_LEGACY_ON_START, false)) {
  if (existsSync(importLegacyScript)) {
    const args = [importLegacyScript];
    if (isEnabled(process.env.AUTO_IMPORT_LEGACY_FORCE_ON_START, false)) args.push("--force");
    runLegacyImportStep(args, {
      required: !isDisabled(process.env.REQUIRE_LEGACY_IMPORT_ON_START, true),
      env: commonEnv,
    });
  } else {
    logWarn("scripts/deploy/import-legacy-wa-backup.mjs tidak ditemukan, import legacy dilewati.");
  }
}

logOk("Start App ...");
logOk(`Dashboard siap di port ${webPort}`);
logOk(`WhatsApp bot siap di port ${whatsappPort}`);
logOk(`Public domain : ${publicDomain}`);

spawnService("DASHBOARD", "node", ["server/index.js"], {
  cwd: dashboardDir,
  env: {
    ...commonEnv,
    DASHBOARD_API_PORT: webPort,
    DASHBOARD_API_HOST: process.env.PTERO_DASHBOARD_API_HOST || "0.0.0.0",
    PORT: webPort,
  },
  restartOnExit: true,
});

spawnService("WHATSAPP", "node", ["index.js"], {
  cwd: whatsappDir,
  env: {
    ...commonEnv,
    PORT: whatsappPort,
  },
  restartOnExit: true,
});

if (cloudflaredToken) {
  logOk("Cloudflare Tunnel start dari .env");
  spawnIsolatedService("TUNNEL", cloudflaredBin, ["tunnel", "--loglevel", process.env.CLOUDFLARED_LOG_LEVEL || "warn", "--no-autoupdate", "run", "--token", cloudflaredToken], {
    cwd: root,
    env: commonEnv,
    restartOnExit: true,
    isolated: true,
  });
} else {
  logWarn("Cloudflare Tunnel token kosong. Isi CLOUDFLARED_TOKEN di .env, lalu restart server.");
}

if (!isDisabled(process.env.AUTO_BACKUP_ON_START, true)) {
  setTimeout(() => {
    if (existsSync(runtimeBackupScript)) {
      runDetachedUtility("BACKUP", "node", [runtimeBackupScript, "--send-whatsapp", "--reason=pterodactyl-start"], {
        cwd: root,
        env: commonEnv,
      });
    } else {
      logWarn("scripts/maintenance/runtime-backup.mjs tidak ditemukan, backup otomatis dilewati.");
    }
  }, Number(process.env.AUTO_BACKUP_START_DELAY_MS || 15000));
}
