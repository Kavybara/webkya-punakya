import assert from "node:assert/strict";
import test from "node:test";
import { registerSystemRoutes } from "../routes/system-routes.js";

function setup() {
  const routes = new Map();
  const app = Object.fromEntries(["get", "post"].map((method) => [method, (path, ...handlers) => routes.set(`${method} ${path}`, handlers)]));
  const db = {
    settings: { ownerWhatsAppNumber: "6281234567890", pakasirApiKey: "fixture-private-key", ownerPasswordHash: "fixture-hash" },
    stock: [{ password: "fixture-password" }],
    resellers: [{ passwordHash: "fixture-reseller-hash" }],
    passwordResets: [{ code: "123456" }],
  };
  registerSystemRoutes(app, {
    requireAuth: (roles) => ({ roles }),
    readDb: async () => db,
    readDbSnapshot: async () => structuredClone(db),
    firstConfigured: (...values) => values.find(Boolean),
    getPakasirCredentials: () => ({ configured: true }),
    googleSheetsConfigured: () => true,
    googleSheetsSyncHealth: () => ({ healthy: true, lastAttemptAt: "fixture-time", failedSections: [] }),
    maintenanceMode: () => ({ active: false }),
    warrantyWhatsAppNumber: () => "628999888777",
    mergedWhatsappRentals: async () => [{ groupJid: "test@g.us", status: "paused", linkGrub: "fixture-private-invite" }],
    readActiveLegacyGroupLists: async () => [{ groupJid: "test@g.us", entries: [{ keyword: "account", response: "fixture-private-list-password" }] }],
  });
  return { routes, db };
}

async function payload(handlers) {
  assert.ok(handlers, "route should be registered");
  let result;
  await handlers.at(-1)({}, { json(value) { result = value; } });
  return result;
}

test("public health exposes liveness only", async () => {
  const { routes } = setup();
  assert.deepEqual(await payload(routes.get("get /api/health")), { ok: true });
});

test("detailed diagnostics require owner authentication", async () => {
  const { routes } = setup();
  const handlers = routes.get("get /api/health/details");
  assert.deepEqual(handlers?.[0].roles, ["owner"]);
  const result = await payload(handlers);
  assert.equal(result.googleSheetsHealthy, true);
  assert.ok(result.databaseLoss);
  assert.equal(JSON.stringify(result).includes("fixture-private-key"), false);
});

test("public contact exposes only intentionally published contact numbers", async () => {
  const { routes } = setup();
  assert.deepEqual(await payload(routes.get("get /api/public/contact")), {
    ownerWhatsAppNumber: "6281234567890", warrantyWhatsAppNumber: "628999888777",
  });
});

test("bootstrap never sends credential tables or integration settings", async () => {
  const { routes, db } = setup();
  const before = JSON.stringify(db);
  const result = await payload(routes.get("get /api/bootstrap"));
  assert.deepEqual(Object.keys(result).sort(), ["whatsappGroupLists", "whatsappRentals"]);
  assert.equal(result.whatsappRentals[0].status, "paused");
  assert.equal(JSON.stringify(result).includes("fixture-private-invite"), false);
  assert.equal(JSON.stringify(result).includes("fixture-private-list-password"), false);
  assert.equal(JSON.stringify(db), before);
});
