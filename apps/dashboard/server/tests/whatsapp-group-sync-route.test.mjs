import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { registerWhatsAppRoutes } from "../routes/whatsapp-routes.js";

function routeCollector() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
  }
  return { app, routes };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
}

/*
 * The route under test is registered alongside every other WhatsApp route, so
 * the harness stubs all the deps it destructures. Only `requireAuth` and
 * `syncGroupsThroughBot` are ever reached by the sync-now handler; the rest
 * exist so the destructuring in `registerWhatsAppRoutes` succeeds.
 */
function fixture(syncResult) {
  const noop = async () => undefined;
  const { app, routes } = routeCollector();
  const authCalls = [];
  registerWhatsAppRoutes(app, {
    requireAuth: (roles) => (req, res, next) => {
      authCalls.push(roles);
      if (req.authorized === false) return res.status(401).json({ error: "unauthorized" });
      return next();
    },
    syncGroupsThroughBot: async () => syncResult,
    readDb: async () => ({}),
    assertInboundToken: () => undefined,
    updateDb: noop,
    sendRentalJoinedNotifications: async () => [],
    syncWhatsappGroups: (_db, groups) => ({ applied: (groups || []).length, joinedRentals: [] }),
  });
  const route = routes.find((item) => item.path === "/api/whatsapp/groups/sync-now");
  assert.ok(route, "the owner-triggered sync route is not registered");
  return { route, authCalls };
}

/*
 * Express runs every handler in a route in order, so the auth middleware is
 * only exercised if the test runs the whole chain. Invoking just the last
 * handler would make a route with no guard at all pass the same assertions.
 */
async function invoke(route, req = {}) {
  const res = response();
  let nextError = null;
  const next = (error) => { nextError = error || null; };
  for (const handler of route.handlers) {
    await handler(req, res, next);
    if (res.payload !== null) return res;
    if (nextError) throw nextError;
  }
  return res;
}

test("an owner can ask the bot to sync, and the bot's count comes back", async () => {
  const { route, authCalls } = fixture({ success: true, group_count: 42 });

  const res = await invoke(route);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.groupCount, 42);
  assert.equal(res.payload.skipped, false);
  assert.match(res.payload.message, /42 grup/);
  assert.equal(authCalls.length, 1, "sync-now must be guarded exactly once");
  assert.deepEqual(authCalls[0], ["owner"], "sync-now must be owner-only");
});

/*
 * `syncJoinedGroups` signals a refusal by returning `{success: false, reason}`
 * rather than by throwing, so an HTTP 200 from the bot is not on its own a
 * success. Without this the owner clicks the button, sees a green message, and
 * believes the directory is current when nothing was synced at all.
 */
test("a bot refusal is a 502 with a reason, not a 200 that looks like success", async () => {
  const { route } = fixture({ success: false, error: "group_sync_webhook_unconfigured" });

  const res = await invoke(route);

  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.success, undefined);
  assert.equal(res.payload.error, "group_sync_failed");
  assert.equal(res.payload.detail, "group_sync_webhook_unconfigured");
  assert.match(res.payload.message, /webhook sinkronisasi grup belum diatur/);
});

test("a skipped sync says it was skipped rather than claiming a fresh directory", async () => {
  const { route } = fixture({ success: true, skipped: true, reason: "group_sync_throttled", group_count: 7 });

  const res = await invoke(route);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.skipped, true);
  assert.match(res.payload.message, /baru saja berjalan/);
  assert.doesNotMatch(res.payload.message, /disinkronkan/, "a skipped sync must not read as a completed one");
});

test("an in-flight sync is reported as in-flight, not as a failure", async () => {
  const { route } = fixture({ success: true, skipped: true, reason: "group_sync_in_flight" });

  const res = await invoke(route);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.message, /sedang berjalan/);
});

/*
 * The owner-triggered route and the inbound webhook are different directions
 * with different credentials. Conflating them would either let a caller forge
 * a sync result, or make the owner's button depend on the inbound secret.
 */
test("sync-now and the inbound webhook are separate routes with separate auth", () => {
  const { routes } = routeCollectorHolder();
  const ownerRoute = routes.find((item) => item.path === "/api/whatsapp/groups/sync-now");
  const inboundRoute = routes.find((item) => item.path === "/api/whatsapp/groups/sync");

  assert.ok(ownerRoute, "the owner-triggered route is missing");
  assert.ok(inboundRoute, "the inbound webhook route is missing");
  assert.notEqual(ownerRoute, inboundRoute);
  assert.equal(inboundRoute.method, "post");
  assert.equal(ownerRoute.method, "post");
  // The inbound one is guarded by `assertInboundToken` inside its handler; the
  // owner one is guarded by `requireAuth` as a middleware, so the two guards
  // sit in different places and must both stay.
  assert.equal(
    inboundRoute.handlers.some((handler) => handler.length === 3),
    true,
    "the inbound webhook lost its middleware guard",
  );
  assert.notEqual(
    ownerRoute.handlers.length,
    inboundRoute.handlers.length,
    "the two sync routes should not share a guard shape",
  );
});

function routeCollectorHolder() {
  const { app, routes } = routeCollector();
  registerWhatsAppRoutes(app, {
    requireAuth: () => (_req, _res, next) => next(),
    assertInboundToken: () => undefined,
    readDb: async () => ({}),
  });
  return { routes };
}

/*
 * The bot's roster was deliberately stripped of participants before it can
 * leave the bot process, so nothing here may pass a member list through. The
 * sync-now handler is a second path onto the same data and has to be held to
 * the same rule as the webhook it sits next to.
 */
test("the owner-triggered sync never relays a participant roster", async () => {
  const { route } = fixture({
    success: true,
    group_count: 3,
    // Even if the bot ever grew a roster here, this handler must not pass it on.
    groups: [{ groupJid: "1@g.us", participants: [{ id: "62811@s.whatsapp.net" }] }],
  });

  const res = await invoke(route);

  assert.equal(res.payload.groups, undefined);
  assert.doesNotMatch(JSON.stringify(res.payload), /participants/);
});

test("the group_sync status block the panel reads is typed on the client", () => {
  const api = readFileSync(new URL("../../src/lib/api.ts", import.meta.url), "utf8");

  assert.match(api, /group_sync\?: WhatsappGroupSync/);
  assert.match(api, /last_synced_at\?: string \| null/);
  assert.match(api, /last_error\?: string/);
  assert.match(api, /group_count\?: number/);
});

test("the owner page renders the sync state rather than leaving it in the payload", () => {
  const page = readFileSync(new URL("../../src/pages/owner-v2/whatsapp/page.tsx", import.meta.url), "utf8");

  assert.match(page, /status\?\.group_sync/, "the page never reads group_sync");
  assert.match(page, /Sinkron sekarang/, "there is no way to trigger a sync on demand");
  assert.match(page, /<small>Sync terakhir<\/small>/, "the last sync time is not shown");
  // A failed sync and a never-synced bot are different states; rendering one
  // for both would tell the owner to fix a problem they do not have.
  assert.match(page, /const groupSyncState: "ok" \| "never" \| "failed"/);
  assert.match(page, /groupSyncState === "never"/);
});
