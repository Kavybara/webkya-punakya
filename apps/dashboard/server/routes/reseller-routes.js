import crypto from "node:crypto";

export function registerResellerRoutes(app, deps) {
  const {
    authReseller,
    createDepositTopupOrder,
    createPakasirQris,
    defaultResellerAccessTools,
    depositRequestMethodLabel,
    depositRequestNotificationText,
    enableMaintenanceMode,
    findDuplicateReseller,
    formatRupiah,
    hashPassword,
    makeId,
    normalizeResellerAccessTools,
    normalizeResellerInput,
    normalizeResellerSelfInput,
    normalizeWhatsappNumber,
    notifyResellerProfileChanged,
    nowText,
    ownerIntegrationSettings,
    ownerProfile,
    ownerWhatsappTarget,
    publicUser,
    readDb,
    requireAuth,
    resellerAccessTools,
    safePublicPayment,
    safeResellerForSelf,
    sendResellerWelcomeWhatsApp,
    sendWhatsAppMessage,
    syncDataResellerToGoogleSheetsSafely,
    throwDuplicateResellerError,
    todayText,
    updateDb,
  } = deps;

  app.get("/api/resellers", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDb();
    if (req.auth.role === "reseller") {
      res.json((db.resellers || []).filter((item) => item.id === req.auth.sub).map(safeResellerForSelf));
      return;
    }
    res.json((db.resellers || []).map((item) => ({ ...publicUser(item), allowedAccessTools: resellerAccessTools(item) })));
  });

  app.post("/api/resellers", requireAuth(["owner"]), async (req, res) => {
    const temporaryPassword = String(req.body.password || "").trim() || crypto.randomBytes(9).toString("base64url");
    const created = await updateDb((db) => {
      const input = normalizeResellerInput({ ...req.body, password: temporaryPassword }, { joinedAt: todayText() });
      const duplicate = findDuplicateReseller(db, input);
      if (duplicate) throwDuplicateResellerError(duplicate);
      const reseller = {
        id: makeId("res"),
        ...input,
        passwordHash: hashPassword(temporaryPassword),
        allowedAccessTools: normalizeResellerAccessTools(input.allowedAccessTools, defaultResellerAccessTools),
      };
      delete reseller.password;
      db.resellers.unshift(reseller);
      return reseller;
    });
    const dbForSend = await readDb();
    await updateDb(async (db) => {
      await syncDataResellerToGoogleSheetsSafely(db, created.id);
      return null;
    });
    const delivery = await sendResellerWelcomeWhatsApp(dbForSend, { ...created, password: temporaryPassword });
    const notificationStatus = delivery.sent ? "sent" : "failed";
    const notificationAt = nowText();
    await updateDb((db) => {
      const reseller = (db.resellers || []).find((item) => item.id === created.id);
      if (reseller) {
        reseller.whatsappWelcomeStatus = notificationStatus;
        reseller.whatsappWelcomeSentAt = delivery.sent ? notificationAt : "";
        reseller.whatsappWelcomeError = delivery.sent ? "" : delivery.reason || "whatsapp_send_failed";
        reseller.whatsappWelcomeMessageKey = delivery.messageKey || null;
      }
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "reseller",
        title: delivery.sent ? "Notif reseller terkirim" : "Notif reseller gagal",
        description: delivery.sent
          ? `Akun reseller ${created.name} dibuat dan detail login dikirim ke WhatsApp ${normalizeWhatsappNumber(created.whatsapp)}.`
          : `Akun reseller ${created.name} dibuat, tapi notif WhatsApp gagal: ${delivery.reason || "whatsapp_send_failed"}.`,
        resellerId: created.id,
        whatsapp: normalizeWhatsappNumber(created.whatsapp),
        createdAt: notificationAt,
      });
      return null;
    });
    res.status(201).json({
      ...publicUser(created),
      whatsappWelcomeStatus: notificationStatus,
      whatsappWelcomeSentAt: delivery.sent ? notificationAt : "",
      whatsappWelcomeError: delivery.sent ? "" : delivery.reason || "whatsapp_send_failed",
      whatsappWelcomeMessageKey: delivery.messageKey || null,
    });
  });

  app.put("/api/resellers/:id", requireAuth(["owner", "reseller"]), async (req, res) => {
    if (req.auth.role === "reseller" && req.auth.sub !== req.params.id) {
      res.status(403).json({ error: "Tidak boleh mengubah reseller lain" });
      return;
    }
    const updated = await updateDb(async (db) => {
      const index = db.resellers.findIndex((item) => item.id === req.params.id);
      if (index === -1) return null;
      const current = db.resellers[index];
      const before = { ...current };
      const requestedUsername = String(req.body.username ?? current.username ?? "").trim().toLowerCase().replace(/\s+/g, ".");
      const currentUsername = String(current.username || "").trim().toLowerCase().replace(/\s+/g, ".");
      if (requestedUsername && currentUsername && requestedUsername !== currentUsername) {
        const error = new Error("Username reseller menjadi kunci Google Sheets dan tidak dapat diubah langsung. Buat migrasi username terpisah agar transaksi lama tetap terhubung.");
        error.status = 409;
        throw error;
      }
      const requestedPassword = req.auth.role === "owner" ? String(req.body.password || "").trim() : "";
      const input = req.auth.role === "reseller" ? normalizeResellerSelfInput(req.body, current) : normalizeResellerInput(req.body, current);
      const duplicate = findDuplicateReseller(db, input, current.id);
      if (duplicate) throwDuplicateResellerError(duplicate);
      const previousDeposit = Number(current.deposit || 0);
      const reseller = {
        ...current,
        ...input,
        id: current.id,
        passwordHash: requestedPassword
          ? hashPassword(requestedPassword)
          : current.passwordHash || (current.password ? hashPassword(current.password) : ""),
        allowedAccessTools: normalizeResellerAccessTools(input.allowedAccessTools, current.allowedAccessTools),
      };
      delete reseller.password;
      db.resellers[index] = reseller;
      const nextDeposit = Number(reseller.deposit || 0);
      if (req.auth.role === "owner" && previousDeposit !== nextDeposit) {
        const delta = nextDeposit - previousDeposit;
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "reseller",
          title: delta >= 0 ? "Deposit reseller ditambah" : "Deposit reseller dikurangi",
          description: `${formatRupiah(Math.abs(delta))} ${delta >= 0 ? "ditambahkan ke" : "dikurangi dari"} ${reseller.name || reseller.username || reseller.whatsapp}. Saldo: ${formatRupiah(previousDeposit)} -> ${formatRupiah(nextDeposit)}.`,
          resellerId: reseller.id,
          whatsapp: normalizeWhatsappNumber(reseller.whatsapp || ""),
          createdAt: nowText(),
        });
      }
      await notifyResellerProfileChanged(
        db,
        { ...before, password: "" },
        { ...reseller, password: requestedPassword },
        req.auth.role === "reseller" ? "self" : "owner",
      );
      return reseller;
    });
    if (!updated) return res.status(404).json({ error: "Reseller tidak ditemukan" });
    await updateDb(async (db) => {
      await syncDataResellerToGoogleSheetsSafely(db, updated.id);
      return null;
    });
    res.json(req.auth.role === "reseller" ? safeResellerForSelf(updated) : publicUser(updated));
  });

  app.delete("/api/resellers/:id", requireAuth(["owner"]), async (req, res) => {
    await updateDb((db) => {
      db.resellers = db.resellers.filter((item) => item.id !== req.params.id);
    });
    res.json({ ok: true });
  });

  app.post("/api/resellers/deposit-request", requireAuth(["reseller"]), async (req, res) => {
    const amount = Math.max(0, Number(req.body?.amount || 0));
    const method = String(req.body?.method || "").trim().toLowerCase();
    const note = String(req.body?.note || "").trim();
    if (!amount) {
      res.status(400).json({ error: "Nominal deposit wajib diisi" });
      return;
    }
    const allowedMethods = new Set(["qris_auto", "qris", "qris_owner", "dana", "livin", "bca", "gopay", "shopeepay"]);
    if (!allowedMethods.has(method)) {
      res.status(400).json({ error: "Metode deposit tidak valid" });
      return;
    }

    const db = await readDb();
    const reseller = authReseller(db, req.auth);
    if (!reseller || reseller.isActive === false) {
      res.status(404).json({ error: "Reseller tidak ditemukan atau nonaktif" });
      return;
    }

    const settings = ownerIntegrationSettings(db);
    const pakasirConnected = settings.status.pakasir === "connected";
    if (method === "qris_auto" && !pakasirConnected) {
      res.status(409).json({
        error: "QRIS otomatis tidak tersedia karena Pakasir sedang disconnected. Silakan pilih QRIS owner manual atau metode bank seperti DANA, Livin, BCA, GoPay, atau ShopeePay.",
      });
      return;
    }

    if (method === "qris_auto") {
      const result = await updateDb(async (draft) => {
        draft.activities = draft.activities || [];
        draft.depositRequests = draft.depositRequests || [];
        draft.orders = draft.orders || [];
        draft.payments = draft.payments || [];

        const currentReseller = authReseller(draft, req.auth);
        if (!currentReseller || currentReseller.isActive === false) {
          const error = new Error("Reseller tidak ditemukan atau nonaktif");
          error.status = 404;
          throw error;
        }

        const { order, payment, ttlMinutes } = createDepositTopupOrder(draft, {
          reseller: currentReseller,
          amount,
          source: "reseller_panel_deposit",
          channel: "Reseller Panel",
          whatsapp: normalizeWhatsappNumber(currentReseller.whatsapp || ""),
        });
        const requestId = order.id;
        const createdAt = order.createdAt || nowText();

        const pakasir = await createPakasirQris(draft, order);
        if (pakasir.providerStatus !== "created") {
          enableMaintenanceMode(draft, `Pakasir QRIS gagal: ${pakasir.providerError || pakasir.providerStatus || "unknown_error"}`, "pakasir");
          const error = new Error(`Pakasir QRIS gagal untuk deposit reseller: ${pakasir.providerError || pakasir.providerStatus || "unknown_error"}`);
          error.status = 503;
          error.maintenance = { reason: `Pakasir QRIS gagal: ${pakasir.providerError || pakasir.providerStatus || "unknown_error"}`, source: "pakasir" };
          throw error;
        }

        Object.assign(payment, pakasir);
        order.qrisUrl = payment.paymentUrl || order.qrisUrl || "";
        order.paymentProviderStatus = pakasir.providerStatus || "";
        order.paymentMethod = payment.paymentMethod || order.paymentMethod || "QRIS top up saldo";
        order.paymentFee = Number(payment.fee || order.paymentFee || 0);
        order.totalPaid = Number(payment.totalPayment || payment.amount || order.paymentDue || 0);
        if (pakasir.providerError) order.paymentError = pakasir.providerError;

        const ownerWhatsapp = ownerWhatsappTarget(draft);
        const delivery = ownerWhatsapp
          ? await sendWhatsAppMessage(draft, {
              to: ownerWhatsapp,
              text: depositRequestNotificationText({
                reseller: currentReseller,
                amount,
                method,
                note: note ? `${note}\nRef QRIS: ${payment.ref}` : `Ref QRIS: ${payment.ref}`,
                requestId,
                createdAt,
              }),
            })
          : { sent: false, reason: "owner_whatsapp_missing" };

        draft.depositRequests.unshift({
          id: requestId,
          resellerId: currentReseller.id,
          resellerName: currentReseller.name || currentReseller.username || "",
          whatsapp: normalizeWhatsappNumber(currentReseller.whatsapp || ""),
          amount,
          method,
          note,
          createdAt,
          status: "pending_payment",
          paymentStatus: "pending",
          orderId: order.id,
          paymentRef: payment.ref,
          deliveryStatus: delivery.sent ? "sent" : delivery.reason || "failed",
          deliveryMessageKey: delivery.messageKey || null,
        });
        draft.activities.unshift({
          id: makeId("act"),
          type: "reseller",
          title: delivery.sent ? "QRIS deposit reseller dibuat" : "QRIS deposit reseller dibuat tanpa notif owner",
          description: delivery.sent
            ? `${currentReseller.name || currentReseller.username || "Reseller"} membuat QRIS deposit ${formatRupiah(amount)}. Ref ${payment.ref}.`
            : `${currentReseller.name || currentReseller.username || "Reseller"} membuat QRIS deposit ${formatRupiah(amount)}. Notif owner gagal: ${delivery.reason || "unknown_error"}.`,
          resellerId: currentReseller.id,
          whatsapp: normalizeWhatsappNumber(currentReseller.whatsapp || ""),
          amount,
          orderId: order.id,
          createdAt,
        });

        return {
          requestId,
          orderId: order.id,
          paymentRef: payment.ref,
          payment: safePublicPayment(payment, order),
          ttlMinutes,
          deliveryStatus: delivery.sent ? "sent" : delivery.reason || "failed",
        };
      });

      res.status(201).json({
        ok: true,
        requestId: result.requestId,
        orderId: result.orderId,
        paymentRef: result.paymentRef,
        payment: result.payment,
        ttlMinutes: result.ttlMinutes,
        deliveryStatus: result.deliveryStatus,
        message: "QRIS deposit berhasil dibuat. Setelah pembayaran sukses, saldo reseller akan bertambah otomatis.",
      });
      return;
    }

    const requestId = makeId("DEP").toUpperCase();
    const createdAt = nowText();
    const ownerWhatsapp = ownerWhatsappTarget(db);
    const delivery = ownerWhatsapp
      ? await sendWhatsAppMessage(db, {
          to: ownerWhatsapp,
          text: depositRequestNotificationText({ reseller, amount, method, note, requestId, createdAt }),
        })
      : { sent: false, reason: "owner_whatsapp_missing" };

    await updateDb((draft) => {
      draft.depositRequests = draft.depositRequests || [];
      draft.depositRequests.unshift({
        id: requestId,
        resellerId: reseller.id,
        resellerName: reseller.name || reseller.username || "",
        whatsapp: normalizeWhatsappNumber(reseller.whatsapp || ""),
        amount,
        method,
        note,
        createdAt,
        status: "pending",
        deliveryStatus: delivery.sent ? "sent" : delivery.reason || "failed",
        deliveryMessageKey: delivery.messageKey || null,
      });
      draft.activities = draft.activities || [];
      draft.activities.unshift({
        id: makeId("act"),
        type: "reseller",
        title: delivery.sent ? "Permintaan deposit terkirim" : "Permintaan deposit tercatat",
        description: delivery.sent
          ? `${reseller.name || reseller.username || "Reseller"} meminta deposit ${formatRupiah(amount)} via ${depositRequestMethodLabel(method)}. Notif owner berhasil dikirim.`
          : `${reseller.name || reseller.username || "Reseller"} meminta deposit ${formatRupiah(amount)} via ${depositRequestMethodLabel(method)}, tetapi notif owner gagal: ${delivery.reason || "unknown_error"}.`,
        resellerId: reseller.id,
        whatsapp: normalizeWhatsappNumber(reseller.whatsapp || ""),
        amount,
        createdAt,
      });
      return null;
    });

    res.status(201).json({
      ok: true,
      requestId,
      deliveryStatus: delivery.sent ? "sent" : delivery.reason || "failed",
      message: delivery.sent
        ? "Permintaan deposit berhasil dikirim ke owner."
        : "Permintaan deposit tersimpan, tetapi notif owner gagal dikirim.",
    });
  });

  app.get("/api/resellers/deposit-requests", requireAuth(["owner"]), async (req, res) => {
    const db = await readDb();
    res.json((Array.isArray(db.depositRequests) ? db.depositRequests : []).filter((item) => !item.archivedAt));
  });

  app.post("/api/resellers/deposit-requests/archive", requireAuth(["owner"]), async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) {
      res.status(400).json({ error: "Pilih minimal satu permintaan deposit" });
      return;
    }
    const archivedAt = nowText();
    const result = await updateDb((draft) => {
      draft.depositRequests = draft.depositRequests || [];
      const matched = draft.depositRequests.filter((item) => ids.includes(String(item.id || "")) && !item.archivedAt);
      const pending = matched.filter((item) => ["", "pending", "pending_payment"].includes(String(item.status || "pending").toLowerCase()));
      if (pending.length) {
        const error = new Error(`${pending.length} permintaan masih menunggu tindakan dan tidak dapat diarsipkan.`);
        error.status = 409;
        throw error;
      }
      for (const item of matched) item.archivedAt = archivedAt;
      return { archived: matched.length, ids: matched.map((item) => item.id) };
    });
    res.json({ ok: true, ...result });
  });

  app.post("/api/resellers/deposit-requests/:id/approve", requireAuth(["owner"]), async (req, res) => {
    const note = String(req.body?.note || "").trim();
    const db = await readDb();
    const profile = ownerProfile(db);
    const reviewedAt = nowText();
    const result = await updateDb((draft) => {
      draft.depositRequests = draft.depositRequests || [];
      const request = draft.depositRequests.find((item) => item.id === req.params.id);
      if (!request) return null;
      if (String(request.status || "pending").toLowerCase() === "approved") {
        const reseller = (draft.resellers || []).find((item) => item.id === request.resellerId) || null;
        return { request, reseller };
      }
      if (String(request.status || "pending").toLowerCase() === "rejected") {
        const error = new Error("Permintaan deposit ini sudah ditolak.");
        error.status = 409;
        throw error;
      }
      if (String(request.status || "").toLowerCase() === "pending_payment") {
        const error = new Error("Deposit ini memakai QRIS otomatis dan masih menunggu pembayaran. Approve manual tidak diperlukan.");
        error.status = 409;
        throw error;
      }

      const reseller = (draft.resellers || []).find((item) => item.id === request.resellerId);
      if (!reseller) {
        const error = new Error("Reseller untuk permintaan deposit ini tidak ditemukan.");
        error.status = 404;
        throw error;
      }

      const depositBefore = Math.max(0, Number(reseller.deposit || 0));
      const depositAfter = depositBefore + Math.max(0, Number(request.amount || 0));
      reseller.deposit = depositAfter;

      request.status = "approved";
      request.reviewedAt = reviewedAt;
      request.reviewedBy = profile.name || profile.username || "owner";
      request.reviewNote = note;

      draft.activities = draft.activities || [];
      draft.activities.unshift({
        id: makeId("act"),
        type: "reseller",
        title: "Deposit reseller dikreditkan",
        description: `${formatRupiah(Number(request.amount || 0))} dari request ${request.id} dimasukkan ke deposit ${reseller.name || reseller.username || reseller.whatsapp}. Saldo: ${formatRupiah(depositBefore)} -> ${formatRupiah(depositAfter)}.`,
        resellerId: reseller.id,
        whatsapp: normalizeWhatsappNumber(reseller.whatsapp || ""),
        amount: Number(request.amount || 0),
        createdAt: reviewedAt,
      });

      return { request, reseller };
    });

    if (!result) {
      res.status(404).json({ error: "Permintaan deposit tidak ditemukan" });
      return;
    }

    res.json({ ok: true, ...result });
  });

  app.post("/api/resellers/deposit-requests/:id/reject", requireAuth(["owner"]), async (req, res) => {
    const note = String(req.body?.note || "").trim();
    const db = await readDb();
    const profile = ownerProfile(db);
    const reviewedAt = nowText();
    const request = await updateDb((draft) => {
      draft.depositRequests = draft.depositRequests || [];
      const current = draft.depositRequests.find((item) => item.id === req.params.id);
      if (!current) return null;
      if (String(current.status || "pending").toLowerCase() === "approved") {
        const error = new Error("Permintaan deposit ini sudah diapprove.");
        error.status = 409;
        throw error;
      }

      current.status = "rejected";
      current.reviewedAt = reviewedAt;
      current.reviewedBy = profile.name || profile.username || "owner";
      current.reviewNote = note;

      draft.activities = draft.activities || [];
      draft.activities.unshift({
        id: makeId("act"),
        type: "reseller",
        title: "Permintaan deposit ditolak",
        description: `${current.resellerName || current.whatsapp || "Reseller"} ditolak untuk request ${current.id} sebesar ${formatRupiah(Number(current.amount || 0))}${note ? `. Catatan: ${note}` : "."}`,
        resellerId: current.resellerId,
        whatsapp: normalizeWhatsappNumber(current.whatsapp || ""),
        amount: Number(current.amount || 0),
        createdAt: reviewedAt,
      });

      return current;
    });

    if (!request) {
      res.status(404).json({ error: "Permintaan deposit tidak ditemukan" });
      return;
    }

    res.json({ ok: true, request });
  });
}
