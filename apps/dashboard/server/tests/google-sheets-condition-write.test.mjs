import assert from "node:assert/strict";
import test from "node:test";

import {
  actualSheetRowUpdates,
  planAccountConditionSheetUpdate,
  planAccountSheetRowUpdate,
  planWarrantyStockReviewSheetUpdates,
  validateReplacementTargetSheetRow,
} from "../google-sheets.js";

test("warranty replacement revalidates that the target Sheet row is still available", () => {
  const header = [
    "ACCOUNT & PASSWORD",
    "PROFIL",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "PIN",
    "DEVICE CUSTOMER",
    "SELLER",
    "NOMOR WA",
    "ORDER ID / ID MANUAL",
    "KONDISI AKUN",
    "CATATAN",
    "STOCK ID",
  ];
  const availableRow = [
    "replacement@example.test\nsecret",
    "Caramel",
    "",
    "",
    "=IF(OR(C2=\"\";D2=\"\");\"\";C2+30)",
    "4421",
    "",
    "",
    "=IFERROR(VLOOKUP(H2;'data reseller'!A:B;2;FALSE);\"\")",
    "",
    "NORMAL",
    "",
    "stock-replacement",
  ];
  const rows = [header, availableRow];
  const stock = {
    id: "stock-replacement",
    sheetPool: "NETFLIX_SHARED",
    sheetRow: 2,
    sheetStartColumn: 0,
  };

  assert.deepEqual(validateReplacementTargetSheetRow(rows, stock), { ok: true });

  const manuallySold = rows.map((row) => [...row]);
  manuallySold[1][7] = "nadia";
  manuallySold[1][9] = "MANUAL-ORDER";
  assert.equal(validateReplacementTargetSheetRow(manuallySold, stock).reason, "replacement_target_already_assigned");

  const alreadyAssignedToThisReplacement = rows.map((row) => [...row]);
  alreadyAssignedToThisReplacement[1][2] = "17 September";
  alreadyAssignedToThisReplacement[1][3] = "1b";
  alreadyAssignedToThisReplacement[1][7] = "nadia";
  alreadyAssignedToThisReplacement[1][9] = "ORD-WARRANTY-2";
  assert.deepEqual(
    validateReplacementTargetSheetRow(alreadyAssignedToThisReplacement, stock, { orderId: "ORD-WARRANTY-2" }),
    { ok: true },
    "a retry must accept a row already assigned to the exact same order and Stock ID",
  );

  const changedIdentity = rows.map((row) => [...row]);
  changedIdentity[1][12] = "different-stock";
  assert.equal(validateReplacementTargetSheetRow(changedIdentity, stock).reason, "replacement_target_stock_id_changed");

  const missingStockId = rows.map((row) => [...row]);
  missingStockId[1][12] = "";
  assert.deepEqual(
    validateReplacementTargetSheetRow(missingStockId, stock),
    { ok: true },
    "an otherwise available row may receive its deterministic Stock ID during replacement",
  );
  const assignment = planAccountSheetRowUpdate("Netflix", 2, missingStockId, stock, {
    stockId: stock.id,
    duration: "1 Bulan",
  }, {
    id: "ORD-WARRANTY-2",
    reseller: "nadia",
    duration: "1 Bulan",
  });
  assert.equal(assignment.ok, true);
  assert.ok(assignment.updates.some((update) => update.range === "'Netflix'!M2" && update.values[0][0] === stock.id));
});

test("warranty replacement only plans KONDISI AKUN on the old Sheet row", () => {
  const rows = [
    [],
    ["POOL: NETFLIX_1U"],
    [
      "ACCOUNT & PASSWORD",
      "PROFIL",
      "TANGGAL",
      "DURASI",
      "EXPIRED",
      "PIN",
      "DEVICE CUSTOMER",
      "SELLER",
      "NOMOR WA",
      "ORDER ID / ID MANUAL",
      "KONDISI AKUN",
      "CATATAN",
      "STOCK ID",
      "",
    ],
    [
      "old@example.test\nsecret",
      "Caramel",
      "1 Agustus",
      "1b",
      "=IF(OR(C4=\"\";D4=\"\");\"\";EDATE(C4;1))",
      "1111",
      "TV",
      "nadia",
      "=IFERROR(VLOOKUP(H4;'data reseller'!A:B;2;FALSE);\"\")",
      "ORD-WARRANTY-1",
      "NORMAL",
      "",
      "stock-old",
      "",
    ],
  ];

  const result = planAccountConditionSheetUpdate("Netflix", 4, rows, {
    id: "stock-old",
    sheetPool: "NETFLIX_SHARED",
    sheetRow: 4,
    sheetStartColumn: 0,
  }, "REPLACED");

  assert.equal(result.ok, true);
  assert.deepEqual(result.updates, [{ range: "'Netflix'!K4", values: [["REPLACED"]] }]);
});

test("warranty stock review plans DIPERIKSA for every profile row without crossing pool columns", () => {
  const rows = [
    [],
    ["POOL: NETFLIX_1U"],
    [
      "ACCOUNT & PASSWORD", "PROFIL", "TANGGAL", "DURASI", "EXPIRED", "PIN",
      "DEVICE CUSTOMER", "SELLER", "NOMOR WA", "ORDER ID / ID MANUAL",
      "KONDISI AKUN", "CATATAN", "STOCK ID", "",
    ],
    ["account@example.test\nsecret", "Caramel", "", "", "", "1111", "", "", "", "", "NORMAL", "", "stock-a", ""],
    ["account@example.test\nsecret", "Pretzel", "", "", "", "2222", "", "", "", "", "NORMAL", "", "stock-b", ""],
  ];
  const plan = planWarrantyStockReviewSheetUpdates(new Map([["Netflix", rows]]), [
    { id: "stock-a", sheetName: "Netflix", sheetPool: "NETFLIX_SHARED", sheetRow: 4, sheetStartColumn: 0 },
    { id: "stock-b", sheetName: "Netflix", sheetPool: "NETFLIX_SHARED", sheetRow: 5, sheetStartColumn: 0 },
  ]);

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.updates, [
    { range: "'Netflix'!K4", values: [["DIPERIKSA"]] },
    { range: "'Netflix'!K5", values: [["DIPERIKSA"]] },
  ]);
  assert.deepEqual(plan.stockIds, ["stock-a", "stock-b"]);
});

test("warranty stock review fails closed when one condition cell cannot be resolved", () => {
  const rows = [
    ["ACCOUNT & PASSWORD", "PROFIL", "TANGGAL", "DURASI", "EXPIRED", "PIN", "DEVICE", "SELLER", "NOMOR WA", "ORDER ID", "CATATAN", "STOCK ID"],
    ["account@example.test\nsecret", "Caramel", "", "", "", "1111", "", "", "", "", "", "stock-a"],
  ];
  const plan = planWarrantyStockReviewSheetUpdates(new Map([["Netflix", rows]]), [
    { id: "stock-a", sheetName: "Netflix", sheetPool: "NETFLIX_SHARED", sheetRow: 2, sheetStartColumn: 0 },
  ]);

  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "account_condition_column_missing");
  assert.deepEqual(plan.updates, []);
});

test("fulfillment maps Netflix assignment metadata without rewriting credentials or formula-owned cells", () => {
  const header = [
    "ACCOUNT & PASSWORD",
    "PROFIL",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "PIN",
    "DEVICE",
    "SELLER",
    "NOMOR WA",
    "ORDER ID / ID MANUAL",
    "KONDISI AKUN",
    "CATATAN",
  ];
  const rows = [
    header,
    [
      "account@example.com\nsecret",
      "Profil 1",
      "",
      "",
      "=IF(OR(C2=\"\";D2=\"\");\"\";C2+30)",
      "1234",
      "",
      "",
      "=IF(H2=\"\";\"\";\"628123\")",
      "",
      "NORMAL",
      "",
    ],
  ];

  const result = actualSheetRowUpdates(
    "Netflix",
    2,
    rows,
    {
      id: "STOCK-1",
      sheetPool: "NETFLIX_SHARED",
      sheetRow: 2,
      sheetStartColumn: 0,
      email: "account@example.com",
      password: "secret",
      profile: "Profil 1",
      pin: "1234",
    },
    {
      id: "ACCOUNT-1",
      stockId: "STOCK-1",
      reseller: "kya",
      startedAt: "2026-07-26 12:00",
      duration: "1 Bulan",
      durationDays: 30,
    },
    {
      id: "ORD-CONDITION-1",
      device: "TV",
    },
  );

  assert.ok(result);
  const writtenRanges = new Set(result.updates.map((update) => update.range));
  assert.equal(writtenRanges.has("'Netflix'!A2"), false, "account credential must remain Sheet-owned");
  assert.equal(writtenRanges.has("'Netflix'!B2"), false, "profile must remain Sheet-owned");
  assert.equal(writtenRanges.has("'Netflix'!F2"), false, "PIN must remain Sheet-owned");
  assert.equal(writtenRanges.has("'Netflix'!G2"), true);
  assert.equal(writtenRanges.has("'Netflix'!H2"), true);
  assert.equal(writtenRanges.has("'Netflix'!J2"), true);
  assert.equal(writtenRanges.has("'Netflix'!L2"), true);
  assert.equal(writtenRanges.has("'Netflix'!E2"), false, "EXPIRED formula must remain Sheet-owned");
  assert.equal(writtenRanges.has("'Netflix'!I2"), false, "NOMOR WA formula must remain Sheet-owned");
  assert.equal(writtenRanges.has("'Netflix'!K2"), false, "KONDISI AKUN must remain Owner-owned");
});

test("dynamic checkout values only write to matching Sheet headers", () => {
  const header = [
    "ACCOUNT",
    "PASSWORD",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "EMAIL CUSTOMER",
    "DEVICE",
    "SELLER",
    "NOMOR WA",
    "ORDER ID",
    "PLAN",
    "CATATAN",
  ];
  const rows = [
    header,
    ["account@example.com", "secret", "", "", "=IF(C2=\"\";\"\";C2+30)", "", "", "", "=IFERROR(VLOOKUP(H2;'data reseller'!A:B;2;FALSE);\"\")", "", "", ""],
  ];
  const result = actualSheetRowUpdates(
    "MS365",
    2,
    rows,
    { id: "STOCK-2", sheetPool: "MS365", sheetRow: 2, sheetStartColumn: 0, email: "account@example.com", password: "secret" },
    { id: "ACCOUNT-2", stockId: "STOCK-2", reseller: "Nadia Display Name", startedAt: "2026-07-26 12:00", duration: "1 Bulan", durationDays: 30 },
    {
      id: "ORD-CHECKOUT-1",
      reseller: "nadia",
      email: "customer@example.com",
      device: "Laptop Lenovo",
      customerPlan: "Family",
      checkoutData: { customerEmail: "customer@example.com", customerDevice: "Laptop Lenovo", customerPlan: "Family" },
    },
  );
  assert.ok(result);
  const valuesByRange = new Map(result.updates.map((update) => [update.range, update.values[0][0]]));
  assert.equal(valuesByRange.get("'MS365'!F2"), "customer@example.com");
  assert.equal(valuesByRange.get("'MS365'!G2"), "Laptop Lenovo");
  assert.equal(valuesByRange.get("'MS365'!H2"), "nadia", "SELLER must use the canonical reseller username");
  assert.equal(valuesByRange.get("'MS365'!K2"), "Family");
  assert.equal(valuesByRange.has("'MS365'!E2"), false);
  assert.equal(valuesByRange.has("'MS365'!I2"), false, "NOMOR WA must remain owned by its VLOOKUP formula");
});

test("warranty replacement writes the hold-adjusted start while preserving expiry formula", () => {
  const header = [
    "ACCOUNT & PASSWORD", "PROFIL", "TANGGAL", "DURASI", "EXPIRED", "PIN",
    "DEVICE CUSTOMER", "SELLER", "NOMOR WA", "ORDER ID / ID MANUAL",
    "KONDISI AKUN", "CATATAN", "STOCK ID",
  ];
  const rows = [
    header,
    ["replacement@example.test\nsecret", "Caramel", "", "", "=IF(OR(C2=\"\";D2=\"\");\"\";EDATE(C2;1))", "4421", "", "", "=IF(H2=\"\";\"\";\"628123\")", "", "NORMAL", "", "STOCK-NEW"],
  ];

  const result = actualSheetRowUpdates(
    "Netflix",
    2,
    rows,
    { id: "STOCK-NEW", sheetPool: "NETFLIX_SHARED", sheetRow: 2, sheetStartColumn: 0 },
    {
      id: "ACCOUNT-NEW",
      stockId: "STOCK-NEW",
      reseller: "nadia",
      startedAt: "2026-08-01 10:00",
      warrantyAdjustedStartedAt: "2026-08-02 16:00",
      warrantyHoldAppliedMinutes: 1800,
      duration: "1 Bulan",
      durationDays: 30,
    },
    { id: "ORD-WARRANTY", paidAt: "2026-08-01 10:00", reseller: "nadia" },
  );

  const valuesByRange = new Map(result.updates.map((update) => [update.range, update.values[0][0]]));
  assert.equal(valuesByRange.get("'Netflix'!C2"), "2026-08-02 16:00");
  assert.equal(valuesByRange.get("'Netflix'!D2"), "1 Bulan");
  assert.equal(valuesByRange.has("'Netflix'!E2"), false, "EXPIRED must remain owned by the Sheet formula");
});

test("layout resolution finds a pool header more than forty rows above the stock", () => {
  const header = [
    "ACCOUNT & PASSWORD",
    "PROFIL",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "PIN",
    "DEVICE CUSTOMER",
    "SELLER",
    "NOMOR WA",
    "ORDER ID/ID MANUAL",
    "KONDISI AKUN",
    "CATATAN",
  ];
  const rows = [header];
  while (rows.length < 69) rows.push([]);
  rows.push([
    "account@example.com\nsecret",
    "Croissant",
    "",
    "",
    "=IF(OR(C70=\"\";D70=\"\");\"\";C70+1)",
    "7788",
    "",
    "",
    "=IFERROR(VLOOKUP(H70;'data reseller'!A:B;2;FALSE);\"\")",
    "",
    "",
    "",
  ]);

  const result = actualSheetRowUpdates(
    "Netflix",
    70,
    rows,
    {
      id: "STOCK-DISTANT",
      sheetPool: "NETFLIX_SHARED",
      sheetRow: 70,
      sheetStartColumn: 0,
      email: "account@example.com",
      password: "secret",
      profile: "Croissant",
      pin: "7788",
    },
    {
      id: "ACCOUNT-DISTANT",
      stockId: "STOCK-DISTANT",
      reseller: "Display Name",
      startedAt: "2026-07-26 12:00",
      duration: "1 Hari",
      durationDays: 1,
    },
    {
      id: "ORD-DISTANT",
      reseller: "kya",
      device: "Android TV",
    },
  );

  assert.ok(result);
  const valuesByRange = new Map(result.updates.map((update) => [update.range, update.values[0][0]]));
  assert.equal(valuesByRange.has("'Netflix'!A70"), false);
  assert.equal(valuesByRange.has("'Netflix'!B70"), false);
  assert.equal(valuesByRange.has("'Netflix'!F70"), false);
  assert.equal(valuesByRange.get("'Netflix'!G70"), "Android TV");
  assert.equal(valuesByRange.get("'Netflix'!H70"), "kya");
  assert.equal(valuesByRange.get("'Netflix'!J70"), "ORD-DISTANT");
  assert.equal(valuesByRange.has("'Netflix'!E70"), false);
  assert.equal(valuesByRange.has("'Netflix'!I70"), false);
  assert.equal(valuesByRange.has("'Netflix'!K70"), false);
});

test("Netflix fulfillment uses the verified A:M layout and preserves formula-owned columns", () => {
  const rows = [
    [],
    ["POOL: NETFLIX_1U"],
    [
      "ACCOUNT & PASSWORD",
      "PROFIL",
      "TANGGAL",
      "DURASI",
      "EXPIRED",
      "PIN",
      "DEVICE CUSTOMER",
      "SELLER",
      "NOMOR WA",
      "ORDER ID / ID MANUAL",
      "KONDISI AKUN",
      "CATATAN",
      "STOCK ID",
      "",
    ],
    [
      "account@example.com\nsecret",
      "Caramel",
      "",
      "",
      "=IF(OR(C4=\"\";D4=\"\");\"\";C4+30)",
      "4421",
      "",
      "",
      "=IFERROR(VLOOKUP(H4;'data reseller'!A:B;2;FALSE);\"\")",
      "",
      "NORMAL",
      "",
      "stk-sheet-exact",
      "",
    ],
  ];

  const result = planAccountSheetRowUpdate(
    "Netflix",
    4,
    rows,
    {
      id: "stk-sheet-exact",
      sheetPool: "NETFLIX_SHARED",
      sheetRow: 4,
      sheetStartColumn: 0,
      email: "account@example.com",
      password: "secret",
      profile: "Caramel",
      pin: "4421",
    },
    {
      id: "ACCOUNT-EXACT",
      stockId: "stk-sheet-exact",
      reseller: "kya",
      startedAt: "2026-07-31 10:00",
      duration: "1 Bulan",
      durationDays: 30,
    },
    {
      id: "ORD-EXACT",
      reseller: "kya",
      device: "Android TV",
    },
  );

  assert.equal(result.ok, true);
  const valuesByRange = new Map(result.updates.map((update) => [update.range, update.values[0][0]]));
  assert.equal(valuesByRange.has("'Netflix'!A4"), false);
  assert.equal(valuesByRange.has("'Netflix'!B4"), false);
  assert.equal(valuesByRange.has("'Netflix'!F4"), false);
  assert.equal(valuesByRange.get("'Netflix'!G4"), "Android TV");
  assert.equal(valuesByRange.get("'Netflix'!H4"), "kya");
  assert.equal(valuesByRange.get("'Netflix'!J4"), "ORD-EXACT");
  assert.equal(valuesByRange.get("'Netflix'!L4"), "");
  assert.equal(valuesByRange.get("'Netflix'!M4"), "stk-sheet-exact");
  assert.equal(valuesByRange.has("'Netflix'!E4"), false);
  assert.equal(valuesByRange.has("'Netflix'!I4"), false);
  assert.equal(valuesByRange.has("'Netflix'!K4"), false);
  assert.equal(valuesByRange.has("'Netflix'!N4"), false);
});

test("Disney fulfillment preserves Number, OTP Email, profile, and PIN exactly", () => {
  const rows = [
    ["NUMBER", "OTP EMAIL", "NAMA PROFIL", "TANGGAL", "DURASI", "EXPIRED", "DEVICE", "SELLER", "NOMOR WA", "ORDER ID", "CATATAN", "STOCK ID"],
    [
      "081299703311",
      "otp@example.com",
      "grock",
      "",
      "",
      "=IF(OR(D2=\"\";E2=\"\");\"\";D2+1)",
      "",
      "",
      "=IFERROR(VLOOKUP(H2;'data reseller'!A:B;2;FALSE);\"\")",
      "",
      "",
      "stk-disney-exact",
    ],
  ];

  const result = planAccountSheetRowUpdate(
    "Disney",
    2,
    rows,
    {
      id: "stk-disney-exact",
      sheetPool: "DISNEY_6U",
      sheetPoolSchema: "disney",
      sheetRow: 2,
      sheetStartColumn: 0,
      loginPhone: "6281299703311",
      otpEmail: "otp@example.com",
      profile: "grock",
      pin: "9988",
    },
    {
      id: "ACCOUNT-DISNEY",
      stockId: "stk-disney-exact",
      reseller: "kya",
      startedAt: "2026-07-31 10:00",
      duration: "1 Hari",
      durationDays: 1,
    },
    {
      id: "ORD-DISNEY",
      reseller: "kya",
      device: "Android TV",
    },
  );

  assert.equal(result.ok, true);
  const valuesByRange = new Map(result.updates.map((update) => [update.range, update.values[0][0]]));
  assert.equal(valuesByRange.has("'Disney'!A2"), false);
  assert.equal(valuesByRange.has("'Disney'!B2"), false);
  assert.equal(valuesByRange.has("'Disney'!C2"), false);
  assert.equal(valuesByRange.has("'Disney'!F2"), false);
  assert.equal(valuesByRange.get("'Disney'!G2"), "Android TV");
  assert.equal(valuesByRange.get("'Disney'!H2"), "kya");
  assert.equal(valuesByRange.get("'Disney'!J2"), "ORD-DISNEY");
  assert.equal(valuesByRange.get("'Disney'!L2"), "stk-disney-exact");
  assert.equal(valuesByRange.has("'Disney'!I2"), false);
});

test("sheet-backed fulfillment fails closed when the actual pool layout cannot be resolved", () => {
  const result = planAccountSheetRowUpdate(
    "Netflix",
    61,
    [
      [],
      ["POOL: NETFLIX_1U"],
      ["ACCOUNT", "PROFIL", "TANGGAL"],
      [],
    ],
    {
      id: "stk-sheet-unresolved",
      sheetPool: "NETFLIX_SHARED",
      sheetRow: 61,
      sheetStartColumn: 0,
      sheetStockKey: "NETFLIX_SHARED:61:account@example.com:caramel",
      email: "account@example.com",
      profile: "Caramel",
    },
    {
      id: "ACCOUNT-UNRESOLVED",
      stockId: "stk-sheet-unresolved",
      reseller: "kya",
    },
    {
      id: "ORD-UNRESOLVED",
      reseller: "kya",
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, "sheet_layout_unresolved");
  assert.deepEqual(result.updates, []);
});
