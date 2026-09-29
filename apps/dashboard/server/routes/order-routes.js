import {
  checkoutValuesForOrder,
  validateCheckoutFieldValues,
} from "../services/checkout-fields-service.js";

export function finalizeSuccessfulSheetRepair(repair, sheetResult, repairedAt = "") {
  const sheetCommitFailed = Boolean(
    sheetResult?.ok === false
    || (sheetResult?.sheetCommitRequired && repair?.order?.googleSheetsSyncStatus !== "synced"),
  );
  if (sheetCommitFailed || !repair?.order) return sheetCommitFailed;

  repair.order.orderStatus = "completed";
  repair.order.deliveryStatus = "sent";
  repair.order.fulfilledAt = repair.order.fulfilledAt || repairedAt;
  repair.order.fulfillmentBlockedReason = "";
  delete repair.order.stockPreflightFailedAt;
  return false;
}

export function resolveSmokeTestReseller(db = {}, smokeLabel = "", isSmokeTestReseller = () => false) {
  const label = String(smokeLabel || "").trim().toLowerCase();
  if (!label) return null;
  return (db.resellers || []).find((reseller) => (
    reseller?.isActive !== false
    && isSmokeTestReseller(reseller)
    && [reseller.username, reseller.name]
      .filter(Boolean)
      .some((value) => String(value).trim().toLowerCase() === label)
  )) || null;
}

export function registerOrderRoutes(app, deps) {
  const {
    addAccountDaysText,
    addMinutesText,
    assertOrderIntakeOpen,
    assertResellerCanOrder,
    authReseller,
    checkoutRequirementsForVariant,
    structuredCheckoutFieldsForVariant,
    clearReservedStockState,
    createPakasirQris,
    depositBreakdown,
    durationAllowedForVariant,
    durationDays,
    enableMaintenanceMode,
    ensureWebOrderStock,
    ensureOrderTrackingToken,
    expirePendingOrders,
    findOrderForPublicTracking,
    formatRupiah,
    fulfillPaidOrderAndNotify,
    getProduct,
    isSmokeTestReseller,
    isVariantOrderable,
    makeId,
    normalizeDurationLabel,
    normalizeWhatsappNumber,
    nowText,
    orderBelongsToReseller,
    orderLockError,
    parseOrderQty,
    paymentTtlMinutes,
    prepareManualApprovedOrderForFulfillment,
    preparePaidOrderForFulfillment,
    priceForDuration,
    primaryResellerWhatsapp,
    pushFulfilledOrderToGoogleSheets,
    publicTrackingLimiter,
    refreshOrderDeliveryTemplateSnapshot,
    readDbSnapshot,
    recordPublicTrackingAudit,
    repairCompletedOrderSheetAssignment,
    requireAuth,
    resellerRequiredMessage,
    serializeOrderForApi,
    safeTrackingOrder,
    shouldEnablePakasirMaintenance,
    splitCustomerEmails,
    splitDeviceNames,
    updateDb,
    variantStockGroupKey,
  } = deps;

  app.get("/api/orders", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    if (req.auth.role === "reseller") {
      res.json((db.orders || [])
        .filter((order) => orderBelongsToReseller(db, req.auth, order))
        .map((order) => serializeOrderForApi(db, order, { viewerRole: "reseller", detail: false })));
      return;
    }
    res.json((db.orders || []).map((order) => serializeOrderForApi(db, order, { viewerRole: "owner", detail: false })));
  });

  app.get("/api/orders/:id", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    const order = db.orders.find((item) => item.id.toLowerCase() === req.params.id.toLowerCase() || item.paymentRef?.toLowerCase() === req.params.id.toLowerCase());
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (req.auth.role === "reseller" && !orderBelongsToReseller(db, req.auth, order)) {
      return res.status(404).json({ error: "Order tidak ditemukan" });
    }
    res.json(serializeOrderForApi(db, order, { viewerRole: req.auth.role, detail: true }));
  });

  app.post("/api/public/order-tracking", async (req, res) => {
    const clientKey = req.ip || req.socket?.remoteAddress || "unknown";
    const rate = publicTrackingLimiter.check(clientKey);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      await recordPublicTrackingAudit({ outcome: "rate_limited", clientKey });
      return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi beberapa menit." });
    }

    const db = await readDbSnapshot();
    const order = findOrderForPublicTracking(db.orders || [], req.body || {});
    if (!order) {
      publicTrackingLimiter.recordFailure(clientKey);
      await recordPublicTrackingAudit({ outcome: "not_found", clientKey });
      return res.status(404).json({ error: "Pesanan tidak ditemukan atau data verifikasi tidak sesuai." });
    }
    publicTrackingLimiter.clear(clientKey);
    await recordPublicTrackingAudit({ outcome: "success", clientKey, orderId: order.id });
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json(safeTrackingOrder(order));
  });

  app.get("/api/public/orders/:id", async (req, res) => {
    const clientKey = req.ip || req.socket?.remoteAddress || "unknown";
    const rate = publicTrackingLimiter.check(clientKey);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi beberapa menit." });
    }
    const db = await readDbSnapshot();
    const order = findOrderForPublicTracking(db.orders || [], {
      trackingToken: req.query.token,
      orderId: req.params.id,
      verification: req.query.verification,
    });
    if (!order || String(order.id || "").toLowerCase() !== String(req.params.id || "").toLowerCase()) {
      publicTrackingLimiter.recordFailure(clientKey);
      return res.status(404).json({ error: "Pesanan tidak ditemukan atau data verifikasi tidak sesuai." });
    }
    publicTrackingLimiter.clear(clientKey);
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json(safeTrackingOrder(order));
  });

  app.post("/api/orders", requireAuth(["owner", "reseller"]), async (req, res) => {
    const created = await updateDb(async (db) => {
      assertOrderIntakeOpen(db);
      const product = getProduct(db, req.body.productId) || db.products[0];
      const variant = product?.variants?.find((item) => item.id === req.body.variantId) || product?.variants?.[0];
      if (!product || product.isArchived || product.isActive === false || !variant || !isVariantOrderable(product, variant)) {
        const error = new Error("Produk atau varian tidak aktif untuk order");
        error.status = 400;
        throw error;
      }
      const lockError = orderLockError(product, variant);
      if (lockError) throw lockError;
      const orderDuration = normalizeDurationLabel(req.body.duration || "1 Bulan", variant);
      if (!durationAllowedForVariant(variant, orderDuration)) {
        const error = new Error(`Durasi ${orderDuration} sedang tidak aktif untuk ${variant.name}.`);
        error.status = 400;
        throw error;
      }
      const price = priceForDuration(variant, orderDuration);
      if (!Number.isFinite(price) || price <= 0) {
        const error = new Error(`Harga ${orderDuration} untuk ${product.name} ${variant.name} belum dikonfigurasi.`);
        error.status = 400;
        throw error;
      }
      const qty = parseOrderQty(req.body.qty);
      const reseller = req.auth.role === "reseller" ? authReseller(db, req.auth) : assertResellerCanOrder(db, req.body.whatsapp || "");
      if (!reseller || reseller.isActive === false) {
        const error = new Error(resellerRequiredMessage);
        error.status = 403;
        throw error;
      }
      const cleanWhatsapp = req.auth.role === "reseller"
        ? primaryResellerWhatsapp(reseller)
        : normalizeWhatsappNumber(req.body.whatsapp || "");
      if (!cleanWhatsapp) {
        const error = new Error("Nomor WhatsApp reseller belum terisi. Lengkapi data reseller dulu sebelum order.");
        error.status = 400;
        throw error;
      }
      const total = price * qty;
      const paymentPlan = depositBreakdown(reseller, total);
      const excludeFromSalesMetrics = isSmokeTestReseller(reseller);
      const requirements = checkoutRequirementsForVariant(db, product, variant, { qty });
      const checkoutFields = structuredCheckoutFieldsForVariant(product, variant, { qty, legacyRequirements: requirements });
      const legacyCheckoutData = {
        customerEmail: req.body.email || req.body.customerData || req.body.customerInfo || "",
        customerDevice: req.body.device || req.body.customerData || req.body.customerInfo || "",
        customerWhatsapp: req.body.customerWhatsapp || "",
        customerPlan: req.body.customerPlan || "",
      };
      const validatedCheckout = validateCheckoutFieldValues(
        checkoutFields,
        { ...legacyCheckoutData, ...(req.body.checkoutData || {}) },
        { normalizeWhatsapp: normalizeWhatsappNumber },
      );
      if (!validatedCheckout.ok) {
        const error = new Error(Object.values(validatedCheckout.errors)[0] || "Data checkout belum lengkap.");
        error.status = 400;
        error.fields = validatedCheckout.errors;
        throw error;
      }
      const orderCheckout = checkoutValuesForOrder(validatedCheckout.values);
      const createdAt = nowText();
      const paymentExpiresAt = addMinutesText(paymentTtlMinutes);
      const orderDurationDays = durationDays(orderDuration);
      const expiresAt = addAccountDaysText(orderDurationDays, createdAt, { keepTime: true });
      const order = {
        id: makeId("ORD").toUpperCase(),
        paymentRef: makeId("PAY").toUpperCase(),
        customer: req.body.customer || req.body.whatsapp || "Customer",
        whatsapp: cleanWhatsapp,
        resellerId: reseller?.id || "",
        reseller: reseller?.username || reseller?.name || cleanWhatsapp,
        excludeFromSalesMetrics,
        internalTestAccount: excludeFromSalesMetrics ? "kya" : "",
        product: product.name,
        productId: product.id,
        variant: variant.name,
        variantId: variant.id,
        variantCode: variant.code,
        customerVariant: variant.name,
        customerVariantId: variant.id,
        customerVariantCode: variant.code,
        stockPoolKey: variantStockGroupKey(product, variant),
        duration: orderDuration,
        durationDays: orderDurationDays,
        qty,
        total,
        depositBefore: paymentPlan.depositBefore,
        depositUsed: paymentPlan.depositUsed,
        depositAfter: paymentPlan.depositAfter,
        paymentDue: paymentPlan.paymentDue,
        ...orderCheckout,
        customerData: String(req.body.customerData || req.body.customerInfo || "").trim(),
        checkoutFields,
        checkoutRequirements: requirements,
        note: req.body.note || "",
        qrisStatus: paymentPlan.paymentDue > 0 ? "pending" : "paid",
        orderStatus: paymentPlan.paymentDue > 0 ? "pending" : "processing",
        deliveryStatus: paymentPlan.paymentDue > 0 ? "waiting_payment" : "paid_by_deposit",
        channel: "Reseller",
        source: "web",
        stockPolicy: "pay_first",
        paymentMethod:
          paymentPlan.paymentDue > 0 && paymentPlan.depositUsed > 0
            ? "Deposit + QRIS auto"
            : paymentPlan.depositUsed > 0
              ? "Deposit reseller"
              : "QRIS auto",
        createdAt,
        expiresAt,
        paymentExpiresAt,
        deliveredStockIds: [],
      };
      ensureOrderTrackingToken(order);
      const reservedStocks = await ensureWebOrderStock(db, order, product, variant, qty);
      if (paymentPlan.depositUsed > 0) {
        reseller.deposit = paymentPlan.depositAfter;
      }
      const payment = {
        ref: order.paymentRef,
        orderId: order.id,
        status: paymentPlan.paymentDue > 0 ? "pending" : "paid",
        amount: paymentPlan.paymentDue,
        provider: paymentPlan.paymentDue > 0 ? "pakasir" : "deposit",
        depositBefore: paymentPlan.depositBefore,
        depositUsed: paymentPlan.depositUsed,
        depositAfter: paymentPlan.depositAfter,
        totalPayment: paymentPlan.paymentDue > 0 ? paymentPlan.paymentDue : total,
        paymentMethod: order.paymentMethod,
        createdAt,
        expiresAt: paymentExpiresAt,
      };
      if (paymentPlan.paymentDue > 0) {
        const pakasir = await createPakasirQris(db, order);
        if (pakasir.providerStatus !== "created") {
          if (paymentPlan.depositUsed > 0) reseller.deposit = paymentPlan.depositBefore;
          for (const stock of reservedStocks) clearReservedStockState(stock);
          const reason = `Pakasir QRIS gagal: ${pakasir.providerError || pakasir.providerStatus || "unknown_error"}`;
          if (shouldEnablePakasirMaintenance?.(reason)) enableMaintenanceMode(db, reason, "pakasir");
          const error = new Error(`Pakasir QRIS gagal. Order tidak dibuat dan deposit tidak dipotong: ${pakasir.providerError || pakasir.providerStatus || "unknown_error"}`);
          error.status = 503;
          if (shouldEnablePakasirMaintenance?.(reason)) error.maintenance = { reason, source: "pakasir" };
          throw error;
        }
        Object.assign(payment, pakasir);
        order.qrisUrl = pakasir.paymentUrl || `${db.settings.botPublicUrl || "http://127.0.0.1:4174"}/api/payments/${order.paymentRef}`;
        if (pakasir.providerError) order.paymentError = pakasir.providerError;
      } else {
        order.qrisUrl = "";
      }
      db.payments.unshift(payment);
      db.orders.unshift(order);
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "order",
        title: `Order ${order.id} dibuat dari Web`,
        description:
          paymentPlan.paymentDue > 0
            ? `${product.name} ${variant.name} x${qty}. Deposit dipakai ${formatRupiah(paymentPlan.depositUsed)}, sisa QRIS ${formatRupiah(paymentPlan.paymentDue)}.`
            : `${product.name} ${variant.name} x${qty} lunas memakai deposit reseller.`,
        createdAt: nowText(),
        orderId: order.id,
        resellerId: reseller?.id || "",
        whatsapp: cleanWhatsapp,
      });
      if (paymentPlan.paymentDue <= 0) {
        const result = await fulfillPaidOrderAndNotify(db, order.id);
        return result.order || order;
      }
      return order;
    });
    res.status(201).json(created);
  });

  app.post("/api/orders/smoke-test", requireAuth(["owner"]), async (req, res) => {
    const created = await updateDb(async (db) => {
      assertOrderIntakeOpen(db);
      const product = getProduct(db, req.body.productId) || db.products[0];
      const variant = product?.variants?.find((item) => item.id === req.body.variantId) || product?.variants?.[0];
      if (!product || product.isArchived || product.isActive === false || !variant || !isVariantOrderable(product, variant)) {
        const error = new Error("Produk atau varian tidak aktif untuk smoke test");
        error.status = 400;
        throw error;
      }
      const lockError = orderLockError(product, variant);
      if (lockError) throw lockError;
      const orderDuration = normalizeDurationLabel(req.body.duration || "1 Bulan", variant);
      if (!durationAllowedForVariant(variant, orderDuration)) {
        const error = new Error(`Durasi ${orderDuration} sedang tidak aktif untuk ${variant.name}.`);
        error.status = 400;
        throw error;
      }
      const qty = parseOrderQty(req.body.qty);
      const requirements = checkoutRequirementsForVariant(db, product, variant, { qty });
      const checkoutFields = structuredCheckoutFieldsForVariant(product, variant, { qty, legacyRequirements: requirements });
      const validatedCheckout = validateCheckoutFieldValues(
        checkoutFields,
        {
          customerEmail: req.body.email || req.body.customerData || req.body.customerInfo || "",
          customerDevice: req.body.device || req.body.customerData || req.body.customerInfo || "",
          customerWhatsapp: req.body.customerWhatsapp || "",
          customerPlan: req.body.customerPlan || "",
          ...(req.body.checkoutData || {}),
        },
        { normalizeWhatsapp: normalizeWhatsappNumber },
      );
      if (!validatedCheckout.ok) {
        const error = new Error(Object.values(validatedCheckout.errors)[0] || "Data checkout belum lengkap.");
        error.status = 400;
        error.fields = validatedCheckout.errors;
        throw error;
      }
      const orderCheckout = checkoutValuesForOrder(validatedCheckout.values);

      const ownerProfile = db.settings?.profile || {};
      const createdAt = nowText();
      const orderDurationDays = durationDays(orderDuration);
      const expiresAt = addAccountDaysText(orderDurationDays, createdAt, { keepTime: true });
      const smokeLabel = String(req.body.smokeLabel || "kya").trim().toLowerCase() || "kya";
      const smokeReseller = resolveSmokeTestReseller(db, smokeLabel, isSmokeTestReseller);
      if (!smokeReseller) {
        const error = new Error("Akun smoke test reseller tidak ditemukan atau tidak aktif");
        error.status = 400;
        throw error;
      }
      const ownerWhatsapp = normalizeWhatsappNumber(
        req.body.whatsapp || primaryResellerWhatsapp(smokeReseller) || ownerProfile.whatsapp || "",
      );
      const quotedTotal = priceForDuration(variant, orderDuration) * qty;
      const order = {
        id: makeId("ORD").toUpperCase(),
        paymentRef: makeId("TEST").toUpperCase(),
        customer: smokeLabel,
        whatsapp: ownerWhatsapp,
        resellerId: smokeReseller.id,
        reseller: smokeLabel,
        product: product.name,
        productId: product.id,
        variant: variant.name,
        variantId: variant.id,
        variantCode: variant.code,
        customerVariant: variant.name,
        customerVariantId: variant.id,
        customerVariantCode: variant.code,
        stockPoolKey: variantStockGroupKey(product, variant),
        duration: orderDuration,
        durationDays: orderDurationDays,
        qty,
        total: 0,
        quotedTotal,
        smokeTestCatalogTotal: quotedTotal,
        depositBefore: 0,
        depositUsed: 0,
        depositAfter: 0,
        paymentDue: 0,
        ...orderCheckout,
        customerData: String(req.body.customerData || req.body.customerInfo || "").trim(),
        checkoutFields,
        checkoutRequirements: requirements,
        note: String(req.body.note || "").trim(),
        qrisStatus: "manual",
        orderStatus: "processing",
        deliveryStatus: "manual_approved",
        channel: "Owner Smoke Test",
        source: "owner_smoke_test",
        isSmokeTest: true,
        smokeTestLabel: smokeLabel,
        stockPolicy: "pay_first",
        paymentMethod: "Owner Smoke Test",
        createdAt,
        expiresAt,
        paymentExpiresAt: "",
        deliveredStockIds: [],
        manualApproved: true,
        manualApprovedAt: createdAt,
        manualApprovedBy: req.auth?.name || req.auth?.username || req.auth?.email || "owner",
        manualApprovalReason: "owner smoke test",
      };
      ensureOrderTrackingToken(order);
      await ensureWebOrderStock(db, order, product, variant, qty);
      const payment = {
        ref: order.paymentRef,
        orderId: order.id,
        status: "manual",
        amount: 0,
        provider: "smoke_test",
        depositBefore: 0,
        depositUsed: 0,
        depositAfter: 0,
        totalPayment: 0,
        paymentMethod: order.paymentMethod,
        createdAt,
        expiresAt: "",
        manualApproved: true,
        manualApprovedAt: createdAt,
        manualApprovedBy: order.manualApprovedBy,
        manualApprovalReason: order.manualApprovalReason,
        providerStatus: "smoke_test",
        providerWebhookStatus: "smoke_test",
        resellerId: smokeReseller.id,
      };
      db.payments.unshift(payment);
      db.orders.unshift(order);
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "order",
        title: `Smoke test ${order.id} dibuat`,
        description: `${product.name} ${variant.name} x${qty} untuk akun internal ${smokeLabel}. Stok asli dipakai, metrik penjualan tidak dihitung.`,
        createdAt: nowText(),
        orderId: order.id,
        resellerId: smokeReseller.id,
        whatsapp: ownerWhatsapp,
      });
      const result = await fulfillPaidOrderAndNotify(db, order.id);
      return serializeOrderForApi(db, result?.order || order, { viewerRole: "owner", detail: true });
    });
    res.status(201).json(created);
  });

  app.post("/api/orders/:id/mark-paid", requireAuth(["owner"]), async (req, res) => {
    const result = await updateDb(async (db) => {
      expirePendingOrders(db);
      const order = db.orders.find((item) => item.id === req.params.id || item.paymentRef === req.params.id);
      if (!order) return null;
      const payment = db.payments.find((item) => item.orderId === order.id || item.ref === order.paymentRef) || {};
      const prepared = preparePaidOrderForFulfillment(db, order, payment);
      if (prepared.reply && prepared.order.deliveryStatus === "late_paid_deposit") return prepared;
      return fulfillPaidOrderAndNotify(db, order.id);
    });
    if (!result) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.json(result);
  });

  app.post("/api/orders/:id/approve-manual", requireAuth(["owner"]), async (req, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ error: "Alasan approve manual wajib diisi" });
    const result = await updateDb(async (db) => {
      expirePendingOrders(db);
      const order = db.orders.find((item) => item.id === req.params.id || item.paymentRef === req.params.id);
      if (!order) return null;
      if (String(order.orderStatus || "").toLowerCase() === "completed" || String(order.deliveryStatus || "").toLowerCase() === "sent") {
        return { ok: true, order, reply: order.fulfillmentText || "Order sudah selesai." };
      }
      const payment = db.payments.find((item) => item.orderId === order.id || item.ref === order.paymentRef) || {};
      prepareManualApprovedOrderForFulfillment(db, order, payment, {
        reason,
        actor: req.auth?.name || req.auth?.username || req.auth?.email || "owner",
      });
      return fulfillPaidOrderAndNotify(db, order.id);
    });
    if (!result) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.json(result);
  });

  app.post("/api/orders/:id/retry-delivery", requireAuth(["owner"]), async (req, res) => {
    const result = await updateDb((db) => fulfillPaidOrderAndNotify(db, req.params.id));
    res.json(result);
  });

  app.post("/api/orders/:id/delivery-template/rerender", requireAuth(["owner"]), async (req, res) => {
    const result = await updateDb((db) => {
      const order = (db.orders || []).find((item) => item.id === req.params.id);
      if (!order) return null;
      if (order.deliveryStatus !== "sent" && order.orderStatus !== "completed") {
        const error = new Error("Template hanya dapat dirender ulang setelah fulfillment selesai.");
        error.status = 409;
        throw error;
      }
      const product = (db.products || []).find((item) => item.id === order.productId);
      const variant = product?.variants?.find((item) => (
        item.id === (order.customerVariantId || order.variantId)
        || item.code === (order.customerVariantCode || order.variantCode)
      ));
      if (!product || !variant) {
        const error = new Error("Produk atau varian order tidak ditemukan.");
        error.status = 404;
        throw error;
      }
      const accounts = (db.managedAccounts || []).filter((account) => (
        String(account.orderId || account.sourceOrderId || "") === String(order.id)
        && !account.hidden
      ));
      if (!accounts.length) {
        const error = new Error("Akun fulfillment order belum tersedia.");
        error.status = 409;
        throw error;
      }
      refreshOrderDeliveryTemplateSnapshot(db, {
        order,
        product,
        variant,
        accounts,
        fallbackText: order.fulfillmentText || "",
        force: true,
      });
      const rerenderedAt = nowText();
      order.deliveryTemplateRerenderedAt = rerenderedAt;
      order.deliveryTemplateRerenderedBy = req.auth?.sub || "owner";
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "order",
        title: `Template order ${order.id} dirender ulang`,
        description: `Varian ${variant.id}; versi ${Number(order.deliveryTemplateSnapshot?.templateVersion || 0)}; actor owner.`,
        createdAt: rerenderedAt,
        orderId: order.id,
        variantId: variant.id,
        templateVersion: Number(order.deliveryTemplateSnapshot?.templateVersion || 0),
        actorId: req.auth?.sub || "owner",
      });
      return serializeOrderForApi(db, order, { viewerRole: "owner", detail: true });
    });
    if (!result) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.json(result);
  });

  app.post("/api/orders/:id/repair-sheets", requireAuth(["owner"]), async (req, res) => {
    const result = await updateDb(async (db) => {
      const working = structuredClone(db);
      const repair = repairCompletedOrderSheetAssignment(working, req.params.id);
      if (!repair.ok) return repair;
      const sheetResult = await pushFulfilledOrderToGoogleSheets(working, { ok: true, order: repair.order });
      working.activities = working.activities || [];
      working.activities.unshift({
        id: makeId("act"),
        type: "order",
        title: `Order ${repair.order.id} dipulihkan ke Sheets`,
        description: `${repair.accounts.length} akun dipulihkan. Commit Sheets: ${repair.order.googleSheetsSyncStatus || "unknown"}.`,
        createdAt: nowText(),
        orderId: repair.order.id,
      });
      const sheetCommitFailed = finalizeSuccessfulSheetRepair(repair, sheetResult, nowText());
      for (const key of Object.keys(db)) delete db[key];
      Object.assign(db, working);
      return {
        ...repair,
        ok: !sheetCommitFailed,
        status: sheetCommitFailed ? 502 : 200,
        reason: sheetCommitFailed ? "sheet_commit_failed" : "",
        sheetResult,
        order: serializeOrderForApi(working, repair.order, { viewerRole: "owner", detail: true }),
      };
    });
    if (!result.ok) return res.status(result.status || 409).json(result);
    res.json(result);
  });

}
