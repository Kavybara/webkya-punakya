import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeliveryTemplateContext,
  renderDeliveryTemplate,
  resolveDeliveryTemplateConfig,
  validateDeliveryTemplate,
} from "../services/delivery-template-service.js";

test("renders unicode, line breaks, and supported placeholders without changing owner copy", () => {
  const source = [
    "⋆°࿔ NETFLIX 1P1U 𝜗𝜚°⋆",
    "",
    "email :: {{email}}",
    "pass :: {{password}}",
    "profile :: {{profile}}",
  ].join("\n");

  const result = renderDeliveryTemplate(source, {
    email: "customer@example.com",
    password: "rahasia",
    profile: "Profil 2",
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, [
    "⋆°࿔ NETFLIX 1P1U 𝜗𝜚°⋆",
    "",
    "email :: customer@example.com",
    "pass :: rahasia",
    "profile :: Profil 2",
  ].join("\n"));
});

test("renders safe conditional blocks and removes optional placeholder-only lines", () => {
  const source = [
    "{{#if profile}}profile :: {{profile}}{{/if}}",
    "{{#if pin}}pin :: {{pin}}{{/if}}",
    "{{rental_end}}",
    "selesai",
  ].join("\n");

  const result = renderDeliveryTemplate(source, {
    profile: "Anak",
    pin: "",
    rental_end: "",
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "profile :: Anak\nselesai");
  assert.equal(result.text.includes("{{"), false);
});

test("validates unknown placeholders and unclosed conditional blocks", () => {
  const result = validateDeliveryTemplate(
    "{{#if email}}email {{emali}}",
    ["email"],
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /emali/);
  assert.match(result.errors.join(" "), /ditutup/);
});

test("supports required fields with alternatives", () => {
  const valid = renderDeliveryTemplate(
    "{{login_identifier}}\n{{password}}",
    { login_identifier: "628123", password: "secret" },
    { requiredFields: ["email|login_identifier", "password"] },
  );
  const invalid = renderDeliveryTemplate(
    "{{login_identifier}}\n{{password}}",
    { login_identifier: "", password: "secret" },
    { requiredFields: ["email|login_identifier", "password"] },
  );

  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.missingFields, ["email|login_identifier"]);
});

test("variant template wins over product default and configurations are independent", () => {
  const product = {
    deliveryTemplate: "default {{email}}",
    deliveryTemplateVersion: 4,
  };
  const variant = {
    id: "variant-daily",
    code: "SKU-DAILY",
    deliveryTemplate: "daily {{email}}",
    deliveryTemplateVersion: 2,
  };

  const resolved = resolveDeliveryTemplateConfig(product, variant);

  assert.equal(resolved.scope, "variant");
  assert.equal(resolved.source, "daily {{email}}");
  assert.equal(resolved.version, 2);
  assert.equal(resolved.variantId, "variant-daily");
  assert.equal(resolved.sku, "SKU-DAILY");
});

test("selects Netflix and WeTV daily/monthly templates only by stable variant id and SKU", () => {
  const product = { deliveryTemplate: "fallback {{email}}" };
  const cases = [
    ["var-netflix-monthly", "NET-1P1U-MONTH", "Template Netflix bulanan"],
    ["var-netflix-daily", "NET-1P1U-DAY", "Template Netflix harian"],
    ["var-wetv-monthly", "WETV-SHARE-MONTH", "Template WeTV bulanan"],
    ["var-wetv-daily", "WETV-SHARE-DAY", "Template WeTV harian"],
  ];

  for (const [id, sku, source] of cases) {
    const resolved = resolveDeliveryTemplateConfig(product, {
      id,
      sku,
      name: "Nama varian boleh diubah tanpa memengaruhi mapping",
      deliveryTemplate: source,
    });
    assert.equal(resolved.variantId, id);
    assert.equal(resolved.sku, sku);
    assert.equal(resolved.source, source);
    assert.equal(resolved.scope, "variant");
  }
});

test("falls back to product default and reports missing configuration", () => {
  assert.equal(
    resolveDeliveryTemplateConfig(
      { deliveryTemplate: "default {{email}}", deliveryTemplateVersion: 3 },
      { id: "variant-empty", code: "SKU-EMPTY" },
    ).scope,
    "product",
  );
  assert.equal(
    resolveDeliveryTemplateConfig({}, { id: "variant-empty" }).configured,
    false,
  );
});

test("builds context from real order and fulfillment account fields", () => {
  const context = buildDeliveryTemplateContext({
    order: {
      id: "ORD-1",
      product: "Netflix",
      variant: "1P1U",
      variantCode: "SKU-1",
      duration: "1 Bulan",
      customer: "Nadia",
      email: "buyer@example.com",
      whatsapp: "628123",
      createdAt: "2026-07-20 10:00",
      expiresAt: "2026-08-20 10:00",
    },
    product: { name: "Netflix" },
    variant: { id: "var-1", code: "SKU-1", name: "1P1U" },
    account: {
      email: "netflix@example.com",
      password: "secret",
      profile: "Nadia",
      pin: "1234",
      expiresAt: "2026-08-20 10:00",
    },
  });

  assert.equal(context.product_name, "Netflix");
  assert.equal(context.variant_name, "1P1U");
  assert.equal(context.sku, "SKU-1");
  assert.equal(context.email, "netflix@example.com");
  assert.equal(context.customer_email, "buyer@example.com");
  assert.equal(context.rental_end, "2026-08-20 10:00");
});

test("does not stringify objects or leak raw unresolved placeholders", () => {
  const result = renderDeliveryTemplate(
    "email: {{email}}\npassword: {{password}}",
    { email: { unsafe: true }, password: undefined },
  );

  assert.equal(result.ok, false);
  assert.equal(result.text.includes("[object Object]"), false);
  assert.equal(result.text.includes("undefined"), false);
  assert.equal(result.text.includes("{{"), false);
});
