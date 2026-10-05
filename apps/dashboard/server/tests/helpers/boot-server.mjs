import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Boots the real dashboard server against a throwaway database and hands the
// caller a small client for it.
//
// The rest of this suite reads source text, which is how a route can lose a
// dependency it still calls and stay green through typecheck, lint and every
// test. Anything about what a request actually does — what it costs, what it
// discloses, what it returns — has to be proven against a running server.
const SERVER_ENTRY = fileURLToPath(new URL("../../index.js", import.meta.url));

/** A catalog with one orderable variant, backed by a real available stock row. */
export function fixtureDatabase(overrides = {}) {
  return {
    products: [
      {
        id: "netflix",
        name: "Netflix",
        isActive: true,
        variants: [
          {
            id: "netflix-1m",
            name: "1 Bulan",
            isActive: true,
            allowedDurations: ["1 bulan"],
            price: 25000,
          },
        ],
      },
    ],
    // publicCatalog hides variants with no available stock rows, so the
    // fixture needs a real row rather than a count on the variant.
    stock: [
      {
        id: "stk-1",
        productId: "netflix",
        variantId: "netflix-1m",
        status: "available",
        accountCondition: "NORMAL",
        accountConditionKnown: true,
        sheetSource: "google_sheets",
      },
    ],
    resellers: [
      {
        id: "res-kya",
        username: "kya",
        name: "Kya",
        whatsapp: "628111222333",
        isActive: true,
        sessionVersion: 1,
      },
    ],
    ...overrides,
  };
}

export async function withServer(run, { database, env = {}, timeoutMs = 90_000, preload, runtimeRoot, serverEntry = SERVER_ENTRY } = {}) {
  const dir = runtimeRoot ? path.resolve(runtimeRoot) : fs.mkdtempSync(path.join(os.tmpdir(), "kavya-boot-"));
  const databasePath = path.join(dir, "kavya-db.json");
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  if (runtimeRoot) {
    if (database) throw new Error("existing_runtime_must_not_be_reseeded");
    fs.accessSync(databasePath);
  } else fs.writeFileSync(databasePath, JSON.stringify(database || fixtureDatabase(), null, 2));

  const child = spawn(process.execPath, [...(preload ? ["--import", preload] : []), serverEntry], {
    // Run from the throwaway directory. The server loads the repository .env
    // by absolute path regardless of cwd, so credentials are neutralised
    // through the environment instead — dotenv never overrides a variable
    // that is already set.
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      DATABASE_PATH: databasePath,
      RUNTIME_PATH: dir,
      RUNTIME_DIR: dir,
      WHATSAPP_DATABASE_DIR: path.join(dir, "whatsapp-database"),
      LEGACY_WHATSAPP_ROOT_DIR: dir,
      DISABLE_BACKGROUND_JOBS: "1",
      SERVER_PORT: String(port),
      DASHBOARD_API_PORT: String(port),
      DASHBOARD_API_HOST: "127.0.0.1",
      AUTH_SECRET: "boot-test-secret-not-used-in-production",
      OWNER_USERNAME: "owner",
      OWNER_PASSWORD: "boot-test-password",
      OWNER_WHATSAPP_NUMBER: "6281234567890",
      // Nothing that could reach a real provider. The bot URL points at a
      // closed port on purpose: it makes the instance look configured, so
      // tests exercise the "bot is configured" branch, while any send it
      // attempts fails immediately against loopback.
      WHATSAPP_BOT_TOKEN: "boot-test-token",
      WHATSAPP_BOT_URL: "http://127.0.0.1:1",
      CLOUDFLARED_TOKEN: "",
      GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON: "",
      GOOGLE_SHEETS_SPREADSHEET_ID: "",
      GOOGLE_SHEETS_PRIVATE_KEY: "",
      GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "",
      PAKASIR_API_KEY: "",
      PAKASIR_WEBHOOK_SECRET: "",
      GMAIL_CLIENT_ID: "",
      GMAIL_CLIENT_SECRET: "",
      GMAIL_REFRESH_TOKEN: "",
      GMAIL_IMAP_PASSWORD: "",
      AUTO_BACKUP: "false",
      AUTO_BACKUP_SCHEDULE_ENABLED: "false",
      NODE_ENV: "test",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  const base = `http://127.0.0.1:${port}`;
  const get = (routePath) => fetch(`${base}${routePath}`);
  const post = (routePath, body) => fetch(`${base}${routePath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const fileSize = () => {
    try {
      return fs.statSync(databasePath).size;
    } catch {
      return -1;
    }
  };

  try {
    let ready = false;
    let lastError = "";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !ready && child.exitCode === null) {
      try {
        const response = await get("/api/public/catalog");
        if (response.ok) ready = true;
        else lastError = `status ${response.status}: ${(await response.text()).slice(0, 200)}`;
      } catch (error) {
        lastError = error.message;
      }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error(`the server never came up: ${lastError}\n${logs}`);
    await run({ base, get, post, fileSize, logs, databasePath });
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    // Wait for the process to let go of the database file. On Windows the
    // handle outlives the kill signal briefly, and removing the directory too
    // early fails with EBUSY.
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (runtimeRoot) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A leftover temp directory is not worth failing a test over.
    }
  }
}
