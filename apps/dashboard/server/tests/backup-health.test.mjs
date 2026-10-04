import assert from "node:assert/strict";
import test from "node:test";

import { assessBackupHealth, backupIntervalMs } from "../services/backup-health.js";

/**
 * The Health Center already shows *which* backup files exist on disk. This is
 * the other question: did the scheduled backup actually run, and did it reach
 * the owner.
 *
 * Those are different things and only the first is visible from the filesystem.
 * `runScheduledBackup` returns before building an archive when WhatsApp is not
 * connected or while heavy work is paused, so a machine with thirty healthy
 * backup files on disk can still have sent nothing for a week. Worse, the
 * process that would tell us is the process that stopped.
 *
 * The bot therefore writes each outcome into `kavya-db.json` (see
 * `apps/bot/lib/backup-state-writer.js`), and this reads it.
 */

const HOUR_MS = 60 * 60 * 1000;

test("a recent successful run is healthy", () => {
  const state = { status: "sent", ranAt: "2026-10-04 09:00", sentAt: "2026-10-04 09:00", fileName: "File Backup.tar.gz", error: "", reason: "" };
  const health = assessBackupHealth({ backupState: state, intervalMs: 24 * HOUR_MS, now: new Date("2026-10-04T12:00:00Z") });

  assert.equal(health.ok, true);
  assert.equal(health.status, "sent");
  assert.equal(health.message, "");
});

test("a run that never happened is reported as never_run, not healthy", () => {
  // The dangerous default. A database written before this feature existed has
  // no state at all, and treating that as "fine" is how weeks of silence pass.
  const health = assessBackupHealth({ backupState: null, intervalMs: 24 * HOUR_MS, now: new Date("2026-10-04T12:00:00Z") });

  assert.equal(health.ok, false);
  assert.equal(health.status, "never_run");
  assert.match(health.message, /belum pernah/i);
});

test("a skipped run is not counted as a healthy backup", () => {
  const state = { status: "skipped", ranAt: "2026-10-04 09:00", sentAt: "", fileName: "", error: "whatsapp_not_connected", reason: "whatsapp_not_connected" };
  const health = assessBackupHealth({ backupState: state, intervalMs: 24 * HOUR_MS, now: new Date("2026-10-04T12:00:00Z") });

  assert.equal(health.ok, false);
  assert.equal(health.status, "skipped");
  assert.match(health.message, /dilewati/i);
});

test("a run older than the interval is stale even when it succeeded", () => {
  const state = { status: "sent", ranAt: "2026-09-25 09:00", sentAt: "2026-09-25 09:00", fileName: "File Backup.tar.gz", error: "", reason: "" };
  const health = assessBackupHealth({ backupState: state, intervalMs: 24 * HOUR_MS, now: new Date("2026-10-04T12:00:00Z") });

  assert.equal(health.ok, false);
  assert.equal(health.stale, true);
  assert.match(health.message, /terlalu lama/i);
});

test("a bot that died silently is caught by staleness", () => {
  // Last state says "sent" and looks perfect. If the process had not died, the
  // next run would have overwritten it. Nothing overwrites a state that is
  // still three days old.
  const state = { status: "sent", ranAt: "2026-10-01 09:00", sentAt: "2026-10-01 09:00", fileName: "File Backup.tar.gz", error: "", reason: "" };
  const health = assessBackupHealth({ backupState: state, intervalMs: 24 * HOUR_MS, now: new Date("2026-10-04T12:00:00Z") });

  assert.equal(health.ok, false);
  assert.equal(health.stale, true);
});

test("an archive built but not sent says so", () => {
  // "created" means a file exists but the owner never received it. The owner
  // does not have a copy, which is the entire point of the backup.
  const state = { status: "created", ranAt: "2026-10-04 09:00", sentAt: "", fileName: "File Backup.tar.gz", error: "send_failed", reason: "send_failed" };
  const health = assessBackupHealth({ backupState: state, intervalMs: 24 * HOUR_MS, now: new Date("2026-10-04T12:00:00Z") });

  assert.equal(health.ok, false);
  assert.match(health.message, /tidak terkirim|kirim/i);
});

test("severity separates a hard failure from something merely overdue", () => {
  // The UI picks its banner tone from this. Deriving it from the message text
  // instead would couple the UI to Indonesian wording, and one copy edit would
  // silently turn an error banner into a warning.
  const at = (status, extra = {}) => assessBackupHealth({
    backupState: { status, ranAt: "2026-10-04 09:00", sentAt: "2026-10-04 09:00", fileName: "x", error: "", reason: "", ...extra },
    intervalMs: 24 * HOUR_MS,
    now: new Date("2026-10-04T12:00:00Z"),
  });

  assert.equal(at("sent").severity, "none", "a healthy backup has nothing to report");
  assert.equal(at("failed").severity, "error", "a run that blew up is a hard failure");
  assert.equal(at("created", { sentAt: "", error: "send_failed", reason: "send_failed" }).severity, "error", "built but never delivered");
  // Overdue, skipped and never-run are all recoverable by starting the bot --
  // they are warnings, not errors.
  assert.equal(at("skipped", { sentAt: "", error: "whatsapp_not_connected", reason: "whatsapp_not_connected" }).severity, "warning");
  assert.equal(at("disabled").severity, "warning");
  assert.equal(assessBackupHealth({ backupState: null, intervalMs: 24 * HOUR_MS }).severity, "warning");
});

test("every verdict reports a severity, so the UI never has to guess", () => {
  const statuses = ["sent", "created", "skipped", "failed", "disabled", "something_new"];
  for (const status of statuses) {
    const health = assessBackupHealth({
      backupState: { status, ranAt: "2026-10-04 09:00", sentAt: "", fileName: "x", error: "", reason: "" },
      intervalMs: 24 * HOUR_MS,
      now: new Date("2026-10-04T12:00:00Z"),
    });
    assert.ok(["none", "warning", "error"].includes(health.severity), `${status} produced severity=${health.severity}`);
  }
});

test("a missing or unparseable timestamp does not read as healthy", () => {
  for (const ranAt of ["", "not-a-date", "2026-13-45 99:99"]) {
    const health = assessBackupHealth({
      backupState: { status: "sent", ranAt, sentAt: ranAt, fileName: "x", error: "", reason: "" },
      intervalMs: 24 * HOUR_MS,
      now: new Date("2026-10-04T12:00:00Z"),
    });
    assert.equal(health.ok, false, `ranAt=${JSON.stringify(ranAt)} was treated as healthy`);
  }
});

test("the message names the process to check, since that is the usual cause", () => {
  const state = { status: "skipped", ranAt: "2026-10-04 09:00", sentAt: "", fileName: "", error: "whatsapp_not_connected", reason: "whatsapp_not_connected" };
  const health = assessBackupHealth({ backupState: state, intervalMs: 24 * HOUR_MS, now: new Date("2026-10-04T12:00:00Z") });

  assert.match(health.message, /WhatsApp|proses bot/i, "the owner needs to know where to look");
});

test("a backup that has not been sent in the last interval is flagged even if a run happened", () => {
  // Sent yesterday, skipped today, sent the day before that. The run happened;
  // the delivery did not. Judging on `ranAt` alone would report this as fine.
  const state = { status: "skipped", ranAt: "2026-10-04 11:00", sentAt: "2026-10-03 09:00", fileName: "", error: "heavy_work_paused", reason: "heavy_work_paused" };
  const health = assessBackupHealth({ backupState: state, intervalMs: 24 * HOUR_MS, now: new Date("2026-10-04T12:00:00Z") });

  assert.equal(health.ok, false);
});

/*
 * The interval has to be the bot's real schedule. Both processes read one
 * `.env`, and a dashboard judging staleness against a hardcoded 24h while the
 * bot runs every 6h would cry wolf every night -- or, worse, if the bot were
 * moved to a longer interval than the default, sleep through a real gap.
 */
test("the interval comes from the same env the bot reads", () => {
  assert.equal(backupIntervalMs({ AUTO_BACKUP_INTERVAL_HOURS: "6" }), 6 * HOUR_MS);
  assert.equal(backupIntervalMs({ AUTO_BACKUP_INTERVAL_MS: String(90 * 60 * 1000) }), 90 * 60 * 1000);
});

test("milliseconds win over hours, matching the bot's precedence", () => {
  assert.equal(
    backupIntervalMs({ AUTO_BACKUP_INTERVAL_HOURS: "24", AUTO_BACKUP_INTERVAL_MS: String(2 * HOUR_MS) }),
    2 * HOUR_MS,
  );
});

test("an unset or nonsense interval falls back to daily", () => {
  for (const env of [{}, { AUTO_BACKUP_INTERVAL_HOURS: "" }, { AUTO_BACKUP_INTERVAL_HOURS: "abc" }, { AUTO_BACKUP_INTERVAL_MS: "-5" }, { AUTO_BACKUP_INTERVAL_MS: "0" }]) {
    assert.equal(backupIntervalMs(env), 24 * HOUR_MS, `env=${JSON.stringify(env)}`);
  }
});

test("staleness tracks the configured interval, not a fixed 24 hours", () => {
  // 30 hours old. Unremarkable on a daily schedule; a missed backup on a 6-hour
  // one. This is the case a hardcoded interval gets exactly backwards.
  const state = { status: "sent", ranAt: "2026-10-03 06:00", sentAt: "2026-10-03 06:00", fileName: "x", error: "", reason: "" };
  const now = new Date("2026-10-04T12:00:00Z");

  assert.equal(assessBackupHealth({ backupState: state, intervalMs: 24 * HOUR_MS, now }).ok, true);
  assert.equal(assessBackupHealth({ backupState: state, intervalMs: 6 * HOUR_MS, now }).ok, false);
});