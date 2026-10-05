import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const importSourcePath = new URL("../../../../scripts/deploy/import-legacy-wa-backup.mjs", import.meta.url);
const dashboardIndexPath = new URL("../index.js", import.meta.url);
const whatsappRoutesPath = new URL("../routes/whatsapp-routes.js", import.meta.url);

test("legacy import skips empty sources instead of overwriting active runtime data", async () => {
  const source = await fs.readFile(importSourcePath, "utf8");

  assert.match(source, /const hasLegacyInput =/);
  assert.match(source, /skip_reason = "legacy_source_empty"/);
  assert.match(source, /return;\s*\}\s*if \(previousMarker && !forceRun\)/);
});

test("legacy import merges lists instead of overwriting runtime updates", async () => {
  const source = await fs.readFile(importSourcePath, "utf8");

  assert.match(source, /async function mergeListJsonFile/);
  assert.match(source, /listEntryTimestamp\(entry\) >= listEntryTimestamp\(importedEntry\)/);
  assert.match(source, /mergeListJsonFile\(path\.join\(whatsappRuntimeDbDir, "lists\.json"\), runtimeLists, "runtime"\)/);
  assert.match(source, /mergeListJsonFile\(path\.join\(whatsappSourceDbDir, "lists\.json"\), dashboardLists, "legacy"\)/);
  assert.match(source, /mergeDashboardGroupLists\(dashboardLists\)/);
});

test("legacy import keeps active dashboard and runtime rental state authoritative", async () => {
  const source = await fs.readFile(importSourcePath, "utf8");

  assert.match(source, /async function mergeRentalJsonFile/);
  assert.match(source, /function normalizeRentalStatus/);
  assert.match(source, /merged\[key\] = \{ \.\.\.\(merged\[key\] \|\| \{\}\), \.\.\.rental \}/);
  assert.match(source, /status === "expired" \|\| daysLeft <= 0/);
  assert.match(source, /if \(!key \|\| byId\.has\(key\)\) continue;/);
  assert.match(source, /mergeRentalJsonFile\(path\.join\(whatsappRuntimeDbDir, "rentals\.json"\), runtimeRentals, "runtime"\)/);
  assert.match(source, /mergeRentalJsonFile\(path\.join\(whatsappSourceDbDir, "rentals\.json"\), activeRentals, "legacy"\)/);
});

test("dashboard rental merge preserves paused status from legacy mirrors", async () => {
  const source = await fs.readFile(dashboardIndexPath, "utf8");

  assert.match(source, /const legacyStatus = String\(rental\?\.status \|\| ""\)/);
  assert.match(source, /\["active", "paused", "expired"\]\.includes\(legacyStatus\)/);
  assert.match(source, /status,\s*\n\s*linkGrub: rental\?\.linkGrub/);
});

test("rental legacy mirror writes status and adjust does not reactivate paused groups", async () => {
  const indexSource = await fs.readFile(dashboardIndexPath, "utf8");
  const routeSource = await fs.readFile(whatsappRoutesPath, "utf8");

  assert.match(indexSource, /return canonicalRentalMap\(await readDbSnapshot\(\)\)/);
  assert.match(indexSource, /rentalMirror\.reconcile\(\)/);
  assert.match(routeSource, /status: String\(current\.status \|\| fallback\.status \|\| ""\)\.toLowerCase\(\) === "paused"/);
  assert.match(routeSource, /status: updated\.status/);
});
