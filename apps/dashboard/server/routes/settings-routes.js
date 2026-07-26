export function registerSettingsRoutes(app, deps) {
  const {
    STORED_SECRET_PLACEHOLDER,
    firstUsableSecret,
    gmailOAuthConfigured,
    gmailOAuthState,
    maskedOwnerIntegrationSettings,
    mergeGoogleSheetsSettings,
    mergeStoredSecret,
    nowText,
    ownerIntegrationSettings,
    ownerProfile,
    parseBotPublicUrlInput,
    readDb,
    readDbSnapshot,
    requireAuth,
    updateDb,
    validateGmailConnectionForStatus,
    verifyGmailOAuthState,
  } = deps;

  app.get("/api/owner-profile", requireAuth(["owner"]), async (_req, res) => {
    const db = await readDb();
    res.json(ownerProfile(db));
  });

  app.put("/api/owner-profile", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb((db) => {
      const current = ownerProfile(db);
      const name = String(req.body.name ?? current.name).trim();
      const username = String(req.body.username ?? current.username).trim().toLowerCase().replace(/\s+/g, ".");
      const email = String(req.body.email ?? current.email).trim();
      const whatsapp = String(req.body.whatsapp ?? current.whatsapp).replace(/[^\d]/g, "");
      const initial = String(req.body.initial || name.slice(0, 1) || "O").trim().slice(0, 2).toUpperCase();
      if (!name) {
        const error = new Error("Nama owner wajib diisi");
        error.status = 400;
        throw error;
      }
      if (!email || !email.includes("@")) {
        const error = new Error("Email owner tidak valid");
        error.status = 400;
        throw error;
      }
      if (!whatsapp) {
        const error = new Error("Nomor WhatsApp owner wajib diisi");
        error.status = 400;
        throw error;
      }
      db.settings = {
        ...(db.settings || {}),
        ownerName: name,
        ownerUsername: username,
        ownerEmail: email,
        ownerWhatsAppNumber: whatsapp,
        ownerInitial: initial || "O",
      };
      return ownerProfile(db);
    });
    res.json(updated);
  });

  app.get("/api/owner-settings", requireAuth(["owner"]), async (_req, res) => {
    res.json(maskedOwnerIntegrationSettings(await readDbSnapshot()));
  });

  app.post("/api/owner-settings/validate", requireAuth(["owner"]), async (req, res) => {
    const settings = await updateDb(async (db) => {
      await validateGmailConnectionForStatus(db);
      db.activities = db.activities || [];
      db.activities.unshift({
        id: `act-settings-validation-${Date.now().toString(36)}`,
        type: "system",
        title: "Validasi integrasi dijalankan",
        description: "Owner menjalankan validasi koneksi integrasi Gmail.",
        createdAt: nowText(),
        actorRole: "owner",
        actorName: req.auth?.name || req.auth?.username || "owner",
      });
      return maskedOwnerIntegrationSettings(db);
    });
    res.json(settings);
  });

  app.put("/api/owner-settings", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb((db) => {
      db.settings = { ...(db.settings || {}) };
      if (req.body.profile) {
        const name = String(req.body.profile.name || "").trim();
        const username = String(req.body.profile.username || "owner").trim().toLowerCase().replace(/\s+/g, ".");
        const email = String(req.body.profile.email || "").trim();
        const whatsapp = String(req.body.profile.whatsapp || "").replace(/[^\d]/g, "");
        if (!name) {
          const error = new Error("Nama owner wajib diisi");
          error.status = 400;
          throw error;
        }
        if (!email || !email.includes("@")) {
          const error = new Error("Email owner tidak valid");
          error.status = 400;
          throw error;
        }
        db.settings.ownerName = name;
        db.settings.ownerUsername = username;
        db.settings.ownerEmail = email;
        db.settings.ownerWhatsAppNumber = whatsapp;
        db.settings.ownerInitial = String(req.body.profile.initial || name.slice(0, 1) || "O").trim().slice(0, 2).toUpperCase();
      }
      if (req.body.pakasir) {
        db.settings.pakasirApiKey = mergeStoredSecret(req.body.pakasir.apiKey, db.settings.pakasirApiKey);
        db.settings.pakasirMerchantId = String(req.body.pakasir.merchantId || "").trim();
        db.settings.pakasirProject = db.settings.pakasirMerchantId;
        db.settings.pakasirWebhookSecret = mergeStoredSecret(req.body.pakasir.webhookSecret, db.settings.pakasirWebhookSecret);
      }
      if (req.body.bailey) {
        const parsedPublicUrl = parseBotPublicUrlInput(req.body.bailey.publicUrl);
        db.settings.baileySessionId = String(req.body.bailey.sessionId || "").trim();
        db.settings.baileyBotNumber = String(req.body.bailey.botNumber || "").replace(/[^\d]/g, "");
        db.settings.whatsappBotPublicUrl = parsedPublicUrl.publicUrl;
        db.settings.baileyWebhookUrl = String(req.body.bailey.webhookUrl || "").trim();
        db.settings.baileyQrisGenerateUrl = String(req.body.bailey.qrisGenerateUrl || "").trim();
        db.settings.whatsappBotToken = mergeStoredSecret(req.body.bailey.botToken, db.settings.whatsappBotToken);
        db.settings.whatsappInboundToken = mergeStoredSecret(req.body.bailey.inboundToken, db.settings.whatsappInboundToken);
      }
      if (req.body.gmail) {
        const requestedMode = String(req.body.gmail.mode || "").trim().toLowerCase();
        db.settings.gmailMode = requestedMode === "imap" ? "imap" : "oauth";
        db.settings.gmailClientId = String(req.body.gmail.clientId || "").trim();
        db.settings.gmailClientSecret = mergeStoredSecret(req.body.gmail.clientSecret, db.settings.gmailClientSecret);
        db.settings.gmailRedirectUri = String(req.body.gmail.redirectUri || "").trim();
        db.settings.gmailInboxEmail = String(req.body.gmail.inboxEmail || "").trim();
        db.settings.gmailImapHost = String(req.body.gmail.imapHost || "imap.gmail.com").trim();
        db.settings.gmailImapPort = String(req.body.gmail.imapPort || "993").replace(/[^\d]/g, "") || "993";
        db.settings.gmailImapUser = String(req.body.gmail.imapUser || req.body.gmail.inboxEmail || "").trim();
        db.settings.gmailImapPassword = mergeStoredSecret(
          String(req.body.gmail.imapPassword ?? "").replace(/\s+/g, ""),
          db.settings.gmailImapPassword,
        );
        db.settings.gmailImapSecure = req.body.gmail.imapSecure === false ? "false" : "true";
      }
      if (req.body.googleSheets) {
        Object.assign(
          db.settings,
          mergeGoogleSheetsSettings(db.settings, req.body.googleSheets, { storedSecretPlaceholder: STORED_SECRET_PLACEHOLDER }),
        );
      }
      if (req.body.cloudflare) {
        db.settings.publicDomain = String(req.body.cloudflare.publicDomain || "").trim().replace(/\/$/, "");
        db.settings.botPublicUrl = db.settings.publicDomain || db.settings.botPublicUrl;
        const envCloudflaredToken = firstUsableSecret(process.env.CLOUDFLARED_TOKEN);
        if (envCloudflaredToken) {
          db.settings.cloudflareTunnelToken = envCloudflaredToken;
        } else {
          delete db.settings.cloudflareTunnelToken;
        }
      }
      if (req.body.payment) {
        db.settings.ownerQrisImageUrl = String(req.body.payment.ownerQrisImageUrl || "").trim();
        db.settings.ownerQrisNote = String(req.body.payment.ownerQrisNote || "").trim();
        db.settings.danaNumber = String(req.body.payment.danaNumber || "").trim();
        db.settings.danaName = String(req.body.payment.danaName || "").trim();
        db.settings.livinNumber = String(req.body.payment.livinNumber || "").trim();
        db.settings.livinName = String(req.body.payment.livinName || "").trim();
        db.settings.bcaNumber = String(req.body.payment.bcaNumber || "").trim();
        db.settings.bcaName = String(req.body.payment.bcaName || "").trim();
        db.settings.gopayNumber = String(req.body.payment.gopayNumber || "").trim();
        db.settings.gopayName = String(req.body.payment.gopayName || "").trim();
        db.settings.shopeepayNumber = String(req.body.payment.shopeepayNumber || "").trim();
        db.settings.shopeepayName = String(req.body.payment.shopeepayName || "").trim();
      }
      const updatedSections = [
        "profile",
        "pakasir",
        "bailey",
        "gmail",
        "googleSheets",
        "cloudflare",
        "payment",
      ].filter((section) => Object.prototype.hasOwnProperty.call(req.body || {}, section));
      db.activities = db.activities || [];
      db.activities.unshift({
        id: `act-settings-update-${Date.now().toString(36)}`,
        type: "system",
        title: "Konfigurasi Owner diperbarui",
        description: updatedSections.length
          ? `Section diperbarui: ${updatedSections.join(", ")}.`
          : "Tidak ada section konfigurasi yang berubah.",
        createdAt: nowText(),
        actorRole: "owner",
        actorName: req.auth?.name || req.auth?.username || "owner",
      });
      return maskedOwnerIntegrationSettings(db);
    });
    res.json(updated);
  });

  app.get("/api/resellers/deposit-instructions", requireAuth(["reseller"]), async (_req, res) => {
    const db = await readDb();
    const settings = ownerIntegrationSettings(db);
    const payment = settings.payment || {};
    const pakasirConnected = settings.status.pakasir === "connected";
    const methods = {
      qris_auto: {
        label: "Deposit otomatis QRIS",
        note: pakasirConnected
          ? "Saldo otomatis diproses via Pakasir bila integrasi aktif."
          : "Pakasir sedang disconnected. Pilih QRIS owner manual atau metode bank.",
        available: pakasirConnected,
      },
      qris_owner: {
        label: "QRIS owner manual",
        imageUrl: payment.ownerQrisImageUrl || "",
        note: payment.ownerQrisNote || "",
        available: Boolean(payment.ownerQrisImageUrl),
      },
      dana: {
        label: "DANA",
        accountNumber: payment.danaNumber || "",
        accountName: payment.danaName || "",
        available: Boolean(payment.danaNumber),
      },
      livin: {
        label: "Livin Mandiri",
        accountNumber: payment.livinNumber || "",
        accountName: payment.livinName || "",
        available: Boolean(payment.livinNumber),
      },
      bca: {
        label: "BCA",
        accountNumber: payment.bcaNumber || "",
        accountName: payment.bcaName || "",
        available: Boolean(payment.bcaNumber),
      },
      gopay: {
        label: "GoPay",
        accountNumber: payment.gopayNumber || "",
        accountName: payment.gopayName || "",
        available: Boolean(payment.gopayNumber),
      },
      shopeepay: {
        label: "ShopeePay",
        accountNumber: payment.shopeepayNumber || "",
        accountName: payment.shopeepayName || "",
        available: Boolean(payment.shopeepayNumber),
      },
    };
    res.json({
      ownerName: settings.profile?.name || settings.profile?.username || "Owner",
      ownerWhatsapp: settings.profile?.whatsapp || "",
      pakasirConnected,
      methods,
    });
  });

  app.get("/api/gmail/oauth/start", requireAuth(["owner"]), async (_req, res) => {
    const db = await readDb();
    const settings = ownerIntegrationSettings(db);
    if (!gmailOAuthConfigured(db)) {
      res.status(400).json({ error: "Client ID, Client Secret, dan Redirect URI Gmail wajib diisi dulu" });
      return;
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", settings.gmail.clientId);
    url.searchParams.set("redirect_uri", settings.gmail.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.readonly");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", gmailOAuthState());
    res.json({ ok: true, url: url.toString() });
  });

  app.get("/api/gmail/oauth/callback", async (req, res, next) => {
    try {
      if (!verifyGmailOAuthState(req.query.state)) {
        res.status(400).send("State OAuth Gmail tidak valid atau kadaluarsa.");
        return;
      }
      const code = String(req.query.code || "").trim();
      if (!code) {
        res.status(400).send("Kode OAuth Gmail tidak ditemukan.");
        return;
      }

      const db = await readDb();
      const settings = ownerIntegrationSettings(db);
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: settings.gmail.clientId,
          client_secret: settings.gmail.clientSecret,
          redirect_uri: settings.gmail.redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.refresh_token) {
        res.status(400).send(payload.error_description || payload.error || "Gagal menyambungkan Gmail. Pastikan consent diberikan dengan akses offline.");
        return;
      }

      await updateDb((nextDb) => {
        nextDb.settings.gmailRefreshToken = String(payload.refresh_token || "").trim();
        nextDb.settings.gmailConnectedAt = nowText();
        nextDb.settings.gmailOAuthStatus = "connected";
        nextDb.settings.gmailLastError = "";
        nextDb.settings.gmailLastErrorAt = "";
        return null;
      });
      res.send("Gmail berhasil tersambung. Silakan kembali ke dashboard Kavya.");
    } catch (error) {
      next(error);
    }
  });
}
