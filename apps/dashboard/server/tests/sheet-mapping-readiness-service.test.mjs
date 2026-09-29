import assert from "node:assert/strict";
import test from "node:test";

import { summarizeSheetMappingPreview } from "../services/sheet-mapping-readiness-service.js";

test("mapping readiness accepts exact writable columns without exposing values", () => {
  const result = summarizeSheetMappingPreview({
    ok: true,
    sheetName: "Netflix",
    rowNumber: 12,
    columns: [
      { index: 0, header: "ACCOUNT & PASSWORD", value: "secret" },
      { index: 4, header: "EXPIRED", value: "=formula" },
      { index: 7, header: "SELLER", value: "kya" },
    ],
    updates: [
      { range: "Netflix!A12", values: [["secret"]] },
      { range: "Netflix!H12", values: [["kya"]] },
    ],
  }, { groupKey: "netflix-1u" });

  assert.equal(result.status, "READY");
  assert.deepEqual(result.updateColumns, ["A", "H"]);
  assert.equal("values" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("mapping readiness blocks formula-owned and operational columns", () => {
  const result = summarizeSheetMappingPreview({
    ok: true,
    sheetName: "Netflix",
    rowNumber: 12,
    columns: [
      { index: 4, header: "EXPIRED" },
      { index: 8, header: "NOMOR WA" },
      { index: 10, header: "KONDISI AKUN" },
    ],
    updates: [
      { range: "Netflix!E12", values: [["bad"]] },
      { range: "Netflix!I12", values: [["bad"]] },
      { range: "Netflix!K12", values: [["bad"]] },
    ],
  });

  assert.equal(result.status, "BLOCKED_PROTECTED_COLUMN");
  assert.deepEqual(result.protectedWrites, [
    { column: "E", header: "EXPIRED" },
    { column: "I", header: "NOMOR WA" },
    { column: "K", header: "KONDISI AKUN" },
  ]);
});
