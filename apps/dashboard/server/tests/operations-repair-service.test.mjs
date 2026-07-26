import assert from "node:assert/strict";
import test from "node:test";

import { createOperationsRepairService } from "../services/operations-repair-service.js";
import { snapshotVersion } from "../services/read-snapshot-service.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function service() {
  return createOperationsRepairService({
    makeId: () => "act-repair",
    nowText: () => "2026-07-26T12:00:00.000Z",
    snapshotVersion,
    syncGoogleSheetsStockSafely: async () => ({ ok: true }),
    reconcileGoogleSheetsStockOrderLinks: () => 0,
    refreshManagedAccountStatuses: () => false,
    repairHistoricalStockReuse: () => 0,
    repairManagedAccountOwnership: (db) => {
      const account = db.managedAccounts[0];
      if (!account || account.resellerId === "res-correct") {
        return { repaired: 0, rebuilt: 0, matched: 1, rebuildResults: [] };
      }
      account.resellerId = "res-correct";
      return {
        repaired: 1,
        rebuilt: 0,
        matched: 1,
        rebuildResults: [],
        changedAccountIds: [account.id],
        changedOrderIds: [account.orderId],
      };
    },
    syncHistoricalStockConflicts: () => 0,
    syncManagedAccountWhatsappFromOrders: () => 0,
    syncSoldStockMetadata: () => 0,
  });
}

test("repair preview reports changes without mutating its source database", () => {
  const db = {
    managedAccounts: [{ id: "acc-1", orderId: "ORD-1", resellerId: "res-wrong", status: "active" }],
    orders: [{ id: "ORD-1", resellerId: "res-correct", orderStatus: "completed", deliveryStatus: "sent" }],
    stock: [],
    activities: [],
  };
  const before = JSON.stringify(db);
  const preview = service().preview(db, { action: "reseller_repair" });

  assert.equal(preview.readOnly, true);
  assert.equal(preview.affectedObjects, 1);
  assert.equal(preview.before.accounts[0].resellerId, "res-wrong");
  assert.equal(preview.after.accounts[0].resellerId, "res-correct");
  assert.equal(JSON.stringify(db), before);
});

test("repair apply requires confirmation and a current preview token", async () => {
  const db = {
    managedAccounts: [{ id: "acc-1", orderId: "ORD-1", resellerId: "res-wrong" }],
    orders: [{ id: "ORD-1", resellerId: "res-correct" }],
    stock: [],
    activities: [],
  };
  const repair = service();
  const preview = repair.preview(db, {});

  await assert.rejects(() => repair.apply(db, { previewToken: preview.previewToken }), /Konfirmasi eksplisit/);
  await assert.rejects(
    () => repair.apply({ ...clone(db), changed: true }, { previewToken: preview.previewToken, confirmed: true }),
    /Data berubah sejak preview/,
  );
});

test("repair apply records actor audit metadata without credentials", async () => {
  const db = {
    managedAccounts: [{ id: "acc-1", orderId: "ORD-1", resellerId: "res-wrong", password: "must-not-log" }],
    orders: [{ id: "ORD-1", resellerId: "res-correct" }],
    stock: [],
    activities: [],
  };
  const repair = service();
  const preview = repair.preview(db, {});
  const result = await repair.apply(db, {
    action: "reseller_repair",
    previewToken: preview.previewToken,
    confirmed: true,
  }, { role: "owner", username: "kya" });

  assert.equal(result.ok, true);
  assert.equal(db.managedAccounts[0].resellerId, "res-correct");
  assert.equal(db.activities[0].actorName, "kya");
  assert.equal(db.activities[0].actorRole, "owner");
  assert.equal(JSON.stringify(db.activities).includes("must-not-log"), false);
});
