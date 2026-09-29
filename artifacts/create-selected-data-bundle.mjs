import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const downloadsDir = path.resolve(repoRoot, "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const stagingRoot = path.join(downloadsDir, `kavya-selected-data-staging-${stamp}`);
const output = path.join(downloadsDir, "kavya-pterodactyl-linux-with-selected-data.tar.gz");

const sensitiveKeyPattern =
  /(password|hash|secret|token|apiKey|clientSecret|session|credential|cookie|authorization)/i;

function copyFileIfExists(source, destination) {
  const sourcePath = path.join(repoRoot, source);
  if (!fs.existsSync(sourcePath)) return false;
  const destinationPath = path.join(stagingRoot, destination || source);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

function copyDirectoryIfExists(source, destination) {
  const sourcePath = path.join(repoRoot, source);
  if (!fs.existsSync(sourcePath)) return false;
  const destinationPath = path.join(stagingRoot, destination || source);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.cpSync(sourcePath, destinationPath, {
    recursive: true,
    filter: (entry) => {
      const normalized = entry.replaceAll("\\", "/");
      return !/node_modules|\.git|\.env|baileys-auth|auth_info|session/i.test(normalized);
    },
  });
  return true;
}

function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKeyPattern.test(key))
      .map(([key, child]) => [key, stripSensitive(child)]),
  );
}

fs.mkdirSync(stagingRoot, { recursive: true });

const codeBundle = path.join(downloadsDir, "kavya-pterodactyl-linux-latest.tar.gz");
if (!fs.existsSync(codeBundle)) {
  throw new Error(`Missing clean code bundle: ${codeBundle}`);
}

const extract = spawnSync("tar.exe", ["-xzf", codeBundle, "-C", stagingRoot], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (extract.status !== 0) process.exit(extract.status || 1);

const copied = [];
for (const file of [
  "database/group.json",
  "database/group_backup.json",
  "database/list.json",
  "database/sewa.json",
  "database/owner.json",
  "database/users.json",
  "apps/bot/database/groups.json",
  "apps/bot/database/lists.json",
  "apps/bot/database/rentals.json",
  "apps/bot/database/settings.json",
]) {
  if (copyFileIfExists(file)) copied.push(file);
}

for (const directory of ["database/additional"]) {
  if (copyDirectoryIfExists(directory)) copied.push(`${directory}/`);
}

const dashboardDbPath = path.join(repoRoot, "apps/dashboard/runtime/kavya-db.json");
if (fs.existsSync(dashboardDbPath)) {
  const dashboardDb = JSON.parse(fs.readFileSync(dashboardDbPath, "utf8"));
  const selectedDashboardDb = {
    settings: stripSensitive(dashboardDb.settings || {}),
    resellers: stripSensitive(dashboardDb.resellers || []),
    whatsappRentals: stripSensitive(dashboardDb.whatsappRentals || []),
    whatsappGroupLists: stripSensitive(dashboardDb.whatsappGroupLists || []),
    maintenance: stripSensitive(dashboardDb.maintenance || {}),
  };
  const destinationPath = path.join(stagingRoot, "apps/dashboard/runtime/kavya-db.json");
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, JSON.stringify(selectedDashboardDb, null, 2));
  copied.push("apps/dashboard/runtime/kavya-db.json (selected + sanitized)");
}

fs.writeFileSync(
  path.join(stagingRoot, "RESTORE-DATA-README.txt"),
  [
    "Kavya selected-data bundle.",
    "",
    "Included:",
    "- group data",
    "- group list data",
    "- rental start/end data",
    "- owner identity/settings that are not secrets",
    "- reseller records without password hashes",
    "",
    "Not included:",
    "- .env",
    "- WhatsApp/Baileys auth session",
    "- dashboard owner password hash",
    "- reseller password hashes",
    "- API keys, webhook secrets, tokens, or OAuth client secrets",
    "",
    "After restore, set .env on the target panel and reset owner/reseller passwords.",
    "",
    "Copied paths:",
    ...copied.map((item) => `- ${item}`),
    "",
  ].join("\n"),
);

if (fs.existsSync(output)) fs.rmSync(output, { force: true });
const pack = spawnSync("tar.exe", ["-czf", output, "-C", stagingRoot, "."], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (pack.status !== 0) process.exit(pack.status || 1);

console.log(output);
