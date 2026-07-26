import assert from "node:assert/strict";
import test from "node:test";

import { registerProductAdminRoutes } from "../routes/product-admin-routes.js";

function routeCollector() {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
  }
  return { app, routes };
}

const requireAuth = (roles) => ({ roles });

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
}

function fixture() {
  return {
    products: [{
      id: "prod-netflix",
      name: "Netflix",
      variants: [
        {
          id: "var-monthly",
          code: "NET-MONTH",
          name: "Bulanan",
          deliveryTemplate: "email: {{email}}",
          deliveryTemplateVersion: 2,
          requiredDeliveryFields: ["email"],
        },
        {
          id: "var-daily",
          code: "NET-DAY",
          name: "Harian",
          deliveryTemplate: "",
          deliveryTemplateVersion: 0,
          requiredDeliveryFields: [],
        },
      ],
    }],
    activities: [],
  };
}

test("owner can preview, save, and independently copy a variant delivery template", async () => {
  const { app, routes } = routeCollector();
  const db = fixture();
  registerProductAdminRoutes(app, {
    requireAuth,
    readDb: async () => db,
    updateDb: async (mutator) => mutator(db),
    makeId: () => "act-template",
    nowText: () => "2026-07-26T12:00:00.000Z",
  });

  const previewRoute = routes.find((route) => route.path.endsWith("/delivery-template/preview"));
  const previewRes = response();
  await previewRoute.handlers.at(-1)({
    auth: { sub: "owner" },
    params: { id: "prod-netflix", variantId: "var-daily" },
    body: {
      source: "preview {{email}}\n{{#if pin}}pin {{pin}}{{/if}}",
      requiredFields: ["email"],
    },
  }, previewRes);
  assert.equal(previewRes.payload.previewData, true);
  assert.match(previewRes.payload.rendered.text, /contoh@kavya\.test/);

  const saveRoute = routes.find((route) => route.method === "put" && route.path.endsWith("/delivery-template"));
  const saveRes = response();
  await saveRoute.handlers.at(-1)({
    auth: { sub: "owner" },
    params: { id: "prod-netflix", variantId: "var-daily" },
    body: { source: "harian {{email}}\n{{rental_end}}", requiredFields: ["email", "rental_end"] },
  }, saveRes);
  assert.equal(saveRes.payload.variant.deliveryTemplateVersion, 1);
  assert.equal(saveRes.payload.variant.deliveryTemplate, "harian {{email}}\n{{rental_end}}");

  const copyRoute = routes.find((route) => route.path.endsWith("/delivery-template/copy"));
  const copyRes = response();
  await copyRoute.handlers.at(-1)({
    auth: { sub: "owner" },
    params: { id: "prod-netflix", variantId: "var-daily" },
    body: { sourceProductId: "prod-netflix", sourceVariantId: "var-monthly" },
  }, copyRes);
  const source = db.products[0].variants[0];
  const target = db.products[0].variants[1];
  assert.equal(target.deliveryTemplate, "email: {{email}}");
  assert.notEqual(target.requiredDeliveryFields, source.requiredDeliveryFields);
  target.deliveryTemplate = "independent edit";
  assert.equal(source.deliveryTemplate, "email: {{email}}");
  assert.equal(JSON.stringify(db.activities).includes("passwordcontoh"), false);
  assert.equal(JSON.stringify(db.activities).includes("email: {{email}}"), false);
});
