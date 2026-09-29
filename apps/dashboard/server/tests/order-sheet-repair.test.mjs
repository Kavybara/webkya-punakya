import assert from "node:assert/strict";
import test from "node:test";

import { readSheetValuesForLayout } from "../google-sheets.js";
import { finalizeSuccessfulSheetRepair } from "../routes/order-routes.js";

test("layout read retries one transient empty response before fulfillment planning", async () => {
  let calls = 0;
  const expected = [["ACCOUNT", "PROFIL"], ["account@example.com", "Profil 1"]];
  const rows = await readSheetValuesForLayout({}, "Netflix", {
    attempts: 2,
    delayMs: 0,
    read: async () => {
      calls += 1;
      return calls === 1 ? [] : expected;
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(rows, expected);
});

test("layout read retries one transient error without retrying any write", async () => {
  let calls = 0;
  const rows = await readSheetValuesForLayout({}, "Netflix", {
    attempts: 2,
    delayMs: 0,
    read: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary read failure");
      return [["ACCOUNT", "PROFIL"]];
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(rows, [["ACCOUNT", "PROFIL"]]);
});

test("layout read does not amplify a Google Sheets quota error", async () => {
  let calls = 0;
  await assert.rejects(
    readSheetValuesForLayout({}, "Netflix", {
      attempts: 2,
      delayMs: 0,
      read: async () => {
        calls += 1;
        throw new Error("Quota exceeded for Read requests per minute");
      },
    }),
    /Quota exceeded/,
  );
  assert.equal(calls, 1);
});

test("successful Sheets repair restores terminal order status without re-fulfillment", () => {
  const repair = {
    order: {
      orderStatus: "processing",
      deliveryStatus: "sheet_sync_failed",
      googleSheetsSyncStatus: "synced",
      fulfillmentBlockedReason: "sheet_layout_unresolved",
    },
  };

  const failed = finalizeSuccessfulSheetRepair(
    repair,
    { ok: true, sheetCommitRequired: true },
    "2026-07-31 12:30",
  );

  assert.equal(failed, false);
  assert.equal(repair.order.orderStatus, "completed");
  assert.equal(repair.order.deliveryStatus, "sent");
  assert.equal(repair.order.fulfilledAt, "2026-07-31 12:30");
  assert.equal(repair.order.fulfillmentBlockedReason, "");
});

test("failed Sheets repair keeps order blocked", () => {
  const repair = {
    order: {
      orderStatus: "processing",
      deliveryStatus: "sheet_sync_failed",
      googleSheetsSyncStatus: "failed",
      fulfillmentBlockedReason: "sheet_layout_unresolved",
    },
  };

  const failed = finalizeSuccessfulSheetRepair(
    repair,
    { ok: false, sheetCommitRequired: true },
    "2026-07-31 12:30",
  );

  assert.equal(failed, true);
  assert.equal(repair.order.orderStatus, "processing");
  assert.equal(repair.order.deliveryStatus, "sheet_sync_failed");
  assert.equal(repair.order.fulfillmentBlockedReason, "sheet_layout_unresolved");
});
