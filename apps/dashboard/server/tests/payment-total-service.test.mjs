import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCustomerPaymentBreakdown,
  deriveProviderTotalPayment,
} from "../services/payment-total-service.js";

test("merchant-absorbed fee does not increase customer total", () => {
  assert.equal(deriveProviderTotalPayment(3_000, 331, 3_000), 3_000);
  assert.deepEqual(deriveCustomerPaymentBreakdown(3_000, 331, 3_000), {
    nominal: 3_000,
    total: 3_000,
    customerFee: 0,
  });
});

test("customer fee follows an explicit higher provider total", () => {
  assert.deepEqual(deriveCustomerPaymentBreakdown(3_000, 331, 3_331), {
    nominal: 3_000,
    total: 3_331,
    customerFee: 331,
  });
});

test("fee remains a fallback when provider omits total_payment", () => {
  assert.equal(deriveProviderTotalPayment(3_000, 331, 0), 3_331);
});
