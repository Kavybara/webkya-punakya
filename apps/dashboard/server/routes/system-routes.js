export function registerSystemRoutes(app, deps) {
  const {
    ensureDb,
    firstConfigured,
    getDbVersion,
    getPakasirCredentials,
    googleSheetsConfigured,
    maintenanceMode,
    makeId,
    mergedWhatsappRentals,
    nowText,
    onDbChange,
    readActiveLegacyGroupLists,
    readDb,
    readDbSnapshot,
    requireAuth,
    setMaintenanceMode,
    updateDb,
    warrantyWhatsAppNumber,
  } = deps;

  app.get("/api/health", async (_req, res) => {
    const db = await readDb();
    const pakasir = getPakasirCredentials(db);
    res.json({
      ok: true,
      googleSheetsConfigured: googleSheetsConfigured(db),
      googleSheetsLastSyncAt: db.settings?.googleSheetsLastSyncAt || "",
      ownerWhatsAppNumber: db.settings?.ownerWhatsAppNumber || process.env.OWNER_WHATSAPP_NUMBER || "",
      warrantyWhatsAppNumber: warrantyWhatsAppNumber(db),
      whatsappInboundConfigured: Boolean(firstConfigured(db.settings?.whatsappInboundToken, process.env.WHATSAPP_INBOUND_TOKEN)),
      pakasirConfigured: pakasir.configured,
      maintenance: maintenanceMode(db),
    });
  });

  app.get("/api/maintenance", async (_req, res) => {
    const db = await readDb();
    res.json({ ok: true, maintenance: maintenanceMode(db) });
  });

  app.post("/api/maintenance", requireAuth(["owner"]), async (req, res) => {
    const state = await updateDb((db) => {
      setMaintenanceMode(db, Boolean(req.body.enabled), req.body.reason || "", "manual");
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "security",
        title: Boolean(req.body.enabled) ? "Maintenance order diaktifkan" : "Maintenance order dimatikan",
        description: Boolean(req.body.enabled)
          ? `Order baru ditahan sementara. Alasan: ${req.body.reason || "manual"}`
          : "Order baru kembali dibuka dari panel owner.",
        createdAt: nowText(),
      });
      return maintenanceMode(db);
    });
    res.json({ ok: true, maintenance: state });
  });

  app.get("/api/bootstrap", requireAuth(["owner"]), async (_req, res) => {
    const db = await readDbSnapshot();
    db.whatsappRentals = await mergedWhatsappRentals(db);
    db.whatsappGroupLists = await readActiveLegacyGroupLists();
    res.json(db);
  });

  app.get("/api/events", requireAuth(["owner", "reseller"]), async (req, res) => {
    await ensureDb();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let closed = false;
    let unsubscribe = () => {};
    let heartbeat = null;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    };
    const send = (event) => {
      if (closed || res.destroyed || res.writableEnded) return;
      try {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    };

    send({ type: "connected", version: getDbVersion(), at: nowText() });
    unsubscribe = onDbChange(send);
    heartbeat = setInterval(() => {
      send({ type: "heartbeat", version: getDbVersion(), at: nowText() });
    }, 25000);

    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  });
}
