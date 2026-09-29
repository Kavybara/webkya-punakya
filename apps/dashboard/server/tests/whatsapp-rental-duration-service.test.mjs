import test from "node:test";
import assert from "node:assert/strict";

import {
  addDaysToDateText,
  daysFromRentalDuration,
  rentalAdjustmentDays,
} from "../services/whatsapp-rental-duration-service.js";

test("rental month duration always uses 30 days", () => {
  assert.equal(daysFromRentalDuration({ months: 1 }), 30);
  assert.equal(daysFromRentalDuration({ months: 12 }), 360);
  assert.equal(daysFromRentalDuration({ months: 2, days: 5 }), 65);
});

test("rental adjustments support adding and reducing months or days", () => {
  assert.equal(rentalAdjustmentDays({ direction: "add", unit: "month", amount: 2 }), 60);
  assert.equal(rentalAdjustmentDays({ direction: "subtract", unit: "month", amount: 1 }), -30);
  assert.equal(rentalAdjustmentDays({ direction: "subtract", unit: "day", amount: 7 }), -7);
});

test("rental end preview adds fixed days from a yyyy-mm-dd date", () => {
  assert.equal(addDaysToDateText("2026-06-27", 30), "2026-07-27");
  assert.equal(addDaysToDateText("2026-06-27", 60), "2026-08-26");
});
