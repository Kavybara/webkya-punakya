import assert from "node:assert/strict";
import test from "node:test";

import {
  recordOperationalCheck,
  sanitizeOperationalAlertDetail,
} from "../services/operational-alert-service.js";

test("operational alert waits for three consecutive failures", () => {
  const settings = {};

  const first = recordOperationalCheck(settings, {
    key: "google_sheets",
    label: "Google Sheets",
    ok: false,
    detail: "netflix",
    now: "2026-08-03T00:00:00.000Z",
  });
  const second = recordOperationalCheck(settings, {
    key: "google_sheets",
    label: "Google Sheets",
    ok: false,
    detail: "netflix",
    now: "2026-08-03T00:03:00.000Z",
  });
  const third = recordOperationalCheck(settings, {
    key: "google_sheets",
    label: "Google Sheets",
    ok: false,
    detail: "netflix",
    now: "2026-08-03T00:06:00.000Z",
  });

  assert.equal(first.event, "none");
  assert.equal(second.event, "none");
  assert.equal(third.event, "alert");
  assert.equal(third.shouldNotify, true);
  assert.equal(settings.operationalAlertState.google_sheets.consecutiveFailures, 3);
  assert.equal(settings.operationalAlertState.google_sheets.active, true);
});

test("active operational alert respects cooldown and sends one recovery", () => {
  const settings = {};
  for (let index = 0; index < 3; index += 1) {
    recordOperationalCheck(settings, {
      key: "fulfillment",
      label: "Fulfillment",
      ok: false,
      now: new Date(Date.UTC(2026, 7, 3, 0, index)).toISOString(),
      cooldownMs: 12 * 60 * 60 * 1000,
    });
  }

  const muted = recordOperationalCheck(settings, {
    key: "fulfillment",
    label: "Fulfillment",
    ok: false,
    now: "2026-08-03T01:00:00.000Z",
    cooldownMs: 12 * 60 * 60 * 1000,
  });
  const reminder = recordOperationalCheck(settings, {
    key: "fulfillment",
    label: "Fulfillment",
    ok: false,
    now: "2026-08-03T13:00:00.000Z",
    cooldownMs: 12 * 60 * 60 * 1000,
  });
  const recovery = recordOperationalCheck(settings, {
    key: "fulfillment",
    label: "Fulfillment",
    ok: true,
    now: "2026-08-03T13:05:00.000Z",
  });
  const healthyAgain = recordOperationalCheck(settings, {
    key: "fulfillment",
    label: "Fulfillment",
    ok: true,
    now: "2026-08-03T13:10:00.000Z",
  });

  assert.equal(muted.event, "none");
  assert.equal(reminder.event, "reminder");
  assert.equal(recovery.event, "recovery");
  assert.equal(recovery.shouldNotify, true);
  assert.equal(healthyAgain.event, "none");
  assert.equal(settings.operationalAlertState.fulfillment.active, false);
  assert.equal(settings.operationalAlertState.fulfillment.consecutiveFailures, 0);
});

test("operational alert detail is short and redacts common secrets", () => {
  const detail = sanitizeOperationalAlertDetail(
    "timeout\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz password=hunter2 https://secret.example/path",
  );

  assert.doesNotMatch(detail, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(detail, /hunter2/);
  assert.doesNotMatch(detail, /secret\.example/);
  assert.ok(detail.length <= 180);
  assert.doesNotMatch(detail, /\n/);
});
