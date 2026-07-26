import assert from "node:assert/strict";
import test from "node:test";

import { planResellerSheetSync } from "../services/reseller-sheet-sync-service.js";

test("reseller sync adds missing rows, updates changed phones, and is case insensitive", () => {
  const plan = planResellerSheetSync([
    { id: "r1", username: " Nadia ", whatsapp: "628111" },
    { id: "r2", username: "Sena", whatsapp: "628222" },
    { id: "r3", username: "Kya", whatsapp: "628333" },
  ], [
    { rowNumber: 2, seller: "NADIA", whatsapp: "628111" },
    { rowNumber: 3, seller: "sena", whatsapp: "628000" },
    { rowNumber: 4, seller: "manual", whatsapp: "628999" },
  ]);
  assert.equal(plan.checked, 3);
  assert.deepEqual(plan.added.map((item) => item.username), ["kya"]);
  assert.deepEqual(plan.updated.map((item) => [item.username, item.rowNumber]), [["sena", 3]]);
  assert.deepEqual(plan.skipped.map((item) => item.username), ["nadia"]);
});

test("reseller sync is idempotent and preserves unknown manual rows", () => {
  const resellers = [{ id: "r1", username: "nadia", whatsapp: "628111" }];
  const rows = [
    { rowNumber: 2, seller: "nadia", whatsapp: "628111" },
    { rowNumber: 3, seller: "manual", whatsapp: "628999" },
  ];
  const first = planResellerSheetSync(resellers, rows);
  const second = planResellerSheetSync(resellers, rows);
  assert.equal(first.added.length, 0);
  assert.equal(second.added.length, 0);
  assert.equal(first.updated.length, 0);
  assert.equal(rows.length, 2);
});

test("reseller sync reports duplicates and never deletes them", () => {
  const plan = planResellerSheetSync(
    [{ id: "r1", username: "nadia", whatsapp: "628111" }],
    [
      { rowNumber: 2, seller: "nadia", whatsapp: "628111" },
      { rowNumber: 3, seller: " NADIA ", whatsapp: "628222" },
    ],
  );
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].type, "duplicate_sheet_username");
  assert.equal(plan.added.length, 0);
  assert.equal(plan.updated.length, 0);
});

test("canonical SELLER value resolves the same WhatsApp as the Sheet VLOOKUP", () => {
  const plan = planResellerSheetSync(
    [{ id: "r1", username: " Nadia ", whatsapp: "81398357485" }],
    [],
  );
  const dataResellerRows = new Map(plan.added.map((item) => [item.username, item.whatsapp]));
  assert.equal(dataResellerRows.get("nadia"), "81398357485");
});
