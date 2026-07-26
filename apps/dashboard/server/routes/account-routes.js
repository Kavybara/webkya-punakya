export function registerAccountRoutes(app, deps) {
  const {
    accessLookupLabel,
    accountChangeFields,
    accountStatusFromDate,
    appendAccessLookupActivity,
    authReseller,
    buildAccountAuditTrail,
    buildManagedAccountInput,
    canonicalResellerDisplayName,
    clearAccountsInGoogleSheets,
    findAccountForLookup,
    findDisneyAccountForLookup,
    gmailConnectionInfo,
    historicalAccountForLookup,
    historicalDisneyAccountForLookup,
    inactiveLookupResult,
    isGmailOAuthInvalidError,
    isNetflixManagedAccount,
    isTerminalManagedAccountStatus,
    lookupAccountAccessValue,
    makeId,
    normalizeWhatsappNumber,
    notifyResellerAccountChanged,
    nowText,
    orderForManagedAccount,
    primaryResellerWhatsapp,
    readDbSnapshot,
    requireAuth,
    resellerAccessTools,
    resellerById,
    safeAccountForAccess,
    stockForManagedAccount,
    syncCredentialsToSheetsSafely,
    syncPasswordByEmail,
    updateDb,
    visibleManagedAccountsForAuth,
  } = deps;

  app.get("/api/accounts/unread-delivery-count", requireAuth(["reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    const accounts = visibleManagedAccountsForAuth(db, req.auth);
    res.json({
      count: accounts.filter((account) => (
        account.deliveryTemplateSnapshot?.status === "ready"
        && account.deliveryTemplateUnreadAt
        && !account.deliveryTemplateOpenedAt
      )).length,
    });
  });

  app.get("/api/accounts/:id/delivery", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    const account = visibleManagedAccountsForAuth(db, req.auth).find((item) => item.id === req.params.id);
    const snapshot = account?.deliveryTemplateSnapshot || null;
    const result = account ? {
      account: {
        id: account.id,
        orderId: account.orderId || account.sourceOrderId || "",
        product: account.product || "",
        variant: account.variant || "",
        email: account.email || "",
        loginPhone: account.loginPhone || "",
        password: account.password || "",
        canvaLink: account.canvaLink || "",
        profile: account.profile || "",
        pin: account.pin || "",
        duration: account.duration || "",
        startedAt: account.startedAt || "",
        expiresAt: account.expiresAt || "",
        status: account.status || "",
      },
      deliveryTemplateSnapshot: snapshot,
    } : null;
    if (!result) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json(result);
  });

  app.post("/api/accounts/:id/delivery/opened", requireAuth(["reseller"]), async (req, res) => {
    const result = await updateDb((db) => {
      const account = visibleManagedAccountsForAuth(db, req.auth).find((item) => item.id === req.params.id);
      if (!account) return null;
      const snapshot = account.deliveryTemplateSnapshot || null;
      if (snapshot?.status === "ready") {
        account.deliveryTemplateOpenedAt = nowText();
        account.deliveryTemplateUnreadAt = "";
      }
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "account",
        title: "Detail pengiriman dibuka",
        description: `Akun ${account.id}; order ${account.orderId || account.sourceOrderId || "-"}; versi template ${Number(snapshot?.templateVersion || 0)}.`,
        createdAt: nowText(),
        resellerId: account.resellerId || "",
        accountId: account.id,
        orderId: account.orderId || account.sourceOrderId || "",
        templateVersion: Number(snapshot?.templateVersion || 0),
      });
      return { ok: true };
    });
    if (!result) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json(result);
  });

  app.post("/api/accounts/:id/delivery/copied", requireAuth(["reseller"]), async (req, res) => {
    const recorded = await updateDb((db) => {
      const account = visibleManagedAccountsForAuth(db, req.auth).find((item) => item.id === req.params.id);
      if (!account) return null;
      const snapshot = account.deliveryTemplateSnapshot;
      if (!snapshot || snapshot.status !== "ready") return { ok: false, reason: "template_not_ready" };
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "account",
        title: "Template pengiriman disalin reseller",
        description: `Akun ${account.id}; order ${account.orderId || account.sourceOrderId || "-"}; versi ${Number(snapshot.templateVersion || 0)}.`,
        createdAt: nowText(),
        resellerId: account.resellerId || "",
        accountId: account.id,
        orderId: account.orderId || account.sourceOrderId || "",
        templateVersion: Number(snapshot.templateVersion || 0),
      });
      return { ok: true };
    });
    if (!recorded) return res.status(404).json({ error: "Akun tidak ditemukan" });
    if (!recorded.ok) return res.status(409).json({ error: "Template pengiriman belum siap" });
    res.json(recorded);
  });

  app.get("/api/accounts/:id/audit", requireAuth(["owner"]), async (req, res) => {
    const db = await readDbSnapshot();
    const account = (db.managedAccounts || []).find((item) => item.id === req.params.id);
    if (!account) {
      res.status(404).json({ error: "Akun tidak ditemukan" });
      return;
    }
    const stock = stockForManagedAccount(db, account);
    const order = orderForManagedAccount(db, account);
    res.json({
      accountId: account.id,
      stockId: account.stockId || "",
      orderId: order?.id || account.orderId || account.sourceOrderId || "",
      sheet: { name: account.sheetName || stock?.sheetName || "", row: account.sheetRow || stock?.sheetRow || 0 },
      timeline: buildAccountAuditTrail(db, account),
    });
  });

  app.get("/api/accounts", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDbSnapshot();
    res.json(visibleManagedAccountsForAuth(db, req.auth));
  });

  app.post("/api/accounts", requireAuth(["owner"]), async (req, res) => {
    const created = await updateDb((db) => {
      const account = buildManagedAccountInput(db, req.body);
      db.managedAccounts = db.managedAccounts || [];
      db.managedAccounts.unshift(account);
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "account",
        title: `Akun manual ${account.email} ditambahkan`,
        description: `${account.email} ditambahkan ke manajemen akun ${account.reseller || account.whatsapp || "reseller"}.`,
        createdAt: nowText(),
        resellerId: account.resellerId || "",
        whatsapp: normalizeWhatsappNumber(account.whatsapp || ""),
        accountId: account.id,
        accountEmail: account.email,
      });
      return account;
    });
    res.status(201).json(created);
  });

  app.put("/api/accounts/:id", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb(async (db) => {
      const account = (db.managedAccounts || []).find((item) => item.id === req.params.id);
      if (!account) return null;
      const previousResellerId = String(account.resellerId || "").trim();
      const explicitResellerId = req.body.resellerId === undefined ? null : String(req.body.resellerId || "").trim();
      const explicitReseller = explicitResellerId ? resellerById(db, explicitResellerId) : null;
      const previousEmail = String(account.email || "").trim();
      const nextEmail = req.body.email === undefined ? previousEmail : String(req.body.email || "").trim();
      if (!nextEmail) {
        const error = new Error("Email akun wajib diisi");
        error.status = 400;
        throw error;
      }
      const previousPassword = String(account.password || "").trim();
      const nextPassword = req.body.password === undefined ? previousPassword : String(req.body.password || "");
      const beforeNotify = {
        email: previousEmail,
        password: previousPassword,
        profile: String(account.profile || ""),
        pin: String(account.pin || ""),
      };
      Object.assign(account, {
        product: req.body.product ?? account.product,
        productId: req.body.productId ?? account.productId,
        variant: req.body.variant ?? account.variant,
        variantId: req.body.variantId ?? account.variantId,
        variantCode: req.body.variantCode ?? account.variantCode,
        duration: req.body.duration ?? account.duration,
        durationDays: req.body.durationDays ?? account.durationDays,
        email: nextEmail,
        password: nextPassword,
        resellerId: explicitResellerId ?? account.resellerId,
        reseller: req.body.reseller ?? (explicitReseller ? canonicalResellerDisplayName(explicitReseller, account.reseller || "") : account.reseller),
        whatsapp: req.body.whatsapp ?? (explicitReseller ? normalizeWhatsappNumber(primaryResellerWhatsapp(explicitReseller) || account.whatsapp || "") : account.whatsapp),
        buyer: req.body.buyer ?? account.buyer,
        profile: req.body.profile ?? account.profile,
        pin: req.body.pin ?? account.pin,
        signInCode: req.body.signInCode ?? account.signInCode,
        verificationCode: req.body.verificationCode ?? account.verificationCode,
        resetLink: req.body.resetLink ?? account.resetLink,
        householdLink: req.body.householdLink ?? account.householdLink,
        startedAt: req.body.startedAt ?? account.startedAt,
        expiresAt: req.body.expiresAt ?? account.expiresAt,
        status: req.body.status ?? account.status,
        hidden: false,
      });
      const restoredStatus = String(account.status || "").toLowerCase();
      if (!["expired", "replaced", "disabled"].includes(restoredStatus)) {
        account.returnedToStockAt = "";
        account.sheetClearedAt = "";
        account.sheetMissingArchivedAt = "";
        delete account.slotConflictArchived;
        delete account.duplicateOfAccountId;
        delete account.duplicateArchivedAt;
      }
      if (explicitReseller && (!req.body.buyer || !String(req.body.buyer || "").trim()) && !String(account.buyer || "").trim()) {
        account.buyer = canonicalResellerDisplayName(explicitReseller, account.buyer || "");
      }
      const linkedOrder = orderForManagedAccount(db, account);
      if (explicitReseller && linkedOrder) {
        linkedOrder.resellerId = explicitReseller.id;
        linkedOrder.reseller = canonicalResellerDisplayName(explicitReseller, linkedOrder.reseller || linkedOrder.customer || "");
        linkedOrder.whatsapp = normalizeWhatsappNumber(primaryResellerWhatsapp(explicitReseller) || linkedOrder.whatsapp || "");
      }
      const stock = account.stockId ? (db.stock || []).find((item) => item.id === account.stockId) : null;
      const nextStatus = accountStatusFromDate(account.expiresAt, account.durationDays);
      const canSyncStock = stock && nextStatus !== "expired" && account.status !== "expired";
      if (canSyncStock) {
        stock.email = account.email;
        stock.password = account.password;
        stock.profile = account.profile || "";
        stock.pin = account.pin || "";
        stock.signInCode = account.signInCode || "";
        stock.verificationCode = account.verificationCode || "";
        stock.resetLink = account.resetLink || "";
        stock.householdLink = account.householdLink || "";
        stock.notes = req.body.notes ?? stock.notes;
      }
      let passwordSync = null;
      if (req.body.password !== undefined && previousPassword !== nextPassword && nextStatus !== "expired" && account.status !== "expired") {
        passwordSync = syncPasswordByEmail(db, nextEmail, nextPassword, { sourceAccountId: account.id, sourceStockId: stock?.id || "" });
      }
      if ((previousEmail !== nextEmail || (req.body.password !== undefined && previousPassword !== nextPassword)) && nextStatus !== "expired" && account.status !== "expired") {
        account.googleSheetsCredentialSync = await syncCredentialsToSheetsSafely(db, {
          email: nextEmail,
          password: nextPassword,
          stockIds: [stock?.id || account.stockId].filter(Boolean),
          sheetStockKeys: [stock?.sheetStockKey || account.sheetStockKey].filter(Boolean),
          accountIds: [account.id],
        });
      }
      const notificationDedupe = new Set();
      const directChanges = accountChangeFields(beforeNotify, {
        email: account.email || "",
        password: account.password || "",
        profile: account.profile || "",
        pin: account.pin || "",
      });
      if (directChanges.length && nextStatus !== "expired" && account.status !== "expired") {
        await notifyResellerAccountChanged(db, account, directChanges, { dedupeSet: notificationDedupe });
      }
      for (const affectedAccount of passwordSync?.affectedAccounts || []) {
        if (affectedAccount.id === account.id) continue;
        await notifyResellerAccountChanged(db, affectedAccount, [{ key: "password", label: "Password/Link" }], { dedupeSet: notificationDedupe });
      }
      db.activities = db.activities || [];
      if (previousEmail !== nextEmail) {
        db.activities.unshift({
          id: makeId("act"),
          type: "account",
          title: `Akun diganti ke email ${nextEmail}`,
          description: `${previousEmail || account.id} diganti untuk ${account.reseller || account.buyer || "reseller"}.`,
          createdAt: nowText(),
          resellerId: account.resellerId || "",
          whatsapp: normalizeWhatsappNumber(account.whatsapp || ""),
          accountId: account.id,
          accountEmail: nextEmail,
        });
      } else if (
        previousPassword !== nextPassword
        || req.body.profile !== undefined
        || req.body.pin !== undefined
        || req.body.status !== undefined
        || previousResellerId !== String(account.resellerId || "").trim()
        || req.body.buyer !== undefined
      ) {
        db.activities.unshift({
          id: makeId("act"),
          type: "account",
          title: `Akun ${nextEmail} diperbarui`,
          description: `${account.reseller || account.buyer || "reseller"} data akun diperbarui.`,
          createdAt: nowText(),
          resellerId: account.resellerId || "",
          whatsapp: normalizeWhatsappNumber(account.whatsapp || ""),
          accountId: account.id,
          accountEmail: nextEmail,
        });
      }
      return account;
    });
    if (!updated) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json(updated);
  });

  app.post("/api/account-access/lookup", requireAuth(["reseller"]), async (req, res, next) => {
    try {
      const type = String(req.body.type || "signin").trim();
      const target = String(req.body.target || req.body.email || "").trim();
      const email = String(req.body.email || req.body.target || "").trim().toLowerCase();
      const silent = Boolean(req.body.silent);
      if (!target) {
        res.status(400).json({ error: type === "disney_otp" ? "Nomor login Disney wajib diisi" : "Email akun wajib diisi" });
        return;
      }
      if (!["signin", "verification", "reset", "household", "disney_otp"].includes(type)) {
        res.status(400).json({ error: "Tipe lookup tidak valid" });
        return;
      }

      const lookupResponse = await updateDb(async (db) => {
        await refreshResellerViewFromGoogleSheets(db, req.auth, "reseller_lookup_refresh");
        const reseller = authReseller(db, req.auth);
        if (!reseller || reseller.isActive === false) {
          return { statusCode: 404, body: { error: "Reseller tidak ditemukan atau nonaktif" } };
        }
        const allowedTools = resellerAccessTools(reseller);
        const permitted = type === "disney_otp" ? allowedTools.includes("signin") : allowedTools.includes(type);
        if (!permitted) {
          return {
            statusCode: 403,
            body: { error: `${accessLookupLabel(type)} tidak diizinkan untuk reseller ini` },
          };
        }
        const account = type === "disney_otp"
          ? findDisneyAccountForLookup(db, req.auth, target)
          : findAccountForLookup(db, req.auth, email);
        if (!account) {
          const historicalAccount = type === "disney_otp"
            ? historicalDisneyAccountForLookup(db, req.auth, target)
            : historicalAccountForLookup(db, req.auth, email);
          if (historicalAccount) {
            const result = inactiveLookupResult(historicalAccount, type);
            if (!silent) {
              appendAccessLookupActivity(db, req.auth, {
                account: historicalAccount,
                email: target,
                type,
                result,
                status: result.reason,
              });
            }
            return {
              statusCode: 200,
              body: {
                ok: true,
                type,
                account: safeAccountForAccess({
                  ...historicalAccount,
                  status: ["replaced", "disabled"].includes(historicalAccount.status) ? historicalAccount.status : "expired",
                }),
                result,
                refreshedAt: nowText(),
                expiresInSeconds: null,
                gmail: gmailConnectionInfo(db),
              },
            };
          }
          if (!silent) {
            appendAccessLookupActivity(db, req.auth, {
              email: target,
              type,
              result: { source: "fallback", reason: "account_not_found", value: "" },
              status: "account_not_found",
            });
          }
          return { statusCode: 404, body: { error: type === "disney_otp" ? "Nomor Disney tidak ditemukan di akun yang dibeli reseller ini" : "Email tidak ditemukan di akun yang dibeli reseller ini" } };
        }
        const currentStatus = accountStatusFromDate(account.expiresAt, account.durationDays);
        if (currentStatus === "expired" || isTerminalManagedAccountStatus(account.status)) {
          const result = {
            source: "fallback",
            kind: ["reset", "household"].includes(type) ? "link" : "code",
            value: "",
            reason: account.status === "replaced" ? "account_replaced" : account.status === "disabled" ? "account_disabled" : "account_expired",
            error: account.status === "replaced" ? "Akun sudah replaced, lookup kode tidak aktif." : account.status === "disabled" ? "Akun sudah nonaktif, lookup kode tidak aktif." : "Akun sudah expired, lookup kode tidak aktif.",
          };
          if (!silent) {
            appendAccessLookupActivity(db, req.auth, { account, email: target, type, result, status: result.reason });
          }
          return {
            statusCode: 200,
            body: {
          ok: true,
          type,
          account: safeAccountForAccess({ ...account, status: ["replaced", "disabled"].includes(account.status) ? account.status : "expired" }),
          result,
          refreshedAt: nowText(),
          expiresInSeconds: null,
          gmail: gmailConnectionInfo(db),
            },
          };
        }

        const result = await lookupAccountAccessValue(db, account, type);
        const gmailInfo = result?.reason === "gmail_error" && isGmailOAuthInvalidError(result?.error) ? { ...gmailConnectionInfo(db), connected: false, needsOAuth: true, error: result.error } : gmailConnectionInfo(db);
        if (!silent) {
          appendAccessLookupActivity(db, req.auth, { account, email: target, type, result, status: result?.value ? "success" : result?.reason || result?.error || "not_found" });
        }
        return {
          statusCode: 200,
          body: {
        ok: true,
        type,
        account: safeAccountForAccess(account),
        result,
        refreshedAt: nowText(),
        expiresInSeconds: ["reset", "household"].includes(type) ? null : 15 * 60,
        gmail: gmailInfo,
          },
        };
      });
      res.status(lookupResponse.statusCode || 200).json(lookupResponse.body || lookupResponse);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/accounts/:id", requireAuth(["owner"]), async (req, res) => {
    const deleted = await updateDb(async (db) => {
      const index = (db.managedAccounts || []).findIndex((item) => item.id === req.params.id);
      if (index === -1) return null;
      const account = db.managedAccounts[index];
      if (!isNetflixManagedAccount(account)) {
        const status = String(account.status || accountStatusFromDate(account.expiresAt, account.durationDays)).toLowerCase();
        if (!["expired", "replaced", "disabled"].includes(status)) {
          const error = new Error("Akun non-Netflix yang masih aktif tidak bisa dihapus dari manajemen");
          error.status = 400;
          throw error;
        }
        const archivedAt = nowText();
        account.status = status === "replaced" || status === "disabled" ? status : "expired";
        account.hidden = true;
        account.archivedAt = archivedAt;
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "account",
          title: `${account.email || account.id} dihapus dari Manajemen Akun`,
          description: `${account.product || "Akun"} ${account.variant || ""} diarsipkan. Stok sumber tidak diubah dari web.`,
          createdAt: archivedAt,
          resellerId: account.resellerId || "",
          whatsapp: normalizeWhatsappNumber(account.whatsapp || ""),
          accountId: account.id,
          accountEmail: account.email || "",
          stockId: account.stockId || "",
        });
        let sheetsClear = { ok: true, skipped: true };
        try {
          sheetsClear = await clearAccountsInGoogleSheets(db, [account]);
        } catch (error) {
          sheetsClear = { ok: false, error: error.message || "google_sheets_clear_failed" };
          db.activities.unshift({
            id: makeId("act"),
            type: "error",
            title: "Gagal mengosongkan row Sheets saat hapus akun",
            description: `${account.email || account.id}: ${sheetsClear.error}`,
            createdAt: archivedAt,
            accountId: account.id,
            accountEmail: account.email || "",
            stockId: account.stockId || "",
          });
        }
        return { account, archived: true, accounts: [account], stocks: [], sheetsClear };
      }
      const error = new Error("Akun Google Sheets tidak bisa di-release dari web. Kosongkan atau ubah row-nya di Sheets lalu sync.");
      error.status = 400;
      throw error;
    });
    if (!deleted) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json({
      ok: true,
      account: deleted.account,
      stock: deleted.returnedStock,
      accounts: deleted.accounts,
      stocks: deleted.stocks,
      returned: deleted.accounts?.length || 0,
      sheets: deleted.sheetsClear,
      credentialSync: deleted.credentialSync,
    });
  });
}
