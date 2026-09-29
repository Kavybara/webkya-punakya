import {
  addDaysToDateText,
  daysFromRentalDuration,
  rentalAdjustmentDays,
  rentalAdjustmentLabel,
} from "../services/whatsapp-rental-duration-service.js";
import { buildWhatsappListHistory } from "../services/whatsapp-list-history-service.js";

export function registerWhatsAppRoutes(app, deps) {
  const {
    applyWaPriceSync,
    assertInboundToken,
    buildDepositCreatedReply,
    buildOrderCreatedReply,
    cleanInviteLink,
    createPakasirQris,
    enableMaintenanceMode,
    expirationFromDays,
    extractInviteCode,
    findWaPriceSource,
    formatDateFromDays,
    getWhatsAppBotStatus,
    handleInboundMessage,
    joinGroupThroughBot,
    legacyRootDir,
    legacyTodayText,
    makeId,
    markRentalJoinedNotice,
    mergedWhatsappRentals,
    normalizeRentalPatch,
    normalizeRentalRuntimeDays,
    notifyOwnerRentalChanged,
    notifyOwnerRentalJoined,
    nowText,
    shouldEnablePakasirMaintenance,
    paymentTtlMinutes,
    previewWaPriceSync,
    pushFulfilledOrderToGoogleSheets,
    readActiveLegacyGroupLists,
    readLegacyGroupLists,
    readListUpdateAudit,
    readDb,
    readLegacyRentals,
    requireAuth,
    resolveRentalGroupJid,
    sendRentalJoinedNotifications,
    syncWhatsappGroups,
    todayText,
    updateDb,
    upsertLegacyRental,
  } = deps;

  app.get("/api/whatsapp/status", requireAuth(["owner"]), async (_req, res) => {
    const db = await readDb();
    res.json(await getWhatsAppBotStatus(db));
  });

  app.get("/api/whatsapp/rentals", requireAuth(["owner"]), async (_req, res) => {
    const db = await readDb();
    res.json(await mergedWhatsappRentals(db));
  });

  app.get("/api/whatsapp/rentals/:id/price-sync/preview", requireAuth(["owner"]), async (req, res, next) => {
    try {
      const db = await readDb();
      const rentals = await mergedWhatsappRentals(db);
      const rental = rentals.find((item) => item.id === req.params.id || item.groupJid === req.params.id);
      const groupJid = String(req.query.groupJid || rental?.groupJid || req.params.id || "").trim();
      const groupName = String(req.query.groupName || rental?.name || "").trim();
      const linkGrub = String(req.query.linkGrub || rental?.linkGrub || "").trim();
      const source = await findWaPriceSource(legacyRootDir, { groupJid, groupName, linkGrub });
      if (!source) {
        res.status(404).json({ error: `Pricelist harga tidak ditemukan di grup ini${groupName ? ` (${groupName})` : ""}` });
        return;
      }
      const preview = previewWaPriceSync(db, source.text);
      res.json({
        ok: true,
        source: {
          keyword: source.keyword,
          groupJid: source.groupJid,
          groupName: groupName || rental?.name || source.groupJid,
          filePath: source.filePath,
          score: source.score,
          entryCount: source.entryCount,
        },
        ...preview,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/whatsapp/rentals/:id/price-sync/apply", requireAuth(["owner"]), async (req, res, next) => {
    try {
      const currentDb = await readDb();
      const rentals = await mergedWhatsappRentals(currentDb);
      const rental = rentals.find((item) => item.id === req.params.id || item.groupJid === req.params.id);
      const groupJid = String(req.body.groupJid || rental?.groupJid || req.params.id || "").trim();
      const groupName = String(req.body.groupName || rental?.name || "").trim();
      const linkGrub = String(req.body.linkGrub || rental?.linkGrub || "").trim();
      const source = await findWaPriceSource(legacyRootDir, { groupJid, groupName, linkGrub });
      if (!source) {
        const error = new Error(`Pricelist harga tidak ditemukan di grup ini${groupName ? ` (${groupName})` : ""}`);
        error.status = 404;
        throw error;
      }
      const result = await updateDb((db) => {
        const preview = previewWaPriceSync(db, source.text);
        const updated = applyWaPriceSync(db, preview);
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "stock",
          title: "Harga produk disinkronkan dari grup WhatsApp",
          description: `${updated} harga produk diperbarui dari ${groupName || rental?.name || source.groupJid}.`,
          createdAt: nowText(),
        });
        return {
          ok: true,
          updated,
          source: {
            keyword: source.keyword,
            groupJid: source.groupJid,
            groupName: groupName || rental?.name || source.groupJid,
            filePath: source.filePath,
            score: source.score,
            entryCount: source.entryCount,
          },
          ...preview,
        };
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/whatsapp/group-lists", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      res.json(await readActiveLegacyGroupLists());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/whatsapp/rentals/:id/list-history", requireAuth(["owner"]), async (req, res, next) => {
    try {
      const db = await readDb();
      const rentals = await mergedWhatsappRentals(db, { includeExpired: true });
      const rental = rentals.find((item) => item.id === req.params.id || item.groupJid === req.params.id);
      const groupId = String(rental?.groupJid || rental?.id || req.params.id || "").trim();
      const groupLists = await readLegacyGroupLists();
      const auditEvents = await readListUpdateAudit();
      res.json(buildWhatsappListHistory({ rentals, groupLists, auditEvents, groupId }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/whatsapp/groups/sync", async (req, res, next) => {
    try {
      assertInboundToken(req, await readDb());
      const result = await updateDb((db) => syncWhatsappGroups(db, req.body.groups, req.body.source || "bot"));
      const joinedNotifications = await sendRentalJoinedNotifications(result.joinedRentals || []);
      res.json({ success: true, result: { ...result, joinedNotifications } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/whatsapp/rentals", requireAuth(["owner"]), async (req, res) => {
    const linkGrub = cleanInviteLink(req.body.linkGrub || req.body.link || "");
    const durationDays = daysFromRentalDuration({ months: req.body.durationMonths, days: req.body.durationDays });
    const daysLeft = Number(durationDays || req.body.daysLeft || req.body.days || 30);
    const startedAt = String(req.body.startedAt || todayText()).trim();
    const endsAt = addDaysToDateText(startedAt, daysLeft);
    const inviteCode = extractInviteCode(linkGrub);
    if (!inviteCode) return res.status(400).json({ error: "Link grup WhatsApp tidak valid" });
    if (!Number.isFinite(daysLeft) || daysLeft <= 0) return res.status(400).json({ error: "Sisa hari tidak valid" });

    const legacyRentals = await readLegacyRentals();
    const matchedEntry = Object.entries(legacyRentals).find(([, rental]) => cleanInviteLink(rental?.linkGrub) === linkGrub);
    const joinResult = matchedEntry ? { joinStatus: "joined", groupJid: matchedEntry[0], groupName: "" } : await joinGroupThroughBot(linkGrub);

    const created = await updateDb((db) => {
      const resolved = resolveRentalGroupJid(db, {
        id: req.body.id,
        groupJid: req.body.groupJid,
        joinGroupJid: joinResult.groupJid,
        matchedGroupJid: matchedEntry?.[0],
        name: req.body.name,
        groupName: joinResult.groupName,
        fallbackName: matchedEntry?.[0],
      });
      const id = String(resolved.groupJid || req.body.id || req.body.groupJid || joinResult.groupJid || matchedEntry?.[0] || `pending-${inviteCode}`).trim();
      const groupJid = resolved.groupJid || "";
      const effectiveJoinStatus = groupJid ? "joined" : joinResult.joinStatus;
      const effectiveJoinError = groupJid ? "" : joinResult.joinError || "";
      const rental = {
        id,
        groupJid: groupJid || (id.endsWith("@g.us") ? id : ""),
        ...normalizeRentalPatch(req.body, {
          name: resolved.directory?.name || req.body.name || joinResult.groupName || id,
          owner: "",
          contact: req.body.contact || joinResult.ownerNumber || resolved.directory?.contact || "",
          startedAt,
          endsAt,
          daysLeft,
          monthlyPrice: 0,
          status: "active",
          linkGrub,
        }),
        name: req.body.name || resolved.directory?.name || joinResult.groupName || matchedEntry?.[0] || `Menunggu join ${inviteCode}`,
        linkGrub,
        joinStatus: effectiveJoinStatus,
        joinError: effectiveJoinError,
      };
      const existingIndex = db.whatsappRentals.findIndex((item) => item.id === id);
      if (existingIndex >= 0) db.whatsappRentals[existingIndex] = rental;
      else db.whatsappRentals.unshift(rental);
      return rental;
    });
    await upsertLegacyRental(created.groupJid || created.id, {
      linkGrub,
      start: created.startedAt || legacyTodayText(),
      daysLeft: created.daysLeft,
      expired: expirationFromDays(created.daysLeft),
      status: created.status,
    });
    if (created.joinStatus === "joined") {
      const delivery = await notifyOwnerRentalJoined(await readDb(), {
        rental: created,
        addedDays: created.daysLeft,
        previousDays: 0,
        totalDays: created.daysLeft,
        source: "Dashboard",
      });
      await markRentalJoinedNotice(created, delivery);
    } else {
      await notifyOwnerRentalChanged(await readDb(), {
        rental: created,
        action: "created",
        addedDays: created.daysLeft,
        previousDays: 0,
        totalDays: created.daysLeft,
        newEndsAt: created.endsAt,
        adjustmentLabel: req.body.durationMonths ? `${req.body.durationMonths} bulan` : "",
        source: "Dashboard",
      });
    }
    res.status(201).json(created);
  });

  app.put("/api/whatsapp/rentals/:id", requireAuth(["owner"]), async (req, res) => {
    const legacyRows = await mergedWhatsappRentals(await readDb());
    const fallback = legacyRows.find((rental) => rental.id === req.params.id) || { id: req.params.id, name: req.params.id };
    let previousDays = Number(fallback.daysLeft || 0);
    const updated = await updateDb((db) => {
      const index = db.whatsappRentals.findIndex((rental) => rental.id === req.params.id);
      const current = index >= 0 ? db.whatsappRentals[index] : fallback;
      previousDays = Number(normalizeRentalRuntimeDays({ ...fallback, ...current }, fallback.daysLeft).daysLeft || 0);
      const resolved = resolveRentalGroupJid(db, {
        id: req.params.id,
        groupJid: req.body.groupJid,
        fallbackGroupJid: fallback.groupJid || current.groupJid,
        name: req.body.name,
        fallbackName: fallback.name || current.name,
      });
      const groupJid = resolved.groupJid || fallback.groupJid || current.groupJid || req.params.id;
      const rental = normalizeRentalRuntimeDays({
        ...fallback,
        ...current,
        ...normalizeRentalPatch(req.body, index >= 0 ? db.whatsappRentals[index] : fallback),
        id: req.params.id,
        groupJid,
        name: String(req.body.name || current.name || fallback.name || resolved.directory?.name || groupJid).trim(),
        contact: String(req.body.contact || current.contact || fallback.contact || resolved.directory?.contact || "").trim(),
        joinStatus: groupJid.endsWith("@g.us") ? "joined" : current.joinStatus || fallback.joinStatus || "pending",
        joinError: groupJid.endsWith("@g.us") ? "" : current.joinError || fallback.joinError || "",
      }, previousDays);
      if (index >= 0) db.whatsappRentals[index] = rental;
      else db.whatsappRentals.unshift(rental);
      return rental;
    });
    await upsertLegacyRental(updated.groupJid || updated.id, {
      linkGrub: updated.linkGrub,
      start: updated.startedAt,
      daysLeft: updated.daysLeft,
      expired: expirationFromDays(updated.status === "expired" ? 0 : updated.daysLeft),
      status: updated.status,
    });
    const totalDays = Number(updated.daysLeft || 0);
    if (totalDays !== previousDays) {
      await notifyOwnerRentalChanged(await readDb(), {
        rental: updated,
        action: totalDays < previousDays ? "reduced" : "added",
        addedDays: totalDays - previousDays,
        previousDays,
        totalDays,
        source: "Dashboard",
      });
    }
    res.json(updated);
  });

  app.post("/api/whatsapp/rentals/:id/adjust", requireAuth(["owner"]), async (req, res) => {
    const days = Number(req.body.days || rentalAdjustmentDays(req.body) || 0);
    if (!Number.isFinite(days) || days === 0) return res.status(400).json({ error: "Jumlah hari tidak valid" });
    const legacyRows = await mergedWhatsappRentals(await readDb());
    const fallback = legacyRows.find((rental) => rental.id === req.params.id) || { id: req.params.id, name: req.params.id, daysLeft: 0 };
    let previousDays = Number(fallback.daysLeft || 0);
    let previousEndsAt = String(fallback.endsAt || "");
    const updated = await updateDb((db) => {
      const index = db.whatsappRentals.findIndex((rental) => rental.id === req.params.id);
      const current = index >= 0 ? db.whatsappRentals[index] : fallback;
      previousDays = Number(normalizeRentalRuntimeDays({ ...fallback, ...current }, fallback.daysLeft).daysLeft || 0);
      previousEndsAt = String(current.endsAt || fallback.endsAt || "");
      const nextDaysLeft = Math.max(0, previousDays + days);
      const rental = {
        ...fallback,
        ...current,
        daysLeft: nextDaysLeft,
        endsAt: previousEndsAt ? addDaysToDateText(previousEndsAt, days) : formatDateFromDays(nextDaysLeft),
        status: String(current.status || fallback.status || "").toLowerCase() === "paused"
          ? "paused"
          : nextDaysLeft > 0
            ? "active"
            : "expired",
        id: req.params.id,
        groupJid: fallback.groupJid || req.params.id,
      };
      if (index >= 0) db.whatsappRentals[index] = rental;
      else db.whatsappRentals.unshift(rental);
      return rental;
    });
    await upsertLegacyRental(updated.groupJid || updated.id, {
      linkGrub: updated.linkGrub,
      start: updated.startedAt,
      daysLeft: updated.daysLeft,
      expired: expirationFromDays(updated.daysLeft),
      status: updated.status,
    });
    await notifyOwnerRentalChanged(await readDb(), {
      rental: updated,
      action: days < 0 ? "reduced" : "added",
      addedDays: days,
      previousDays,
      totalDays: updated.daysLeft,
      previousEndsAt,
      newEndsAt: updated.endsAt,
      adjustmentLabel: rentalAdjustmentLabel(req.body) || `${days > 0 ? "+" : "-"}${Math.abs(days)} hari`,
      source: "Dashboard",
    });
    res.json(updated);
  });

  app.post("/api/whatsapp/inbound", async (req, res, next) => {
    try {
      assertInboundToken(req, await readDb());
      const result = await updateDb(async (db) => {
        const inboundResult = await handleInboundMessage(db, req.body);
        if (inboundResult?.order?.deliveryStatus === "sent" && inboundResult.order.deliveredStockIds?.length) {
          await pushFulfilledOrderToGoogleSheets(db, { ok: true, order: inboundResult.order, reply: inboundResult.reply });
        }
        if (inboundResult?.order?.source === "whatsapp" && inboundResult.order.qrisStatus === "pending") {
          const payment = (db.payments || []).find((item) => item.ref === inboundResult.order.paymentRef || item.orderId === inboundResult.order.id);
          const dashboardPaymentUrl = inboundResult.order.qrisUrl;
          const pakasir = await createPakasirQris(db, inboundResult.order);
          if (pakasir.providerStatus !== "created") {
            const reason = `Pakasir QRIS gagal: ${pakasir.providerError || pakasir.providerStatus || "unknown_error"}`;
            if (shouldEnablePakasirMaintenance?.(reason)) enableMaintenanceMode(db, reason, "pakasir");
            const error = new Error(`Pakasir QRIS gagal untuk order WhatsApp: ${pakasir.providerError || pakasir.providerStatus || "unknown_error"}`);
            error.status = 503;
            if (shouldEnablePakasirMaintenance?.(reason)) error.maintenance = { reason, source: "pakasir" };
            throw error;
          }
          if (payment) {
            Object.assign(payment, pakasir);
            payment.paymentUrl = payment.paymentUrl || dashboardPaymentUrl;
          }
          inboundResult.order.qrisUrl = dashboardPaymentUrl || pakasir.paymentUrl || "";
          inboundResult.order.paymentProviderStatus = pakasir.providerStatus || "";
          if (pakasir.providerError) inboundResult.order.paymentError = pakasir.providerError;
          const replyOptions = {
            order: inboundResult.order,
            fee: pakasir.fee || payment?.fee || 0,
            totalPayment: pakasir.totalPayment || payment?.totalPayment || inboundResult.order.paymentDue,
            ttlMinutes: paymentTtlMinutes,
          };
          inboundResult.reply = inboundResult.order.type === "deposit_topup" || inboundResult.order.orderType === "deposit_topup"
            ? buildDepositCreatedReply(replyOptions)
            : buildOrderCreatedReply({
                ...replyOptions,
                productName: inboundResult.order.product,
                variantName: inboundResult.order.variant,
                qty: inboundResult.order.qty,
                price: Number(inboundResult.order.total || 0) / Math.max(1, Number(inboundResult.order.qty || 1)),
              });
          return {
            ...inboundResult,
            paymentUrl: inboundResult.order.qrisUrl,
            qrisText: pakasir.qrisText || pakasir.qrString || pakasir.paymentNumber || pakasir.paymentUrl || inboundResult.order.qrisUrl,
            qrText: pakasir.qrisText || pakasir.qrString || pakasir.paymentNumber || pakasir.paymentUrl || inboundResult.order.qrisUrl,
            qrImageUrl: pakasir.qrImageUrl || "",
            orderId: inboundResult.order.id,
            paymentRef: inboundResult.order.paymentRef,
            providerStatus: pakasir.providerStatus || "pending",
            providerError: pakasir.providerError || "",
          };
        }
        return inboundResult;
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/whatsapp/orders/:id/payment-message", async (req, res, next) => {
    try {
      assertInboundToken(req, await readDb());
      const saved = await updateDb((db) => {
        const order = (db.orders || []).find((item) => item.id === req.params.id || item.paymentRef === req.params.id);
        if (!order) return null;
        order.whatsappPaymentMessageKey = req.body.messageKey || req.body.message_key || null;
        order.whatsappPaymentMessageChatJid = String(req.body.chatJid || req.body.chat_jid || "").trim();
        order.whatsappPaymentMessageSavedAt = nowText();
        return order;
      });
      if (!saved) return res.status(404).json({ error: "Order tidak ditemukan" });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}
