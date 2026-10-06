import assert from "node:assert/strict";
import test from "node:test";

import { createPaymentReconciliationService } from "../services/payment-reconciliation-service.js";

const { pakasirStatusIsPaid } = createPaymentReconciliationService({});

for (const status of ["paid", "success", "settlement", "settled", "completed", "complete", "berhasil", "sukses", " PAID ", "\tCompleted\n"]) {
  test(`recognizes only an exact paid status: ${JSON.stringify(status)}`, () => {
    assert.equal(pakasirStatusIsPaid(status), true);
  });
}

for (const status of ["unpaid", "unsuccessful", "unsettled", "pending", "expired", "cancelled", "failed", "not paid", "payment completed", "paid_pending", "", null, undefined]) {
  test(`does not mark ${JSON.stringify(status)} as paid`, () => {
    assert.equal(pakasirStatusIsPaid(status), false);
  });
}

for (const status of ["unpaid", "unsuccessful", "unsettled"]) {
  test(`reconciliation does not fulfill provider status ${status}`, async () => {
    let fulfilled = 0;
    let service;
    const db = {
      orders: [{ id: "ORD-TEST", paymentRef: "PAY-TEST", orderStatus: "pending", qrisStatus: "pending" }],
      payments: [{ ref: "PAY-TEST", orderId: "ORD-TEST", provider: "pakasir", status: "pending" }],
    };
    service = createPaymentReconciliationService({
      fetchPakasirTransactionDetail: async () => ({ ok: true, status, paid: service.pakasirStatusIsPaid(status) }),
      fulfillPaidOrderAndNotify: async () => { fulfilled += 1; return { ok: true }; },
      nowText: () => new Date().toISOString(),
      toDateTime: () => null,
      derivePakasirTotalPayment: () => 0,
      dateTimeText: (value) => value.toISOString(),
      makeId: () => "act-test",
      normalizeWhatsappNumber: (value) => value,
      formatRupiah: (value) => String(value),
      activeResellerByWhatsapp: () => null,
    });

    const result = await service.reconcilePakasirPaymentInDb(db, "PAY-TEST");

    assert.equal(result.paid, false);
    assert.equal(fulfilled, 0);
    assert.equal(db.orders[0].qrisStatus, "pending");
    assert.equal(db.payments[0].status, "pending");
    assert.equal(db.payments[0].paymentProviderStatus, status);
  });
}
