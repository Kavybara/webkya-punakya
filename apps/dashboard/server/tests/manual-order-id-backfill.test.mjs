import assert from "node:assert/strict";
import test from "node:test";

import {
  backfillManualSheetOrderIds,
  deterministicManualSheetOrderId,
} from "../google-sheets.js";

const headers = [
  "ACCOUNT & PASSWORD", "PROFIL", "TANGGAL", "DURASI", "EXPIRED", "PIN",
  "DEVICE CUSTOMER", "SELLER", "NOMOR WA", "ORDER ID / ID MANUAL",
  "KONDISI AKUN", "CATATAN", "STOCK ID",
];

function fixture(stockId = "STK-MANUAL-1") {
  const stock = {
    id: stockId,
    productId: "prod-netflix",
    variantId: "variant-1u",
    status: "sold",
    sheetSource: "google_sheets",
    sheetName: "Netflix",
    sheetPool: "NETFLIX_1U",
    sheetPoolSchema: "profile",
    sheetStartColumn: 0,
    sheetRow: 4,
    sheetSellerInput: "nadia",
    resellerId: "reseller-a",
    reseller: "nadia",
    soldAt: "2026-08-05 10:00",
    soldDuration: "1 Bulan",
    soldDurationDays: 30,
    soldExpiresAt: "2026-09-05 10:00",
  };
  return {
    settings: {
      googleSheetsSpreadsheetId: "sheet-test",
      googleSheetsSheetName: "Netflix",
      googleSheetsServiceAccountEmail: "test@example.test",
      googleSheetsPrivateKey: "test-key",
    },
    products: [{ id: "prod-netflix", name: "Netflix", variants: [{ id: "variant-1u", name: "1P1U", code: "NET-1U" }] }],
    resellers: [{ id: "reseller-a", username: "nadia", whatsapp: "628111111111" }],
    orders: [],
    manualOrders: [],
    stock: [stock],
    managedAccounts: [{
      id: "account-manual-1",
      stockId,
      resellerId: "reseller-a",
      reseller: "nadia",
      product: "Netflix",
      variant: "1P1U",
      duration: "1 Bulan",
      durationDays: 30,
      startedAt: "2026-08-05 10:00",
      expiresAt: "2026-09-05 10:00",
    }],
  };
}

function sheetRows(stockId = "STK-MANUAL-1") {
  return [
    [],
    ["POOL: NETFLIX_1U"],
    headers,
    ["user@example.test\nsecret", "Profile 1", "05 Aug", "1b", "05 Sep", "1234", "TV", "nadia", "", "", "NORMAL", "", stockId],
  ];
}

test("manual order ID dry-run is deterministic and performs no write", async () => {
  const db = fixture();
  let writes = 0;
  const options = {
    dryRun: true,
    readSheetValues: async () => sheetRows(),
    writeValues: async () => { writes += 1; },
  };
  const first = await backfillManualSheetOrderIds(db, options);
  const second = await backfillManualSheetOrderIds(db, options);
  assert.equal(first.candidates, 1);
  assert.equal(first.rows.find((row) => row.status === "EXACT")?.orderIdCell, "'Netflix'!J4");
  assert.equal(first.rows.find((row) => row.status === "EXACT")?.manualOrderId, deterministicManualSheetOrderId(db.stock[0]));
  assert.deepEqual(first, second);
  assert.equal(writes, 0);
  assert.equal(db.stock[0].sheetOrderId, undefined);
});

test("manual order ID apply writes only Order ID and creates an internal manual order relation", async () => {
  const db = fixture();
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(),
    writeValues: async (data) => writes.push(...data),
  });
  const manualOrderId = deterministicManualSheetOrderId(db.stock[0]);
  assert.equal(result.updated, 1);
  assert.deepEqual(writes, [{ range: "'Netflix'!J4", values: [[manualOrderId]] }]);
  assert.equal(db.stock[0].sheetOrderId, manualOrderId);
  assert.equal(db.managedAccounts[0].orderId, manualOrderId);
  assert.equal(db.manualOrders[0].id, manualOrderId);
  assert.equal(db.manualOrders[0].excludedFromSalesMetrics, true);
  assert.deepEqual(db.manualOrders[0].deliveredStockIds, ["STK-MANUAL-1"]);
});

test("manual order backfill writes Stock ID when the sold manual Sheet row has an empty Stock ID cell", async () => {
  const db = fixture();
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(""),
    writeValues: async (data) => writes.push(...data),
  });
  const manualOrderId = deterministicManualSheetOrderId(db.stock[0]);
  assert.equal(result.updated, 1);
  assert.deepEqual(writes, [
    { range: "'Netflix'!J4", values: [[manualOrderId]] },
    { range: "'Netflix'!M4", values: [["STK-MANUAL-1"]] },
  ]);
  assert.equal(db.stock[0].sheetOrderId, manualOrderId);
  assert.equal(db.managedAccounts[0].orderId, manualOrderId);
  assert.deepEqual(db.manualOrders[0].deliveredStockIds, ["STK-MANUAL-1"]);
});

test("manual order backfill restores Stock ID for an already-filled manual Order ID row", async () => {
  const db = fixture();
  const manualOrderId = deterministicManualSheetOrderId(db.stock[0]);
  db.stock[0].sheetOrderId = manualOrderId;
  db.managedAccounts[0].orderId = manualOrderId;
  db.managedAccounts[0].sourceOrderId = manualOrderId;
  db.manualOrders.push({
    id: manualOrderId,
    source: "google_sheets_manual",
    deliveredStockIds: ["STK-MANUAL-1"],
    excludedFromSalesMetrics: true,
  });
  const rows = sheetRows("");
  rows[3][9] = manualOrderId;
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => rows,
    writeValues: async (data) => writes.push(...data),
  });
  assert.equal(result.updated, 1);
  assert.deepEqual(writes, [{ range: "'Netflix'!M4", values: [["STK-MANUAL-1"]] }]);
  assert.equal(result.rows[0].reason, "stock_id_missing_from_sheet");
});

test("manual order ID backfill fails safe when live Stock ID does not match", async () => {
  const db = fixture();
  let writes = 0;
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows("STK-DIFFERENT"),
    writeValues: async () => { writes += 1; },
  });
  assert.equal(result.updated, 0);
  assert.equal(result.counts.CONFLICT, 1);
  assert.equal(result.rows[0].reason, "stock_id_mismatch");
  assert.equal(writes, 0);
});

test("existing database order ID is restored to an exact matching Sheet row", async () => {
  const db = fixture();
  const originalOrderId = "ORD-EXISTING-123";
  db.orders.push({
    id: originalOrderId,
    resellerId: "reseller-a",
    deliveredStockIds: [db.stock[0].id],
  });
  db.stock[0].sheetOrderId = originalOrderId;
  db.managedAccounts[0].orderId = originalOrderId;
  db.managedAccounts[0].sourceOrderId = originalOrderId;
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(),
    writeValues: async (data) => writes.push(...data),
  });
  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].candidateType, "existing_order");
  assert.equal(result.rows[0].targetOrderId, originalOrderId);
  assert.deepEqual(writes, [{ range: "'Netflix'!J4", values: [[originalOrderId]] }]);
  assert.equal(db.manualOrders.length, 0);
});

test("existing order ID is not restored when live Stock ID differs", async () => {
  const db = fixture();
  const originalOrderId = "ORD-EXISTING-123";
  db.orders.push({ id: originalOrderId, deliveredStockIds: [db.stock[0].id] });
  db.stock[0].sheetOrderId = originalOrderId;
  db.managedAccounts[0].orderId = originalOrderId;
  let writes = 0;
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows("STK-DIFFERENT"),
    writeValues: async () => { writes += 1; },
  });
  assert.equal(result.updated, 0);
  assert.equal(result.rows[0].reason, "stock_id_mismatch");
  assert.equal(writes, 0);
});

test("Netflix 1U manual row can use its unique Sheet row when legacy Stock ID is empty", async () => {
  const db = fixture();
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(""),
    writeValues: async (data) => writes.push(...data),
  });
  const manualOrderId = deterministicManualSheetOrderId(db.stock[0]);
  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].candidateType, "manual_order");
  assert.deepEqual(writes, [
    { range: "'Netflix'!J4", values: [[manualOrderId]] },
    { range: "'Netflix'!M4", values: [["STK-MANUAL-1"]] },
  ]);
});

test("legacy row without rental date is not treated as a manual sale", async () => {
  const db = fixture();
  const rows = sheetRows("");
  rows[3][2] = "";
  let writes = 0;
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => rows,
    writeValues: async () => { writes += 1; },
  });
  assert.equal(result.updated, 0);
  assert.equal(result.rows[0].status, "SKIPPED");
  assert.equal(result.rows[0].reason, "rental_date_or_duration_empty");
  assert.equal(writes, 0);
});

test("Netflix 2U manual row can use its unique Sheet row when legacy Stock ID is empty", async () => {
  const db = fixture();
  db.stock[0].sheetPool = "NETFLIX_2U";
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(""),
    writeValues: async (data) => writes.push(...data),
  });
  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].candidateType, "manual_order");
  assert.equal(writes.length, 2);
});

test("missing Stock ID fallback rejects a non-unique Netflix row relation", async () => {
  const db = fixture();
  db.stock.push({ ...db.stock[0], id: "STK-DUPLICATE-ROW" });
  let writes = 0;
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(""),
    writeValues: async () => { writes += 1; },
  });
  assert.equal(result.updated, 0);
  assert.equal(result.rows[0].reason, "stock_id_missing_without_unique_netflix_row_relation");
  assert.equal(writes, 0);
});

test("legacy original Order ID is preserved when only its exact account relation remains", async () => {
  const db = fixture();
  const legacyOrderId = "ORD-LEGACY-123";
  db.stock[0].sheetPool = "NETFLIX_2U";
  db.stock[0].sheetOrderId = legacyOrderId;
  db.managedAccounts[0].orderId = legacyOrderId;
  db.managedAccounts[0].sourceOrderId = legacyOrderId;
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(""),
    writeValues: async (data) => writes.push(...data),
  });
  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].candidateType, "legacy_order_reference");
  assert.deepEqual(writes, [
    { range: "'Netflix'!J4", values: [[legacyOrderId]] },
    { range: "'Netflix'!M4", values: [["STK-MANUAL-1"]] },
  ]);
  assert.equal(db.manualOrders[0].id, legacyOrderId);
  assert.equal(db.manualOrders[0].sheetLegacyOrderRelation, true);
  assert.equal(db.manualOrders[0].excludedFromSalesMetrics, true);
});

test("legacy original Order ID is preserved from its unique stock row relation", async () => {
  const db = fixture();
  const legacyOrderId = "ORD-LEGACY-STOCK-123";
  db.stock[0].sheetPool = "NETFLIX_2U";
  db.stock[0].sheetOrderId = legacyOrderId;
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(""),
    writeValues: async (data) => writes.push(...data),
  });
  assert.equal(result.updated, 1);
  assert.equal(result.rows[0].candidateType, "legacy_order_reference");
  assert.deepEqual(writes, [
    { range: "'Netflix'!J4", values: [[legacyOrderId]] },
    { range: "'Netflix'!M4", values: [["STK-MANUAL-1"]] },
  ]);
  assert.equal(db.manualOrders[0].id, legacyOrderId);
});

test("legacy alphanumeric manual Order ID is accepted when restoring a missing Stock ID", async () => {
  const db = fixture();
  const legacyManualOrderId = "MNL-KSIWNSJ-ISNSI";
  db.stock[0].sheetOrderId = legacyManualOrderId;
  db.managedAccounts[0].orderId = legacyManualOrderId;
  db.managedAccounts[0].sourceOrderId = legacyManualOrderId;
  db.manualOrders.push({
    id: legacyManualOrderId,
    source: "google_sheets_manual",
    deliveredStockIds: ["STK-MANUAL-1"],
    excludedFromSalesMetrics: true,
  });
  const rows = sheetRows("");
  rows[3][9] = legacyManualOrderId;
  const writes = [];
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => rows,
    writeValues: async (data) => writes.push(...data),
  });
  assert.equal(result.updated, 1);
  assert.deepEqual(writes, [{ range: "'Netflix'!M4", values: [["STK-MANUAL-1"]] }]);
  assert.equal(result.rows[0].reason, "stock_id_missing_from_sheet");
});

test("manual order backfill never writes malformed credential-like Stock IDs", async () => {
  const db = fixture("user@example.test\nsecret");
  db.stock[0].sheetOrderId = "MNL-KSIWNSJ-ISNSI";
  db.managedAccounts[0].orderId = "MNL-KSIWNSJ-ISNSI";
  db.managedAccounts[0].sourceOrderId = "MNL-KSIWNSJ-ISNSI";
  const rows = sheetRows("");
  rows[3][9] = "MNL-KSIWNSJ-ISNSI";
  let writes = 0;
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => rows,
    writeValues: async () => { writes += 1; },
  });

  assert.equal(result.updated, 0);
  assert.equal(result.rows[0].status, "CONFLICT");
  assert.equal(result.rows[0].reason, "unsafe_database_stock_id");
  assert.equal(writes, 0);
});

test("numeric legacy metadata is rejected as an invalid Order ID", async () => {
  const db = fixture();
  db.stock[0].sheetPool = "NETFLIX_2U";
  db.stock[0].sheetOrderId = "1234";
  let writes = 0;
  const result = await backfillManualSheetOrderIds(db, {
    dryRun: false,
    readSheetValues: async () => sheetRows(""),
    writeValues: async () => { writes += 1; },
  });
  assert.equal(result.updated, 0);
  assert.equal(result.rows[0].reason, "invalid_database_order_id");
  assert.equal(writes, 0);
});
