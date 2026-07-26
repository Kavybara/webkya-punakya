export function registerOperationsRoutes(app, deps) {
  const {
    activityBelongsToReseller,
    applyOperationsAction,
    buildOperationsAudit,
    buildOwnerSearch,
    buildSystemStatus,
    previewOperationsAction,
    readDb,
    readDbSnapshot,
    requireAuth,
    scheduleKavyaRestart,
    snapshotVersion,
    updateDb,
  } = deps;

  app.get("/api/activities", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    const scope = String(req.query?.scope || "active").trim().toLowerCase();
    const selected = scope === "archived"
      ? (db.archivedActivities || [])
      : scope === "all"
        ? [...(db.activities || []), ...(db.archivedActivities || [])]
        : (db.activities || []);
    if (req.auth.role === "reseller") {
      res.json(selected.filter((activity) => activityBelongsToReseller(db, req.auth, activity)));
      return;
    }
    res.json(selected);
  });

  app.get("/api/operations/center", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      const snapshot = await readDbSnapshot();
      const audit = await buildOperationsAudit(snapshot);
      const generatedAt = new Date().toISOString();
      res.json({
        ...audit,
        generatedAt,
        readOnly: true,
        snapshotVersion: snapshotVersion(snapshot),
        findings: audit.manual?.items || [],
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/owner-search", requireAuth(["owner"]), async (req, res) => {
    const db = await readDbSnapshot();
    res.json(buildOwnerSearch(db, req.query.q || ""));
  });

  app.post("/api/operations/actions/preview", requireAuth(["owner"]), async (req, res, next) => {
    try {
      res.json(previewOperationsAction(await readDbSnapshot(), req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/operations/actions/apply", requireAuth(["owner"]), async (req, res, next) => {
    try {
      const result = await updateDb((db) => applyOperationsAction(db, req.body || {}, req.auth || {}));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/operations/reseller/repair", requireAuth(["owner"]), async (req, res, next) => {
    try {
      const result = await updateDb((db) => applyOperationsAction(db, {
        action: "reseller_repair",
        ...(req.body || {}),
      }, req.auth || {}));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/system/status", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      res.json(await buildSystemStatus(await readDb()));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/restart", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      res.json({ ok: true, message: "Restart Kavya dijadwalkan." });
      scheduleKavyaRestart();
    } catch (error) {
      next(error);
    }
  });
}
