import assert from "node:assert/strict";
import test from "node:test";

import {
  checkoutFieldsForVariant,
  checkoutFieldsFromHeaders,
  checkoutValuesForOrder,
  validateCheckoutFieldValues,
} from "../services/checkout-fields-service.js";

test("Sheet headers map only controlled customer fields", () => {
  const fields = checkoutFieldsFromHeaders([" DEVICE\n", "Email Customer", "NOMOR WHATSAPP", "PLAN"]);
  assert.deepEqual(fields.map((field) => field.key), ["customerDevice", "customerEmail"]);
});

test("operational reseller WhatsApp headers never create customer checkout fields", () => {
  const fields = checkoutFieldsFromHeaders([
    "SELLER",
    "NOMOR WA",
    "Nomer WA",
    "WHATSAPP",
    "ORDER ID",
    "CATATAN",
    "STOCK ID",
    "KONDISI AKUN",
  ]);
  assert.deepEqual(fields, []);
});

test("variant checkout fields take precedence and do not inspect product names", () => {
  const fields = checkoutFieldsForVariant(
    { name: "Netflix Canva Vidio" },
    { checkoutFields: [{ key: "customerEmail", required: true }] },
    { qty: 2 },
  );
  assert.deepEqual(fields.map((field) => field.key), ["customerEmail"]);
  assert.equal(fields[0].minItems, 2);
});

test("explicit empty variant metadata disables all additional checkout fields", () => {
  const fields = checkoutFieldsForVariant(
    {
      name: "Netflix Canva Vidio",
      checkoutFields: [{ key: "customerDevice", required: true }],
      checkoutRequirements: { customerField: "device", required: true },
    },
    {
      name: "Vidio tanpa input tambahan",
      checkoutFields: [],
      sheetCheckoutFields: [{ key: "customerEmail", required: true }],
      checkoutRequirements: { customerField: "email", required: true },
    },
    { legacyRequirements: { customerField: "device", required: true } },
  );
  assert.deepEqual(fields, []);
  assert.deepEqual(validateCheckoutFieldValues(fields, {}), {
    ok: true,
    values: {},
    errors: {},
  });
});

test("server validation rejects missing required fields and invalid email", () => {
  const fields = checkoutFieldsFromHeaders(["DEVICE", "EMAIL CUSTOMER"]);
  const missing = validateCheckoutFieldValues(fields, {});
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.customerDevice);
  assert.ok(missing.errors.customerEmail);

  const invalid = validateCheckoutFieldValues(fields, {
    customerDevice: " Samsung A15 ",
    customerEmail: "bukan-email",
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.customerEmail, /valid/);
});

test("validated checkout values are persisted in canonical order fields", () => {
  const fields = [
    ...checkoutFieldsFromHeaders(["DEVICE", "EMAIL CUSTOMER", "NOMOR WA"]),
    { key: "customerWhatsapp", required: true },
  ];
  const validated = validateCheckoutFieldValues(fields, {
    customerDevice: " Laptop Lenovo ",
    customerEmail: "CUSTOMER@EXAMPLE.COM",
    customerWhatsapp: "08123456789",
  }, { normalizeWhatsapp: (value) => `62${String(value).replace(/\D/g, "").replace(/^0/, "")}` });
  assert.equal(validated.ok, true);
  assert.deepEqual(checkoutValuesForOrder(validated.values), {
    checkoutData: {
      customerDevice: "Laptop Lenovo",
      customerEmail: "customer@example.com",
      customerWhatsapp: "628123456789",
      customerPlan: "",
    },
    email: "customer@example.com",
    customerEmails: ["customer@example.com"],
    device: "Laptop Lenovo",
    customerWhatsapp: "628123456789",
    customerPlan: "",
  });
});

test("legacy checkout requirement remains supported", () => {
  const fields = checkoutFieldsForVariant({}, {
    checkoutRequirements: { customerField: "device", required: true, label: "Device Customer" },
  });
  assert.equal(fields.length, 1);
  assert.equal(fields[0].key, "customerDevice");
});
