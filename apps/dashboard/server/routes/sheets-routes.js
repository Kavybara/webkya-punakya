export function registerSheetsRoutes(app, deps) {
  const {
    buildSheetsSyncPreview,
    cloneForPreview,
    enableMaintenanceMode,
    ensureGoogleSheetsTemplate,
    ensureNetflixSheetsTemplate,
    friendlyGoogleSheetsError,
    googleSheetsConfigured,
    googleSheetsPublicSettings,
    previewAccountSheetMapping,
    readDb,
    requireAuth,
    syncGoogleSheetsStockSafely,
    syncDataResellersToGoogleSheets,
    updateDb,
  } = deps;

  app.get("/api/google-sheets/status", requireAuth(["owner"]), async (_req, res) => {
    const db = await readDb();
    res.json({
      configured: googleSheetsConfigured(db),
      settings: googleSheetsPublicSettings(db),
      lastSyncAt: db.settings?.googleSheetsLastSyncAt || "",
      lastSyncSummary: db.settings?.googleSheetsLastSyncSummary || null,
    });
  });

  app.get("/api/google-sheets/mapping-preview", requireAuth(["owner"]), async (req, res, next) => {
    try {
      const db = await readDb();
      const preview = await previewAccountSheetMapping(db, {
        accountId: req.query.accountId || req.query.account_id || "",
        stockId: req.query.stockId || req.query.stock_id || "",
        sheetStockKey: req.query.sheetStockKey || req.query.sheet_stock_key || "",
        email: req.query.email || "",
      });
      if (!preview.ok) {
        res.status(404).json(preview);
        return;
      }
      res.json(preview);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/google-sheets/netflix/template", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      const result = await ensureNetflixSheetsTemplate(await readDb());
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/google-sheets/template", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      const result = await ensureGoogleSheetsTemplate(await readDb());
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/google-sheets/sync", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      const result = await updateDb((db) => syncGoogleSheetsStockSafely(db, { reason: "manual_sync", force: true }));
      res.json(result);
    } catch (error) {
      await updateDb((db) => {
        const friendly = friendlyGoogleSheetsError(error);
        if (friendly.code !== "google_sheets_rate_limited") {
          enableMaintenanceMode(db, `Google Sheets gagal sync manual: ${friendly.message || "unknown_error"}`, "google_sheets");
        }
        return null;
      }).catch(() => undefined);
      next(friendlyGoogleSheetsError(error));
    }
  });

  app.post("/api/google-sheets/resellers/sync", requireAuth(["owner"]), async (req, res, next) => {
    try {
      const result = await updateDb(async (db) => {
        const sync = await syncDataResellersToGoogleSheets(db);
        db.activities = db.activities || [];
        db.activities.unshift({
          id: `act-reseller-sheet-${Date.now().toString(36)}`,
          type: "reseller",
          title: "Data reseller disinkronkan ke Sheets",
          description: `${sync.checked || 0} diperiksa, ${sync.added || 0} ditambahkan, ${sync.updated || 0} diperbarui, ${sync.conflicts || 0} konflik.`,
          createdAt: new Date().toISOString(),
          actor: req.auth?.name || req.auth?.username || "owner",
        });
        return sync;
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/google-sheets/preview", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      const db = await readDb();
      if (!googleSheetsConfigured(db)) {
        res.status(400).json({ error: "Google Sheets belum dikonfigurasi" });
        return;
      }
      const previewDb = cloneForPreview(db);
      const result = await syncGoogleSheetsStockSafely(previewDb, { silent: true, reason: "preview_sync", force: true, readOnly: true });
      res.json({ ok: true, preview: buildSheetsSyncPreview(db, previewDb, result) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/google-sheets/netflix/sync", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      const result = await updateDb((db) => syncGoogleSheetsStockSafely(db, { reason: "manual_sync", force: true }));
      res.json(result);
    } catch (error) {
      next(friendlyGoogleSheetsError(error));
    }
  });
}
