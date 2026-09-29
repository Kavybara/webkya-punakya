import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resetRentalGateCache, shouldBlockExpiredGroup } from "../lib/rental-gate.js";

function withFrozenNow(timestamp, callback) {
  const originalNow = Date.now;
  Date.now = () => timestamp;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      Date.now = originalNow;
    });
}

test("dashboard whatsappRentals is authoritative over stale bot rental store", async () => {
  resetRentalGateCache();
  const root = await mkdir(path.join(os.tmpdir(), `kavya-rental-authority-${Date.now()}`), { recursive: true });
  const dashboardDbPath = path.join(root, "kavya-db.json");
  await writeFile(dashboardDbPath, JSON.stringify({
    whatsappRentals: [{
      id: "120363111111111111@g.us",
      groupJid: "120363111111111111@g.us",
      status: "active",
      daysLeft: 30,
    }],
  }));

  const result = await shouldBlockExpiredGroup({
    remoteJid: "120363222222222222@g.us",
    commandInfo: { command: "list" },
    isOwner: false,
    config: { dashboardDatabasePath: dashboardDbPath, paths: { projectRoot: root } },
    store: {
      read: async () => ({
        "120363222222222222@g.us": { status: "active", daysLeft: 30 },
      }),
    },
  });

  assert.equal(result.block, true);
  assert.equal(result.reason, "group_rental_missing");
});

test("localized Indonesian rental end date overrides stale daysLeft", async () => {
  await withFrozenNow(new Date("2026-08-25T00:00:00+07:00").getTime(), async () => {
    resetRentalGateCache();
    const root = await mkdtemp(path.join(os.tmpdir(), "kavya-rental-local-date-"));
    const dashboardDbPath = path.join(root, "kavya-db.json");
    await writeFile(dashboardDbPath, JSON.stringify({
      whatsappRentals: [{
        id: "120363402415540657@g.us",
        groupJid: "120363402415540657@g.us",
        name: "Reseller Iky",
        status: "active",
        endsAt: "13 Agu 2026",
        daysLeft: 78,
      }],
    }));

    const result = await shouldBlockExpiredGroup({
      remoteJid: "120363402415540657@g.us",
      commandInfo: { command: "list" },
      isOwner: false,
      config: { dashboardDatabasePath: dashboardDbPath, paths: { projectRoot: root } },
      store: { read: async () => ({}) },
    });

    assert.equal(result.block, true);
    assert.equal(result.reason, "group_rental_expired");
  });
});
