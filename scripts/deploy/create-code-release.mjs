import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collectReleaseFiles } from "./release-files.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const output = path.resolve(outputArg?.slice(9) || path.join(root, "release", `kavya-code-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`));
const stage = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-code-release-"));
try {
  const files = await collectReleaseFiles(root);
  for (const required of ["package.json", "apps/dashboard/dist/index.html", "apps/dashboard/server/index.js", "apps/bot/index.js"]) {
    if (!files.includes(required)) throw new Error(`Release tidak lengkap: ${required}. Jalankan npm run app:build terlebih dahulu.`);
  }
  const hashes = {};
  for (const relative of files) {
    const content = await fs.readFile(path.join(root, relative));
    hashes[relative] = crypto.createHash("sha256").update(content).digest("hex");
    const target = path.join(stage, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await fs.writeFile(path.join(stage, "code-release-manifest.json"), JSON.stringify({
    type: "code-only", createdAt: new Date().toISOString(), files: hashes,
    protected: [".env", "runtime", "database", "apps/bot/database", "Baileys session"],
  }, null, 2));
  await fs.mkdir(path.dirname(output), { recursive: true });
  try { await fs.access(output); throw new Error("Output sudah ada; gunakan nama arsip baru."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const result = spawnSync("tar", ["-czf", output, "-C", stage, "."], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "tar_failed");
  await fs.chmod(output, 0o600);
  console.log(JSON.stringify({ archive: output, fileCount: files.length, sha256: crypto.createHash("sha256").update(await fs.readFile(output)).digest("hex"), type: "code-only" }, null, 2));
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
