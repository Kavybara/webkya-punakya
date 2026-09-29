export function registerWarrantyRoutes(app, deps) {
  const {
    buildWarrantyOwnerNotification,
    buildWarrantyReplacementNotifications,
    buildWarrantyStatusNotification,
    createWarrantyClaim,
    decodeWarrantyEvidence,
    makeId,
    markWarrantyReplacementSync,
    nowText,
    primaryResellerWhatsapp,
    readWarrantyEvidence,
    readDbSnapshot,
    removeWarrantyEvidence,
    refreshOrderDeliveryTemplateSnapshot,
    replacementCandidatesForClaim,
    replaceWarrantyAccount,
    replaceWarrantyAccountManually,
    requireAuth,
    saveWarrantyEvidence,
    sendWhatsAppMessage,
    syncAccountReplacementToGoogleSheets,
    syncWarrantyStockReviewToGoogleSheets,
    syncSheetsForProductOrThrow,
    updateDb,
    updateWarrantyClaim,
    validateWarrantyReplacementState,
    warrantyClaimsForAuth,
    warrantyManualClaimOptions,
    warrantyWhatsAppNumber,
  } = deps;
  const replacementFlights = new Map();

  const publicDomain = (db = {}) => String(
    db.settings?.publicDomain || process.env.PUBLIC_DOMAIN || "https://www.vya.baby",
  ).replace(/\/$/, "");

  async function recordNotification(claimId, patch = {}) {
    if (!updateDb) return;
    await updateDb((db) => {
      const claim = (db.warrantyClaims || []).find((item) => item.id === claimId);
      if (claim) Object.assign(claim, patch, { updatedAt: nowText() });
    });
  }

  app.get("/api/warranty-claims", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    res.json(warrantyClaimsForAuth(db, req.auth));
  });

  app.get("/api/warranty-claims/manual-options", requireAuth(["owner"]), async (_req, res) => {
    const db = await readDbSnapshot();
    res.json(warrantyManualClaimOptions(db, nowText));
  });

  app.post("/api/warranty-claims", requireAuth(["owner", "reseller"]), async (req, res) => {
    const ownerManual = req.auth?.role === "owner";
    if (!ownerManual && !req.body?.evidence) {
      const error = new Error("Screenshot bukti wajib dilampirkan bersama klaim");
      error.status = 400;
      error.code = "warranty_evidence_required";
      throw error;
    }
    const decodedEvidence = req.body?.evidence
      ? decodeWarrantyEvidence(req.body.evidence)
      : null;
    let savedEvidence = null;
    let result;
    try {
      result = await updateDb(async (db) => {
        const claim = createWarrantyClaim(db, {
          auth: req.auth,
          accountId: req.body?.accountId,
          issue: req.body?.issue,
          submissionSource: ownerManual ? "owner_manual_whatsapp" : "reseller_dashboard",
          now: nowText,
          makeId,
        });
        if (decodedEvidence) {
          savedEvidence = await saveWarrantyEvidence(decodedEvidence, {
            claimId: claim.id,
            evidenceId: makeId("evd"),
            createdAt: nowText(),
          });
          claim.evidence = [savedEvidence];
        }
        return {
          claim,
          ownerNumber: warrantyWhatsAppNumber(db),
        };
      });
    } catch (error) {
      if (savedEvidence) await removeWarrantyEvidence(savedEvidence).catch(() => undefined);
      throw error;
    }

    if (result.claim.stockReviewSyncStatus === "pending") {
      const reviewDb = await readDbSnapshot();
      let reviewSync;
      try {
        reviewSync = await syncWarrantyStockReviewToGoogleSheets(reviewDb, {
          stockIds: result.claim.stockReviewStockIds || [],
        });
      } catch (error) {
        reviewSync = { ok: false, reason: String(error?.code || "warranty_review_sheet_sync_failed") };
      }
      await updateDb((db) => {
        const claim = (db.warrantyClaims || []).find((item) => item.id === result.claim.id);
        if (!claim) return;
        claim.stockReviewSyncStatus = reviewSync.ok ? "synced" : "failed";
        claim.stockReviewSyncError = reviewSync.ok
          ? ""
          : String(reviewSync.reason || "warranty_review_sheet_sync_failed").slice(0, 200);
        claim.stockReviewSyncUpdatedAt = nowText();
        for (const stockId of claim.stockReviewStockIds || []) {
          const stock = (db.stock || []).find((item) => item.id === stockId);
          if (!stock) continue;
          stock.warrantyReviewBlocked = !reviewSync.ok;
          if (reviewSync.ok) stock.googleSheetsSyncedAt = reviewSync.syncedAt || nowText();
        }
      });
    }

    const notificationDb = await readDbSnapshot();
    const finalClaim = (notificationDb.warrantyClaims || []).find((item) => item.id === result.claim.id) || result.claim;

    if (ownerManual) {
      await recordNotification(finalClaim.id, {
        ownerNotificationStatus: "not_required",
        ownerNotificationAt: nowText(),
        ownerNotificationError: "",
      });
      return res.status(201).json({
        ...finalClaim,
        ownerNotificationStatus: "not_required",
      });
    }

    const delivery = await sendWhatsAppMessage(notificationDb, {
      to: result.ownerNumber,
      text: buildWarrantyOwnerNotification(notificationDb, finalClaim, {
        ownerUrl: `${publicDomain(notificationDb)}/owner-v2/warranty`,
      }),
    });
    await recordNotification(finalClaim.id, {
      ownerNotificationStatus: delivery.sent ? "sent" : "failed",
      ownerNotificationAt: nowText(),
      ownerNotificationError: delivery.sent ? "" : String(delivery.reason || "whatsapp_delivery_failed"),
    });
    res.status(201).json({
      ...finalClaim,
      ownerNotificationStatus: delivery.sent ? "sent" : "failed",
    });
  });

  app.get("/api/warranty-claims/:id/evidence/:evidenceId", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    const claim = (db.warrantyClaims || []).find((item) => item.id === req.params.id);
    if (!claim || (req.auth.role === "reseller" && claim.resellerId !== req.auth.sub)) {
      return res.status(404).json({ error: "Bukti klaim tidak ditemukan" });
    }
    const evidence = (claim.evidence || []).find((item) => item.id === req.params.evidenceId);
    if (!evidence) return res.status(404).json({ error: "Bukti klaim tidak ditemukan" });
    const buffer = await readWarrantyEvidence(evidence);
    res.setHeader("Content-Type", evidence.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${String(evidence.originalName || "bukti").replace(/["\r\n]/g, "")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  });

  app.patch("/api/warranty-claims/:id", requireAuth(["owner"]), async (req, res) => {
    const result = await updateDb((db) => {
      const current = (db.warrantyClaims || []).find((item) => item.id === req.params.id) || null;
      const requestedStatus = String(req.body?.status || current?.status || "").trim().toLowerCase();
      const normalizedStatus = requestedStatus === "waiting_evidence" ? "reviewing" : requestedStatus;
      const currentStatus = String(current?.status || "").trim().toLowerCase() === "waiting_evidence"
        ? "reviewing"
        : String(current?.status || "").trim().toLowerCase();
      const requestedNote = String(req.body?.ownerNote ?? "").trim().slice(0, 1000);
      const currentNote = String(current?.ownerNote || "").trim().slice(0, 1000);
      if (current && normalizedStatus === currentStatus && requestedNote === currentNote) {
        return { claim: current, idempotent: true };
      }
      const claim = updateWarrantyClaim(db, {
        claimId: req.params.id,
        status: req.body?.status,
        ownerNote: req.body?.ownerNote,
        actorId: req.auth?.sub || "owner",
        now: nowText,
        makeId,
      });
      const reseller = (db.resellers || []).find((item) => item.id === claim.resellerId) || null;
      return {
        claim,
        idempotent: false,
        resellerNumber: primaryResellerWhatsapp(reseller || {}),
        message: buildWarrantyStatusNotification(db, claim),
      };
    });
    if (result.idempotent) {
      return res.json({
        ...result.claim,
        idempotent: true,
      });
    }
    const delivery = await sendWhatsAppMessage(await readDbSnapshot(), {
      to: result.resellerNumber,
      text: result.message,
    });
    await recordNotification(result.claim.id, {
      statusNotificationStatus: delivery.sent ? "sent" : "failed",
      statusNotificationAt: nowText(),
      statusNotificationError: delivery.sent ? "" : String(delivery.reason || "whatsapp_delivery_failed"),
    });
    res.json({
      ...result.claim,
      idempotent: false,
      statusNotificationStatus: delivery.sent ? "sent" : "failed",
    });
  });

  app.post("/api/warranty-claims/:id/retry-stock-review-sync", requireAuth(["owner"]), async (req, res) => {
    const db = await readDbSnapshot();
    const claim = (db.warrantyClaims || []).find((item) => item.id === req.params.id);
    if (!claim || !claim.stockReviewTriggered || !(claim.stockReviewStockIds || []).length) {
      return res.status(404).json({ error: "Pemeriksaan stok garansi tidak ditemukan" });
    }
    let reviewSync;
    try {
      reviewSync = await syncWarrantyStockReviewToGoogleSheets(db, {
        stockIds: claim.stockReviewStockIds,
      });
    } catch (error) {
      reviewSync = { ok: false, reason: String(error?.code || "warranty_review_sheet_sync_failed") };
    }
    const updated = await updateDb((currentDb) => {
      const currentClaim = (currentDb.warrantyClaims || []).find((item) => item.id === req.params.id);
      if (!currentClaim) return null;
      currentClaim.stockReviewSyncStatus = reviewSync.ok ? "synced" : "failed";
      currentClaim.stockReviewSyncError = reviewSync.ok
        ? ""
        : String(reviewSync.reason || "warranty_review_sheet_sync_failed").slice(0, 200);
      currentClaim.stockReviewSyncUpdatedAt = nowText();
      for (const stockId of currentClaim.stockReviewStockIds || []) {
        const stock = (currentDb.stock || []).find((item) => item.id === stockId);
        if (!stock) continue;
        stock.warrantyReviewBlocked = !reviewSync.ok;
        if (reviewSync.ok) stock.googleSheetsSyncedAt = reviewSync.syncedAt || nowText();
      }
      return currentClaim;
    });
    if (!reviewSync.ok) {
      return res.status(409).json({
        error: "Kondisi stok tetap dikunci, tetapi sinkronisasi Google Sheets belum berhasil",
        code: reviewSync.reason || "warranty_review_sheet_sync_failed",
      });
    }
    res.json(updated);
  });

  app.get("/api/warranty-claims/:id/replacement-candidates", requireAuth(["owner"]), async (req, res) => {
    const db = await readDbSnapshot();
    res.json(replacementCandidatesForClaim(db, req.params.id));
  });

  async function deliverReplacementNotifications(claimId) {
    const db = await readDbSnapshot();
    validateWarrantyReplacementState(db, claimId);
    const claim = (db.warrantyClaims || []).find((item) => item.id === claimId);
    if (!claim || String(claim.status || "").toLowerCase() !== "replaced") {
      const error = new Error("Akun garansi belum selesai diganti");
      error.status = 409;
      error.code = "warranty_replacement_not_ready";
      throw error;
    }
    const oldAccount = (db.managedAccounts || []).find((item) => item.id === claim.replacement?.oldAccountId);
    const newAccount = (db.managedAccounts || []).find((item) => item.id === claim.replacement?.newAccountId);
    const order = [...(db.orders || []), ...(db.manualOrders || [])].find((item) => item.id === claim.orderId);
    const reseller = (db.resellers || []).find((item) => item.id === claim.resellerId) || null;
    const replacement = { claim, oldAccount, newAccount, order };
    const messages = buildWarrantyReplacementNotifications(db, replacement, {
      accountUrl: `${publicDomain(db)}/reseller-v2/accounts`,
    });
    const recipientNumber = oldAccount?.whatsapp
      || order?.whatsapp
      || newAccount?.whatsapp
      || primaryResellerWhatsapp(reseller || {})
      || "";
    const recipientDelivery = claim.replacementNotificationStatus === "sent"
      ? { sent: true, skipped: true }
      : await sendWhatsAppMessage(db, { to: recipientNumber, text: messages.reseller });
    const ownerDelivery = claim.ownerReplacementNotificationStatus === "sent"
      ? { sent: true, skipped: true }
      : await sendWhatsAppMessage(db, { to: warrantyWhatsAppNumber(db), text: messages.owner });

    await recordNotification(claim.id, {
      replacementNotificationStatus: recipientDelivery.sent ? "sent" : "failed",
      replacementNotificationAt: nowText(),
      replacementNotificationError: recipientDelivery.sent ? "" : String(recipientDelivery.reason || "whatsapp_delivery_failed"),
      ownerReplacementNotificationStatus: ownerDelivery.sent ? "sent" : "failed",
      ownerReplacementNotificationAt: nowText(),
      ownerReplacementNotificationError: ownerDelivery.sent ? "" : String(ownerDelivery.reason || "whatsapp_delivery_failed"),
    });
    const updatedDb = await readDbSnapshot();
    const updatedClaim = (updatedDb.warrantyClaims || []).find((item) => item.id === claim.id) || claim;
    return {
      claim: updatedClaim,
      notifications: {
        recipient: {
          status: recipientDelivery.sent ? "sent" : "failed",
          reason: recipientDelivery.sent ? "" : String(recipientDelivery.reason || "whatsapp_delivery_failed"),
        },
        owner: {
          status: ownerDelivery.sent ? "sent" : "failed",
          reason: ownerDelivery.sent ? "" : String(ownerDelivery.reason || "whatsapp_delivery_failed"),
        },
      },
    };
  }

  app.post("/api/warranty-claims/:id/retry-notification", requireAuth(["owner"]), async (req, res) => {
    res.json(await deliverReplacementNotifications(req.params.id));
  });

  async function executeReplacement(req, mode = "stock") {
    const operation = await updateDb(async (db) => {
      const pendingClaim = (db.warrantyClaims || []).find((item) => item.id === req.params.id);
      if (mode === "stock" && pendingClaim && String(pendingClaim.status || "").toLowerCase() !== "replaced") {
        const currentAccount = (db.managedAccounts || []).find((item) => item.id === pendingClaim.accountId);
        const product = (db.products || []).find((item) => item.id === currentAccount?.productId);
        const sheetBacked = Boolean(
          currentAccount?.sheetSource === "google_sheets"
          || currentAccount?.sheetStockKey
          || currentAccount?.sheetName,
        );
        if (product && sheetBacked) {
          await syncSheetsForProductOrThrow(db, product, "warranty_replacement_precheck", { force: true });
        }
      }

      const replacement = mode === "manual"
        ? replaceWarrantyAccountManually(db, {
            claimId: req.params.id,
            account: req.body?.account || req.body || {},
            reason: req.body?.reason,
            actorId: req.auth?.sub || "owner",
            now: nowText,
            makeId,
          })
        : replaceWarrantyAccount(db, {
            claimId: req.params.id,
            stockId: req.body?.stockId,
            reason: req.body?.reason,
            actorId: req.auth?.sub || "owner",
            now: nowText,
            makeId,
          });
      if (!replacement.idempotent) {
        const product = (db.products || []).find((item) => item.id === replacement.newAccount.productId);
        const variant = product?.variants?.find((item) => item.id === replacement.newAccount.variantId);
        if (product && variant) {
          const renderedText = refreshOrderDeliveryTemplateSnapshot(db, {
            order: replacement.order,
            product,
            variant,
            accounts: [replacement.newAccount],
            force: true,
          });
          if (renderedText) replacement.order.fulfillmentText = renderedText;
        }
      }
      return {
        replacement,
        idempotent: replacement.idempotent,
        alreadySynced: replacement.claim.replacementSyncStatus === "synced",
      };
    });

    if (mode === "stock" && !operation.alreadySynced) {
      const db = await readDbSnapshot();
      const claim = (db.warrantyClaims || []).find((item) => item.id === req.params.id);
      const oldAccount = (db.managedAccounts || []).find((item) => item.id === claim?.replacement?.oldAccountId);
      const newAccount = (db.managedAccounts || []).find((item) => item.id === claim?.replacement?.newAccountId);
      const order = [...(db.orders || []), ...(db.manualOrders || [])].find((item) => item.id === claim?.orderId);
      let sheetSync;
      if (!claim || !oldAccount || !newAccount || !order) {
        sheetSync = { ok: false, reason: "replacement_recovery_relation_missing" };
      } else {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            sheetSync = await syncAccountReplacementToGoogleSheets(db, { oldAccount, newAccount, order });
          } catch (error) {
            sheetSync = { ok: false, reason: String(error?.code || "replacement_sheet_write_failed") };
          }
          if (sheetSync.ok) break;
        }
      }
      if (!sheetSync.ok) {
        await updateDb((currentDb) => markWarrantyReplacementSync(currentDb, {
          claimId: req.params.id,
          status: "failed",
          error: sheetSync.reason || "replacement_sheet_sync_failed",
          now: nowText,
        }));
        const ownerDelivery = await sendWhatsAppMessage(await readDbSnapshot(), {
          to: warrantyWhatsAppNumber(db),
          text: [
            "KAVYA - SINKRONISASI GARANSI PERLU DIPERIKSA",
            "",
            `Claim ID : ${claim?.id || req.params.id}`,
            `Order ID : ${claim?.orderId || "-"}`,
            `Status : ${sheetSync.reason || "replacement_sheet_sync_failed"}`,
            "",
            "Replacement sudah dikunci di database, tetapi Sheets belum terbarui. Buka Warranty Center lalu pilih Coba Sync Ulang.",
          ].join("\n"),
        });
        await recordNotification(req.params.id, {
          replacementSyncOwnerNotificationStatus: ownerDelivery.sent ? "sent" : "failed",
          replacementSyncOwnerNotificationAt: nowText(),
        });
        const error = new Error("Akun sudah dikunci sebagai pengganti, tetapi sinkronisasi Google Sheets belum selesai. Gunakan Coba Sync Ulang.");
        error.status = 409;
        error.code = sheetSync.reason || "replacement_sheet_sync_failed";
        throw error;
      }
      await updateDb((currentDb) => {
        const recoveryClaim = (currentDb.warrantyClaims || []).find((item) => item.id === req.params.id);
        const recoveryOrder = [...(currentDb.orders || []), ...(currentDb.manualOrders || [])]
          .find((item) => item.id === recoveryClaim?.orderId);
        const oldStockId = recoveryClaim?.replacement?.oldStockId || "";
        const newStockId = recoveryClaim?.replacement?.newStockId || "";
        if (recoveryOrder && newStockId) {
          recoveryOrder.deliveredStockIds = [...new Set([
            ...(recoveryOrder.deliveredStockIds || []).filter((id) => id !== oldStockId && id !== newStockId),
            newStockId,
          ])];
        }
        const recoveryOldStock = (currentDb.stock || []).find((item) => item.id === oldStockId);
        if (recoveryOldStock) {
          recoveryOldStock.status = "blocked";
          recoveryOldStock.accountCondition = "REPLACED";
          recoveryOldStock.accountConditionKnown = true;
          recoveryOldStock.accountConditionBlocked = true;
        }
        const recoveryNewStock = (currentDb.stock || []).find((item) => item.id === newStockId);
        if (recoveryNewStock) {
          recoveryNewStock.status = "sold";
          recoveryNewStock.sheetOrderId = recoveryOrder?.id || recoveryNewStock.sheetOrderId || "";
        }
        validateWarrantyReplacementState(currentDb, req.params.id);
        const syncedClaim = markWarrantyReplacementSync(currentDb, {
          claimId: req.params.id,
          status: "synced",
          now: nowText,
        });
        const currentOld = (currentDb.managedAccounts || []).find((item) => item.id === syncedClaim.replacement?.oldAccountId);
        const currentNew = (currentDb.managedAccounts || []).find((item) => item.id === syncedClaim.replacement?.newAccountId);
        if (currentOld) currentOld.googleSheetsSyncedAt = oldAccount?.googleSheetsSyncedAt || currentOld.googleSheetsSyncedAt || nowText();
        if (currentNew) currentNew.googleSheetsSyncedAt = newAccount?.googleSheetsSyncedAt || currentNew.googleSheetsSyncedAt || nowText();
      });
    }

    const delivery = await deliverReplacementNotifications(req.params.id);
    const claim = delivery.claim;
    const db = await readDbSnapshot();
    const newAccount = (db.managedAccounts || []).find((item) => item.id === claim?.replacement?.newAccountId);
    const order = [...(db.orders || []), ...(db.manualOrders || [])].find((item) => item.id === claim?.orderId);

    return {
      ok: true,
      idempotent: operation.idempotent,
      claim,
      notifications: delivery.notifications,
      account: {
        id: newAccount?.id || "",
        stockId: newAccount?.stockId || "",
        orderId: order?.id || "",
        product: newAccount?.product || "",
        variant: newAccount?.variant || "",
        expiresAt: newAccount?.expiresAt || "",
        status: newAccount?.status || "",
      },
    };
  }

  app.post("/api/warranty-claims/:id/replace", requireAuth(["owner"]), async (req, res) => {
    const claimId = req.params.id;
    let flight = replacementFlights.get(claimId);
    if (!flight) {
      flight = executeReplacement(req).finally(() => replacementFlights.delete(claimId));
      replacementFlights.set(claimId, flight);
    }
    res.json(await flight);
  });

  app.post("/api/warranty-claims/:id/replace-manual", requireAuth(["owner"]), async (req, res) => {
    const claimId = req.params.id;
    let flight = replacementFlights.get(claimId);
    if (!flight) {
      flight = executeReplacement(req, "manual").finally(() => replacementFlights.delete(claimId));
      replacementFlights.set(claimId, flight);
    }
    res.json(await flight);
  });
}
