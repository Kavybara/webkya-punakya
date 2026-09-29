import crypto from "node:crypto";
import {
  cleanupRegistrationOtps,
  normalizeRegistrationInput,
  registrationRateLimit,
  validateRegistrationInput,
} from "../services/registration-service.js";

export function registerAuthRoutes(app, deps) {
  const {
    assertLoginAllowed,
    authSessionResponse,
    cleanupPasswordResets,
    clearLoginFailures,
    defaultResellerAccessTools,
    findDuplicateReseller,
    findPasswordResetAccount,
    firstConfigured,
    firstUsableSecret,
    hashPassword,
    makeId,
    normalizeLoginIdentifier,
    normalizeResellerAccessTools,
    normalizeWhatsappNumber,
    nowText,
    ownerCredentials,
    ownerPasswordConfigured,
    ownerProfile,
    passwordResetDeliveryError,
    publicUser,
    randomSecret,
    readDb,
    recordLoginFailure,
    removeSessionCookie,
    requireAuth,
    resetCodeHash,
    resetTokenHash,
    sendResetCodeWhatsApp,
    sendRegistrationCodeWhatsApp,
    sendSelfRegistrationWelcomeWhatsApp,
    syncDataResellerToGoogleSheetsSafely,
    todayText,
    updateDb,
    verifyOwnerPassword,
    verifyPassword,
  } = deps;

  app.post("/api/auth/login", async (req, res) => {
    const db = await readDb();
    const requestedRole = req.body.role === "owner" || req.body.role === "reseller" ? req.body.role : "auto";
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const remember = req.body.remember === true;
    assertLoginAllowed(req, email);

    if (requestedRole === "owner" || requestedRole === "auto") {
      const owner = ownerCredentials(db);
      const profile = ownerProfile(db);
      if (!ownerPasswordConfigured(owner)) {
        if (requestedRole === "owner") {
          recordLoginFailure(req, email);
          res.status(401).json({ error: "Password owner belum dikonfigurasi. Set OWNER_PASSWORD atau reset password owner lewat OTP WhatsApp." });
          return;
        }
      } else {
        const ownerCandidates = [owner.email, profile.email, profile.username, `${profile.username}@kavya.id`]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        if (ownerCandidates.includes(email) && verifyOwnerPassword(owner, password)) {
          if (!owner.passwordHash) {
            await updateDb((draft) => {
              draft.settings = { ...(draft.settings || {}), ownerPasswordHash: hashPassword(password) };
              delete draft.settings.ownerPassword;
              return null;
            });
          }
          const profile = ownerProfile(db);
          const session = {
            ok: true,
            role: "owner",
            user: { id: "owner", name: profile.name, email: profile.email, username: profile.username, whatsapp: profile.whatsapp },
          };
          clearLoginFailures(req, email);
          authSessionResponse(req, res, session, db.settings?.ownerSessionVersion || 0, remember);
          return;
        }
      }
      if (requestedRole === "owner") {
        recordLoginFailure(req, email);
        res.status(401).json({ error: "Email atau password owner salah" });
        return;
      }
    }

    const reseller = db.resellers.find((item) => {
      const candidates = [item.email, item.username, `${item.username}@kavya.id`].filter(Boolean).map((value) => String(value).toLowerCase());
      return candidates.includes(email) && verifyPassword(password, item.passwordHash || item.password || "");
    });
    if (!reseller) {
      recordLoginFailure(req, email);
      res.status(401).json({ error: "Email/username atau password salah" });
      return;
    }
    if (reseller.isActive === false) {
      recordLoginFailure(req, email);
      res.status(403).json({ error: "Akun reseller sedang nonaktif" });
      return;
    }
    if (!reseller.passwordHash) {
      await updateDb((draft) => {
        const stored = (draft.resellers || []).find((item) => item.id === reseller.id);
        if (!stored) return null;
        stored.passwordHash = hashPassword(password);
        delete stored.password;
        return null;
      });
    }
    const session = { ok: true, role: "reseller", user: publicUser(reseller) };
    clearLoginFailures(req, email);
    authSessionResponse(req, res, session, reseller.sessionVersion || 0, remember);
  });

  app.get("/api/auth/session", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDb();
    if (req.auth.role === "owner") {
      const profile = ownerProfile(db);
      res.json({ ok: true, role: "owner", user: { id: "owner", ...profile } });
      return;
    }
    const reseller = (db.resellers || []).find((item) => item.id === req.auth.sub);
    if (!reseller) return res.status(401).json({ error: "Sesi login tidak valid" });
    res.json({ ok: true, role: "reseller", user: publicUser(reseller) });
  });

  app.post("/api/auth/logout", (req, res) => {
    removeSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get("/api/auth/register/config", async (_req, res) => {
    const db = await readDb();
    res.json({ enabled: db.settings?.selfRegistrationEnabled !== false });
  });

  app.post("/api/auth/register/request", async (req, res, next) => {
    try {
      const input = normalizeRegistrationInput(req.body || {});
      const validationError = validateRegistrationInput(input);
      if (validationError) return res.status(400).json({ error: validationError });
      // A single shared label, so this is a global cap on registration
      // requests rather than a per-account one. That is deliberate: the
      // endpoint sends a WhatsApp OTP on every call, so the number one address
      // can trigger across the whole instance is the thing worth bounding. The
      // per-WhatsApp resend limit below still applies per applicant.
      assertLoginAllowed(req, "self-registration");
      recordLoginFailure(req, "self-registration");

      const dbForSend = await readDb();
      if (dbForSend.settings?.selfRegistrationEnabled === false) {
        return res.status(403).json({ error: "Pendaftaran reseller mandiri sedang ditutup." });
      }
      const botConfigured = Boolean(
        firstUsableSecret(dbForSend.settings?.whatsappBotToken, process.env.WHATSAPP_BOT_TOKEN)
          && firstConfigured(process.env.WHATSAPP_BOT_URL, dbForSend.settings?.whatsappBotUrl, "http://127.0.0.1:4016"),
      );
      if (!botConfigured) return res.status(503).json({ error: "OTP WhatsApp sedang tidak tersedia." });

      const created = await updateDb((db) => {
        cleanupRegistrationOtps(db);
        const duplicate = findDuplicateReseller(db, input);
        if (duplicate) return { ok: false, status: 409, reason: `${duplicate.field}_already_used` };
        const rate = registrationRateLimit(db.registrationOtps || [], input.whatsapp, Date.now(), {
          resendMs: Number(process.env.REGISTRATION_OTP_RESEND_MS || 60_000),
          windowMs: Number(process.env.REGISTRATION_OTP_WINDOW_MS || 60 * 60 * 1000),
          maxRequests: Number(process.env.REGISTRATION_OTP_MAX_REQUESTS || 5),
        });
        if (!rate.allowed) return { ok: false, status: 429, reason: rate.reason, retryAfterSeconds: rate.retryAfterSeconds };

        const registrationId = makeId("reg");
        const code = String(crypto.randomInt(100000, 1000000));
        db.registrationOtps = db.registrationOtps || [];
        db.registrationOtps.unshift({
          id: registrationId,
          name: input.name,
          username: input.username,
          email: input.email,
          whatsapp: input.whatsapp,
          passwordHash: hashPassword(input.password),
          codeHash: resetCodeHash(registrationId, code),
          attempts: 0,
          sent: false,
          createdAt: nowText(),
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + Number(process.env.REGISTRATION_OTP_TTL_MS || 10 * 60 * 1000),
        });
        return { ok: true, registrationId, code, whatsapp: input.whatsapp, name: input.name };
      });

      if (!created.ok) {
        const messages = {
          whatsapp_already_used: "Nomor WhatsApp sudah dipakai reseller lain.",
          username_already_used: "Username sudah dipakai.",
          email_already_used: "Email sudah dipakai.",
          resend_wait: `Tunggu ${created.retryAfterSeconds || 60} detik sebelum meminta OTP baru.`,
          hourly_limit: "Terlalu banyak permintaan OTP. Coba lagi nanti.",
        };
        return res.status(created.status || 400).json({ error: messages[created.reason] || "Pendaftaran tidak dapat diproses." });
      }

      const delivery = await sendRegistrationCodeWhatsApp(dbForSend, {
        to: created.whatsapp,
        name: created.name,
        code: created.code,
      });
      await updateDb((db) => {
        const pending = (db.registrationOtps || []).find((item) => item.id === created.registrationId);
        if (pending) {
          pending.sent = Boolean(delivery.sent);
          pending.deliveryError = delivery.reason || "";
        }
        return null;
      });
      if (!delivery.sent) return res.status(502).json({ error: passwordResetDeliveryError(delivery.reason) });

      res.json({
        ok: true,
        registrationId: created.registrationId,
        expiresInSeconds: Math.floor(Number(process.env.REGISTRATION_OTP_TTL_MS || 10 * 60 * 1000) / 1000),
        message: "OTP 6 digit sudah dikirim ke WhatsApp.",
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/register/verify", async (req, res, next) => {
    try {
      const registrationId = String(req.body.registrationId || "").trim();
      const code = String(req.body.code || "").replace(/[^\d]/g, "");
      if (!registrationId || code.length !== 6) return res.status(400).json({ error: "Registration ID dan OTP 6 digit wajib diisi." });

      const result = await updateDb((db) => {
        cleanupRegistrationOtps(db);
        const pending = (db.registrationOtps || []).find((item) => item.id === registrationId && !item.usedAt);
        if (!pending || !pending.sent) return { ok: false, status: 400, reason: "otp_not_found" };
        if (Number(pending.expiresAtMs || 0) <= Date.now()) {
          return { ok: false, status: 400, reason: "otp_not_found" };
        }
        if (Number(pending.attempts || 0) >= Number(process.env.REGISTRATION_OTP_MAX_ATTEMPTS || 5)) {
          return { ok: false, status: 429, reason: "otp_locked" };
        }
        if (pending.codeHash !== resetCodeHash(pending.id, code)) {
          pending.attempts = Number(pending.attempts || 0) + 1;
          return { ok: false, status: 400, reason: "otp_invalid" };
        }
        const duplicate = findDuplicateReseller(db, pending);
        if (duplicate) return { ok: false, status: 409, reason: `${duplicate.field}_already_used` };

        const reseller = {
          id: makeId("res"),
          name: pending.name,
          username: pending.username,
          email: pending.email,
          whatsapp: pending.whatsapp,
          passwordHash: pending.passwordHash,
          isActive: true,
          orders: 0,
          revenue: 0,
          deposit: 0,
          joinedAt: todayText(),
          allowedAccessTools: normalizeResellerAccessTools(defaultResellerAccessTools, defaultResellerAccessTools),
          sessionVersion: 0,
          selfRegisteredAt: nowText(),
          whatsappVerifiedAt: nowText(),
          whatsappWelcomeStatus: "pending",
        };
        db.resellers = db.resellers || [];
        db.resellers.unshift(reseller);
        pending.usedAt = nowText();
        delete pending.codeHash;
        delete pending.passwordHash;
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "reseller",
          title: "Reseller mendaftar mandiri",
          description: `${reseller.name} (${reseller.username}) berhasil memverifikasi nomor WhatsApp dan membuat akun reseller.`,
          createdAt: nowText(),
          resellerId: reseller.id,
          whatsapp: reseller.whatsapp,
        });
        return { ok: true, reseller };
      });

      if (!result.ok) {
        const messages = {
          otp_not_found: "OTP tidak ditemukan atau sudah kedaluwarsa.",
          otp_locked: "OTP terlalu sering salah. Minta OTP baru.",
          otp_invalid: "OTP tidak valid.",
          whatsapp_already_used: "Nomor WhatsApp sudah dipakai reseller lain.",
          username_already_used: "Username sudah dipakai.",
          email_already_used: "Email sudah dipakai.",
        };
        return res.status(result.status || 400).json({ error: messages[result.reason] || "Verifikasi pendaftaran gagal." });
      }

      await updateDb(async (db) => {
        await syncDataResellerToGoogleSheetsSafely(db, result.reseller.id);
        return null;
      });

      let delivery = { sent: false, reason: "whatsapp_sender_not_configured" };
      try {
        const dbForSend = await readDb();
        delivery = await sendSelfRegistrationWelcomeWhatsApp(dbForSend, result.reseller);
      } catch (error) {
        delivery = { sent: false, reason: error?.message || "whatsapp_send_failed" };
      }
      const notificationAt = nowText();
      await updateDb((db) => {
        const reseller = (db.resellers || []).find((item) => item.id === result.reseller.id);
        if (reseller) {
          reseller.whatsappWelcomeStatus = delivery.sent ? "sent" : "failed";
          reseller.whatsappWelcomeSentAt = delivery.sent ? notificationAt : "";
          reseller.whatsappWelcomeError = delivery.sent ? "" : delivery.reason || "whatsapp_send_failed";
          reseller.whatsappWelcomeMessageKey = delivery.messageKey || null;
        }
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "reseller",
          title: delivery.sent ? "Notif pendaftaran terkirim" : "Notif pendaftaran gagal",
          description: delivery.sent
            ? `Konfirmasi akun reseller ${result.reseller.name} dikirim ke WhatsApp ${normalizeWhatsappNumber(result.reseller.whatsapp)}.`
            : `Akun reseller ${result.reseller.name} tetap aktif, tetapi konfirmasi WhatsApp gagal: ${delivery.reason || "whatsapp_send_failed"}.`,
          resellerId: result.reseller.id,
          whatsapp: normalizeWhatsappNumber(result.reseller.whatsapp),
          createdAt: notificationAt,
        });
        return null;
      });

      const session = { ok: true, role: "reseller", user: publicUser(result.reseller) };
      authSessionResponse(req, res, session, result.reseller.sessionVersion || 0, true);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/password-reset/request", async (req, res, next) => {
    try {
      const identifier = String(req.body.identifier || req.body.email || "").trim();
      if (!identifier) {
        res.status(400).json({ error: "Email atau username wajib diisi" });
        return;
      }

      assertLoginAllowed(req, normalizeLoginIdentifier(identifier));
      const dbForSend = await readDb();
      const botConfigured = Boolean(
        firstUsableSecret(dbForSend.settings?.whatsappBotToken, process.env.WHATSAPP_BOT_TOKEN)
          && firstConfigured(process.env.WHATSAPP_BOT_URL, dbForSend.settings?.whatsappBotUrl, "http://127.0.0.1:4016"),
      );

      const created = await updateDb((db) => {
        cleanupPasswordResets(db);
        const account = findPasswordResetAccount(db, identifier);
        const whatsapp = normalizeWhatsappNumber(account?.whatsapp);
        if (!account) return { account: null, code: "", reason: "account_not_found" };
        if (!whatsapp) return { account: { ...account, whatsapp: "" }, code: "", reason: "whatsapp_number_not_found" };
        if (!botConfigured) return { account: { ...account, whatsapp }, code: "", reason: "whatsapp_bot_not_configured" };
        const resetId = makeId("rst");
        const code = String(crypto.randomInt(100000, 1000000));
        db.passwordResets = db.passwordResets || [];
        db.passwordResets.unshift({
          id: resetId,
          role: account.role,
          accountId: account.id,
          whatsapp,
          codeHash: resetCodeHash(resetId, code),
          attempts: 0,
          createdAt: nowText(),
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + Number(process.env.PASSWORD_RESET_CODE_TTL_MS || 10 * 60 * 1000),
          sent: false,
        });
        return { account: { ...account, whatsapp }, resetId, code, reason: "" };
      });

      if (!created.account || !created.code) {
        const status = created.reason === "account_not_found" ? 404 : created.reason === "whatsapp_bot_not_configured" ? 503 : 400;
        res.status(status).json({
          ok: false,
          botConfigured,
          deliveryStatus: created.reason || "not_sent",
          error: passwordResetDeliveryError(created.reason),
        });
        return;
      }

      const delivery = await sendResetCodeWhatsApp(dbForSend, {
        to: created.account.whatsapp,
        name: created.account.name,
        code: created.code,
      });
      await updateDb((db) => {
        const reset = (db.passwordResets || []).find((item) => item.id === created.resetId);
        if (reset) {
          reset.sent = Boolean(delivery.sent);
          reset.deliveryError = delivery.reason || "";
        }
        return null;
      });

      if (!delivery.sent) {
        res.status(502).json({
          ok: false,
          botConfigured,
          deliveryStatus: delivery.reason || "send_failed",
          error: passwordResetDeliveryError(delivery.reason),
        });
        return;
      }

      res.json({
        ok: true,
        botConfigured,
        destination: "",
        deliveryStatus: "sent",
        message: "Kode OTP sudah dikirim ke nomor WhatsApp terdaftar.",
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/password-reset/verify", async (req, res, next) => {
    try {
      const identifier = String(req.body.identifier || req.body.email || "").trim();
      const code = String(req.body.code || "").replace(/[^\d]/g, "");
      if (!identifier || code.length !== 6) {
        res.status(400).json({ error: "Email/username dan kode 6 digit wajib diisi" });
        return;
      }

      const result = await updateDb((db) => {
        cleanupPasswordResets(db);
        const account = findPasswordResetAccount(db, identifier);
        if (!account) return { ok: false };
        const reset = (db.passwordResets || []).find(
          (item) => item.role === account.role && item.accountId === account.id && !item.usedAt && Number(item.expiresAtMs || 0) > Date.now(),
        );
        if (!reset) return { ok: false };
        if (Number(reset.attempts || 0) >= Number(process.env.PASSWORD_RESET_MAX_ATTEMPTS || 5)) return { ok: false, locked: true };
        if (reset.codeHash !== resetCodeHash(reset.id, code)) {
          reset.attempts = Number(reset.attempts || 0) + 1;
          return { ok: false };
        }
        const resetToken = randomSecret("reset");
        reset.verifiedAt = nowText();
        reset.resetTokenHash = resetTokenHash(resetToken);
        reset.resetTokenExpiresAtMs = Date.now() + Number(process.env.PASSWORD_RESET_TOKEN_TTL_MS || 10 * 60 * 1000);
        return { ok: true, resetToken };
      });

      if (!result.ok) {
        res.status(400).json({ error: result.locked ? "Kode terlalu sering salah. Minta kode baru." : "Kode tidak valid atau sudah kadaluarsa" });
        return;
      }
      res.json({ ok: true, resetToken: result.resetToken });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/password-reset/confirm", async (req, res, next) => {
    try {
      const resetToken = String(req.body.resetToken || "").trim();
      const newPassword = String(req.body.newPassword || "");
      const confirmPassword = String(req.body.confirmPassword || "");
      if (!resetToken || !newPassword) {
        res.status(400).json({ error: "Token reset dan password baru wajib diisi" });
        return;
      }
      if (newPassword.length < 8) {
        res.status(400).json({ error: "Password baru minimal 8 karakter" });
        return;
      }
      if (newPassword !== confirmPassword) {
        res.status(400).json({ error: "Konfirmasi password tidak sama" });
        return;
      }

      const result = await updateDb((db) => {
        cleanupPasswordResets(db);
        const hash = resetTokenHash(resetToken);
        const reset = (db.passwordResets || []).find(
          (item) => item.resetTokenHash === hash && !item.usedAt && Number(item.resetTokenExpiresAtMs || 0) > Date.now(),
        );
        if (!reset) return { ok: false };
        if (reset.role === "owner") {
          db.settings = { ...(db.settings || {}) };
          db.settings.ownerPasswordHash = hashPassword(newPassword);
          delete db.settings.ownerPassword;
          db.settings.ownerSessionVersion = Number(db.settings.ownerSessionVersion || 0) + 1;
        } else {
          const reseller = (db.resellers || []).find((item) => item.id === reset.accountId);
          if (!reseller) return { ok: false };
          reseller.passwordHash = hashPassword(newPassword);
          delete reseller.password;
          reseller.sessionVersion = Number(reseller.sessionVersion || 0) + 1;
        }
        reset.usedAt = nowText();
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "security",
          title: "Password panel direset",
          description: `${reset.role === "owner" ? "Owner" : "Reseller"} berhasil reset password lewat OTP WhatsApp.`,
          createdAt: nowText(),
        });
        return { ok: true };
      });

      if (!result.ok) {
        res.status(400).json({ error: "Token reset tidak valid atau sudah kadaluarsa" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/change-password", requireAuth(["owner", "reseller"]), async (req, res) => {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    const confirmPassword = String(req.body.confirmPassword || "");
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "Password lama dan password baru wajib diisi" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "Password baru minimal 8 karakter" });
      return;
    }
    if (newPassword !== confirmPassword) {
      res.status(400).json({ error: "Konfirmasi password tidak sama" });
      return;
    }

    const nextSession = await updateDb((db) => {
      if (req.auth.role === "owner") {
        const owner = ownerCredentials(db);
        if (!verifyOwnerPassword(owner, currentPassword)) {
          const error = new Error("Password lama salah");
          error.status = 401;
          throw error;
        }
        const nextVersion = Number(db.settings?.ownerSessionVersion || 0) + 1;
        db.settings = { ...(db.settings || {}), ownerPasswordHash: hashPassword(newPassword), ownerSessionVersion: nextVersion };
        delete db.settings.ownerPassword;
        const profile = ownerProfile(db);
        return {
          session: {
            ok: true,
            role: "owner",
            user: { id: "owner", name: profile.name, email: profile.email, username: profile.username, whatsapp: profile.whatsapp },
          },
          sessionVersion: nextVersion,
        };
      }

      const reseller = (db.resellers || []).find((item) => item.id === req.auth.sub);
      if (!reseller) {
        const error = new Error("Reseller tidak ditemukan");
        error.status = 404;
        throw error;
      }
      if (!verifyPassword(currentPassword, reseller.passwordHash || reseller.password || "")) {
        const error = new Error("Password lama salah");
        error.status = 401;
        throw error;
      }
      reseller.passwordHash = hashPassword(newPassword);
      delete reseller.password;
      reseller.sessionVersion = Number(reseller.sessionVersion || 0) + 1;
      return {
        session: { ok: true, role: "reseller", user: publicUser(reseller) },
        sessionVersion: reseller.sessionVersion,
      };
    });
    authSessionResponse(req, res, nextSession.session, nextSession.sessionVersion);
  });
}
