import assert from "node:assert/strict";
import test from "node:test";

import { fulfillPaidOrder, refreshOrderDeliveryTemplateSnapshot } from "../auto-order.js";

function paidOrderFixture() {
  const product = {
    id: "prod-netflix",
    name: "Netflix Premium",
    variants: [{
      id: "net-1p1u",
      code: "NET-1P1U",
      name: "Sharing 1P1U",
      prices: { "1 Hari": 3000 },
    }],
  };
  const order = {
    id: "ORD-FALLBACK",
    paymentRef: "PAY-FALLBACK",
    resellerId: "res-test",
    whatsapp: "6281234567890",
    customer: "Tester",
    product: product.name,
    productId: product.id,
    variant: "Sharing 1P1U",
    variantId: "net-1p1u",
    variantCode: "NET-1P1U",
    customerVariant: "Sharing 1P1U",
    customerVariantId: "net-1p1u",
    customerVariantCode: "NET-1P1U",
    duration: "1 Hari",
    durationDays: 1,
    qty: 1,
    total: 3000,
    paymentDue: 3000,
    qrisStatus: "paid",
    orderStatus: "processing",
    deliveryStatus: "paid",
    reservedStockIds: ["stk-reserved-became-sold"],
    createdAt: "2026-07-19 10:00",
    expiresAt: "2026-07-20 10:00",
  };
  const fallback = {
    id: "stk-fallback",
    productId: product.id,
    variantId: "net-1p1u",
    variantCode: "NET-1P1U",
    status: "available",
    sheetSource: "google_sheets",
    sheetName: "Netflix",
    sheetRow: 10,
    email: "fallback@example.com",
    password: "secret",
    profile: "Fallback",
    pin: "1234",
  };
  return {
    order,
    fallback,
    db: {
      products: [product],
      stock: [
        {
          id: "stk-reserved-became-sold",
          productId: product.id,
          variantId: "net-1p1u",
          variantCode: "NET-1P1U",
          status: "sold",
          sheetSource: "google_sheets",
        },
        fallback,
      ],
      orders: [order],
      payments: [{ ref: "PAY-FALLBACK", orderId: order.id, status: "paid", amount: 3000, provider: "pakasir" }],
      resellers: [{ id: "res-test", name: "Tester", whatsapp: "6281234567890", deposit: 0 }],
      managedAccounts: [],
      activities: [],
      linkPools: [],
      settings: {},
    },
  };
}

test("paid order falls back to another available stock when its reservation became unavailable", () => {
  const { db, order, fallback } = paidOrderFixture();

  const result = fulfillPaidOrder(db, order.id);

  assert.equal(result.ok, true);
  assert.equal(order.deliveryStatus, "sent");
  assert.equal(order.orderStatus, "completed");
  assert.deepEqual(order.deliveredStockIds, [fallback.id]);
  assert.equal(fallback.status, "sold");
  assert.equal(db.resellers[0].deposit, 0);
  assert.equal(order.stockRaceDepositCredited, undefined);
});

test("paid order is held for Owner when a Sheet conflict has no safe fallback", () => {
  const { db, order } = paidOrderFixture();
  order.holdOnStockUnavailable = true;
  order.stockConflictStockIds = ["stk-reserved-became-sold"];
  db.stock = db.stock.filter((stock) => stock.status !== "available");

  const result = fulfillPaidOrder(db, order.id);

  assert.equal(result.ok, false);
  assert.equal(order.orderStatus, "processing");
  assert.equal(order.deliveryStatus, "stock_conflict");
  assert.equal(order.stockRaceDepositCredited, undefined);
  assert.equal(db.resellers[0].deposit, 0);
});

test("fulfillment stores an immutable per-variant delivery template snapshot", () => {
  const { db, order } = paidOrderFixture();
  const variant = db.products[0].variants[0];
  variant.deliveryTemplate = [
    "NETFLIX {{variant_name}}",
    "email: {{email}}",
    "password: {{password}}",
    "{{#if profile}}profile: {{profile}}{{/if}}",
    "{{#if pin}}pin: {{pin}}{{/if}}",
    "berakhir: {{rental_end}}",
  ].join("\n");
  variant.deliveryTemplateVersion = 7;
  variant.requiredDeliveryFields = ["email", "password", "rental_end"];

  const result = fulfillPaidOrder(db, order.id);

  assert.equal(result.ok, true);
  assert.equal(order.deliveryTemplateSnapshot.status, "ready");
  assert.equal(order.deliveryTemplateSnapshot.variantId, variant.id);
  assert.equal(order.deliveryTemplateSnapshot.sku, variant.code);
  assert.equal(order.deliveryTemplateSnapshot.templateVersion, 7);
  assert.match(order.deliveryTemplateSnapshot.renderedText, /fallback@example\.com/);
  assert.match(order.deliveryTemplateSnapshot.renderedText, /berakhir: 2026-07-20 10:00/);
  assert.equal(order.deliveryTemplateSnapshots.length, 1);
  assert.equal(db.managedAccounts[0].deliveryTemplateSnapshot.status, "ready");
  assert.ok(db.managedAccounts[0].deliveryTemplateUnreadAt);

  variant.deliveryTemplate = "TEMPLATE BARU {{email}}";
  variant.deliveryTemplateVersion = 8;
  fulfillPaidOrder(db, order.id);
  assert.equal(order.deliveryTemplateSnapshot.templateVersion, 7);
  assert.equal(order.deliveryTemplateSnapshot.renderedText.includes("TEMPLATE BARU"), false);
});

test("fulfillment marks template incomplete without exposing broken rendered text", () => {
  const { db, order } = paidOrderFixture();
  const variant = db.products[0].variants[0];
  variant.deliveryTemplate = "email: {{email}}\nusername: {{username}}\npassword: {{password}}";
  variant.deliveryTemplateVersion = 1;
  variant.requiredDeliveryFields = ["email", "username", "password"];

  const result = fulfillPaidOrder(db, order.id);

  assert.equal(result.ok, true);
  assert.equal(order.deliveryTemplateSnapshot.status, "incomplete");
  assert.deepEqual(order.deliveryTemplateSnapshot.missingFields, ["username"]);
  assert.equal(order.deliveryTemplateSnapshot.renderedText, "");
  assert.equal(result.reply.includes("{{username}}"), false);
});

test("explicit owner rerender replaces the snapshot and marks it unread again", () => {
  const { db, order } = paidOrderFixture();
  const product = db.products[0];
  const variant = product.variants[0];
  variant.deliveryTemplate = "versi 1 {{email}}";
  variant.deliveryTemplateVersion = 1;
  variant.requiredDeliveryFields = ["email"];
  fulfillPaidOrder(db, order.id);
  const account = db.managedAccounts[0];
  account.deliveryTemplateOpenedAt = "2026-07-20 11:00";
  account.deliveryTemplateUnreadAt = "";

  variant.deliveryTemplate = "versi 2 {{email}}";
  variant.deliveryTemplateVersion = 2;
  refreshOrderDeliveryTemplateSnapshot(db, {
    order,
    product,
    variant,
    accounts: [account],
    force: true,
  });

  assert.equal(order.deliveryTemplateSnapshot.templateVersion, 2);
  assert.match(order.deliveryTemplateSnapshot.renderedText, /versi 2/);
  assert.equal(account.deliveryTemplateOpenedAt, undefined);
  assert.ok(account.deliveryTemplateUnreadAt);
});
