import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicTrackingLimiter,
  createTrackingToken,
  findOrderForPublicTracking,
  safeTrackingOrder,
} from "../services/public-order-tracking-service.js";

const baseOrder = {
  id: "ORD-TEST-123",
  trackingToken: "track_secret_value",
  product: "Netflix Premium",
  variant: "Sharing 1P1U",
  whatsapp: "628123456789",
  email: "buyer@example.com",
  customer: "Buyer",
  reseller: "internal-reseller",
  resellerId: "res-1",
  qrisStatus: "paid",
  orderStatus: "completed",
  deliveryStatus: "sent",
  createdAt: "2026-07-24 10:00",
  paidAt: "2026-07-24 10:05",
  fulfillmentText: "email: secret@example.com\npassword: very-secret",
  deliveredAccounts: [{ password: "very-secret", pin: "1234" }],
  deliveryTemplateSnapshot: {
    templateSource: "password: {{password}}",
    renderedText: "password: very-secret",
    templateVersion: 2,
  },
  note: "internal note",
};

test("tracking token is random and URL safe", () => {
  const first = createTrackingToken();
  const second = createTrackingToken();
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{40,}$/);
});

test("public tracking accepts a valid token and rejects an order id alone", () => {
  const orders = [baseOrder];
  assert.equal(findOrderForPublicTracking(orders, { trackingToken: baseOrder.trackingToken }), baseOrder);
  assert.equal(findOrderForPublicTracking(orders, { orderId: baseOrder.id }), null);
});

test("fallback tracking requires both order id and matching contact", () => {
  const orders = [baseOrder];
  assert.equal(findOrderForPublicTracking(orders, {
    orderId: baseOrder.id,
    verification: "08123456789",
  }), baseOrder);
  assert.equal(findOrderForPublicTracking(orders, {
    orderId: baseOrder.id,
    verification: "wrong@example.com",
  }), null);
});

test("public response masks identity and excludes credentials and internal data", () => {
  const result = safeTrackingOrder(baseOrder);
  const serialized = JSON.stringify(result);
  assert.equal(result.product, "Netflix Premium");
  assert.match(result.customerContact, /\*+/);
  for (const forbidden of [
    "very-secret",
    "1234",
    "internal-reseller",
    "internal note",
    "fulfillmentText",
    "deliveredAccounts",
    "deliveryTemplateSnapshot",
    "renderedText",
    "templateSource",
    "password",
    "pin",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
  }
});

test("public tracking limiter blocks repeated failed attempts", () => {
  let now = 1_000;
  const limiter = createPublicTrackingLimiter({
    maxAttempts: 3,
    windowMs: 60_000,
    now: () => now,
  });
  assert.equal(limiter.check("client").allowed, true);
  limiter.recordFailure("client");
  limiter.recordFailure("client");
  limiter.recordFailure("client");
  assert.equal(limiter.check("client").allowed, false);
  now += 60_001;
  assert.equal(limiter.check("client").allowed, true);
});
