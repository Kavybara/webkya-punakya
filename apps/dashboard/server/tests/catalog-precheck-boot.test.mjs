import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// This is the only test that actually boots the server. Every other check in
// the suite reads source text, which is why a route could lose a dependency it
// still used and stay green. The properties asserted here are the ones that
// matter on an unauthenticated endpoint: what it costs an attacker, and what a
// real shopper still gets.
const SERVER_ENTRY = path.resolve("server/index.js");

function fixtureDatabase() {
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
  };
}

async function withServer(run, { timeoutMs = 90_000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kavya-precheck-"));
  const databasePath = path.join(dir, "kavya-db.json");
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  fs.writeFileSync(databasePath, JSON.stringify(fixtureDatabase(), null, 2));

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    // Run from the throwaway directory. The server loads the repository .env
    // by absolute path regardless of cwd, so the credentials are neutralised
    // through the environment instead, and dotenv never overrides a variable
    // that is already set.
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      DATABASE_PATH: databasePath,
      RUNTIME_PATH: dir,
      SERVER_PORT: String(port),
      DASHBOARD_API_PORT: String(port),
      DASHBOARD_API_HOST: "127.0.0.1",
      AUTH_SECRET: "boot-test-secret-not-used-in-production",
      OWNER_USERNAME: "owner",
      OWNER_PASSWORD: "boot-test-password",
      OWNER_WHATSAPP_NUMBER: "6281234567890",
      // Nothing that could reach a real provider.
      WHATSAPP_BOT_TOKEN: "",
      WHATSAPP_BOT_URL: "",
      CLOUDFLARED_TOKEN: "",
      AUTO_BACKUP: "false",
      AUTO_BACKUP_SCHEDULE_ENABLED: "false",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  const base = `http://127.0.0.1:${port}`;
  const precheck = (body) => fetch(`${base}/api/public/catalog/precheck`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const fileSize = () => {
    try {
      return fs.statSync(databasePath).size;
    } catch {
      return -1;
    }
  };

  try {
    let catalog = null;
    let lastError = "";
    for (let attempt = 0; attempt < 120 && !catalog; attempt += 1) {
      try {
        const response = await fetch(`${base}/api/public/catalog`);
        if (response.ok) catalog = await response.json();
        else lastError = `status ${response.status}: ${(await response.text()).slice(0, 200)}`;
      } catch (error) {
        lastError = error.message;
      }
      if (!catalog) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(catalog?.length, `the server never served a catalog: ${lastError}\n${logs}`);
    await run({ catalog, precheck, fileSize, logs });
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    // Wait for the process to actually let go of the database file. On
    // Windows the handle outlives the kill signal for a moment, and removing
    // the directory too early fails with EBUSY.
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A leftover temp directory is not worth failing a test over.
    }
  }
}

test("the public precheck rejects without writing to the database", { timeout: 90_000 }, async () => {
  await withServer(async ({ catalog, precheck, fileSize }) => {
    const before = fileSize();

    const missing = await precheck({ productId: "no-such-product", variantId: "no-such-variant" });
    assert.equal(missing.status, 409);

    // The property that matters: an unauthenticated probe costs no storage
    // write at all. It used to run the whole decision inside updateDb, so
    // every guess — including a guess at an id that does not exist — rewrote
    // the entire database file.
    assert.equal(fileSize(), before, "a rejected probe must not touch the database file");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await precheck({ productId: `probe-${attempt}`, variantId: "nope" });
    }
    assert.equal(fileSize(), before, "twenty rejected probes must not touch the database file");
  });
});

test("the public precheck still answers a shopper's real request", { timeout: 90_000 }, async () => {
  await withServer(async ({ catalog, precheck }) => {
    const product = catalog[0];
    const response = await precheck({
      productId: product.id,
      variantId: product.variants[0].id,
      duration: "1 bulan",
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.productId, product.id);
    assert.equal(body.variantId, product.variants[0].id);
    assert.equal(typeof body.stockCount, "number");
    assert.ok(Array.isArray(body.catalog));
  });
});

test("the public precheck rate limits an unauthenticated prober", { timeout: 90_000 }, async () => {
  await withServer(async ({ precheck }) => {
    let limited = null;
    for (let attempt = 0; attempt < 60 && !limited; attempt += 1) {
      const response = await precheck({ productId: "no-such-product", variantId: "nope" });
      if (response.status === 429) limited = response;
    }
    assert.ok(limited, "the precheck never rate limited");
    assert.ok(limited.headers.get("retry-after"), "a 429 must tell the client when to come back");
  });
});
