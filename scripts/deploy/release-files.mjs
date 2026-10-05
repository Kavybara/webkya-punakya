import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

const SOURCE_DIRS = new Set(["apps", "packages", "plugins", "lib", "scripts", "public", "assets", "docs"]);
const ROOT_FILES = new Set(["package.json", "package-lock.json", "index.js", "config.js", ".env.example", "README.md", "AGENTS.md"]);
const DATA_ENV_KEYS = new Set(["RUNTIME_DIR", "RUNTIME_PATH", "DATABASE_PATH", "BAILEYS_AUTH_DIR", "WHATSAPP_DATABASE_DIR", "RUNTIME_BACKUP_DIR", "LOCAL_DATABASE_DIR"]);

async function configuredDataPaths(root) {
  const text = await fs.readFile(path.join(root, ".env"), "utf8").catch(() => "");
  const values = parseEnv(text);
  return [...DATA_ENV_KEYS].map((key) => process.env[key] || values[key]).filter(Boolean).map((value) => path.resolve(root, value));
}

export async function collectReleaseFiles(root, { protectedPaths = [] } = {}) {
  const base = path.resolve(root);
  const protectedRoots = [...await configuredDataPaths(base), ...protectedPaths.map((value) => path.resolve(base, value))];
  const files = [];
  const protectedEntry = (target) => protectedRoots.some((value) => target === value || target.startsWith(`${value}${path.sep}`));
  async function walk(directory, relative = "") {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || protectedEntry(target)) continue;
      if (entry.isDirectory() && /^(?:runtime(?:-|$)|database$|node_modules$|backups$|tmp$|\.auth$|baileys-auth$|\.git$|\.cache$|\.compiled-tests$|coverage$|test-results$|playwright-report$)/i.test(entry.name)) continue;
      if (entry.name === ".npmrc" || (entry.name.startsWith(".env") && next !== ".env.example") || /\.(?:pem|key|p12|pfx|enc|log|tar|tgz|gz)$/i.test(entry.name)) continue;
      if (entry.isDirectory()) {
        if (!relative && !SOURCE_DIRS.has(entry.name)) continue;
        await walk(target, next);
      } else if (entry.isFile() && (relative || ROOT_FILES.has(entry.name))) {
        files.push(next);
      }
    }
  }
  await walk(base);
  return files.sort();
}
