import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGoogleSheetsSyncState,
  friendlyGoogleSheetsError,
  googleSheetsProductSyncScope,
  googleSheetsRequiredSectionsError,
  recentGoogleSheetsProductSync,
  recentGoogleSheetsResellerLookup,
  recordGoogleSheetsProductSync,
  googleSheetsSectionError,
  googleSheetsSyncHealth,
  isGoogleSheetsQuotaError,
  sheetReadWarningOrThrow,
  validateSheetPoolReadColumns,
} from "../services/google-sheets-sync-policy-service.js";

test("catalog precheck reuses only a recent successful product scope", () => {
  const settings = {};
  const scope = googleSheetsProductSyncScope({ id: "prod-netflix" }, "netflix");

  recordGoogleSheetsProductSync(settings, scope, { ok: true }, "2026-08-03T10:00:00.000Z");

  assert.equal(scope, "netflix:prod-netflix");
  assert.equal(recentGoogleSheetsProductSync(
    settings,
    scope,
    new Date("2026-08-03T10:00:15.000Z").getTime(),
    20_000,
  )?.reason, "recent_product_sync");
  assert.equal(recentGoogleSheetsProductSync(
    settings,
    scope,
    new Date("2026-08-03T10:00:21.000Z").getTime(),
    20_000,
  ), null);
});

test("failed product sync is never eligible for catalog cooldown reuse", () => {
  const settings = {};
  const scope = googleSheetsProductSyncScope({ id: "prod-hbo" }, "dynamic");

  recordGoogleSheetsProductSync(settings, scope, { ok: false }, "2026-08-03T10:00:00.000Z");

  assert.equal(recentGoogleSheetsProductSync(
    settings,
    scope,
    new Date("2026-08-03T10:00:01.000Z").getTime(),
    20_000,
  ), null);
});

test("recent reseller lookup can be reused without another Sheet read", () => {
  const settings = {
    googleSheetsResellerAliases: [{ seller: "kya", whatsapp: "6280000000000" }],
    googleSheetsResellerSync: {
      ok: true,
      rows: 1,
      aliases: 1,
      sheetName: "data reseller",
      warnings: [],
      syncedAt: "2026-08-03T10:00:00.000Z",
    },
  };

  const cached = recentGoogleSheetsResellerLookup(
    settings,
    new Date("2026-08-03T10:00:45.000Z").getTime(),
    60_000,
  );

  assert.equal(cached?.ok, true);
  assert.equal(cached?.reused, true);
  assert.equal(cached?.reason, "recent_reseller_lookup");
  assert.equal(recentGoogleSheetsResellerLookup(
    settings,
    new Date("2026-08-03T10:01:01.000Z").getTime(),
    60_000,
  ), null);
});

test("reseller lookup cache fails closed when aliases or sync status are invalid", () => {
  const now = new Date("2026-08-03T10:00:10.000Z").getTime();
  const syncedAt = "2026-08-03T10:00:00.000Z";

  assert.equal(recentGoogleSheetsResellerLookup({
    googleSheetsResellerAliases: [],
    googleSheetsResellerSync: { ok: false, syncedAt },
  }, now, 60_000), null);
  assert.equal(recentGoogleSheetsResellerLookup({
    googleSheetsResellerSync: { ok: true, syncedAt },
  }, now, 60_000), null);
});

test("recognizes Google Sheets quota failures without exposing the provider message", () => {
  const providerError = new Error("Quota exceeded for quota metric 'Read requests' (429)");

  assert.equal(isGoogleSheetsQuotaError(providerError), true);
  const friendly = friendlyGoogleSheetsError(providerError);
  assert.equal(friendly.status, 429);
  assert.equal(friendly.code, "google_sheets_rate_limited");
  assert.equal(friendly.message, "Stok sedang disinkronkan dengan Google Sheets. Coba lagi dalam 1 menit.");
});

test("returns a fail-closed quota error for the selected product section", () => {
  const error = googleSheetsSectionError({
    dynamic: {
      ok: false,
      error: "Quota exceeded for Read requests per minute per user",
    },
  }, "dynamic");

  assert.equal(error.status, 429);
  assert.equal(error.code, "google_sheets_rate_limited");
});

test("returns a service error for a non-quota product section failure", () => {
  const error = googleSheetsSectionError({
    netflix: {
      ok: false,
      error: "sheet marker missing",
    },
  }, "netflix");

  assert.equal(error.status, 503);
  assert.equal(error.code, "google_sheets_sync_failed");
  assert.match(error.message, /netflix/);
});

test("ignores unrelated failed sections when the selected product section is healthy", () => {
  const error = googleSheetsSectionError({
    viu: { ok: true },
    resellers: { ok: false, reason: "duplicate_sheet_username" },
  }, "viu");

  assert.equal(error, null);
});

test("dynamic sheet scans rethrow quota errors instead of converting them to warnings", () => {
  const quotaError = new Error("Quota exceeded for Read requests per minute");

  assert.throws(
    () => sheetReadWarningOrThrow(quotaError, "Disney"),
    (error) => error === quotaError,
  );
});

test("dynamic sheet scans keep non-quota read failures as scoped warnings", () => {
  assert.equal(
    sheetReadWarningOrThrow(new Error("tab tidak ditemukan"), "Disney"),
    "Disney: tab tidak ditemukan",
  );
});

test("partial sync records an attempt without replacing the last successful sync", () => {
  const settings = {
    googleSheetsLastSyncAt: "2026-07-30T10:00:00.000Z",
  };
  const result = {
    netflix: { ok: false, error: "sheet marker missing" },
    viu: { ok: true },
    vidio: { ok: true },
    canva: { ok: true },
    linkPools: { ok: true },
    dynamic: { ok: true },
    disneyFormat: { ok: true },
    resellers: { ok: true },
  };

  const health = applyGoogleSheetsSyncState(settings, result, "2026-07-31T10:00:00.000Z");

  assert.equal(health.ok, false);
  assert.deepEqual(health.failedSections, ["netflix"]);
  assert.equal(settings.googleSheetsLastSyncAttemptAt, "2026-07-31T10:00:00.000Z");
  assert.equal(settings.googleSheetsLastSyncAt, "2026-07-30T10:00:00.000Z");
  assert.deepEqual(settings.googleSheetsLastSyncFailedSections, ["netflix"]);
});

test("complete sync updates the last successful sync and clears failures", () => {
  const settings = {
    googleSheetsLastSyncAt: "2026-07-30T10:00:00.000Z",
    googleSheetsLastSyncFailedSections: ["netflix"],
  };
  const result = Object.fromEntries(
    ["netflix", "viu", "vidio", "canva", "linkPools", "dynamic", "disneyFormat", "resellers"]
      .map((key) => [key, { ok: true }]),
  );

  const health = applyGoogleSheetsSyncState(settings, result, "2026-07-31T10:00:00.000Z");

  assert.equal(health.ok, true);
  assert.equal(settings.googleSheetsLastSyncAt, "2026-07-31T10:00:00.000Z");
  assert.deepEqual(settings.googleSheetsLastSyncFailedSections, []);
  assert.deepEqual(googleSheetsSyncHealth(settings), {
    healthy: true,
    lastAttemptAt: "2026-07-31T10:00:00.000Z",
    lastSuccessAt: "2026-07-31T10:00:00.000Z",
    failedSections: [],
  });
});

test("reseller lookup rejects a failed required Sheet section", () => {
  const error = googleSheetsRequiredSectionsError({
    ok: false,
    netflix: { ok: false, error: "sheet marker missing" },
    resellers: { ok: true },
  }, ["netflix", "resellers"]);

  assert.equal(error?.code, "google_sheets_sync_failed");
  assert.match(error?.message || "", /netflix/);
  assert.equal(googleSheetsRequiredSectionsError({
    ok: false,
    netflix: { ok: true },
    resellers: { ok: true },
    dynamic: { ok: false, error: "unrelated" },
  }, ["netflix", "resellers"]), null);
});

test("stock pool read mapping fails closed when ownership headers are missing", () => {
  const valid = {
    account: 0,
    password: -1,
    profile: 1,
    date: 2,
    duration: 3,
    expiresAt: 4,
    seller: 7,
    pin: 5,
    orderId: 9,
    stockId: 12,
  };

  assert.deepEqual(validateSheetPoolReadColumns(valid, {
    schema: "profile",
    requireProfile: true,
  }), { ok: true, missing: [] });

  const missingSeller = validateSheetPoolReadColumns({ ...valid, seller: -1 }, {
    schema: "profile",
    requireProfile: true,
  });
  assert.equal(missingSeller.ok, false);
  assert.deepEqual(missingSeller.missing, ["SELLER"]);

  const missingStockId = validateSheetPoolReadColumns({ ...valid, stockId: -1 }, {
    schema: "profile",
    requireProfile: true,
  });
  assert.equal(missingStockId.ok, false);
  assert.deepEqual(missingStockId.missing, ["STOCK ID"]);
});
