import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const stage = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-clean-install-"));
const checkout = path.join(stage, "checkout");
const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "ComSpec", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
function run(command, args, cwd = checkout) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" && command === "npm.cmd" });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status ?? result.error?.code}`);
}
try {
  run("git", ["clone", "--local", "--no-hardlinks", root, checkout], stage);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const prefix of ["", "apps/dashboard", "apps/bot"]) {
    const scope = prefix ? ["--prefix", prefix] : [];
    run(npm, ["ci", ...scope]);
    run(npm, ["audit", "--omit=dev", "--audit-level=high", ...scope]);
  }
  run(npm, ["run", "dashboard:typecheck"]);
  run(npm, ["run", "whatsapp:check"]);
  run(npm, ["run", "app:build"]);
  console.log(JSON.stringify({ ok: true, platform: process.platform, checked: ["clean local clone", "npm ci root/dashboard/bot", "runtime audits", "typecheck", "bot check", "production build"], externalActions: "package installation only; no live app, push or deploy" }));
} finally {
  const relative = path.relative(os.tmpdir(), stage);
  if (relative.startsWith("kavya-clean-install-") && !relative.includes(path.sep)) {
    await fs.rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
