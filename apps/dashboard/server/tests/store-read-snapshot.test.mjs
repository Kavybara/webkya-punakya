import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("readDbSnapshot returns an isolated clone and keeps the database file byte-identical", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-read-snapshot-"));
  const databasePath = path.join(tempDir, "runtime", "test-db.json");
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const initial = JSON.stringify({
    orders: [{ id: "ORD-TEMP", orderStatus: "waiting_payment" }],
    stock: [{ id: "stock-temp", status: "available" }],
    managedAccounts: [],
    activities: [],
    archivedActivities: [],
  }, null, 2);
  await fs.writeFile(databasePath, initial, "utf8");
  const storeUrl = pathToFileURL(path.resolve("server/store.js")).href;
  const script = `
    const store = await import(${JSON.stringify(storeUrl)});
    const snapshot = await store.readDbSnapshot();
    snapshot.orders[0].orderStatus = "mutated-only-in-memory";
    process.stdout.write(JSON.stringify(snapshot));
  `;

  try {
    await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: databasePath },
    });
    const after = await fs.readFile(databasePath, "utf8");
    assert.equal(hash(after), hash(initial));
    assert.equal(JSON.parse(after).orders[0].orderStatus, "waiting_payment");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("readDbSnapshot does not create a missing runtime directory", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-read-missing-"));
  const databasePath = path.join(tempDir, "missing-runtime", "test-db.json");
  const storeUrl = pathToFileURL(path.resolve("server/store.js")).href;
  const script = `
    const store = await import(${JSON.stringify(storeUrl)});
    await store.readDbSnapshot();
  `;

  try {
    await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: databasePath },
    });
    await assert.rejects(() => fs.stat(path.dirname(databasePath)), { code: "ENOENT" });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("GET Operations Center keeps the temporary database SHA-256 identical", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-get-hash-"));
  const databasePath = path.join(tempDir, "runtime", "test-db.json");
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  await fs.writeFile(databasePath, JSON.stringify({
    orders: [{ id: "ORD-HASH", orderStatus: "completed", deliveryStatus: "sent" }],
    stock: [{ id: "stock-hash", status: "sold", soldOrderId: "ORD-HASH" }],
    managedAccounts: [],
    activities: [{ id: "act-hash", title: "Existing", createdAt: "2026-07-26T00:00:00.000Z" }],
    archivedActivities: [],
  }, null, 2), "utf8");
  const storeUrl = pathToFileURL(path.resolve("server/store.js")).href;
  const routesUrl = pathToFileURL(path.resolve("server/routes/operations-routes.js")).href;
  const script = `
    import crypto from "node:crypto";
    import fs from "node:fs/promises";
    import express from "express";
    const store = await import(${JSON.stringify(storeUrl)});
    const { registerOperationsRoutes } = await import(${JSON.stringify(routesUrl)});
    const digest = async () => crypto.createHash("sha256").update(await fs.readFile(process.env.DATABASE_PATH)).digest("hex");
    const app = express();
    app.use(express.json());
    const requireAuth = () => (req, _res, next) => { req.auth = { role: "owner", sub: "owner" }; next(); };
    registerOperationsRoutes(app, {
      requireAuth,
      readDbSnapshot: store.readDbSnapshot,
      snapshotVersion: () => "snapshot-proof",
      buildOperationsAudit: async () => ({ checkedAt: "2026-07-26T00:00:00.000Z", manual: { items: [] } }),
      buildOwnerSearch: () => ({ groups: [] }),
      activityBelongsToReseller: () => true,
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const before = await digest();
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/operations/center");
    const payload = await response.json();
    const after = await digest();
    await new Promise((resolve) => server.close(resolve));
    process.stdout.write(JSON.stringify({ status: response.status, readOnly: payload.readOnly, before, after }));
  `;

  try {
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: databasePath },
    });
    const proof = JSON.parse(stdout);
    console.log(`SHA-256 sebelum GET: ${proof.before}`);
    console.log(`SHA-256 sesudah GET: ${proof.after}`);
    assert.equal(proof.status, 200);
    assert.equal(proof.readOnly, true);
    assert.equal(proof.after, proof.before);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
