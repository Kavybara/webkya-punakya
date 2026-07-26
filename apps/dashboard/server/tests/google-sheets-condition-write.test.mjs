import assert from "node:assert/strict";
import test from "node:test";

import { actualSheetRowUpdates } from "../google-sheets.js";

test("fulfillment maps the new Netflix headers and never writes formula, WhatsApp, or account condition", () => {
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
  assert.equal(writtenRanges.has("'Netflix'!A2"), true);
  assert.equal(writtenRanges.has("'Netflix'!F2"), true);
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
  assert.equal(valuesByRange.get("'Netflix'!F70"), "7788");
  assert.equal(valuesByRange.get("'Netflix'!G70"), "Android TV");
  assert.equal(valuesByRange.get("'Netflix'!H70"), "kya");
  assert.equal(valuesByRange.get("'Netflix'!J70"), "ORD-DISTANT");
  assert.equal(valuesByRange.has("'Netflix'!E70"), false);
  assert.equal(valuesByRange.has("'Netflix'!I70"), false);
  assert.equal(valuesByRange.has("'Netflix'!K70"), false);
});
