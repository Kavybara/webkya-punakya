import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const downloadsDir = path.resolve(repoRoot, "..");
const stage = path.join(downloadsDir, `kavya-clean-active-restore-stage-${Date.now()}`);
const output = path.join(downloadsDir, "kavya-owner-disaster-restore-full.tar.gz");
const includeBaileysAuth = /^(1|true|yes|on)$/i.test(String(process.env.INCLUDE_BAILEYS_AUTH || "").trim());
const sourceBackup = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"),
  "Packages",
  "5319275A.WhatsAppDesktop_cv1g1gvanyjgm",
  "LocalState",
  "sessions",
  "4456438D2B405C5BCDBDCD8E53EEAF7FB065B0CC",
  "transfers",
  "2026-34",
  "File Backup.tar.gz",
);

const excludedPaths = [
  ".git",
  "node_modules",
  "apps/dashboard/node_modules",
  "apps/bot/node_modules",
  "kavya-digital-dashboard/node_modules",
  "database",
  "runtime",
  "runtime-laptop-wa-test*",
  "apps/bot/database",
  "apps/bot/runtime-laptop-wa-test*",
  "apps/dashboard/runtime",
  "kavya-digital-dashboard/runtime/backups",
  "kavya-digital-dashboard/runtime/tmp",
  "kavya-digital-dashboard/runtime/pglite",
  "artifacts",
  "reports",
  "test-results",
  ".agents",
  ".vscode",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

run("tar.exe", [
  "-czf",
  output,
  ...excludedPaths.map((item) => `--exclude=./${item}`),
  "--exclude=./*.tar.gz",
  "--exclude=./*.tgz",
  "--exclude=./*.zip",
  "--exclude=./*.enc",
  "-C",
  repoRoot,
  ".",
]);
run("tar.exe", ["-xzf", output, "-C", stage]);

for (const activePath of [
  path.join("kavya-digital-dashboard", "runtime", "kavya-db.json"),
  path.join("kavya-digital-dashboard", "runtime", "whatsapp-database"),
  path.join("database", "templates", "list.js"),
  path.join("database", "menu.js"),
]) {
  const source = path.join(repoRoot, activePath);
  const destination = path.join(stage, activePath);
  if (!fs.existsSync(source)) continue;
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

if (includeBaileysAuth && fs.existsSync(sourceBackup)) {
  run("tar.exe", ["-xzf", sourceBackup, "-C", stage, "./apps/dashboard/runtime/baileys-auth"]);
  const oldAuth = path.join(stage, "apps", "dashboard", "runtime", "baileys-auth");
  const newAuth = path.join(stage, "kavya-digital-dashboard", "runtime", "baileys-auth");
  if (fs.existsSync(oldAuth)) {
    fs.rmSync(newAuth, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(newAuth), { recursive: true });
    fs.renameSync(oldAuth, newAuth);
  }
  fs.rmSync(path.join(stage, "apps", "dashboard", "runtime"), { recursive: true, force: true });
}

if (!includeBaileysAuth) {
  fs.rmSync(path.join(stage, "kavya-digital-dashboard", "runtime", "baileys-auth"), { recursive: true, force: true });
}

run("tar.exe", ["-czf", output, "-C", stage, "."]);
const stat = fs.statSync(output);
console.log(JSON.stringify({
  output,
  bytes: stat.size,
  mb: Math.round((stat.size / 1024 / 1024) * 100) / 100,
  includeBaileysAuth,
}, null, 2));
