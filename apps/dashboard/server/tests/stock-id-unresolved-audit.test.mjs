import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runUnresolvedStockIdAudit } from "../scripts/audit-stock-id-unresolved.js";

test("unresolved audit classifies new stock without mutating the database or Sheets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-unresolved-audit-"));
  const databasePath = path.join(directory, "db.json");
  const reportDir = path.join(directory, "report");
  const oldReportPath = path.join(directory, "old.json");
  const currentReportPath = path.join(directory, "current.json");
  const database = {
    stock: [],
    managedAccounts: [],
    orders: [],
    products: [],
    linkPools: [],
  };
  const inventory = [{
    sheetName: "Prime",
    pool: "PRIME_3U",
    product: "Prime",
    productKey: "prime",
    rowNumber: 4,
    stockIdCell: "'Prime'!K4",
    stockId: "",
    account: "masked-source@example.test",
    profile: "",
    seller: "",
    accountCondition: "",
  }];
  await Promise.all([
    fs.writeFile(databasePath, JSON.stringify(database)),
    fs.writeFile(oldReportPath, JSON.stringify({ rows: [] })),
    fs.writeFile(currentReportPath, JSON.stringify({
      rows: [{
        status: "UNMATCHED",
        tab: "Prime",
        pool: "PRIME_3U",
        row: 4,
        stockIdCell: "'Prime'!K4",
        reason: "tidak ada record VPS",
      }],
    })),
  ]);
  const mutationObservers = [];
  try {
    const result = await runUnresolvedStockIdAudit({
      databasePath,
      reportDir,
      oldReportPath,
      currentReportPath,
    }, {
      readInventory: async () => ({ ok: true, inventory }),
      setMutationObserver: (observer) => mutationObservers.push(observer),
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].classification, "NEW_UNTRACKED_STOCK");
    assert.equal(result.rows[0].canEnterCatalogNow, false);
    assert.equal(result.rows[0].canBecomeAvailableOnNextSync, true);
    assert.equal(result.proof.databaseHashIdentical, true);
    assert.equal(result.proof.databaseWriterCalls, 0);
    assert.equal(result.proof.googleSheetsWriterCalls, 0);
    assert.equal(result.proof.maintenanceCalls, 0);
    assert.equal(mutationObservers.at(-1), null);
    assert.deepEqual(JSON.parse(await fs.readFile(databasePath, "utf8")), database);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
