import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The Backup card on the owner Health Center could never report a real backup.
 *
 * `/api/health` has never returned a `backup` field, but `HealthResult`
 * declares one, so the page compiled happily and read `health?.backup?.count`
 * as `undefined`. `api.systemStatus()` does return backup details --
 * `buildSystemStatus` calls `readBackupInfo()` -- and the same card's `ok`
 * field already knew that: it read `health?.backup?.count || system?.backup?.count`.
 *
 * Only the detail string was left behind. So the card rendered the amber "cek"
 * badge from the working fallback while its text said "Backup belum ditemukan."
 * The owner was told backups did not exist, next to a count proving they did.
 *
 * This is the worst shape a health check can take: it is wrong in the
 * reassuring direction on the card that exists to reassure you about the file
 * you would need if the database disappeared.
 */
const rawPage = readFileSync(
  new URL("../../src/pages/owner-v2/health/page.tsx", import.meta.url),
  "utf8",
);

// Comments are stripped before the negative assertions below. The fix explains
// itself in a comment that quotes the old expression verbatim, so a raw scan
// would find `health?.backup?.` in the explanation of why it was removed --
// and the test would fail on its own documentation.
const page = rawPage
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

test("the backup detail reads the endpoint that actually serves it", () => {
  // Guards the specific regression: the `ok` flag read a `system` fallback the
  // detail string lacked, so the card contradicted itself in one render --
  // amber "cek" badge from real data, "Backup belum ditemukan." beside it.
  assert.match(
    page,
    /system\?\.backup\?\.latestName/,
    "the backup detail no longer reads the endpoint that serves it",
  );
  assert.doesNotMatch(
    page,
    /health\?\.backup\?/,
    "api.health() has never returned a backup field; reading it here is how the card went silent",
  );
});

test("the backup timestamp comes from the same source", () => {
  // A name without its date is half an answer; the owner needs to know whether
  // the newest backup is from last night or from three weeks ago.
  assert.match(
    page,
    /system\.backup\.latestAt/,
    "the backup detail shows a filename with no date",
  );
});

test("the database card reads the same endpoint", () => {
  // Same phantom field, same page. `/api/health` never sent `database` either,
  // so both the size and the "last updated" line were permanently blank.
  assert.doesNotMatch(
    page,
    /health\?\.database\?/,
    "api.health() has never returned a database field",
  );
  assert.match(page, /system\?\.database\?\.exists/, "the database card cannot see the file it reports on");
});

test("the health endpoint does not claim to serve backup details it cannot", () => {
  // The mismatch that caused this: the client type promised a `backup` field on
  // HealthResult, so nothing failed loudly when the server stopped sending it.
  // Either the endpoint serves it or the type stops promising it.
  const systemRoutes = readFileSync(new URL("../routes/system-routes.js", import.meta.url), "utf8");
  const healthBlock = systemRoutes.slice(
    systemRoutes.indexOf('app.get("/api/health"'),
    systemRoutes.indexOf('app.get("/api/maintenance"'),
  );
  assert.doesNotMatch(
    healthBlock,
    /\bbackup\b/,
    "the endpoint still advertises backup fields it does not send; either serve them or drop the claim",
  );
});
