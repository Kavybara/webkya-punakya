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

test("payment and Owner Settings GET keep the database SHA-256 byte-identical", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-payment-settings-get-"));
  const databasePath = path.join(tempDir, "runtime", "test-db.json");
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  await fs.writeFile(databasePath, JSON.stringify({
    settings: {
      settingsSchemaVersion: 0,
      pakasirProject: "legacy-project",
      gmailOAuthStatus: "unknown",
    },
    orders: [{
      id: "ORD-HASH",
      paymentRef: "PAY-HASH",
      resellerId: "res-hash",
      trackingToken: "track-secret",
      orderStatus: "pending",
      deliveryStatus: "waiting_payment",
    }],
    payments: [{
      ref: "PAY-HASH",
      orderId: "ORD-HASH",
      provider: "pakasir",
      status: "pending",
      amount: 10_000,
    }],
    stock: [{
      id: "stock-hash",
      status: "reserved",
      reservedOrderId: "ORD-HASH",
      reservationExpiresAt: "2026-07-26T12:00:00.000Z",
    }],
    activities: [{ id: "act-existing", title: "Existing" }],
  }, null, 2), "utf8");

  const storeUrl = pathToFileURL(path.resolve("server/store.js")).href;
  const paymentRoutesUrl = pathToFileURL(path.resolve("server/routes/payment-routes.js")).href;
  const settingsRoutesUrl = pathToFileURL(path.resolve("server/routes/settings-routes.js")).href;
  const script = `
    import crypto from "node:crypto";
    import fs from "node:fs/promises";
    import path from "node:path";
    import express from "express";
    const store = await import(${JSON.stringify(storeUrl)});
    const { registerPaymentRoutes } = await import(${JSON.stringify(paymentRoutesUrl)});
    const { registerSettingsRoutes } = await import(${JSON.stringify(settingsRoutesUrl)});
    const digest = async () => crypto.createHash("sha256").update(await fs.readFile(process.env.DATABASE_PATH)).digest("hex");
    const spies = { writer: 0, provider: 0, fulfillment: 0, notifier: 0, expiry: 0, validation: 0 };
    const forbidden = (name) => async () => { spies[name] += 1; throw new Error(name + " must not run during GET"); };
    const app = express();
    app.use(express.json());
    const requireAuth = () => (req, _res, next) => {
      req.auth = { role: "owner", sub: "owner", name: "Owner" };
      next();
    };
    registerPaymentRoutes(app, {
      assertPakasirSecret: forbidden("provider"),
      expirePendingOrders: (...args) => { spies.expiry += 1; throw new Error("expiry must not run during GET"); },
      findOrderForPublicTracking: (orders, input) => orders.find((order) => order.trackingToken === input.trackingToken) || null,
      nowText: () => "2026-07-26T10:00:00.000Z",
      orderBelongsToReseller: () => true,
      readDb: store.readDbSnapshot,
      readDbSnapshot: store.readDbSnapshot,
      reconcilePakasirPaymentInDb: forbidden("provider"),
      requireAuth,
      safePublicPayment: (payment, order) => ({ ref: payment.ref, status: payment.status, orderId: order.id }),
      safeTrackingPayment: (payment, order) => ({ ref: payment.ref, status: payment.status, orderId: order.id }),
      updateDb: forbidden("writer"),
      fulfillPaidOrderAndNotify: forbidden("fulfillment"),
      sendNotification: forbidden("notifier"),
    });
    registerSettingsRoutes(app, {
      STORED_SECRET_PLACEHOLDER: "[stored]",
      firstUsableSecret: (...values) => values.find(Boolean) || "",
      gmailOAuthConfigured: () => false,
      gmailOAuthState: () => "state",
      maskedOwnerIntegrationSettings: (db) => ({
        schemaVersion: Number(db.settings?.settingsSchemaVersion || 0),
        pakasirProject: db.settings?.pakasirProject || "",
        gmailStatus: db.settings?.gmailOAuthStatus || "unknown",
      }),
      mergeGoogleSheetsSettings: () => ({}),
      mergeStoredSecret: (value, previous) => value || previous,
      nowText: () => "2026-07-26T10:00:00.000Z",
      ownerIntegrationSettings: () => ({}),
      ownerProfile: () => ({}),
      parseBotPublicUrlInput: () => ({}),
      readDb: store.readDbSnapshot,
      readDbSnapshot: store.readDbSnapshot,
      requireAuth,
      updateDb: forbidden("writer"),
      validateGmailConnectionForStatus: forbidden("validation"),
      verifyGmailOAuthState: () => false,
    });
    app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    const directoryBefore = await fs.readdir(path.dirname(process.env.DATABASE_PATH)).catch(() => []);
    const paymentBefore = await digest();
    const paymentResponse = await fetch(base + "/api/payments/PAY-HASH");
    const paymentPayload = await paymentResponse.json();
    const paymentAfter = await digest();
    const publicBefore = await digest();
    const publicResponse = await fetch(base + "/api/public/payments/PAY-HASH?token=track-secret");
    const publicPayload = await publicResponse.json();
    const publicAfter = await digest();
    const settingsBefore = await digest();
    const settingsResponse = await fetch(base + "/api/owner-settings");
    const settingsPayload = await settingsResponse.json();
    const settingsAfter = await digest();
    const directoryAfter = await fs.readdir(path.dirname(process.env.DATABASE_PATH)).catch(() => []);
    await new Promise((resolve) => server.close(resolve));
    process.stdout.write(JSON.stringify({
      statuses: [paymentResponse.status, publicResponse.status, settingsResponse.status],
      payloads: [paymentPayload, publicPayload, settingsPayload],
      paymentBefore,
      paymentAfter,
      publicBefore,
      publicAfter,
      settingsBefore,
      settingsAfter,
      directoryBefore,
      directoryAfter,
      spies,
    }));
  `;

  try {
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: databasePath },
    });
    const proof = JSON.parse(stdout);
    console.log(`Payment SHA-256 sebelum GET: ${proof.paymentBefore}`);
    console.log(`Payment SHA-256 sesudah GET: ${proof.paymentAfter}`);
    console.log(`Public payment SHA-256 sebelum GET: ${proof.publicBefore}`);
    console.log(`Public payment SHA-256 sesudah GET: ${proof.publicAfter}`);
    console.log(`Owner Settings SHA-256 sebelum GET: ${proof.settingsBefore}`);
    console.log(`Owner Settings SHA-256 sesudah GET: ${proof.settingsAfter}`);
    console.log(`Mutation/provider spies: ${JSON.stringify(proof.spies)}`);
    assert.deepEqual(proof.statuses, [200, 200, 200]);
    assert.equal(proof.paymentAfter, proof.paymentBefore);
    assert.equal(proof.publicAfter, proof.publicBefore);
    assert.equal(proof.settingsAfter, proof.settingsBefore);
    assert.deepEqual(proof.directoryAfter, proof.directoryBefore);
    assert.deepEqual(proof.spies, {
      writer: 0,
      provider: 0,
      fulfillment: 0,
      notifier: 0,
      expiry: 0,
      validation: 0,
    });
    assert.equal(proof.payloads[2].schemaVersion, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
