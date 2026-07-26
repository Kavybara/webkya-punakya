import assert from "node:assert/strict";
import test from "node:test";

import { createReadMaintenanceService } from "../services/read-maintenance-service.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function harness(initial) {
  const db = clone(initial);
  let writes = 0;
  const service = createReadMaintenanceService({
    readDbSnapshot: async () => clone(db),
    updateDb: async (mutator) => {
      writes += 1;
      return mutator(db);
    },
    hasExpiredPendingOrders: (snapshot, now) => snapshot.orders.some(
      (order) => order.status === "pending" && new Date(order.expiresAt).getTime() <= now.getTime(),
    ),
    expirePendingOrders: (current, now) => {
      let changed = false;
      for (const order of current.orders) {
        if (order.status !== "pending" || new Date(order.expiresAt).getTime() > now.getTime()) continue;
        order.status = "expired";
        changed = true;
      }
      return changed;
    },
    archiveOldActivities: (current, keepDays) => {
      const cutoff = Date.now() - keepDays * 86400000;
      const archived = current.activities.filter((item) => new Date(item.createdAt).getTime() < cutoff);
      if (!archived.length) return false;
      current.activities = current.activities.filter((item) => !archived.includes(item));
      current.archivedActivities = [...archived, ...(current.archivedActivities || [])];
      return true;
    },
  });
  return { db, service, writes: () => writes };
}

test("expired orders change only when the explicit maintenance job runs", async () => {
  const now = new Date("2026-07-26T12:00:00.000Z");
  const { db, service, writes } = harness({
    orders: [{ id: "ORD-1", status: "pending", expiresAt: "2026-07-26T11:00:00.000Z" }],
    activities: [],
    archivedActivities: [],
  });
  const snapshot = clone(db);
  assert.equal(db.orders[0].status, "pending");
  assert.deepEqual(snapshot, db);

  const result = await service.runExpiredOrders(now);
  assert.equal(result.changed, true);
  assert.equal(db.orders[0].status, "expired");
  assert.equal(writes(), 1);

  const second = await service.runExpiredOrders(now);
  assert.equal(second.skipped, true);
  assert.equal(writes(), 1);
});

test("activity archive changes only when the explicit maintenance job runs", async () => {
  const { db, service, writes } = harness({
    orders: [],
    activities: [{ id: "old", createdAt: "2020-01-01T00:00:00.000Z" }],
    archivedActivities: [{ id: "existing", createdAt: "2019-01-01T00:00:00.000Z" }],
  });
  assert.equal(db.activities.length, 1);

  const result = await service.runActivityArchive({ keepDays: 5 });
  assert.equal(result.changed, true);
  assert.equal(db.activities.length, 0);
  assert.deepEqual(db.archivedActivities.map((item) => item.id), ["old", "existing"]);
  assert.equal(writes(), 1);
});
