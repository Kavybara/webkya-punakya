import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertApplyAllowed,
  planStockIdBackfill,
  stockIdBackfillRowFingerprint,
} from "../services/stock-id-backfill-service.js";
import {
  parseStockIdBackfillArgs,
  reportCsv,
  runStockIdBackfill,
} from "../scripts/stock-id-backfill.js";

const stock = (id, overrides = {}) => ({
  id,
  productId: "netflix",
  sheetPool: "NETFLIX_SHARED",
  sheetName: "Netflix",
  sheetRow: 4,
  email: "account@example.com",
  profile: "Profil 1",
  ...overrides,
});

const row = (overrides = {}) => ({
  sheetName: "Netflix",
  pool: "NETFLIX_SHARED",
  productId: "netflix",
  rowNumber: 4,
  stockIdCell: "L4",
  stockId: "",
  account: "account@example.com",
  profile: "Profil 1",
  profileRequired: true,
  ...overrides,
});

test("exact match berdasarkan explicit row relation", () => {
  const plan = planStockIdBackfill({ db: { stock: [stock("STK-1")] }, inventory: [row()] });
  assert.equal(plan.rows[0].status, "EXACT");
  assert.equal(plan.rows[0].stockId, "STK-1");
  assert.match(plan.rows[0].reason, /explicit/);
});

test("exact match berdasarkan unique Order ID", () => {
  const db = {
    stock: [stock("STK-1", { sheetRow: 8 })],
    orders: [{ id: "ORD-1", productId: "netflix", stockGroupKey: "NETFLIX_SHARED", deliveredStockIds: ["STK-1"] }],
  };
  const plan = planStockIdBackfill({ db, inventory: [row({ rowNumber: 5, orderId: "ORD-1" })] });
  assert.equal(plan.rows[0].status, "EXACT");
  assert.match(plan.rows[0].reason, /Order ID/);
});

test("Netflix account sama dengan profile berbeda tetap menjadi stok berbeda", () => {
  const db = { stock: [
    stock("STK-1"),
    stock("STK-2", { sheetRow: 5, profile: "Profil 2" }),
  ] };
  const plan = planStockIdBackfill({
    db,
    inventory: [row({ rowNumber: 9, profile: "Profil 2" })],
  });
  assert.equal(plan.rows[0].status, "EXACT");
  assert.equal(plan.rows[0].stockId, "STK-2");
});

test("account sama di dua pool tanpa pool pasti menjadi ambiguous", () => {
  const db = { stock: [
    stock("STK-1"),
    stock("STK-2", { sheetPool: "NETFLIX_2U", sheetRow: 8 }),
  ] };
  const plan = planStockIdBackfill({ db, inventory: [row({ pool: "", rowNumber: 20 })] });
  assert.equal(plan.rows[0].status, "AMBIGUOUS");
  assert.equal(plan.rows[0].candidateCount, 2);
});

test("Stock ID duplikat pada Sheet menjadi conflict", () => {
  const inventory = [
    row({ stockId: "STK-1" }),
    row({ rowNumber: 5, stockIdCell: "L5", stockId: "STK-1" }),
  ];
  const plan = planStockIdBackfill({ db: { stock: [stock("STK-1")] }, inventory });
  assert.ok(plan.rows.every((item) => item.status === "ALREADY_FILLED_CONFLICT"));
});

test("Stock ID yang sudah valid dilewati", () => {
  const plan = planStockIdBackfill({
    db: { stock: [stock("STK-1")] },
    inventory: [row({ stockId: "STK-1" })],
  });
  assert.equal(plan.rows[0].status, "ALREADY_FILLED_VALID");
  assert.equal(plan.exact.length, 0);
});

test("Stock ID terisi tetapi tidak ditemukan di VPS dilaporkan", () => {
  const plan = planStockIdBackfill({ db: {}, inventory: [row({ stockId: "MISSING" })] });
  assert.equal(plan.rows[0].status, "ALREADY_FILLED_NOT_FOUND");
});

test("baris kosong dengan kondisi NORMAL tetap EMPTY_ROW", () => {
  const plan = planStockIdBackfill({
    db: { stock: [stock("STK-1")] },
    inventory: [row({ account: "", profile: "", accountCondition: "NORMAL" })],
  });
  assert.equal(plan.rows[0].status, "EMPTY_ROW");
});

test("link pool dicocokkan exact berdasarkan link dan pool ID", () => {
  const db = { linkPools: [{
    id: "LINK-1",
    poolKey: "CANVA",
    sheetName: "Canva",
    sheetRow: 4,
    link: "https://example.test/invite/one",
  }] };
  const plan = planStockIdBackfill({
    db,
    inventory: [{
      sheetName: "Canva",
      pool: "CANVA",
      productKey: "CANVA",
      rowNumber: 4,
      stockIdCell: "G4",
      link: "https://example.test/invite/one",
    }],
  });
  assert.equal(plan.rows[0].status, "EXACT");
  assert.equal(plan.rows[0].stockId, "LINK-1");
});

test("usage tanpa explicit relation tidak ditebak", () => {
  const plan = planStockIdBackfill({
    db: { managedAccounts: [{ stockId: "LINK-1", sheetPool: "CANVA", email: "buyer@example.com" }] },
    inventory: [{
      sheetName: "Canva",
      pool: "CANVA",
      rowNumber: 20,
      stockIdCell: "H20",
      account: "other@example.com",
      usageRow: true,
    }],
  });
  assert.equal(plan.rows[0].status, "SKIPPED");
});

test("password tidak tampil penuh dalam report", () => {
  const plan = planStockIdBackfill({
    db: { stock: [stock("STK-1", { password: "super-secret-password" })] },
    inventory: [row({ password: "super-secret-password" })],
  });
  assert.doesNotMatch(JSON.stringify(plan), /super-secret-password/);
  assert.doesNotMatch(reportCsv(plan), /super-secret-password/);
  assert.match(plan.rows[0].account, /\*\*\*/);
});

test("malformed credential-like stock IDs are never candidates or exposed", () => {
  const unsafeId = "account@example.com\nsuper-secret-password";
  const plan = planStockIdBackfill({
    db: { stock: [stock(unsafeId)] },
    inventory: [row({ stockId: unsafeId })],
  });
  assert.equal(plan.rows[0].status, "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW");
  assert.equal(plan.rows[0].stockId, "[unsafe-stock-id]");
  assert.equal(plan.rows[0].manualReview, true);
  assert.doesNotMatch(JSON.stringify(plan), /super-secret-password/);
});

test("row linked to malformed VPS Stock ID requires manual review", () => {
  const unsafeId = "account@example.com\nsuper-secret-password";
  const plan = planStockIdBackfill({
    db: { stock: [stock(unsafeId)] },
    inventory: [row()],
  });
  assert.equal(plan.rows[0].status, "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW");
  assert.equal(plan.rows[0].manualReview, true);
  assert.equal(plan.rows[0].candidateCount, 1);
  assert.doesNotMatch(JSON.stringify(plan), /super-secret-password/);
});

test("malformed VPS Stock ID tetap dilaporkan saat header Sheet belum tersedia", () => {
  const unsafeId = "account@example.com\nsuper-secret-password";
  const plan = planStockIdBackfill({
    db: { stock: [stock(unsafeId, { sheetRow: 23 })] },
    inventory: [],
  });
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].status, "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW");
  assert.equal(plan.rows[0].row, 23);
  assert.equal(plan.rows[0].stockIdCell, "");
  assert.doesNotMatch(JSON.stringify(plan), /super-secret-password/);
});

test("satu Stock ID tidak dapat menjadi EXACT untuk dua row", () => {
  const plan = planStockIdBackfill({
    db: { stock: [stock("STK-1", { sheetRow: 0 })] },
    inventory: [
      row({ rowNumber: 10 }),
      row({ rowNumber: 11, stockIdCell: "L11" }),
    ],
  });
  assert.equal(plan.rows[0].status, "EXACT");
  assert.equal(plan.rows[1].status, "CONFLICT");
  assert.match(plan.rows[1].reason, /sudah digunakan/);
});

test("dry-run dua kali menghasilkan row dan digest identik", () => {
  const input = { db: { stock: [stock("STK-1")] }, inventory: [row()] };
  const first = planStockIdBackfill(input);
  const second = planStockIdBackfill(input);
  assert.deepEqual(first.rows, second.rows);
  assert.equal(first.digest, second.digest);
});

test("fingerprint berubah ketika seller atau kondisi row berubah", () => {
  const original = row({ seller: "reseller-a", accountCondition: "NORMAL" });
  assert.notEqual(
    stockIdBackfillRowFingerprint(original),
    stockIdBackfillRowFingerprint({ ...original, seller: "reseller-b" }),
  );
  assert.notEqual(
    stockIdBackfillRowFingerprint(original),
    stockIdBackfillRowFingerprint({ ...original, accountCondition: "REPLACED" }),
  );
});

test("dry-run tidak memanggil writer", async () => {
  let applyCalls = 0;
  const sheetMutations = [];
  const result = await runStockIdBackfill({
    apply: false,
    writeReports: false,
    databasePath: "",
  }, {
    readDb: async () => ({ stock: [stock("STK-1")] }),
    readInventory: async () => ({ ok: true, inventory: [row()] }),
    applyPlan: async () => { applyCalls += 1; },
    setMutationObserver: (observer) => {
      if (observer) sheetMutations.push(observer);
    },
  });
  assert.equal(applyCalls, 0);
  assert.equal(result.proof.databaseWriterCalls, 0);
  assert.equal(result.proof.googleSheetsWriterCalls, 0);
});

test("apply membuat rollback manifest sebelum writer berjalan", async () => {
  const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), "stock-id-apply-test-"));
  let manifestExistedBeforeWrite = false;
  try {
    const result = await runStockIdBackfill({
      apply: true,
      confirmProduction: true,
      confirmation: "BACKFILL_STOCK_ID",
      writeReports: false,
      reportDir,
      databasePath: "",
    }, {
      readDb: async () => ({ stock: [stock("STK-1")] }),
      readInventory: async () => ({ ok: true, inventory: [row()] }),
      applyPlan: async (_db, plan, confirmation) => {
        await confirmation.onPrepared({
          candidates: plan.exact,
          skipped: [],
          batchSize: confirmation.batchSize,
        });
        manifestExistedBeforeWrite = await fs.stat(
          path.join(reportDir, "stock-id-backfill-rollback-manifest.json"),
        ).then(() => true, () => false);
        return { ok: true, updated: 1, skipped: [], batches: [{ verified: true }] };
      },
    });
    assert.equal(manifestExistedBeforeWrite, true);
    assert.equal(result.applyResult.updated, 1);
    assert.equal(result.rollbackManifestPath, path.join(reportDir, "stock-id-backfill-rollback-manifest.json"));
    assert.equal(result.rollbackSnapshotPath, path.join(reportDir, "stock-id-target-snapshot-before.json"));
    const manifest = JSON.parse(await fs.readFile(result.rollbackManifestPath, "utf8"));
    assert.equal(manifest.candidates[0].before, "");
    assert.equal(manifest.candidates[0].after, "STK-1");
    assert.equal(manifest.candidates[0].cell, "L4");
    assert.doesNotMatch(JSON.stringify(manifest), /account@example\.com/);
    const snapshot = JSON.parse(await fs.readFile(result.rollbackSnapshotPath, "utf8"));
    assert.deepEqual(snapshot.cells[0], {
      spreadsheetTab: "Netflix",
      pool: "NETFLIX_SHARED",
      row: 4,
      cell: "L4",
      value: "",
    });
  } finally {
    await fs.rm(reportDir, { recursive: true, force: true });
  }
});

test("tanpa flag default ke dry-run", () => {
  const options = parseStockIdBackfillArgs([]);
  assert.equal(options.apply, false);
  assert.equal(options.dryRun, true);
  assert.equal(assertApplyAllowed(options), "dry-run");
});

test("apply tidak dapat berjalan tanpa konfirmasi produksi lengkap", () => {
  assert.throws(() => assertApplyAllowed({ apply: true }), /confirm-production/);
  assert.throws(
    () => assertApplyAllowed({ apply: true, confirmProduction: true }),
    /confirmation/,
  );
  assert.equal(assertApplyAllowed({
    apply: true,
    confirmProduction: true,
    confirmation: "BACKFILL_STOCK_ID",
  }), "apply");
});
