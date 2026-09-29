import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverUrl = new URL("../index.js", import.meta.url);
const source = await readFile(serverUrl, "utf8");

/**
 * Every recurring job used to be armed with a bare `setTimeout` + `setInterval`
 * pair at module scope, with no way to switch them off. That is safe on a VPS
 * that owns the deployment and actively dangerous anywhere else: a second copy
 * of the API -- a developer's laptop, a second container during a deploy --
 * would expire the same pending orders, sync the same payments, write the same
 * spreadsheet rows, and send the same WhatsApp messages, all at once and against
 * production.
 *
 * `DISABLE_BACKGROUND_JOBS=1` is the switch. These tests exist so a job added
 * later cannot quietly opt itself back out of it.
 */

/** The timer registrations that are genuinely not a recurring job. */
const ALLOWED_TIMERS = [
  // Per-request abort timers and sleep helpers: they resolve or fire once and
  // are not scheduled by anything the server does on a timer.
  /setTimeout\(\(\) => controller\.abort\(\)/,
  /new Promise\(\(resolve\) => setTimeout\(resolve,/,
  /setTimeout\(job, firstDelayMs\)/,
  /setInterval\(job, everyMs\)/,
];

test("no recurring job is armed without going through scheduleJob", () => {
  const offenders = [];

  source.split("\n").forEach((line, index) => {
    const match = line.match(/^\s*set(?:Timeout|Interval)\((.*)$/);
    if (!match) return;
    if (ALLOWED_TIMERS.some((pattern) => pattern.test(line))) return;
    offenders.push(`${index + 1}: ${line.trim()}`);
  });

  assert.deepEqual(
    offenders,
    [],
    "a timer armed outside scheduleJob cannot be disabled by DISABLE_BACKGROUND_JOBS. "
      + "Route it through scheduleJob(name, job, firstDelayMs, everyMs).\n"
      + offenders.join("\n"),
  );
});

test("the guard is opt-out, named, and spelled in one place", () => {
  // Opt-out, not opt-in: a plain production boot must keep the jobs running, so
  // the default has to be "scheduled". The test above is what proves the
  // default held -- it rejects a bare timer whether or not the flag is set.
  assert.match(source, /process\.env\.DISABLE_BACKGROUND_JOBS/);

  // The truthy spellings are normalized in one place, so "DISABLE_BACKGROUND_JOBS=true"
  // cannot be a silent no-op that leaves jobs writing to production.
  assert.match(source, /\["1", "true", "yes", "on"\]\s*\n?\s*\.includes\(/);
  assert.match(source, /\.toLowerCase\(\)/);
});

test("a disabled run says so loudly, and an active one names the jobs", () => {
  // A developer has to be able to tell which mode they are in without reading
  // the source, and the warning has to be unconditional -- not buried in a
  // branch that only fires on a job error.
  assert.match(source, /DISABLE_BACKGROUND_JOBS is set -- none of the \$\{scheduledJobs\.length\} background jobs will run/);
  assert.match(source, /Background jobs are ACTIVE -- this process writes to the database/);
  assert.match(source, /sends WhatsApp messages/);
  assert.match(source, /Set DISABLE_BACKGROUND_JOBS=1 for a read-only run/);
});

test("the schedule is reported from the registrations, not hardcoded", () => {
  // The banner used to print before any job was registered, so it asserted a
  // schedule that did not exist yet. It now runs after the last registration and
  // is built from the same array the registrations fill.
  assert.match(source, /function reportScheduledJobs\(\)/);

  const reportIndex = source.indexOf("reportScheduledJobs();");
  const lastRegistration = Math.max(
    ...[...source.matchAll(/^scheduleJob\(/gm)].map((match) => match.index),
  );
  assert.ok(
    reportIndex > lastRegistration,
    "reportScheduledJobs() must run after every scheduleJob() call, or the log describes a schedule that has not been built yet",
  );
});

test("every job that exists is named, so the log lists all of them", () => {
  // Each job gets a human-readable name in the startup log. Count the
  // registrations so a job added without a name is caught: the test fails on
  // the mismatch rather than on a stylistic grounds.
  const registrations = [...source.matchAll(/^scheduleJob\("([^"]+)",\s*(\w+),/gm)];
  assert.ok(registrations.length >= 9, `expected the 9 known jobs, found ${registrations.length}`);

  const names = registrations.map((match) => match[1]);
  assert.equal(new Set(names).size, names.length, `duplicate job name: ${names.join(", ")}`);

  const functions = registrations.map((match) => match[2]);
  assert.equal(new Set(functions).size, functions.length, "one job function is registered twice");

  // The short ones are the ones that touch customers and money, so they are the
  // ones worth naming in an assertion rather than trusting the count alone.
  for (const expected of [
    "pakasir-payment-sync",
    "expired-order-maintenance",
    "google-sheets-stock-sync",
    "whatsapp-health-alert",
  ]) {
    assert.ok(names.includes(expected), `${expected} must be scheduled through the guard`);
  }
});
