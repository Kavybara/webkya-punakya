import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
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
const activePath = path.join(repoRoot, "kavya-digital-dashboard", "runtime", "kavya-db.json");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kavya-dashboard-source-"));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const extract = spawnSync("tar.exe", ["-xzf", sourceBackup, "-C", tempDir, "./apps/dashboard/runtime/kavya-db.json"], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (extract.status !== 0) process.exit(extract.status || 1);

const source = readJson(path.join(tempDir, "apps", "dashboard", "runtime", "kavya-db.json"));
const active = readJson(activePath);
const keepSettings = active.settings || {};
const incomingSettings = source.settings || {};

active.settings = {
  ...incomingSettings,
  ...keepSettings,
  ownerUsername: "Kavya",
  ownerName: keepSettings.ownerName || incomingSettings.ownerName || "Kavya",
  ownerEmail: keepSettings.ownerEmail || incomingSettings.ownerEmail || "owner@kavya.id",
  publicDomain: "https://vya.baby",
  botPublicUrl: "https://vya.baby",
  whatsappBotPublicUrl: "https://vya.baby/whatsapp-bot",
  baileyWebhookUrl: "https://vya.baby/api/whatsapp/inbound",
  baileyQrisGenerateUrl: "https://vya.baby/api/orders",
  gmailRedirectUri: "https://vya.baby/api/gmail/oauth/callback",
};

/*
 * The owner password used to be hardcoded here and echoed to stdout at the end
 * of this script, which meant it was committed to the repository *and* written
 * to terminal scrollback and CI logs on every run.
 *
 * Dropping the *plaintext* field is safe. On the next boot the server reads
 * OWNER_PASSWORD from the environment and re-hashes it into ownerPasswordHash
 * (server/index.js, migrateOwnerCredentials); and if .env has no such value,
 * migrateOwnerCredentials falls back to hashing a surviving plaintext field
 * before deleting it. Either way the credential still exists afterwards, and it
 * also clears any stale plaintext carried in by the spread above.
 *
 * Dropping ownerPasswordHash -- which an earlier version of this file also did
 * -- was a lockout waiting to happen. That hash is the *only* usable credential
 * once the plaintext is gone. If .env has no OWNER_PASSWORD (it ships empty in
 * .env.example), migrateOwnerCredentials then has nothing left to hash: every
 * branch of its owner-password cascade tests false, ownerPasswordHash stays
 * undefined, and no password can authenticate at all. The credential survives
 * here; the secret's exposure in git history is a rotation problem, which is
 * what docs/ROTATE-CREDENTIALS.md section 4.2 is for.
 */
delete active.settings.ownerPassword;

for (const key of [
  "resellers",
  "products",
  "stock",
  "orders",
  "managedAccounts",
  "payments",
  "activities",
  "passwordResets",
  "maintenance",
  "archivedActivities",
  "whatsappRentalNotices",
  "warrantyClaims",
]) {
  if (Array.isArray(source[key])) active[key] = source[key];
  else if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) active[key] = source[key];
}

if (Array.isArray(source.whatsappRentals) && source.whatsappRentals.length > (active.whatsappRentals || []).length) {
  active.whatsappRentals = source.whatsappRentals;
}

fs.writeFileSync(activePath, `${JSON.stringify(active, null, 2)}\n`);
/*
 * This summary used to print `ownerPassword` alongside `hasOwnerPasswordHash`.
 * Even after the literal was removed, echoing the field would have written a
 * live credential into terminal scrollback and any CI log that ran the script.
 * The boolean below says what the operator actually needs to know -- whether a
 * usable credential exists -- without disclosing it.
 */
console.log(
  JSON.stringify(
    {
      resellers: active.resellers?.length || 0,
      products: active.products?.length || 0,
      stock: active.stock?.length || 0,
      orders: active.orders?.length || 0,
      managedAccounts: active.managedAccounts?.length || 0,
      whatsappRentals: active.whatsappRentals?.length || 0,
      whatsappGroupLists: active.whatsappGroupLists?.length || 0,
      ownerUsername: active.settings.ownerUsername,
      hasOwnerPassword: Boolean(active.settings.ownerPassword),
      hasOwnerPasswordHash: Boolean(active.settings.ownerPasswordHash),
    },
    null,
    2,
  ),
);
