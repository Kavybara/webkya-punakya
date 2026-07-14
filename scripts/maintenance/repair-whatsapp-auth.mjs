import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.resolve(process.env.RUNTIME_DIR || path.join(root, "runtime"));
const authDir = path.resolve(process.env.BAILEYS_AUTH_DIR || path.join(runtimeDir, "baileys-auth"));
const quarantineRoot = path.resolve(process.env.AUTH_QUARANTINE_DIR || path.join(runtimeDir, "auth-quarantine"));

function isInsideOrEqual(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

if (!isInsideOrEqual(authDir, runtimeDir)) {
  console.error(`Refuse repair: auth dir di luar runtime dir.\nAUTH: ${authDir}\nRUNTIME: ${runtimeDir}`);
  process.exit(1);
}

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(quarantineRoot, { recursive: true });

if (!existsSync(authDir)) {
  console.log(`Auth dir belum ada, tidak ada yang perlu dipindahkan: ${authDir}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(quarantineRoot, `baileys-auth-${stamp}`);

if (!isInsideOrEqual(target, quarantineRoot)) {
  console.error("Refuse repair: target quarantine tidak aman.");
  process.exit(1);
}

renameSync(authDir, target);
mkdirSync(authDir, { recursive: true });

console.log("Auth WhatsApp dipindahkan ke quarantine, bukan dihapus.");
console.log(`Quarantine: ${target}`);
console.log(`Auth baru: ${authDir}`);
console.log("Start ulang bot lalu scan QR lagi kalau session lama memang rusak.");
