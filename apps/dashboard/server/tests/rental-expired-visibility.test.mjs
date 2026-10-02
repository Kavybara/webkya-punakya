import assert from "node:assert/strict";
import test from "node:test";

import { registerWhatsAppRoutes } from "../routes/whatsapp-routes.js";

/*
 * Why the owner could see a rental count but never a rental that had ended.
 *
 * The WhatsApp page shows two numbers off one list: "Rental aktif" and
 * "Expired". `mergedWhatsappRentals` drops every row whose `daysLeft` has run
 * out unless it is called with `includeExpired`:
 *
 *     if (!includeExpired && (merged.daysLeft <= 0 || merged.status === "expired")) continue;
 *
 * `GET /api/whatsapp/rentals` -- the endpoint the page loads -- called it with
 * no options. So the filter ran, and the "Expired" metric counted rows from a
 * list that had already had every expired row removed from it. It was not a
 * wrong count; it was a count of nothing, and it could only ever read zero no
 * matter how many rentals had actually ended.
 *
 * Every other caller in the server already passed `includeExpired: true` --
 * the cron, the price-sync preview, `/api/bootstrap`. This test pins that the
 * listing endpoint joins them, because the difference between "no rental has
 * expired" and "the rental table hides expired rentals" is exactly the
 * difference between a fact and a silence.
 */

function routeCollector() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
  }
  return { app, routes };
}

function response() {
  return {
    statusCode: 200,
    payload: undefined,
    json(payload) {
      this.payload = payload;
      return payload;
    },
  };
}

function handlerFor(routes, method, routePath) {
  const route = routes.find((item) => item.method === method && item.path === routePath);
  assert.ok(route, `${method.toUpperCase()} ${routePath} must be registered`);
  return route.handlers.at(-1);
}

const requireAuth = () => (_req, _res, next) => next();

/**
 * Stands in for the real merge, keeping the one behaviour under test: expired
 * rows are dropped unless the caller asks for them.
 */
function fakeMerge(rentals) {
  return async (_db, options = {}) => (
    options.includeExpired
      ? rentals
      : rentals.filter((rental) => rental.daysLeft > 0 && rental.status !== "expired")
  );
}

const RENTALS = [
  { id: "grp-active", name: "Aktif", status: "active", daysLeft: 12 },
  { id: "grp-lapsed", name: "Sudah lewat", status: "expired", daysLeft: -3 },
];

test("the rentals listing returns ended rentals, not just live ones", async () => {
  const { app, routes } = routeCollector();
  registerWhatsAppRoutes(app, {
    requireAuth,
    readDb: async () => ({ whatsappRentals: [], whatsappGroupDirectory: [] }),
    mergedWhatsappRentals: fakeMerge(RENTALS),
  });

  const res = response();
  await handlerFor(routes, "get", "/api/whatsapp/rentals")({ query: {} }, res);

  const ids = res.payload.map((row) => row.id);
  assert.ok(
    ids.includes("grp-lapsed"),
    "GET /api/whatsapp/rentals still hides expired rentals, so the page's Expired metric can only ever be zero",
  );
  assert.ok(ids.includes("grp-active"), "the live rental went missing while fixing this");
  assert.equal(res.payload.length, 2);
});