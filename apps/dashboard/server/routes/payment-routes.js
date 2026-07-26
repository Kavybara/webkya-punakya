export function registerPaymentRoutes(app, deps) {
  const {
    assertPakasirSecret,
    expirePendingOrders,
    findOrderForPublicTracking,
    nowText,
    orderBelongsToReseller,
    readDb,
    readDbSnapshot,
    reconcilePakasirPaymentInDb,
    requireAuth,
    safePublicPayment,
    safeTrackingPayment,
    updateDb,
  } = deps;
  const manualReconcileAttempts = new Map();

  app.post("/api/pakasir/webhook", async (req, res, next) => {
    try {
      assertPakasirSecret(req, await readDb());
      const ref = req.body.paymentRef || req.body.reference || req.body.ref || req.body.order_id;
      const result = await updateDb(async (db) => {
        expirePendingOrders(db);
        const payment = db.payments.find((item) => item.ref === ref || item.orderId === ref);
        const order = db.orders.find((item) => item.paymentRef === ref || item.id === ref);
        if (!payment || !order) return null;
        payment.providerWebhookStatus = String(req.body.status || req.body.payment_status || "").toLowerCase();
        payment.providerWebhookAt = nowText();
        payment.providerWebhookPayloadReceived = true;
        return reconcilePakasirPaymentInDb(db, ref, {
          throttleMs: 0,
          source: "pakasir_webhook",
          allowLatePaymentRecovery: true,
        });
      });
      if (!result) return res.status(404).json({ error: "Payment/order tidak ditemukan" });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/payments/:ref", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    const payment = (db.payments || []).find((item) => item.ref === req.params.ref);
    const order = payment
      ? (db.orders || []).find((item) => item.paymentRef === payment.ref || item.id === payment.orderId)
      : null;
    const result = payment && !(req.auth.role === "reseller" && order && !orderBelongsToReseller(db, req.auth, order))
      ? safePublicPayment(payment, order)
      : null;
    if (!result) return res.status(404).json({ error: "Payment tidak ditemukan" });
    res.json(result);
  });

  app.get("/api/public/payments/:ref", async (req, res) => {
    const db = await readDbSnapshot();
    const payment = (db.payments || []).find((item) => item.ref === req.params.ref);
    const order = payment
      ? (db.orders || []).find((item) => item.paymentRef === payment.ref || item.id === payment.orderId)
      : null;
    const verifiedOrder = findOrderForPublicTracking(order ? [order] : [], {
      trackingToken: req.query.token,
      orderId: order?.id,
      verification: req.query.verification,
    });
    const result = payment && order && verifiedOrder ? safeTrackingPayment(payment, order) : null;
    if (!result) return res.status(404).json({ error: "Pesanan tidak ditemukan atau data verifikasi tidak sesuai." });
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json(result);
  });

  app.post("/api/operations/payments/:orderId/reconcile", requireAuth(["owner"]), async (req, res, next) => {
    try {
      const orderId = String(req.params.orderId || "").trim();
      if (!orderId) return res.status(400).json({ error: "Order ID wajib diisi" });
      const previousAttempt = Number(manualReconcileAttempts.get(orderId) || 0);
      if (Date.now() - previousAttempt < 15_000) {
        return res.status(429).json({ error: "Pemeriksaan pembayaran baru saja dijalankan. Tunggu sebentar." });
      }
      manualReconcileAttempts.set(orderId, Date.now());
      const result = await updateDb(async (db) => {
        const order = (db.orders || []).find((item) => item.id === orderId || item.paymentRef === orderId);
        const payment = order
          ? (db.payments || []).find((item) => item.orderId === order.id || item.ref === order.paymentRef)
          : null;
        if (!order || !payment) return null;
        const reconciliation = await reconcilePakasirPaymentInDb(db, payment.ref, {
          throttleMs: 0,
          source: "owner_manual_reconcile",
          allowLatePaymentRecovery: true,
        });
        db.activities = db.activities || [];
        db.activities.unshift({
          id: `act-payment-check-${Date.now().toString(36)}`,
          type: "order",
          title: `Pemeriksaan pembayaran ${order.id}`,
          description: `Owner menjalankan reconciliation manual. Hasil: ${reconciliation?.reason || (reconciliation?.paid ? "paid" : "checked")}.`,
          createdAt: nowText(),
          orderId: order.id,
          actorRole: "owner",
          actorName: req.auth?.name || req.auth?.username || req.auth?.email || "owner",
        });
        return {
          ok: reconciliation?.ok !== false,
          checked: Boolean(reconciliation?.checked),
          paid: Boolean(reconciliation?.paid || payment.status === "paid"),
          skipped: Boolean(reconciliation?.skipped),
          reason: reconciliation?.reason || "",
          payment: safePublicPayment(payment, order),
        };
      });
      if (!result) return res.status(404).json({ error: "Payment/order tidak ditemukan" });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

}
