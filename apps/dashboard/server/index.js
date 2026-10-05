import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { canonicalRentalMap, createRentalMirror } from "./services/rental-mirror-service.js";
import { installConsoleRedaction, requestTelemetry } from "../../../packages/shared/observability.mjs";
import { ImapFlow } from "imapflow";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleInboundMessage, fulfillPaidOrder, formatRupiah, buildOrderCreatedReply, buildDepositCreatedReply, createDepositTopupOrder, refreshOrderDeliveryTemplateSnapshot } from "./auto-order.js";
import {
  clearAccountsInGoogleSheets,
  ensureGoogleSheetsTemplate,
  ensureNetflixSheetsTemplate,
  googleSheetsConfigured,
  googleSheetsPublicSettings,
  previewAccountSheetMapping,
  pushAccountsToGoogleSheets,
  pushFulfilledOrderToGoogleSheets,
  syncDataResellerToGoogleSheetsSafely,
  syncDataResellersToGoogleSheets,
  syncAccountCredentialsToGoogleSheets,
  syncGoogleSheetsStock,
  syncGoogleSheetsProductStock,
  syncAccountReplacementToGoogleSheets,
  syncWarrantyStockReviewToGoogleSheets,
} from "./google-sheets.js";
import { applyWaPriceSync, findWaPriceSource, previewWaPriceSync } from "./price-sync.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerAccountRoutes } from "./routes/account-routes.js";
import { registerCatalogRoutes } from "./routes/catalog-routes.js";
import { registerOperationsRoutes } from "./routes/operations-routes.js";
import { registerOrderRoutes } from "./routes/order-routes.js";
import { registerPaymentRoutes } from "./routes/payment-routes.js";
import { registerProductAdminRoutes } from "./routes/product-admin-routes.js";
import { registerResellerRoutes } from "./routes/reseller-routes.js";
import { registerSettingsRoutes } from "./routes/settings-routes.js";
import { registerSheetsRoutes } from "./routes/sheets-routes.js";
import { registerStockRoutes } from "./routes/stock-routes.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { registerWhatsAppRoutes } from "./routes/whatsapp-routes.js";
import { registerWarrantyRoutes } from "./routes/warranty-routes.js";
import { mergeGoogleSheetsSettings } from "./settings-merge.js";
import { clientKey, resolveTrustProxy } from "./lib/client-ip.js";
import { createLoginAttemptLimiter } from "./lib/login-attempt-limiter.js";
import { joinPublicUrl, publicWebsiteUrl } from "./lib/public-url.js";
import { stockBlockedByAccountCondition } from "./google-sheets/account-condition.js";
import { assessBackupHealth, backupIntervalMs } from "./services/backup-health.js";
import { createOrderStockService } from "./services/order-stock-service.js";
import { createFulfillmentNotificationService } from "./services/fulfillment-notification-service.js";
import { extractNetflixVerificationCode, hasFifteenMinuteExpiry, hasTenMinuteExpiry, isNetflixAccountChangeVerification } from "./services/account-access-code-service.js";
import {
  accountAccessGmailQueries,
  accountAccessMailboxPaths,
} from "./services/account-access-search-service.js";
import { classifyGmailConnectionError, createGmailHealthService } from "./services/gmail-health-service.js";
import { createPaymentReconciliationService } from "./services/payment-reconciliation-service.js";
import { createOperationsRepairService } from "./services/operations-repair-service.js";
import { createReadMaintenanceService } from "./services/read-maintenance-service.js";
import { snapshotVersion } from "./services/read-snapshot-service.js";
import { createSettingsMigrationService } from "./services/settings-migration-service.js";
import { createSettingsStartupMigrationService } from "./services/settings-startup-migration-service.js";
import { securityHeaders } from "./services/security-headers-service.js";
import { requestPakasirJsonWithRetry, shouldEnablePakasirMaintenance } from "./services/pakasir-client-service.js";
import { createDeliveryTemplateSnapshot } from "./services/delivery-template-service.js";
import { recordOperationalCheck } from "./services/operational-alert-service.js";
import {
  rentalChangedNotificationText,
  rentalDisplayName,
  rentalExpiredNotificationText,
  rentalExpiringNotificationText,
  rentalJoinedNotificationText,
  rentalOwnerContactNumber,
} from "./services/whatsapp-rental-notification-service.js";
import {
  buildWarrantyOwnerNotification,
  buildWarrantyOverdueNotification,
  buildWarrantyReplacementNotifications,
  buildWarrantyStatusNotification,
  createWarrantyClaim,
  markWarrantyReplacementSync,
  replacementCandidatesForClaim,
  replaceWarrantyAccount,
  replaceWarrantyAccountManually,
  updateWarrantyClaim,
  validateWarrantyReplacementState,
  warrantyClaimsForAuth,
  warrantyManualClaimOptions,
} from "./services/warranty-service.js";
import {
  decodeWarrantyEvidence,
  readWarrantyEvidence,
  removeWarrantyEvidence,
  saveWarrantyEvidence,
} from "./services/warranty-evidence-service.js";
import {
  friendlyGoogleSheetsError,
  GOOGLE_SHEETS_CATALOG_PRECHECK_COOLDOWN_MS,
  googleSheetsProductSyncScope,
  googleSheetsRequiredSectionsError,
  recentGoogleSheetsProductSync,
  recentGoogleSheetsResellerLookup,
  recordGoogleSheetsProductSync,
  googleSheetsSectionError,
  googleSheetsSyncHealth,
} from "./services/google-sheets-sync-policy-service.js";
import { evaluateCatalogPrecheck } from "./services/catalog-precheck-service.js";
import { isLatePaymentRecoveryCandidate } from "./services/late-payment-recovery.js";
import {
  createPublicTrackingLimiter,
  ensureOrderTrackingToken,
  findOrderForPublicTracking,
  safeTrackingOrder,
  safeTrackingPayment,
} from "./services/public-order-tracking-service.js";
import { deriveProviderTotalPayment } from "./services/payment-total-service.js";
import { selfRegistrationWelcomeMessage } from "./services/registration-service.js";
import {
  checkoutFieldsForVariant as structuredCheckoutFieldsForVariant,
  normalizeCheckoutField,
} from "./services/checkout-fields-service.js";
import {
  classifyDeliveryAuditAccounts,
  deliveryAuditCoverage,
  hasHistoricalDeliveryEvidence,
  hasOnlyHistoricalManagedAssignment,
  isCreditedStockUnavailableOrder,
  isDeliverableManagedAccount,
} from "./services/sheet-sync-status-service.js";
import { databasePath, ensureDb, getDbVersion, makeId, nowText, onDbChange, readDb, readDbSnapshot, todayText, updateDb, writeDb } from "./store.js";
import {
  SESSION_COOKIE_NAME,
  assertTrustedBrowserMutation,
  clearSessionCookie,
  configuredOrigins,
  corsOptions,
  hashPassword,
  isPasswordHash,
  parseCookies,
  requestUsesHttps,
  sessionCookie,
  verifyPassword,
} from "./security.js";
import {
  isCanvaProduct,
  isLinkPoolProduct,
  isNetflixSemiPrivateVariant,
  isVariantOrderable,
  durationAllowedForVariant,
  isVidioProduct,
  isViuProduct,
  linkPoolAvailableCount,
  linkPoolsForVariant,
  normalizeDurationLabel,
  normalizeDurationModes,
  priceForDuration,
  pricesAllowedForVariant,
  stockForVariant,
  subscriptionDurationDays,
  variantStockGroupKey,
} from "./stock-groups.js";

const STORED_SECRET_PLACEHOLDER = "[stored]";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "..", "dist");
const legacyRootDir = path.resolve(process.env.LEGACY_WHATSAPP_ROOT_DIR || path.join(__dirname, "..", "..", ".."));

for (const envPath of [
  path.join(process.cwd(), ".env"),
  path.join(legacyRootDir, ".env"),
  path.resolve(__dirname, "..", "..", "..", ".env"),
]) {
  dotenv.config({ path: envPath });
}

const whatsappDatabaseDir = path.resolve(
  process.env.WHATSAPP_DATABASE_DIR || path.join(legacyRootDir, "apps", "bot", "database"),
);
installConsoleRedaction({ structured: true });
app.use(requestTelemetry());
const configuredPort = process.env.DASHBOARD_API_PORT || process.env.API_PORT || process.env.SERVER_PORT || process.env.PORT;
const configuredHost = process.env.DASHBOARD_API_HOST || process.env.API_HOST;
const port = Number(configuredPort || 4174);
const host = configuredHost || "127.0.0.1";
// Where this instance says it lives when nobody has told it. Better a link
// that plainly fails than one that quietly points at production.
const localOrigin = `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}`;
const paymentTtlMinutes = Math.max(1, Math.floor(Number(process.env.PAYMENT_TTL_MINUTES || 15) || 15));
const resellerRequiredMessage = "Nomor WhatsApp ini belum terdaftar sebagai reseller Kavya. Pembelian hanya untuk reseller aktif. Hubungi owner untuk daftar atau aktivasi reseller.";
const allowedBrowserOrigins = configuredOrigins(
  process.env.PUBLIC_DOMAIN,
  process.env.CORS_ALLOWED_ORIGINS,
  `http://${configuredHost || "127.0.0.1"}:${configuredPort || 4174}`,
);

// `req.ip` is the key for every rate limiter and audit trail, so it is only
// trustworthy when X-Forwarded-For comes from a proxy we control. See
// server/lib/client-ip.js for why this is an allowlist and not a hop count.
app.set("trust proxy", resolveTrustProxy());
app.use(securityHeaders({ isSecureRequest: requestUsesHttps }));
app.use(cors(corsOptions(allowedBrowserOrigins)));
app.use(express.json({ limit: "1mb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  try {
    assertTrustedBrowserMutation(req, allowedBrowserOrigins);
    next();
  } catch (error) {
    next(error);
  }
});

function getProduct(db, productId) {
  return db.products.find((product) => product.id === productId);
}

function getVariant(db, productId, variantId) {
  return getProduct(db, productId)?.variants?.find((variant) => variant.id === variantId);
}

function whatsappNumberCandidates(...values) {
  const candidates = new Set();
  for (const value of values.flat(Infinity)) {
    for (const part of String(value || "").split(/[,\s]+/)) {
      const digits = part.replace(/[^\d]/g, "");
      const normalized = normalizeWhatsappNumber(digits);
      if (digits) candidates.add(digits);
      if (normalized) candidates.add(normalized);
    }
  }
  candidates.delete("");
  return candidates;
}

function safeResellerRecord(reseller) {
  return reseller && typeof reseller === "object" ? reseller : {};
}

function resellerNumberCandidates(reseller = {}) {
  const source = safeResellerRecord(reseller);
  return whatsappNumberCandidates(
    source.whatsapp,
    source.phone,
    source.telepon,
    source.telp,
    source.contact,
    source.contactOwner,
    source.ownerNumber,
    source.number,
    source.whatsappNumber,
  );
}

function primaryResellerWhatsapp(reseller = {}) {
  const source = safeResellerRecord(reseller);
  return (
    normalizeWhatsappNumber(source.whatsapp) ||
    normalizeWhatsappNumber(source.phone) ||
    normalizeWhatsappNumber(source.telepon) ||
    normalizeWhatsappNumber(source.telp) ||
    normalizeWhatsappNumber(source.contact) ||
    [...resellerNumberCandidates(source)][0] ||
    ""
  );
}

function activeResellerByWhatsapp(db, whatsapp) {
  const candidates = whatsappNumberCandidates(whatsapp);
  if (!candidates.size) return null;
  return (
    (db.resellers || []).find((reseller) => {
      if (reseller.isActive === false) return false;
      return [...resellerNumberCandidates(reseller)].some((number) => candidates.has(number));
    }) || null
  );
}

function resellerById(db, resellerId) {
  const id = String(resellerId || "").trim();
  if (!id) return null;
  return (db.resellers || []).find((reseller) => reseller.id === id && reseller.isActive !== false) || null;
}

function normalizeSellerNameKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/\b(reseller|ress|seller|store|shop|official|admin)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSellerNameKey(value = "") {
  return normalizeSellerNameKey(value).replace(/\s+/g, "");
}

function resellerNameCandidates(reseller = {}) {
  const source = safeResellerRecord(reseller);
  return [
    source.name,
    source.username,
    source.email,
    source.displayName,
    source.storeName,
    source.shopName,
    source.id,
  ]
    .map(normalizeSellerNameKey)
    .filter(Boolean);
}

function sellerTextMatchesReseller(seller = "", reseller = {}) {
  const wanted = normalizeSellerNameKey(seller);
  if (!wanted) return false;
  const wantedCompact = compactSellerNameKey(seller);
  return resellerNameCandidates(reseller).some((candidate) => (
    candidate === wanted
    || candidate.replace(/\s+/g, "") === wantedCompact
    || (candidate.length >= 3 && wanted.split(" ").includes(candidate))
  ));
}

function sheetResellerAliasEntries(db) {
  return Array.isArray(db?.settings?.googleSheetsResellerAliases) ? db.settings.googleSheetsResellerAliases : [];
}

function mappedSheetResellerByAlias(db, seller = "") {
  const aliasKey = normalizeSellerNameKey(seller);
  const aliasCompact = compactSellerNameKey(seller);
  if (!aliasKey) return null;
  const matches = sheetResellerAliasEntries(db).filter((entry) => (
    normalizeSellerNameKey(entry.alias || "") === aliasKey
    || String(entry.aliasKey || "") === aliasKey
    || (entry.aliasCompact && String(entry.aliasCompact) === aliasCompact)
  ));
  const phones = [...new Set(matches.map((entry) => normalizeWhatsappNumber(entry.whatsapp || "")).filter(Boolean))];
  if (phones.length !== 1) return null;
  return matches.find((entry) => normalizeWhatsappNumber(entry.whatsapp || "") === phones[0]) || null;
}

function resellerBySellerText(db, seller = "") {
  const mapped = mappedSheetResellerByAlias(db, seller);
  if (mapped?.whatsapp) {
    const viaWhatsapp = activeResellerByWhatsapp(db, mapped.whatsapp);
    if (viaWhatsapp) return viaWhatsapp;
  }
  const matches = (db.resellers || []).filter((item) => item.isActive !== false && sellerTextMatchesReseller(seller, item));
  return matches.length === 1 ? matches[0] : null;
}

function assertResellerCanOrder(db, whatsapp) {
  const reseller = activeResellerByWhatsapp(db, whatsapp);
  if (reseller) return reseller;
  const error = new Error(resellerRequiredMessage);
  error.status = 403;
  throw error;
}

function sheetSyncKeyForProduct(product = {}) {
  if (!product) return "";
  if (isCanvaProduct(product)) return "canva";
  if (isViuProduct(product)) return "viu";
  if (isVidioProduct(product)) return "vidio";
  if (isNetflixOrderProduct(product)) return "netflix";
  return "dynamic";
}

function isGoogleSheetsBackedStock(stock = {}) {
  return String(stock?.sheetSource || "").toLowerCase() === "google_sheets";
}

async function syncGoogleSheetsStockSafely(db, options = {}) {
  if (!googleSheetsConfigured(db)) return null;
  // Sync mutates the DB object passed by updateDb. Reusing a cached result here
  // used to report success without applying Sheet changes to a newly-read DB.
  // updateDb already serializes writes, so a process-level result cache is both
  // unnecessary and unsafe.
  try {
    return await syncGoogleSheetsStock(db, options);
  } catch (error) {
    throw friendlyGoogleSheetsError(error);
  }
}

async function syncSheetsForProductOrThrow(db, product, reason = "stock_precheck", options = {}) {
  if (!googleSheetsConfigured(db)) return null;
  db.settings = db.settings || {};
  const syncKey = sheetSyncKeyForProduct(product);
  const syncScope = googleSheetsProductSyncScope(product, syncKey);
  const allowRecent = reason === "catalog_precheck" && options.reuseRecent !== false;
  const recent = allowRecent
    ? recentGoogleSheetsProductSync(
        db.settings,
        syncScope,
        Date.now(),
        Number(options.cooldownMs || GOOGLE_SHEETS_CATALOG_PRECHECK_COOLDOWN_MS),
      )
    : null;
  if (recent) {
    return {
      ok: true,
      reused: true,
      [syncKey]: recent,
      resellers: recentGoogleSheetsResellerLookup(db.settings) || {
        ok: true,
        skipped: true,
        reused: true,
        reason: "product_sync_already_refreshed",
      },
    };
  }
  let result;
  try {
    result = await syncGoogleSheetsProductStock(db, product, {
      silent: true,
      reason,
      force: options.force === true,
      syncKey,
      reuseRecentResellerLookup: reason === "catalog_precheck",
    });
  } catch (error) {
    const friendly = friendlyGoogleSheetsError(error);
    if (friendly.code === "google_sheets_rate_limited") {
      throw friendly;
    }
    enableMaintenanceMode(db, `Google Sheets gagal sync: ${friendly.message || "unknown_error"}`, "google_sheets");
    friendly.maintenance = { reason: `Google Sheets gagal sync: ${friendly.message || "unknown_error"}`, source: "google_sheets" };
    throw friendly;
  }
  const sectionError = googleSheetsSectionError(result, syncKey);
  if (sectionError) {
    if (sectionError.code === "google_sheets_rate_limited") {
      throw sectionError;
    }
    enableMaintenanceMode(db, sectionError.message, "google_sheets");
    sectionError.maintenance = { reason: sectionError.message, source: "google_sheets" };
    throw sectionError;
  }
  recordGoogleSheetsProductSync(db.settings, syncScope, result);
  return result;
}

const {
  availableStockCount,
  availableStockOrThrow,
  clearReservedStockState,
  ensureWebOrderStock,
  reserveAvailableStocksForOrder,
} = createOrderStockService({
  isCanvaProduct,
  isLinkPoolProduct,
  isTerminalManagedAccountStatus,
  isVariantOrderable,
  linkPoolAvailableCount,
  linkPoolsForVariant,
  nowText,
  stockForVariant,
  syncGoogleSheetsStockSafely,
  syncSheetsForProductOrThrow,
});

function publicCatalog(db, options = {}) {
  const includeEmpty = Boolean(options.includeEmpty);
  return (db.products || [])
    .filter((product) => product.isActive && !product.isArchived && !isOrderLocked(product, null))
    .map((product) => {
      const variants = (product.variants || [])
        .filter((variant) => isVariantOrderable(product, variant) && !isOrderLocked(product, variant))
        .map((variant) => {
          const linkPool = isLinkPoolProduct(db, product, variant);
          const fallbackAvailable = stockForVariant(db, product, variant, "available");
          const available = linkPool ? [] : fallbackAvailable;
          const linkPoolCount = linkPool
            ? linkPoolsForVariant(db, product, variant).reduce((total, pool) => total + linkPoolAvailableCount(db, pool), 0)
            : 0;
          const stockCount = linkPool
            ? (linkPoolCount > 0 || !isCanvaProduct(product) ? linkPoolCount : fallbackAvailable.length)
            : available.length;
          return {
            ...variant,
            prices: pricesAllowedForVariant(variant),
            checkoutRequirements: checkoutRequirementsForVariant(db, product, variant),
            checkoutFields: structuredCheckoutFieldsForVariant(product, variant, {
              legacyRequirements: checkoutRequirementsForVariant(db, product, variant),
            }),
            stockCount,
            stockIds: linkPool
              ? Array.from({ length: stockCount }, (_, index) => `${variant.id}-link-slot-${index}`)
              : available.map((item) => item.id),
          };
        })
        .filter((variant) => includeEmpty || variant.stockCount > 0);
      const uniqueStockIds = new Set(variants.flatMap((variant) => variant.stockIds || []));
      return {
        ...product,
        variants: variants.map(({ stockIds, ...variant }) => variant),
        stockCount: uniqueStockIds.size,
      };
    })
    .filter((product) => product.variants.length > 0 && (includeEmpty || product.stockCount > 0));
}

function maintenanceMode(db = {}) {
  const state = db.settings?.maintenance || db.settings?.maintenanceMode || {};
  return {
    enabled: Boolean(state.enabled),
    reason: String(state.reason || "").trim(),
    source: String(state.source || "manual").trim(),
    updatedAt: String(state.updatedAt || "").trim(),
  };
}

function enableMaintenanceMode(db, reason = "Maintenance aktif", source = "system") {
  db.settings = db.settings || {};
  db.settings.maintenance = {
    enabled: true,
    reason: String(reason || "Maintenance aktif").trim(),
    source: String(source || "system").trim(),
    updatedAt: nowText(),
  };
}

function setMaintenanceMode(db, enabled, reason = "", source = "manual") {
  db.settings = db.settings || {};
  db.settings.maintenance = {
    enabled: Boolean(enabled),
    reason: String(reason || (enabled ? "Maintenance manual aktif" : "")).trim(),
    source: String(source || "manual").trim(),
    updatedAt: nowText(),
  };
}

function assertOrderIntakeOpen(db) {
  const state = maintenanceMode(db);
  if (!state.enabled) return;
  if (state.source === "google_sheets" && isGoogleSheetsQuotaError(state.reason || "")) return;
  const error = new Error(state.reason || "Kavya sedang maintenance. Order baru ditahan sementara.");
  error.status = 503;
  throw error;
}

function firstConfigured(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function normalizeConfiguredUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const markdownLink = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/i);
  const candidate = markdownLink ? markdownLink[2] : raw.replace(/\\([:/])/g, "$1");
  return candidate.replace(/\/$/, "");
}

function configuredTokens(...values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function firstUsableSecret(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find((value) => value && !/^(change-me|change-this|replace-with|your-)/i.test(value)) || "";
}

function parseBotPublicUrlInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return { publicUrl: "" };
  try {
    const url = new URL(raw);
    if (url.pathname.includes("/session/qr")) {
      url.pathname = url.pathname.replace(/\/session\/qr.*$/, "") || "/";
    }
    url.search = "";
    url.hash = "";
    return { publicUrl: url.toString().replace(/\/$/, "") };
  } catch {
    return { publicUrl: raw.replace(/\/session\/qr.*$/, "").replace(/\/$/, "") };
  }
}

function randomSecret(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function assertInboundToken(req, db = {}) {
  const expectedTokens = configuredTokens(
    firstUsableSecret(db.settings?.whatsappInboundToken),
    firstUsableSecret(process.env.WHATSAPP_INBOUND_TOKEN),
  );
  if (!expectedTokens.length) {
    const error = new Error("WhatsApp inbound token belum dikonfigurasi");
    error.status = 401;
    throw error;
  }
  const authorization = String(req.get("authorization") || "").trim();
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const actual = req.get("x-whatsapp-token") || bearer || req.body?.token;
  if (!expectedTokens.includes(String(actual || "").trim())) {
    const error = new Error("Invalid WhatsApp inbound token");
    error.status = 401;
    throw error;
  }
}

function assertPakasirSecret(req, db = {}) {
  const expectedTokens = configuredTokens(
    firstUsableSecret(db.settings?.pakasirWebhookSecret),
    firstUsableSecret(process.env.PAKASIR_WEBHOOK_SECRET),
  );
  if (!expectedTokens.length) {
    const error = new Error("Pakasir webhook secret belum dikonfigurasi");
    error.status = 503;
    throw error;
  }
  const actual = req.get("x-pakasir-secret") || req.body?.secret;
  if (!expectedTokens.includes(String(actual || "").trim())) {
    const error = new Error("Invalid Pakasir webhook secret");
    error.status = 401;
    throw error;
  }
}

function ownerCredentials(db = {}) {
  const passwordHash = firstUsableSecret(db.settings?.ownerPasswordHash);
  const storedPassword = firstUsableSecret(db.settings?.ownerPassword);
  const envPassword = firstUsableSecret(process.env.OWNER_PASSWORD, process.env.OWNER_LOGIN_PASSWORD);
  return {
    email: firstConfigured(process.env.OWNER_EMAIL, process.env.OWNER_LOGIN_EMAIL, db.settings?.ownerEmail),
    passwordHash,
    legacyPassword: storedPassword && storedPassword !== "admin12345" ? storedPassword : envPassword,
    envPassword,
  };
}

function ownerPasswordConfigured(credentials = {}) {
  return Boolean(credentials.passwordHash || credentials.legacyPassword);
}

function verifyOwnerPassword(credentials = {}, password = "") {
  return (
    verifyPassword(password, credentials.envPassword || "") ||
    verifyPassword(password, credentials.passwordHash || credentials.legacyPassword || "")
  );
}

function ownerProfile(db) {
  const name = String(db.settings?.ownerName || "Admin Owner").trim() || "Admin Owner";
  const username = String(
    firstConfigured(process.env.OWNER_USERNAME, process.env.OWNER_LOGIN_USERNAME, db.settings?.ownerUsername, "owner"),
  ).trim() || "owner";
  const email = String(firstConfigured(process.env.OWNER_EMAIL, process.env.OWNER_LOGIN_EMAIL, db.settings?.ownerEmail, "owner@kavya.id")).trim() || "owner@kavya.id";
  const whatsapp = String(db.settings?.ownerWhatsAppNumber || process.env.OWNER_WHATSAPP_NUMBER || "").replace(/[^\d]/g, "");
  const initial = String(db.settings?.ownerInitial || name.slice(0, 1) || "A").trim().slice(0, 2).toUpperCase();
  return { name, username, email, whatsapp, initial: initial || "O" };
}

function warrantyWhatsAppNumber(db = {}) {
  return normalizeWhatsappNumber(
    db.settings?.warrantyWhatsAppNumber ||
      process.env.WARRANTY_WHATSAPP_NUMBER ||
      process.env.GARANSI_WHATSAPP_NUMBER ||
      db.settings?.ownerWhatsAppNumber ||
      process.env.OWNER_WHATSAPP_NUMBER ||
      ownerProfile(db).whatsapp ||
      "",
  );
}

function ownerIntegrationSettings(db) {
  const settings = db.settings || {};
  const publicDomain = publicWebsiteUrl(db, { fallback: localOrigin });
  const pakasir = {
    apiKey: firstUsableSecret(settings.pakasirApiKey, process.env.PAKASIR_API_KEY),
    merchantId: firstConfigured(settings.pakasirMerchantId, settings.pakasirProject, process.env.PAKASIR_PROJECT),
    webhookSecret: firstUsableSecret(settings.pakasirWebhookSecret, process.env.PAKASIR_WEBHOOK_SECRET),
  };
  const bailey = {
    sessionId: firstConfigured(settings.baileySessionId, process.env.WHATSAPP_BAILEY_SESSION_ID, "kavya-main"),
    botNumber: firstConfigured(settings.baileyBotNumber, process.env.WHATSAPP_BOT_NUMBER, settings.ownerWhatsAppNumber).replace(/[^\d]/g, ""),
    publicUrl: firstConfigured(settings.whatsappBotPublicUrl, process.env.WHATSAPP_BOT_PUBLIC_URL, `${publicDomain}/whatsapp-bot`),
    webhookUrl: firstConfigured(settings.baileyWebhookUrl, process.env.WHATSAPP_INBOUND_WEBHOOK_URL, `${publicDomain}/api/whatsapp/inbound`),
    qrisGenerateUrl: firstConfigured(settings.baileyQrisGenerateUrl, `${publicDomain}/api/orders`),
    botToken: firstUsableSecret(settings.whatsappBotToken, process.env.WHATSAPP_BOT_TOKEN),
    inboundToken: firstUsableSecret(settings.whatsappInboundToken, process.env.WHATSAPP_INBOUND_TOKEN),
  };
  const gmail = {
    mode: firstConfigured(settings.gmailMode, process.env.GMAIL_MODE, settings.gmailImapPassword ? "imap" : "oauth").toLowerCase(),
    clientId: firstConfigured(settings.gmailClientId, process.env.GMAIL_CLIENT_ID),
    clientSecret: firstUsableSecret(settings.gmailClientSecret, process.env.GMAIL_CLIENT_SECRET),
    redirectUri: firstConfigured(settings.gmailRedirectUri, process.env.GMAIL_REDIRECT_URI, `${publicDomain}/api/gmail/oauth/callback`),
    inboxEmail: firstConfigured(settings.gmailInboxEmail, process.env.GMAIL_INBOX_EMAIL),
    refreshToken: firstUsableSecret(settings.gmailRefreshToken, process.env.GMAIL_REFRESH_TOKEN),
    imapHost: firstConfigured(settings.gmailImapHost, process.env.GMAIL_IMAP_HOST, "imap.gmail.com"),
    imapPort: Number(firstConfigured(settings.gmailImapPort, process.env.GMAIL_IMAP_PORT, "993")) || 993,
    imapUser: firstConfigured(settings.gmailImapUser, process.env.GMAIL_IMAP_USER, settings.gmailInboxEmail, process.env.GMAIL_INBOX_EMAIL),
    imapPassword: firstUsableSecret(settings.gmailImapPassword, process.env.GMAIL_IMAP_PASSWORD).replace(/\s+/g, ""),
    imapSecure: String(firstConfigured(settings.gmailImapSecure, process.env.GMAIL_IMAP_SECURE, "true")).toLowerCase() !== "false",
  };
  const cloudflare = {
    publicDomain,
    tunnelToken: firstUsableSecret(process.env.CLOUDFLARED_TOKEN),
  };
  const payment = {
    ownerQrisImageUrl: firstConfigured(settings.ownerQrisImageUrl, process.env.OWNER_QRIS_IMAGE_URL),
    ownerQrisNote: firstConfigured(settings.ownerQrisNote, process.env.OWNER_QRIS_NOTE),
    danaNumber: firstConfigured(settings.danaNumber, process.env.OWNER_DANA_NUMBER),
    danaName: firstConfigured(settings.danaName, process.env.OWNER_DANA_NAME),
    livinNumber: firstConfigured(settings.livinNumber, process.env.OWNER_LIVIN_NUMBER),
    livinName: firstConfigured(settings.livinName, process.env.OWNER_LIVIN_NAME),
    bcaNumber: firstConfigured(settings.bcaNumber, process.env.OWNER_BCA_NUMBER),
    bcaName: firstConfigured(settings.bcaName, process.env.OWNER_BCA_NAME),
    gopayNumber: firstConfigured(settings.gopayNumber, process.env.OWNER_GOPAY_NUMBER),
    gopayName: firstConfigured(settings.gopayName, process.env.OWNER_GOPAY_NAME),
    shopeepayNumber: firstConfigured(settings.shopeepayNumber, process.env.OWNER_SHOPEEPAY_NUMBER),
    shopeepayName: firstConfigured(settings.shopeepayName, process.env.OWNER_SHOPEEPAY_NAME),
  };
  const googleSheets = googleSheetsPublicSettings(db);
  const gmailHasConfig = Boolean(gmail.clientId && gmail.clientSecret && gmail.redirectUri);
  const gmailHasToken = Boolean(gmail.refreshToken);
  const gmailHasImap = Boolean(gmail.imapHost && gmail.imapPort && gmail.imapUser && gmail.imapPassword);
  const gmailTokenInvalid = String(settings.gmailOAuthStatus || "").toLowerCase() === "invalid";
  const gmailStatus = gmail.mode === "imap"
    ? gmailHasImap ? "connected" : "disconnected"
    : gmailHasConfig && gmailHasToken && !gmailTokenInvalid ? "connected" : gmailHasConfig ? "needs_oauth" : "disconnected";
  const sheetsHealth = googleSheetsSyncHealth(settings);
  return {
    profile: ownerProfile(db),
    pakasir,
    bailey,
    gmail,
    cloudflare,
    payment,
    googleSheets,
    status: {
      pakasir: pakasir.merchantId && pakasir.apiKey ? "connected" : "disconnected",
      bailey: bailey.sessionId && bailey.botNumber && bailey.botToken && bailey.inboundToken ? "connected" : "disconnected",
      gmail: gmailStatus,
      googleSheets: !googleSheetsConfigured(db)
        ? "disconnected"
        : sheetsHealth.healthy ? "connected" : "degraded",
    },
  };
}

function maskedOwnerIntegrationSettings(db) {
  const settings = ownerIntegrationSettings(db);
  const masked = structuredClone(settings);
  const mask = (value) => value ? STORED_SECRET_PLACEHOLDER : "";
  masked.pakasir.apiKey = mask(settings.pakasir.apiKey);
  masked.pakasir.webhookSecret = mask(settings.pakasir.webhookSecret);
  masked.bailey.botToken = mask(settings.bailey.botToken);
  masked.bailey.inboundToken = mask(settings.bailey.inboundToken);
  masked.gmail.clientSecret = mask(settings.gmail.clientSecret);
  masked.gmail.refreshToken = mask(settings.gmail.refreshToken);
  masked.gmail.imapPassword = mask(settings.gmail.imapPassword);
  masked.cloudflare.tunnelToken = mask(settings.cloudflare.tunnelToken);
  return masked;
}

function mergeStoredSecret(input, stored = "") {
  const value = String(input ?? "").trim();
  return value === STORED_SECRET_PLACEHOLDER ? String(stored || "") : value;
}

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function authSecret() {
  const secret = firstUsableSecret(process.env.AUTH_SECRET, process.env.SESSION_SECRET);
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET wajib diisi dengan secret acak minimal 32 karakter dan tidak boleh memakai password owner");
  }
  return secret;
}

function signPayload(payload) {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

function sessionTtlSeconds(remember = false) {
  const defaultTtl = 60 * 60 * 8;
  const rememberTtl = 60 * 60 * 24 * 30;
  const configured = remember
    ? firstConfigured(process.env.SESSION_REMEMBER_TTL_SECONDS, process.env.SESSION_TTL_REMEMBER_SECONDS, rememberTtl)
    : firstConfigured(process.env.SESSION_TTL_SECONDS, defaultTtl);
  const ttl = Number(configured);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : remember ? rememberTtl : defaultTtl;
}

function setSessionCookie(req, res, token, remember = false) {
  res.setHeader("Set-Cookie", sessionCookie(token, {
    secure: requestUsesHttps(req) || process.env.NODE_ENV === "production",
    maxAgeSeconds: sessionTtlSeconds(remember),
  }));
}

function removeSessionCookie(req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie({
    secure: requestUsesHttps(req) || process.env.NODE_ENV === "production",
  }));
}

function issueAuthToken(session, sessionVersion = 0, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    sub: session.user.id,
    role: session.role,
    name: session.user.name,
    email: session.user.email || "",
    username: session.user.username || "",
    sv: Number(sessionVersion || 0),
    iat: now,
    exp: now + sessionTtlSeconds(Boolean(options.remember)),
  });
  return `${header}.${payload}.${signPayload(`${header}.${payload}`)}`;
}

function authSessionResponse(req, res, session, sessionVersion = 0, remember = false) {
  const token = issueAuthToken(session, sessionVersion, { remember });
  setSessionCookie(req, res, token, remember);
  const payload = { ...session };
  // CLI/regression clients may continue using Bearer tokens. Browser sessions
  // receive only an HttpOnly cookie, so JavaScript never stores the JWT.
  if (!req.get("origin")) payload.token = token;
  res.json(payload);
}

function verifyAuthToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = signPayload(`${header}.${payload}`);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.sub || !data?.role || Number(data.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function sessionVersionForAuth(db, auth) {
  if (auth.role === "owner") return Number(db.settings?.ownerSessionVersion || 0);
  const reseller = (db.resellers || []).find((item) => item.id === auth.sub);
  if (!reseller) return null;
  return Number(reseller.sessionVersion || 0);
}

function requireAuth(roles = ["owner", "reseller"]) {
  return async (req, res, next) => {
    const header = req.get("authorization") || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const token = bearer || parseCookies(req.get("cookie") || "")[SESSION_COOKIE_NAME] || "";
    const auth = verifyAuthToken(token);
    if (!auth) {
      res.status(401).json({ error: "Sesi login tidak valid atau sudah berakhir" });
      return;
    }
    if (!roles.includes(auth.role)) {
      res.status(403).json({ error: "Akses tidak diizinkan untuk role ini" });
      return;
    }
    try {
      const db = await readDb();
      const expectedVersion = sessionVersionForAuth(db, auth);
      if (expectedVersion === null || Number(auth.sv || 0) !== expectedVersion) {
        res.status(401).json({ error: "Sesi login tidak valid atau sudah berakhir" });
        return;
      }
      req.auth = auth;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function authReseller(db, auth) {
  if (auth?.role !== "reseller") return null;
  return (db.resellers || []).find((item) => item.id === auth.sub) || null;
}

const defaultResellerAccessTools = ["signin", "verification", "household"];

function normalizeResellerAccessTools(value, fallback = defaultResellerAccessTools) {
  const allowed = new Set(["signin", "verification", "reset", "household"]);
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : defaultResellerAccessTools;
  const normalized = source
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => allowed.has(item));
  return Array.from(new Set(normalized));
}

function resellerAccessTools(reseller = {}) {
  return normalizeResellerAccessTools(reseller.allowedAccessTools, defaultResellerAccessTools);
}

function orderBelongsToReseller(db, auth, order) {
  if (auth?.role !== "reseller") return true;
  if (order.resellerId) return order.resellerId === auth.sub;
  const reseller = authReseller(db, auth);
  if (!reseller) return false;
  return resellerNumberCandidates(reseller).has(normalizeWhatsappNumber(order.whatsapp));
}

function ownedStockIdsForReseller(db, auth) {
  if (auth?.role !== "reseller") return new Set();
  return new Set(
    (db.orders || [])
      .filter((order) => orderBelongsToReseller(db, auth, order))
      .flatMap((order) => order.deliveredStockIds || [])
      .map((stockId) => String(stockId || "").trim())
      .filter(Boolean),
  );
}

function orderForManagedAccount(db, account = {}) {
  const directOrderId = String(account.orderId || account.sourceOrderId || "").trim();
  const stockId = String(account.stockId || "").trim();
  if (directOrderId) {
    const direct = (db.orders || []).find((item) => String(item.id || "").trim() === directOrderId);
    const deliveredIds = new Set((direct?.deliveredStockIds || []).map((item) => String(item || "").trim()).filter(Boolean));
    if (direct && (!stockId || !deliveredIds.size || deliveredIds.has(stockId))) return direct;
  }
  if (!stockId) return null;
  return (db.orders || []).find((item) => (item.deliveredStockIds || []).some((candidate) => String(candidate || "").trim() === stockId)) || null;
}

function stockForManagedAccount(db, account = {}) {
  const stockId = String(account.stockId || "").trim();
  const sheetStockKey = String(account.sheetStockKey || "").trim();
  if (!stockId && !sheetStockKey) return null;
  return (db.stock || []).find((item) => (
    (stockId && String(item.id || "").trim() === stockId)
    || (sheetStockKey && String(item.sheetStockKey || "").trim() === sheetStockKey)
  )) || null;
}

function addManagedAccountResellerCandidate(candidates, reseller, score, source) {
  if (!reseller?.id) return;
  const current = candidates.get(reseller.id);
  if (!current || score > current.score) {
    candidates.set(reseller.id, { reseller, score, source });
  }
}

function resolveManagedAccountReseller(db, account = {}, options = {}) {
  const order = options.order || orderForManagedAccount(db, account);
  const candidates = new Map();
  const sheetBacked = String(account.sheetSource || account.source || "").toLowerCase() === "google_sheets";
  // For Sheet-backed accounts, the explicit SELLER cell is authoritative.
  // Stale order/WhatsApp metadata must not move the assignment to another user.
  if (sheetBacked && String(account.sheetSellerInput || "").trim()) {
    addManagedAccountResellerCandidate(
      candidates,
      resellerBySellerText(db, account.sheetSellerInput),
      700,
      "sheet_seller",
    );
  }
  addManagedAccountResellerCandidate(candidates, resellerById(db, order?.resellerId), 500, "order_reseller_id");
  addManagedAccountResellerCandidate(candidates, activeResellerByWhatsapp(db, order?.whatsapp || ""), 460, "order_whatsapp");
  addManagedAccountResellerCandidate(candidates, activeResellerByWhatsapp(db, account.whatsapp || ""), 420, "account_whatsapp");
  addManagedAccountResellerCandidate(candidates, resellerBySellerText(db, account.reseller || account.buyer || order?.customer || ""), 360, "seller_text");
  addManagedAccountResellerCandidate(candidates, resellerById(db, account.resellerId), 240, "account_reseller_id");
  const ranked = [...candidates.values()].sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].reseller.id !== ranked[1].reseller.id) {
    return null;
  }
  return ranked[0].reseller;
}

function managedAccountBelongsToReseller(db, auth, account = {}, options = {}) {
  if (auth?.role !== "reseller") return true;
  const reseller = options.reseller || authReseller(db, auth);
  if (!reseller) return false;

  const resolvedReseller = resolveManagedAccountReseller(db, account, { order: options.order });
  if (resolvedReseller?.id) return resolvedReseller.id === auth.sub;

  if (account.resellerId) return account.resellerId === auth.sub;

  const resellerWhatsapp = options.resellerWhatsapp || primaryResellerWhatsapp(reseller);
  if (account.whatsapp && resellerWhatsapp) return normalizeWhatsappNumber(account.whatsapp) === resellerWhatsapp;

  const ownedStockIds = options.ownedStockIds || ownedStockIdsForReseller(db, auth);
  if (account.stockId && ownedStockIds.has(String(account.stockId || "").trim())) return true;

  return [account.reseller, account.buyer].some((value) => sellerTextMatchesReseller(value, reseller));
}

function looksLikeEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isMalformedManagedAccount(account = {}) {
  if (account.sheetSource !== "google_sheets") return false;
  if (!isNetflixManagedAccount(account)) return false;
  const email = String(account.email || "").trim();
  const password = String(account.password || "").trim();
  if (!looksLikeEmail(email)) return true;
  if (!password) return true;
  return false;
}

function isVirtualManagedStockLink(account = {}) {
  const stockId = String(account.stockId || "").trim().toLowerCase();
  const source = String(account.source || account.sheetSource || "").trim().toLowerCase();
  const product = String(account.product || account.productId || "").trim().toLowerCase();
  return stockId.startsWith("canva-")
    || stockId.startsWith("link-")
    || source.startsWith("canva")
    || source.includes("link_pool")
    || product.includes("canva");
}

function managedAccountSlotKey(account = {}) {
  if (!isNetflixManagedAccount(account)) return "";
  const email = String(account.email || "").trim().toLowerCase();
  const profile = String(account.profile || "").trim().toLowerCase();
  if (!email || !profile) return "";
  return `${email}::${profile}`;
}

function overlappingLiveSlotAccount(db, account = {}) {
  const wanted = managedAccountSlotKey(account);
  if (!wanted) return null;
  return (db.managedAccounts || []).find((candidate) => {
    if (!candidate || candidate.id === account.id) return false;
    if (candidate.hidden || candidate.returnedToStockAt) return false;
    const status = String(candidate.status || accountStatusFromDate(candidate.expiresAt, candidate.durationDays)).toLowerCase();
    if (["expired", "replaced", "disabled"].includes(status)) return false;
    if (managedAccountSlotKey(candidate) !== wanted) return false;
    const sameOrder = String(candidate.orderId || candidate.sourceOrderId || "").trim() === String(account.orderId || account.sourceOrderId || "").trim();
    const sameStock = String(candidate.stockId || "").trim() === String(account.stockId || "").trim();
    return !sameOrder || !sameStock;
  }) || null;
}

function sameMinuteBucket(left = "", right = "") {
  return String(left || "").slice(0, 16) && String(left || "").slice(0, 16) === String(right || "").slice(0, 16);
}

function deliveredAccountsForOrder(db, order = {}, options = {}) {
  const includeHidden = options.includeHidden === true;
  const deliveredStockIds = new Set((order.deliveredStockIds || []).map((item) => String(item || "").trim()).filter(Boolean));
  const orderId = String(order.id || "").trim();
  const direct = (db.managedAccounts || []).filter((account) => (
    (includeHidden || isDeliverableManagedAccount(account))
    && String(account.orderId || account.sourceOrderId || "").trim() === orderId
  ));
  if (direct.length) return direct;
  const fallback = (db.managedAccounts || []).filter((account) => {
    if (!includeHidden && !isDeliverableManagedAccount(account)) return false;
    if (!deliveredStockIds.size || !deliveredStockIds.has(String(account.stockId || "").trim())) return false;
    if (order.expiresAt && String(account.expiresAt || "").trim() === String(order.expiresAt || "").trim()) return true;
    return sameMinuteBucket(account.startedAt, order.paidAt || order.createdAt);
  });
  return fallback;
}

function directManagedAccountsForOrder(db, order = {}, options = {}) {
  const includeHidden = options.includeHidden === true;
  const orderId = String(order.id || "").trim();
  if (!orderId) return [];
  return (db.managedAccounts || []).filter((account) => (
    (includeHidden || isDeliverableManagedAccount(account))
    && String(account.orderId || account.sourceOrderId || "").trim() === orderId
  ));
}

function stockHasConflictingHistoricalOrders(db, stock = null, order = null) {
  const stockId = String(stock?.id || "").trim();
  if (!stockId) return false;
  if (String(stock?.sheetSource || "").toLowerCase() !== "google_sheets") return false;
  const currentOrderId = String(order?.id || "").trim();
  const orderIds = new Set();
  for (const account of db.managedAccounts || []) {
    if (String(account.stockId || "").trim() !== stockId) continue;
    const linkedOrderId = String(account.orderId || account.sourceOrderId || "").trim();
    if (linkedOrderId) orderIds.add(linkedOrderId);
  }
  for (const candidate of db.orders || []) {
    if (!(candidate.deliveredStockIds || []).some((item) => String(item || "").trim() === stockId)) continue;
    const linkedOrderId = String(candidate.id || "").trim();
    if (linkedOrderId) orderIds.add(linkedOrderId);
  }
  if (currentOrderId) orderIds.delete(currentOrderId);
  return orderIds.size > 0 || Boolean(stock?.historyConflict);
}

function syncHistoricalStockConflicts(db) {
  db.stock = db.stock || [];
  const orderIdsByStock = new Map();
  for (const account of db.managedAccounts || []) {
    const stockId = String(account.stockId || "").trim();
    const orderId = String(account.orderId || account.sourceOrderId || "").trim();
    if (!stockId || !orderId) continue;
    const set = orderIdsByStock.get(stockId) || new Set();
    set.add(orderId);
    orderIdsByStock.set(stockId, set);
  }
  for (const order of db.orders || []) {
    const orderId = String(order.id || "").trim();
    if (!orderId) continue;
    for (const stockIdRaw of order.deliveredStockIds || []) {
      const stockId = String(stockIdRaw || "").trim();
      if (!stockId) continue;
      const set = orderIdsByStock.get(stockId) || new Set();
      set.add(orderId);
      orderIdsByStock.set(stockId, set);
    }
  }

  let updated = 0;
  for (const stock of db.stock || []) {
    const stockId = String(stock.id || "").trim();
    if (!stockId) continue;
    const orderIds = [...(orderIdsByStock.get(stockId) || new Set())].sort();
    const conflicting = isGoogleSheetsBackedStock(stock) && orderIds.length > 1;
    if (conflicting) {
      if (!stock.historyConflict) {
        stock.historyConflict = true;
        updated += 1;
      }
      const serialized = JSON.stringify(orderIds);
      if (JSON.stringify(stock.historyConflictOrderIds || []) !== serialized) {
        stock.historyConflictOrderIds = orderIds;
        updated += 1;
      }
      if (!stock.historyConflictDetectedAt) {
        stock.historyConflictDetectedAt = nowText();
        updated += 1;
      }
      if (!stock.autoBackfillBlocked) {
        stock.autoBackfillBlocked = true;
        updated += 1;
      }
    } else {
      if (stock.historyConflict) {
        delete stock.historyConflict;
        updated += 1;
      }
      if (stock.historyConflictOrderIds) {
        delete stock.historyConflictOrderIds;
        updated += 1;
      }
      if (stock.historyConflictDetectedAt) {
        delete stock.historyConflictDetectedAt;
        updated += 1;
      }
      if (stock.autoBackfillBlocked) {
        delete stock.autoBackfillBlocked;
        updated += 1;
      }
    }
  }
  return updated;
}

function repairHistoricalStockReuse(db) {
  db.stock = db.stock || [];
  db.managedAccounts = db.managedAccounts || [];
  let updated = 0;

  for (const stock of db.stock || []) {
    if (!isGoogleSheetsBackedStock(stock)) continue;
    // Sheet-owned account health is authoritative. Recovery may repair
    // historical links, but must never reopen or rewrite a blocked row.
    if (stockBlockedByAccountCondition(stock)) continue;
    const stockStatus = String(stock.status || "").toLowerCase();
    const sheetReturned = stockStatus === "available";
    if (sheetReturned) continue;
    if (!stock.historyConflict && !stockHasConflictingHistoricalOrders(db, stock)) continue;
    const accounts = (db.managedAccounts || []).filter((account) => (
      String(account.stockId || "").trim() === String(stock.id || "").trim()
      || (stock.sheetStockKey && String(account.sheetStockKey || "").trim() === String(stock.sheetStockKey || "").trim())
    ));
    if (!accounts.length) continue;
    const ranked = accounts.slice().sort((left, right) => {
      const leftStart = createdAtMs(left.startedAt || left.snapshotAt || left.expiresAt || "");
      const rightStart = createdAtMs(right.startedAt || right.snapshotAt || right.expiresAt || "");
      return rightStart - leftStart;
    });
    const keeper = ranked[0];
    const keeperStatus = accountStatusFromDate(keeper.expiresAt, keeper.durationDays);
    if (keeper.hidden) {
      keeper.hidden = false;
      updated += 1;
    }
    if (keeper.returnedToStockAt) {
      delete keeper.returnedToStockAt;
      updated += 1;
    }
    if (keeper.status !== keeperStatus) {
      keeper.status = keeperStatus;
      updated += 1;
    }
    for (const account of ranked.slice(1)) {
      const nextStatus = accountStatusFromDate(account.expiresAt, account.durationDays);
      const shouldReplace = nextStatus !== "expired";
      if (shouldReplace && account.status !== "replaced") {
        account.status = "replaced";
        updated += 1;
      }
      if (account.hidden) {
        account.hidden = false;
        updated += 1;
      }
    }

    const linkedOrder = orderForManagedAccount(db, keeper)
      || (db.orders || []).find((order) => (order.deliveredStockIds || []).some((candidate) => String(candidate || "").trim() === String(stock.id || "").trim()))
      || null;
    const nextBuyer = String(keeper.buyer || linkedOrder?.customer || stock.buyer || "").trim();
    const nextReseller = String(keeper.reseller || linkedOrder?.reseller || stock.reseller || "").trim();
    const nextResellerId = String(keeper.resellerId || linkedOrder?.resellerId || stock.resellerId || "").trim();
    const nextWhatsapp = normalizeWhatsappNumber(keeper.whatsapp || linkedOrder?.whatsapp || stock.whatsapp || "");
    const nextOrderId = String(keeper.orderId || keeper.sourceOrderId || linkedOrder?.id || stock.sheetOrderId || "").trim();
    const nextSoldAt = String(keeper.startedAt || linkedOrder?.paidAt || linkedOrder?.createdAt || stock.soldAt || "").trim();
    const nextExpiresAt = String(keeper.expiresAt || stock.expiresAt || stock.soldExpiresAt || "").trim();
    const nextDuration = String(keeper.duration || linkedOrder?.duration || stock.soldDuration || "").trim();
    const nextDurationDays = Math.max(0, Number(keeper.durationDays || linkedOrder?.durationDays || stock.soldDurationDays || 0));

    if (String(stock.status || "").toLowerCase() !== "sold") {
      stock.status = "sold";
      updated += 1;
    }
    if (nextBuyer && String(stock.buyer || "").trim() !== nextBuyer) {
      stock.buyer = nextBuyer;
      updated += 1;
    }
    if (nextReseller && String(stock.reseller || "").trim() !== nextReseller) {
      stock.reseller = nextReseller;
      updated += 1;
    }
    if (nextResellerId && String(stock.resellerId || "").trim() !== nextResellerId) {
      stock.resellerId = nextResellerId;
      updated += 1;
    }
    if (nextWhatsapp && normalizeWhatsappNumber(stock.whatsapp || "") !== nextWhatsapp) {
      stock.whatsapp = nextWhatsapp;
      updated += 1;
    }
    if (nextOrderId && String(stock.sheetOrderId || "").trim() !== nextOrderId) {
      stock.sheetOrderId = nextOrderId;
      updated += 1;
    }
    if (nextSoldAt && String(stock.soldAt || "").trim() !== nextSoldAt) {
      stock.soldAt = nextSoldAt;
      updated += 1;
    }
    if (nextExpiresAt && String(stock.soldExpiresAt || stock.expiresAt || "").trim() !== nextExpiresAt) {
      stock.soldExpiresAt = nextExpiresAt;
      stock.expiresAt = nextExpiresAt;
      updated += 1;
    }
    if (nextDuration && String(stock.soldDuration || "").trim() !== nextDuration) {
      stock.soldDuration = nextDuration;
      updated += 1;
    }
    if (nextDurationDays > 0 && Number(stock.soldDurationDays || 0) !== nextDurationDays) {
      stock.soldDurationDays = nextDurationDays;
      updated += 1;
    }
  }

  return updated;
}

function deliveryAccountSummary(account = {}, options = {}) {
  const includeSecrets = options.includeSecrets === true;
  const includeSheetMeta = options.includeSheetMeta === true;
  const summary = {
    id: account.id,
    stockId: account.stockId || "",
    orderId: account.orderId || account.sourceOrderId || "",
    product: account.product || "",
    variant: account.variant || "",
    email: account.email || "",
    loginPhone: account.loginPhone || "",
    profile: account.profile || "",
    startedAt: account.startedAt || "",
    expiresAt: account.expiresAt || "",
    status: account.status || "",
    reseller: account.reseller || "",
    buyer: account.buyer || "",
    device: account.device || "",
    source: account.source || "",
  };
  if (includeSecrets) {
    summary.password = account.password || "";
    summary.pin = account.pin || "";
    summary.canvaLink = account.canvaLink || "";
    summary.deliveryTemplateSnapshot = account.deliveryTemplateSnapshot || null;
    summary.deliveryTemplateUnreadAt = account.deliveryTemplateUnreadAt || "";
    summary.deliveryTemplateOpenedAt = account.deliveryTemplateOpenedAt || "";
  }
  if (includeSheetMeta) {
    summary.sheetName = account.sheetName || "";
    summary.sheetRow = Number(account.sheetRow || 0);
    summary.sheetPool = account.sheetPool || "";
  }
  return summary;
}

function orderBaseForApi(order = {}, options = {}) {
  const detail = options.detail === true;
  const publicView = options.public === true;
  const base = publicView ? safePublicOrder(order) : { ...order };
  if (!detail) {
    base.fulfillmentText = "";
    base.snkText = "";
    base.deliveryTemplateSnapshot = order.deliveryTemplateSnapshot ? {
      status: order.deliveryTemplateSnapshot.status || "not_configured",
      variantId: order.deliveryTemplateSnapshot.variantId || order.variantId || "",
      sku: order.deliveryTemplateSnapshot.sku || order.variantCode || "",
      templateVersion: Number(order.deliveryTemplateSnapshot.templateVersion || 0),
      renderedAt: order.deliveryTemplateSnapshot.renderedAt || "",
      missingFields: order.deliveryTemplateSnapshot.missingFields || [],
    } : null;
    delete base.deliveryTemplateSnapshots;
    delete base.trackingToken;
  }
  return base;
}

function isSmokeTestReseller(reseller = {}) {
  return Boolean(reseller.isSmokeTestAccount) || String(reseller.username || "").trim().toLowerCase() === "kya";
}

function orderUsesSmokeTestReseller(db, order = {}) {
  const reseller = (db.resellers || []).find((item) => (
    (order.resellerId && item.id === order.resellerId)
    || (order.reseller && String(item.username || "").trim().toLowerCase() === String(order.reseller || "").trim().toLowerCase())
  ));
  return isSmokeTestReseller(reseller);
}

function serializeOrderForApi(db, order = {}, options = {}) {
  const viewerRole = options.viewerRole || "owner";
  const publicView = viewerRole === "public";
  const detail = options.detail === true;
  const deliveredAccounts = deliveredAccountsForOrder(db, order);
  const traceEvents = detail && !publicView ? buildOrderTraceEvents(db, order) : [];
  const accounts = detail && !publicView
    ? deliveredAccounts.map((account) => deliveryAccountSummary(account, {
        includeSecrets: true,
        includeSheetMeta: viewerRole === "owner",
      }))
    : [];
  const base = orderBaseForApi(order, { public: publicView, detail });
  base.excludeFromSalesMetrics = Boolean(base.excludeFromSalesMetrics || isSmokeTestOrder(order) || orderUsesSmokeTestReseller(db, order));
  return {
    ...base,
    customer: publicView ? "" : order.customer || base.customer || "",
    whatsapp: publicView ? "" : order.whatsapp || base.whatsapp || "",
    resellerId: publicView ? "" : order.resellerId || "",
    reseller: publicView ? "" : order.reseller || "",
    resellerName: publicView ? "" : order.reseller || order.customer || "",
    deliveredAccounts: accounts,
    deliveredAccountCount: deliveredAccounts.length,
    traceEvents,
  };
}

function isSmokeTestOrder(order = {}) {
  return Boolean(order.isSmokeTest || String(order.source || "").toLowerCase() === "owner_smoke_test");
}

function visibleManagedAccountsForAuth(db, auth) {
  const stockRows = db.stock || [];
  const visible = (db.managedAccounts || []).filter((account) => {
    if (account.hidden || account.returnedToStockAt) return false;
    if (account.sheetClearedAt && String(account.sheetSource || account.source || "").toLowerCase() === "google_sheets") return false;
    if (isMalformedManagedAccount(account)) return false;
    if (account.sheetSource !== "google_sheets") return true;
    const linkedStock = stockRows.find((stock) => (
      (account.stockId && stock.id === account.stockId)
      || (account.sheetStockKey && stock.sheetStockKey === account.sheetStockKey)
    ));
    // Sheet-backed accounts without a current Sheet stock row are historical
    // tombstones, not active/expired accounts for the dashboard.
    if (!linkedStock) return false;
    const stockReturned = linkedStock.status === "available" && !linkedStock.soldAt && !linkedStock.reservedFor && !linkedStock.reservedAccountId;
    return !stockReturned;
  });
  if (auth?.role !== "reseller") return visible;

  const reseller = authReseller(db, auth);
  if (!reseller) return [];
  const resellerWhatsapp = primaryResellerWhatsapp(reseller);
  const ownedStockIds = ownedStockIdsForReseller(db, auth);
  return visible.filter((account) => managedAccountBelongsToReseller(db, auth, account, { reseller, resellerWhatsapp, ownedStockIds }));
}

function activityBelongsToReseller(db, auth, activity) {
  if (auth?.role !== "reseller") return true;
  const reseller = authReseller(db, auth);
  if (!reseller) return false;
  const resellerWhatsapp = primaryResellerWhatsapp(reseller);
  if (activity.resellerId) return activity.resellerId === auth.sub;
  const activityWhatsapp = normalizeWhatsappNumber(activity.whatsapp || "");
  if (activityWhatsapp) return Boolean(resellerWhatsapp && activityWhatsapp === resellerWhatsapp);

  const account = activity.accountId
    ? (db.managedAccounts || []).find((item) => item.id === activity.accountId)
    : null;
  if (activity.accountId && !account) return false;
  if (account) return managedAccountBelongsToReseller(db, auth, account, { reseller, resellerWhatsapp });
  return false;
}

const loginAttempts = createLoginAttemptLimiter();
const publicTrackingLimiter = createPublicTrackingLimiter();

async function recordPublicTrackingAudit({ outcome, client, orderId = "" }) {
  const clientHash = crypto.createHash("sha256").update(String(client || "unknown")).digest("hex").slice(0, 12);
  await updateDb((db) => {
    db.activities = db.activities || [];
    db.activities.unshift({
      id: makeId("act"),
      type: "security",
      title: "Public order tracking",
      description: `Outcome ${outcome}; client ${clientHash}${orderId ? `; order ${orderId}` : ""}.`,
      createdAt: nowText(),
      orderId,
    });
    db.activities = db.activities.slice(0, 5_000);
    return null;
  });
}

function assertLoginAllowed(req, email) {
  const limit = loginAttempts.check(req, email);
  if (limit.allowed) return;
  const error = new Error("Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.");
  error.status = 429;
  error.retryAfterSeconds = limit.retryAfterSeconds;
  throw error;
}

function recordLoginFailure(req, email) {
  loginAttempts.recordFailure(req, email);
}

function clearLoginFailures(req, email) {
  loginAttempts.clear(req, email);
}

function normalizeLoginIdentifier(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeWhatsappNumber(value = "") {
  const digits = String(value || "").split("@")[0].split(":")[0].replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function normalizeEmailKey(value = "") {
  return String(value || "").trim().toLowerCase();
}

function findPasswordResetAccount(db, identifier) {
  const query = normalizeLoginIdentifier(identifier);
  const whatsappQuery = normalizeWhatsappNumber(identifier);
  if (!query) return null;

  const owner = ownerCredentials(db);
  const profile = ownerProfile(db);
  const ownerCandidates = [owner.email, profile.email, profile.username, `${profile.username}@kavya.id`]
    .filter(Boolean)
    .map(normalizeLoginIdentifier);
  if (ownerCandidates.includes(query) || (whatsappQuery && whatsappQuery === normalizeWhatsappNumber(profile.whatsapp))) {
    return {
      role: "owner",
      id: "owner",
      name: profile.name,
      email: profile.email || owner.email,
      whatsapp: profile.whatsapp,
    };
  }

  const reseller = (db.resellers || []).find((item) => {
    const candidates = [item.email, item.username, `${item.username}@kavya.id`].filter(Boolean).map(normalizeLoginIdentifier);
    return candidates.includes(query) || (whatsappQuery && whatsappQuery === normalizeWhatsappNumber(item.whatsapp));
  });
  if (!reseller || reseller.isActive === false) return null;
  return {
    role: "reseller",
    id: reseller.id,
    name: reseller.name,
    email: reseller.email,
    whatsapp: reseller.whatsapp,
  };
}

function resetCodeHash(resetId, code) {
  return crypto.createHmac("sha256", authSecret()).update(`${resetId}:${String(code || "").trim()}`).digest("hex");
}

function resetTokenHash(token) {
  return crypto.createHmac("sha256", authSecret()).update(String(token || "")).digest("hex");
}

function cleanupPasswordResets(db) {
  const now = Date.now();
  db.passwordResets = (db.passwordResets || []).filter((item) => {
    if (item.usedAt) return false;
    return Number(item.expiresAtMs || 0) > now || Number(item.resetTokenExpiresAtMs || 0) > now;
  });
}

async function sendWhatsAppMessage(db, { to, text, imageUrl = "", mediaPath = "", documentPath = "", fileName = "" }) {
  const token = firstUsableSecret(db.settings?.whatsappBotToken, process.env.WHATSAPP_BOT_TOKEN);
  const botUrl = firstConfigured(process.env.WHATSAPP_BOT_URL, db.settings?.whatsappBotUrl, "http://127.0.0.1:4016");
  const target = normalizeWhatsAppTarget(to);
  if (!token || !botUrl) {
    return { sent: false, reason: "whatsapp_bot_not_configured" };
  }
  if (!target) {
    return { sent: false, reason: "whatsapp_number_not_found" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.WHATSAPP_BOT_TIMEOUT_MS || 5000));
  try {
    const response = await fetch(new URL("/messages/send", botUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: target,
        text,
        imageUrl,
        mediaPath,
        documentPath,
        fileName,
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      return { sent: false, reason: body.error || `whatsapp_bot_http_${response.status}` };
    }
    return { sent: true, messageKey: body.message_key || body.messageKey || null };
  } catch (error) {
    return {
      sent: false,
      reason: error.name === "AbortError" ? "whatsapp_bot_timeout" : error.message || "whatsapp_bot_unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function reportOperationalHealth({ key, label, ok, detail = "" }) {
  try {
    const event = await updateDb((db) => {
      db.settings = db.settings || {};
      const transition = recordOperationalCheck(db.settings, {
        key,
        label,
        ok,
        detail,
        failureThreshold: Number(process.env.OPERATIONAL_ALERT_FAILURE_THRESHOLD || 3),
        cooldownMs: Number(process.env.OPERATIONAL_ALERT_COOLDOWN_MS || 12 * 60 * 60 * 1000),
      });
      if (transition.event !== "none") {
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "system",
          title: transition.title,
          description: transition.event === "recovery"
            ? `${label} kembali normal setelah gangguan.`
            : `${label} gagal ${transition.state.consecutiveFailures} kali berturut-turut.`,
          createdAt: nowText(),
          source: "operational_alert",
          alertKey: key,
          alertEvent: transition.event,
        });
      }
      return {
        transition,
        to: normalizeWhatsappNumber(
          db.settings.ownerWhatsAppNumber
            || process.env.OWNER_WHATSAPP_NUMBER
            || ownerProfile(db).whatsapp,
        ),
      };
    });

    const { transition, to } = event;
    const canSend = key !== "whatsapp" || ok === true;
    if (!transition.shouldNotify || !to || !canSend) return transition;

    const delivery = await sendWhatsAppMessage(await readDb(), {
      to,
      text: transition.message,
    }).catch((error) => ({ sent: false, reason: error.message || "send_failed" }));

    await updateDb((db) => {
      const state = db.settings?.operationalAlertState?.[key];
      if (!state) return null;
      state.lastDeliveryAt = nowText();
      state.lastDeliveryStatus = delivery.sent ? "sent" : "failed";
      state.lastDeliveryReason = delivery.sent ? "" : String(delivery.reason || "send_failed").slice(0, 120);
      return null;
    });
    return transition;
  } catch (error) {
    console.warn(`[OperationalAlert] ${key} report skipped: ${error.message || error}`);
    return null;
  }
}

function depositRequestMethodLabel(value = "") {
  const method = String(value || "").trim().toLowerCase();
  if (method === "qris_auto" || method === "qris") return "Deposit otomatis QRIS";
  if (method === "qris_owner") return "QRIS owner manual";
  if (method === "dana") return "DANA";
  if (method === "livin") return "Livin Mandiri";
  if (method === "bca") return "BCA";
  if (method === "gopay") return "GoPay";
  if (method === "shopeepay") return "ShopeePay";
  return value || "-";
}

function ownerWhatsappTarget(db = {}) {
  return normalizeWhatsappNumber(ownerProfile(db).whatsapp || db.settings?.ownerWhatsAppNumber || process.env.OWNER_WHATSAPP_NUMBER || "");
}

function depositRequestNotificationText({ reseller = {}, amount = 0, method = "", note = "", requestId = "", createdAt = "" } = {}) {
  return joinBotMessageLines([
    "_*Permintaan Deposit Baru*_",
    "",
    `Reseller : *${reseller.name || reseller.username || reseller.whatsapp || "-"}*`,
    `WhatsApp : *${normalizeWhatsappNumber(reseller.whatsapp || "") || "-"}*`,
    `Request ID : *${requestId || "-"}*`,
    `Metode : *${depositRequestMethodLabel(method)}*`,
    `Nominal : *${formatRupiah(amount)}*`,
    note ? `Catatan : *${note}*` : "",
    createdAt ? `Waktu : *${createdAt}*` : "",
    "",
    "_Silakan cek panel owner untuk approve / tolak permintaan ini._",
  ]);
}

function normalizeWhatsAppTarget(value = "") {
  const target = String(value || "").trim();
  if (target.endsWith("@g.us") || target.endsWith("@s.whatsapp.net") || target.endsWith("@lid")) {
    return target;
  }
  return normalizeWhatsappNumber(target);
}

function rentalStoreOwnerNotificationTarget(db, rental = {}) {
  return rentalOwnerContactNumber(db, rental);
}

function joinBotMessageLines(lines = []) {
  return lines
    .map((line) => String(line ?? "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function notifyOwnerRentalChanged(db, payload) {
  const target = rentalStoreOwnerNotificationTarget(db, payload.rental);
  if (!target) return { sent: false, reason: "store_owner_whatsapp_missing" };
  return sendWhatsAppMessage(db, {
    to: target,
    text: rentalChangedNotificationText({ db, ...payload }),
  });
}

async function notifyOwnerRentalJoined(db, payload) {
  const target = rentalStoreOwnerNotificationTarget(db, payload.rental);
  if (!target) return { sent: false, reason: "store_owner_whatsapp_missing" };
  return sendWhatsAppMessage(db, {
    to: target,
    text: rentalJoinedNotificationText({ db, ...payload }),
  });
}

async function deleteWhatsAppMessage(db, { to, messageKey }) {
  const token = firstUsableSecret(db.settings?.whatsappBotToken, process.env.WHATSAPP_BOT_TOKEN);
  const botUrl = firstConfigured(process.env.WHATSAPP_BOT_URL, db.settings?.whatsappBotUrl, "http://127.0.0.1:4016");
  const target = normalizeWhatsAppTarget(to);
  if (!token || !botUrl) {
    return { deleted: false, reason: "whatsapp_bot_not_configured" };
  }
  if (!target || !messageKey) {
    return { deleted: false, reason: "message_key_not_found" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.WHATSAPP_BOT_TIMEOUT_MS || 5000));
  try {
    const response = await fetch(new URL("/messages/delete", botUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: target,
        messageKey,
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      return { deleted: false, reason: body.error || `whatsapp_bot_http_${response.status}` };
    }
    return { deleted: true };
  } catch (error) {
    return {
      deleted: false,
      reason: error.name === "AbortError" ? "whatsapp_bot_timeout" : error.message || "whatsapp_bot_unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendResetCodeWhatsApp(db, { to, code }) {
  return sendWhatsAppMessage(db, {
    to,
    text: [
      `Kode OTP reset password Kavya: ${code}`,
      "",
      "Kode berlaku 10 menit. Abaikan pesan ini kalau kamu tidak meminta reset password.",
    ].join("\n"),
  });
}

function passwordResetDeliveryError(reason = "") {
  const code = String(reason || "").trim();
  if (code === "account_not_found") return "Akun tidak ditemukan. Gunakan username, email, atau nomor WhatsApp yang terdaftar.";
  if (code === "whatsapp_number_not_found") return "Nomor WhatsApp akun belum terisi.";
  if (code === "whatsapp_bot_not_configured") return "Bot WhatsApp belum dikonfigurasi.";
  if (code === "whatsapp_bot_timeout") return "Bot WhatsApp tidak merespons saat mengirim OTP.";
  if (/not_connected|closed|socket|EPIPE|timed?_?out/i.test(code)) return "Bot WhatsApp belum stabil/terhubung. Coba lagi setelah status bot terhubung.";
  return code ? `OTP belum terkirim: ${code}` : "OTP belum terkirim.";
}

function resellerWelcomeMessage(db, reseller) {
  const resellerName = reseller.name || reseller.username || "Kak";
  return joinBotMessageLines([
    `Welcome (๑•ᴗ•๑)♡, ${resellerName}!`,
    "akun kamu berhasil dibuat———☆",
    "",
    ` User   : ${reseller.username}`,
    ` Pass   : ${reseller.password}`,
    ` Email  : ${reseller.email || "-"}`,
    ` Status : ${reseller.isActive === false ? "Nonaktif" : "Aktif"}`,
    "",
    ".・゜-: ✧ :»»————>",
    "○ note: email bisa diedit melalui Settings",
  ]);
}

async function sendRegistrationCodeWhatsApp(db, { to, name, code }) {
  return sendWhatsAppMessage(db, {
    to,
    text: [
      `Halo ${name || "Kak"},`,
      "",
      `Kode OTP pendaftaran reseller Kavya: ${code}`,
      "",
      "Kode berlaku 10 menit. Jangan berikan kode ini kepada siapa pun.",
      "Abaikan pesan ini jika kamu tidak meminta pendaftaran.",
    ].join("\n"),
  });
}

async function sendSelfRegistrationWelcomeWhatsApp(db, reseller) {
  return sendWhatsAppMessage(db, {
    to: reseller.whatsapp,
    text: selfRegistrationWelcomeMessage(reseller),
  });
}

async function sendResellerWelcomeWhatsApp(db, reseller) {
  return sendWhatsAppMessage(db, {
    to: reseller.whatsapp,
    text: resellerWelcomeMessage(db, reseller),
  });
}

function resellerChangeFields(before = {}, after = {}) {
  const fields = [
    ["name", "Nama"],
    ["username", "Username"],
    ["email", "Email"],
    ["whatsapp", "Nomor WhatsApp"],
    ["password", "Password"],
    ["isActive", "Status"],
    ["deposit", "Deposit"],
  ];
  return fields
    .filter(([key]) => {
      if (key === "whatsapp") {
        return normalizeWhatsappNumber(before[key] ?? "") !== normalizeWhatsappNumber(after[key] ?? "");
      }
      if (key === "deposit") {
        return Number(before[key] ?? 0) !== Number(after[key] ?? 0);
      }
      return String(before[key] ?? "") !== String(after[key] ?? "");
    })
    .map(([key, label]) => ({ key, label }));
}

function resellerUpdateMessage(db, reseller = {}, changes = [], actor = "owner") {
  const resellerName = reseller.name || reseller.username || "Kak";
  const lines = [
    ".・。.・UPDATE DATA RESELLER —⁠☆",
    "",
    `Halo ${resellerName}! data akun reseller kamu diperbarui ${actor === "self" ? "melalui panel reseller." : "oleh admin."}`,
    ":･ﾟ★ Perubahan:",
    "",
    ` Nama      : ${reseller.name || "-"}`,
    ` Username  : ${reseller.username || "-"}`,
    ` Email     : ${reseller.email || "-"}`,
    ` WhatsApp  : ${reseller.whatsapp ? `+${normalizeWhatsappNumber(reseller.whatsapp)}` : "-"}`,
    ` Status    : ${reseller.isActive === false ? "Nonaktif" : "Aktif"}`,
    ` Deposit   : ${formatRupiah(Number(reseller.deposit || 0))}`,
  ];
  if (changes.some((item) => item.key === "password")) {
    lines.push(` Password  : ${reseller.password || "-"}`);
  }
  lines.push("", "‼️Gunakan data terbaru ini untuk login dan menerima notifikasi Kavya‼️ :･ﾟ☆");
  return joinBotMessageLines(lines);
}

function resellerDepositOnlyMessage(reseller = {}, before = {}, after = {}, actor = "owner") {
  const resellerName = reseller.username || reseller.name || "reseller";
  const depositBefore = Number(before.deposit || 0);
  const depositAfter = Number(after.deposit || 0);
  const delta = depositAfter - depositBefore;
  const footer = delta >= 0
    ? "Saldo deposit berhasil ditambahkan ✧⁠*⁠。"
    : actor === "self"
      ? "Saldo reseller berhasil diperbarui."
      : "Saldo reseller telah dikurangi oleh admin.";
  return joinBotMessageLines([
    ".・。.・✭ INFORMASI UPDATE SALDO・。",
    "",
    ` Username          : ${resellerName}`,
    ` Saldo sebelumnya  : ${formatRupiah(depositBefore)}`,
    ` Saldo sekarang    : ${formatRupiah(depositAfter)}`,
    ` Perubahan         : ${delta >= 0 ? "+" : "-"}${formatRupiah(Math.abs(delta))}`,
    "",
    footer,
  ]);
}

function resellerDepositPaidMessage(reseller = {}, order = {}, payment = {}) {
  const resellerName = reseller.username || reseller.name || order.customer || "reseller";
  const depositBefore = Math.max(0, Number(order.depositBefore ?? payment.depositBefore ?? 0));
  const depositAfter = Math.max(0, Number(order.depositAfter ?? payment.depositAfter ?? depositBefore));
  const delta = Math.max(0, Number(order.depositAdded ?? payment.depositAdded ?? payment.amount ?? order.paymentDue ?? order.total ?? 0));
  return joinBotMessageLines([
    ".・。.・✭ INFORMASI UPDATE SALDO・。",
    "",
    ` Username          : ${resellerName}`,
    ` Saldo sebelumnya  : ${formatRupiah(depositBefore)}`,
    ` Saldo sekarang    : ${formatRupiah(depositAfter)}`,
    ` Perubahan         : +${formatRupiah(delta)}`,
    "",
    "Saldo deposit berhasil ditambahkan ✧⁠*⁠。",
  ]);
}

async function notifyResellerProfileChanged(db, before = {}, after = {}, actor = "owner") {
  const changes = resellerChangeFields(before, after);
  if (!changes.length) return { sent: false, skipped: true, reason: "no_changes" };
  const sentAt = nowText();
  const depositBefore = Number(before.deposit || 0);
  const depositAfter = Number(after.deposit || 0);
  const depositChanged = depositBefore !== depositAfter;
  const depositOnlyChange = depositChanged && changes.every((item) => item.key === "deposit");
  const message = depositOnlyChange
    ? resellerDepositOnlyMessage(after, before, after, actor)
    : resellerUpdateMessage(db, after, changes, actor);
  const depositLines = !depositOnlyChange && depositChanged
    ? [
        "",
        ".・。.・✭ INFORMASI UPDATE SALDO・。",
        "",
        ` Username          : ${after.username || after.name || "reseller"}`,
        ` Saldo sebelumnya  : ${formatRupiah(depositBefore)}`,
        ` Saldo sekarang    : ${formatRupiah(depositAfter)}`,
        ` Perubahan         : ${depositAfter >= depositBefore ? "+" : "-"}${formatRupiah(Math.abs(depositAfter - depositBefore))}`,
        "",
        `‼️Hubungi ${after.username || after.name || "owner"} bila mengalami kendala‼️`,
      ]
    : [];
  const delivery = await sendWhatsAppMessage(db, {
    to: after.whatsapp || before.whatsapp || "",
    text: joinBotMessageLines([message, ...depositLines]),
  });
  after.panelProfileUpdateStatus = delivery.sent ? "sent" : "failed";
  after.panelProfileUpdateAt = sentAt;
  after.panelProfileUpdateReason = delivery.sent ? "" : (delivery.reason || "whatsapp_send_failed");
  db.activities = db.activities || [];
  db.activities.unshift({
    id: makeId("act"),
    type: "reseller",
    title: delivery.sent ? "Data reseller diperbarui" : "Data reseller diperbarui tanpa notif WA",
    description: delivery.sent
      ? `Perubahan ${changes.map((item) => item.label).join(", ")} tersimpan dan notif dikirim ke ${after.name || after.username || after.id}.`
      : `Perubahan ${changes.map((item) => item.label).join(", ")} tersimpan di panel ${after.name || after.username || after.id}, tetapi notif WA gagal: ${delivery.reason || "unknown_error"}.`,
    resellerId: after.id || "",
    whatsapp: normalizeWhatsappNumber(after.whatsapp || before.whatsapp || ""),
    createdAt: sentAt,
  });
  return { ...delivery, logged: true, changes };
}

const { fulfillPaidOrderAndNotify } = createFulfillmentNotificationService({
  activeResellerByWhatsapp,
  deleteWhatsAppMessage,
  formatRupiah,
  fulfillPaidOrder,
  getProduct,
  isSmokeTestOrder,
  joinBotMessageLines,
  makeId,
  nowText,
  pushFulfilledOrderToGoogleSheets,
  resellerDepositPaidMessage,
  sendWhatsAppMessage,
  syncGoogleSheetsStockSafely,
  syncSheetsForProductOrThrow,
});

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

/*
 * Written through a temp file and a rename, not a bare `fs.writeFile`.
 *
 * The list files this writes are not ours alone. The bot reads two of these
 * exact paths -- `apps/bot/database/lists.json` and `database/list.json`, via
 * `readLegacyLists` (`apps/bot/lib/json-store.js:354`) -- and writes them itself
 * through `writeLegacyLists`. `fs.writeFile` truncates the target before it
 * writes, so a bot read landing in that window parses invalid JSON. The bot
 * catches that per-path and skips it (`json-store.js:362`), which does not fail
 * loudly: the group simply looks like it has no list entries for one poll.
 */
async function writeJsonFilePretty(filePath, value) {
  await writeJsonFileAtomic(filePath, value);
}

async function readFirstNonEmptyJson(filePaths, fallback) {
  for (const filePath of filePaths) {
    const value = await readJsonIfExists(filePath, fallback);
    if (Array.isArray(value) ? value.length : Object.keys(value || {}).length) return value;
  }
  return fallback;
}

function whatsappDatabasePath(fileName) {
  return path.join(whatsappDatabaseDir, fileName);
}

function hasLegacyDashboardListShape(groupData = {}) {
  if (!groupData || typeof groupData !== "object" || Array.isArray(groupData) || !groupData.list || typeof groupData.list !== "object") {
    return false;
  }
  const listValue = groupData.list;
  return !("text" in listValue || "content" in listValue || "media" in listValue || "media_path" in listValue || "updated_at" in listValue);
}

function normalizeDashboardListGroup(groupData = {}) {
  const now = new Date().toISOString();
  if (!groupData || typeof groupData !== "object" || Array.isArray(groupData)) {
    return { createdAt: now, updatedAt: now, list: {} };
  }

  if (hasLegacyDashboardListShape(groupData)) {
    const list = {};
    for (const [keyword, item] of Object.entries(groupData.list || {})) {
      list[keyword] = {
        content: {
          text: String(item?.content?.text || item?.text || "").trim(),
          media: item?.content?.media || item?.media || item?.media_path || null,
        },
        updatedAt: item?.updatedAt || item?.updated_at || item?.addedAt || groupData.updatedAt || now,
      };
    }
    return {
      createdAt: groupData.createdAt || now,
      updatedAt: groupData.updatedAt || now,
      list,
    };
  }

  const metadataKeys = new Set(["createdAt", "updatedAt", "addedAt", "template", "templatelist", "setlist"]);
  const list = {};
  for (const [keyword, item] of Object.entries(groupData)) {
    if (metadataKeys.has(keyword) || !item || typeof item !== "object") continue;
    list[keyword] = {
      content: {
        text: String(item?.content?.text || item?.text || "").trim(),
        media: item?.content?.media || item?.media || item?.media_path || null,
      },
      updatedAt: item?.updatedAt || item?.updated_at || item?.addedAt || groupData.updatedAt || now,
    };
  }

  return {
    createdAt: groupData.createdAt || now,
    updatedAt: groupData.updatedAt || now,
    list,
  };
}

function mergeDashboardGroupMaps(primary = {}, secondary = {}) {
  const merged = { ...secondary };
  for (const [groupJid, groupData] of Object.entries(primary || {})) {
    const base = normalizeDashboardListGroup(groupData);
    const mirror = normalizeDashboardListGroup(merged[groupJid] || {});
    merged[groupJid] = {
      createdAt: base.createdAt || mirror.createdAt || new Date().toISOString(),
      updatedAt: base.updatedAt || mirror.updatedAt || new Date().toISOString(),
      list: {
        ...(mirror.list || {}),
        ...(base.list || {}),
      },
    };
  }
  return merged;
}

async function readLegacyGroupLists() {
  const modernListPath = whatsappDatabasePath("lists.json");
  const appBotListPath = path.join(legacyRootDir, "apps", "bot", "database", "lists.json");
  const legacyListPath = path.join(legacyRootDir, "database", "list.json");
  const participantPath = path.join(legacyRootDir, "database", "additional", "group participant.json");
  const [modernLists, appBotLists, legacyLists, participants] = await Promise.all([
    readJsonIfExists(modernListPath, {}),
    readJsonIfExists(appBotListPath, {}),
    readJsonIfExists(legacyListPath, {}),
    readJsonIfExists(participantPath, {}),
  ]);
  const hasModernLists = modernLists && typeof modernLists === "object" && !Array.isArray(modernLists) && Object.keys(modernLists).length > 0;
  const sourceLists = hasModernLists ? modernLists : mergeDashboardGroupMaps(appBotLists, legacyLists);
  if (!hasModernLists && sourceLists && Object.keys(sourceLists).length > 0) {
    /*
     * This is a backfill of the modern file from the two legacy copies, and it
     * writes the same `lists.json` that `cleanupExpiredRentalGroupLists`
     * rewrites. Both go through the one list queue so a cleanup cannot delete a
     * group and have this backfill put it straight back.
     *
     * It stays best-effort (`.catch`): a read must not start failing because a
     * cache-warming write could not land, and the caller has a usable value
     * either way.
     */
    await queueLegacyListMutation(async () => {
      // Re-read under the queue. Between the read above and this write, a
      // concurrent writer may have populated the modern file, and backfilling
      // from the legacy copies would then overwrite newer data with older.
      const current = await readJsonIfExists(modernListPath, {});
      if (current && typeof current === "object" && !Array.isArray(current) && Object.keys(current).length > 0) return;
      await writeJsonFilePretty(modernListPath, sourceLists);
    }).catch(() => {});
  }

  return Object.entries(sourceLists).map(([groupJid, groupData]) => {
    const entries = Object.entries(groupData?.list || {})
      .map(([keyword, item]) => ({
        keyword,
        text: String(item?.content?.text || "").trim(),
        media: item?.content?.media || null,
      }))
      .filter((entry) => entry.keyword)
      .sort((a, b) => a.keyword.localeCompare(b.keyword));

    return {
      groupJid,
      total: entries.length,
      updatedAt: groupData?.updatedAt || groupData?.createdAt || "",
      template: participants?.[groupJid]?.setlist || "",
      entries,
    };
  });
}

async function readLegacyRentals() {
  return canonicalRentalMap(await readDbSnapshot());
}

function rentalExpiredForCleanup(rental = {}, now = Date.now()) {
  const expiredAt = Number(rental?.expired || rental?.expiresAt || rental?.expiredAt || 0);
  if (!expiredAt) return false;
  const timestamp = expiredAt < 100000000000 ? expiredAt * 1000 : expiredAt;
  const retentionDays = Math.max(1, Number(process.env.WHATSAPP_RENTAL_LIST_RETENTION_DAYS || 30));
  return timestamp > 0 && timestamp <= now - retentionDays * 86400000;
}

/*
 * This deletes whole group entries from three list files that a different
 * process -- the bot -- also reads and writes.
 *
 * Two things were wrong with it. The read and the write were not serialised
 * against each other, so a concurrent `readLegacyGroupLists` backfill or a bot
 * `writeLegacyLists` could land between them and be erased by the whole-file
 * write. And it was a bare truncating `fs.writeFile`, which the bot can read
 * mid-write.
 *
 * The queue is the same shape as `queueLegacyRentalMutation` below, and for the
 * same reason: the *reads* have to be inside the queued task. Ordering only the
 * writes would leave both callers merging into the same stale base, which is the
 * race unchanged. One queue covers all three files so a group cannot be deleted
 * from one copy and survive in another.
 */
let legacyListWriteQueue = Promise.resolve();

function queueLegacyListMutation(task) {
  // `then(task, task)`, not `then(task)`: a rejected predecessor must not reject
  // the chain, or every later list write fails too.
  const run = legacyListWriteQueue.then(task, task);
  legacyListWriteQueue = run.catch(() => undefined);
  return run;
}

async function cleanupExpiredRentalGroupLists() {
  return queueLegacyListMutation(async () => {
    const rentals = await readLegacyRentals();
    const expiredGroupJids = Object.entries(rentals)
      .filter(([, rental]) => rentalExpiredForCleanup(rental))
      .map(([groupJid]) => groupJid)
      .filter(Boolean);
    if (!expiredGroupJids.length) return { cleaned: 0, groups: [] };

    const listPaths = [
      whatsappDatabasePath("lists.json"),
      path.join(legacyRootDir, "apps", "bot", "database", "lists.json"),
      path.join(legacyRootDir, "database", "list.json"),
    ];
    const cleanedGroups = new Set();
    for (const listPath of listPaths) {
      const lists = await readJsonIfExists(listPath, {});
      if (!lists || typeof lists !== "object" || Array.isArray(lists)) continue;
      let changed = false;
      for (const groupJid of expiredGroupJids) {
        if (Object.prototype.hasOwnProperty.call(lists, groupJid)) {
          delete lists[groupJid];
          cleanedGroups.add(groupJid);
          changed = true;
        }
      }
      if (changed) await writeJsonFilePretty(listPath, lists);
    }

    return { cleaned: cleanedGroups.size, groups: Array.from(cleanedGroups) };
  });
}

async function readActiveLegacyGroupLists() {
  const [rentals, groupLists] = await Promise.all([readLegacyRentals(), readLegacyGroupLists()]);
  const activeJids = new Set(
    Object.entries(rentals)
      .filter(([, rental]) => legacyDaysLeft(rental?.expired) > 0)
      .map(([groupJid]) => groupJid),
  );
  return groupLists.filter((group) => activeJids.has(group.groupJid));
}

function legacySewaPath() {
  return path.join(legacyRootDir, "database", "sewa.json");
}

function formatLegacyDate(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateFromDays(daysLeft) {
  return formatLegacyDate(Date.now() + Number(daysLeft || 0) * 86400000);
}

function legacyTodayText() {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function expirationFromDays(daysLeft) {
  return Date.now() + Math.max(0, Number(daysLeft || 0)) * 86400000;
}

function legacyDaysLeft(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return 0;
  return Math.ceil((timestamp - Date.now()) / 86400000);
}

function rentalCalendarDaysLeft(value) {
  const endsAt = toAccountDateTime(value);
  if (!endsAt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  endsAt.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((endsAt.getTime() - today.getTime()) / 86400000));
}

function rentalTimestampDaysLeft(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const normalized = timestamp < 100000000000 ? timestamp * 1000 : timestamp;
  return Math.max(0, Math.ceil((normalized - Date.now()) / 86400000));
}

function normalizeRentalRuntimeDays(row = {}, fallbackDaysLeft = 0) {
  const timestampDaysLeft = rentalTimestampDaysLeft(row.expired ?? row.expiresAt ?? row.expiredAt);
  const calendarDaysLeft = rentalCalendarDaysLeft(row.endsAt);
  const computedDaysLeft = timestampDaysLeft ?? calendarDaysLeft;
  const daysLeft = computedDaysLeft === null ? Math.max(0, Number(fallbackDaysLeft ?? row.daysLeft ?? 0)) : computedDaysLeft;
  const statusValue = String(row.status || "").trim().toLowerCase();
  const status = statusValue === "paused" ? "paused" : daysLeft > 0 ? "active" : "expired";
  return {
    ...row,
    daysLeft,
    status,
  };
}

function cleanInviteLink(value) {
  return String(value || "").trim().replace(/\?mode=[^ ]+/gi, "");
}

function extractInviteCode(value) {
  const link = cleanInviteLink(value);
  const match = link.match(/chat\.whatsapp\.com\/([^/?\s]+)/i);
  return match?.[1] || "";
}

function normalizeGroupIdentity(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function resolveKnownGroupDirectory(db, candidates = []) {
  const normalizedCandidates = candidates
    .map((value) => normalizeGroupIdentity(value))
    .filter(Boolean);
  if (!normalizedCandidates.length) return null;
  return (db.whatsappGroupDirectory || []).find((group) => {
    const groupName = normalizeGroupIdentity(group?.name || "");
    return normalizedCandidates.includes(groupName);
  }) || null;
}

function resolveRentalGroupJid(db, options = {}) {
  const directCandidates = [
    options.groupJid,
    options.id,
    options.joinGroupJid,
    options.matchedGroupJid,
    options.fallbackGroupJid,
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => value.endsWith("@g.us"));
  if (directCandidates.length) {
    return { groupJid: directCandidates[0], directory: null, source: "direct" };
  }

  const knownDirectory = resolveKnownGroupDirectory(db, [
    options.name,
    options.groupName,
    options.fallbackName,
  ]);
  if (knownDirectory?.groupJid) {
    return { groupJid: knownDirectory.groupJid, directory: knownDirectory, source: "directory_name" };
  }

  return { groupJid: "", directory: null, source: "" };
}

/*
 * Legacy rental writes are serialised, and each write is atomic.
 *
 * `upsertLegacyRental` is a read-modify-write over one whole JSON file, and it
 * is reached from three different HTTP routes (`whatsapp-routes.js:281`, `:343`,
 * `:394`). Two overlapping requests -- an owner adjusting one group's link while
 * a second group's days-left is being edited, or simply two saves in flight --
 * would each read the same base object and each write it back whole. The second
 * write wins and silently discards the first request's group. Nothing errors;
 * the group just reverts to its previous value later.
 *
 * The queue is the same shape as the one `store.js` uses for the main database
 * (`store.js:32`), so the two stores serialise the same way and a failure in one
 * task cannot poison the queue for the next.
 *
 * The write is atomic because these files are read by a separate process -- the
 * bot, via `readDashboardRentalSources` -- and a plain `fs.writeFile` truncates
 * the target before it writes. A bot read landing in that window sees invalid
 * JSON, which is how a whole rental map reads as empty for one poll interval.
 */
let legacyRentalWriteQueue = Promise.resolve();

function queueLegacyRentalMutation(task) {
  // `then(task, task)`, not `then(task)`: a rejected predecessor must not
  // reject the chain, or every later rental write fails too.
  const run = legacyRentalWriteQueue.then(task, task);
  legacyRentalWriteQueue = run.catch(() => undefined);
  return run;
}

async function renameWithRetry(source, target) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!["EACCES", "EBUSY", "EPERM"].includes(error.code) || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function writeJsonFileAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await renameWithRetry(tempPath, filePath);
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeLegacyRentals(rentals) {
  return rentalMirror.reconcile();
}

const rentalMirror = createRentalMirror({
  readCanonical: readDbSnapshot,
  targets: [whatsappDatabasePath("rentals.json"), legacySewaPath()],
  journalPath: whatsappDatabasePath("rental-mirror-pending.json"),
});

async function upsertLegacyRental(groupJid, patch) {
  if (!String(groupJid || "").endsWith("@g.us")) return null;
  // The read has to be inside the queue. Reading outside it and only queueing
  // the write would serialise the writes while still letting two requests
  // build from the same stale base -- the exact race being fixed here.
  return queueLegacyRentalMutation(async () => {
    const rentals = await readLegacyRentals();
    await writeLegacyRentals(rentals);
    return rentals[groupJid] || null;
  });
}

async function joinGroupThroughBot(inviteLink) {
  const db = await readDb();
  const token = firstUsableSecret(db.settings?.whatsappBotToken, process.env.WHATSAPP_BOT_TOKEN);
  const botUrl = firstConfigured(process.env.WHATSAPP_BOT_URL, db.settings?.whatsappBotUrl, "http://127.0.0.1:4016");
  if (!token || !botUrl) {
    return { joinStatus: "pending", joinError: "whatsapp_bot_not_configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.WHATSAPP_BOT_TIMEOUT_MS || 5000));
  try {
    const url = new URL("/groups/join", botUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ invite_link: inviteLink }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(body.error || `whatsapp_bot_http_${response.status}`);
    }
    return {
      joinStatus: "joined",
      groupJid: body.group_jid || body.groupJid || "",
      groupName: body.group_name || body.groupName || "",
      ownerJid: body.owner_jid || body.ownerJid || "",
      ownerNumber: body.owner_number || body.ownerNumber || "",
    };
  } catch (error) {
    return {
      joinStatus: "pending",
      joinError: error.name === "AbortError" ? "whatsapp_bot_timeout" : error.message || "whatsapp_bot_unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/*
 * Owner-triggered group directory sync.
 *
 * The bot only syncs on connect and on a timer, and it reports the outcome --
 * skipped, throttled, failed -- through `group_sync` in its status payload
 * rather than by throwing. Without a way to ask for one on demand the owner
 * could see a week-old directory and no way to say so.
 *
 * The bot is what actually reads WhatsApp, so this proxies to it and returns
 * its verdict verbatim rather than second-guessing it here. Note that its
 * `group_count` counts every group the bot is in, which is not the same as
 * the number that match a rental -- the two are kept separate in the UI.
 */
async function syncGroupsThroughBot() {
  const db = await readDb();
  const tokens = configuredTokens(
    firstUsableSecret(db.settings?.whatsappBotToken),
    firstUsableSecret(process.env.WHATSAPP_BOT_TOKEN),
  );
  const botUrl = firstConfigured(process.env.WHATSAPP_BOT_URL, db.settings?.whatsappBotUrl, "http://127.0.0.1:4016");
  if (!tokens.length) return { success: false, error: "whatsapp_bot_not_configured" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.WHATSAPP_BOT_TIMEOUT_MS || 15000));
  try {
    const url = new URL("/groups/sync", botUrl);
    let lastError = null;
    for (const token of tokens) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.success !== false) {
        return {
          success: true,
          skipped: Boolean(body.skipped),
          reason: String(body.reason || ""),
          group_count: Number(body.group_count || 0),
        };
      }
      lastError = new Error(body.error || `whatsapp_bot_http_${response.status}`);
    }
    throw lastError || new Error("whatsapp_bot_unavailable");
  } catch (error) {
    return {
      success: false,
      error: error.name === "AbortError" ? "whatsapp_bot_timeout" : error.message || "whatsapp_bot_unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRentalBase(groupJid, rental, listCount) {
  const daysLeft = legacyDaysLeft(rental?.expired);
  const hasRental = Boolean(rental);
  const legacyStatus = String(rental?.status || "").trim().toLowerCase();
  const status = ["active", "paused", "expired"].includes(legacyStatus)
    ? legacyStatus
    : hasRental
      ? (daysLeft > 0 ? "active" : "expired")
      : "paused";
  return {
    id: groupJid,
    groupJid,
    name: groupJid,
    owner: "",
    contact: "",
    product: "",
    members: 0,
    capacity: 0,
    helpedOrders: 0,
    monthlyPrice: 0,
    startedAt: rental?.start || "",
    endsAt: formatLegacyDate(rental?.expired),
    daysLeft,
    sent: 0,
    replies: 0,
    status,
    linkGrub: rental?.linkGrub || "",
    listCount,
  };
}

async function mergedWhatsappRentals(db, options = {}) {
  const includeExpired = Boolean(options.includeExpired);
  const legacyRentals = canonicalRentalMap(db);
  const groupLists = await readLegacyGroupLists();
  const listCounts = new Map(groupLists.map((group) => [group.groupJid, group.total]));
  const directoryByJid = new Map((db.whatsappGroupDirectory || []).map((group) => [group.groupJid, group]));
  const groupIds = new Set(Object.keys(legacyRentals));
  const runtimeById = new Map((db.whatsappRentals || []).map((rental) => [rental.id, rental]));
  const rows = [];
  const withSyncedGroup = (row) => {
    const groupJid = row.groupJid || row.id;
    const synced = directoryByJid.get(groupJid);
    if (!synced) return row;
    const currentName = String(row.name || "").trim();
    const shouldUseSyncedName = !currentName || currentName === groupJid || currentName.startsWith("Menunggu join ");
    return {
      ...row,
      name: shouldUseSyncedName ? synced.name || currentName || groupJid : currentName,
      // `members` is a fact about the group: how many people WhatsApp says are
      // in it. `capacity` is a business fact: how many seats this owner sold.
      // The two used to fall back to each other, which made "seats available"
      // mirror "people in the chat" -- so a full rental looked empty and an
      // empty one looked sold out. A sync knows the headcount and knows nothing
      // about what was sold, so it may only write `members`.
      members: Number(row.members || synced.members || 0),
      capacity: Number(row.capacity || 0),
      owner: row.owner || synced.owner || "",
      contact: row.contact || synced.contact || "",
      description: row.description || synced.description || "",
      syncedAt: row.syncedAt || synced.syncedAt || "",
    };
  };

  for (const groupJid of groupIds) {
    const base = buildRentalBase(groupJid, legacyRentals[groupJid], listCounts.get(groupJid) || 0);
    const merged = normalizeRentalRuntimeDays({
      ...base,
      ...(runtimeById.get(groupJid) || {}),
      id: groupJid,
      groupJid,
      listCount: listCounts.get(groupJid) || 0,
    }, base.daysLeft);
    if (!includeExpired && (merged.daysLeft <= 0 || merged.status === "expired")) continue;
    rows.push(withSyncedGroup(merged));
  }

  for (const rental of db.whatsappRentals || []) {
    if (groupIds.has(rental.id) || ["grp-001", "grp-002"].includes(rental.id)) continue;
    const merged = normalizeRentalRuntimeDays({
      groupJid: rental.groupJid || rental.id,
      listCount: listCounts.get(rental.id) || 0,
      ...rental,
    }, rental.daysLeft);
    if (!includeExpired && (merged.daysLeft <= 0 || merged.status === "expired")) continue;
    rows.push(withSyncedGroup(merged));
  }

  return rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : b.status === "active" ? 1 : 0;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
}

async function notifyRentalReminders() {
  const db = await readDb();
  const rows = await mergedWhatsappRentals(db, { includeExpired: true });
  const notices = db.whatsappRentalNotices || {};
  const fiveDayRows = rows.filter((rental) => {
    const daysLeft = Number(rental.daysLeft || 0);
    const key = rental.groupJid || rental.id;
    return daysLeft === 5 && rental.status === "active" && !notices[key]?.fiveDaySentAt;
  });
  const expiredRows = rows.filter((rental) => {
    const daysLeft = Number(rental.daysLeft || 0);
    const key = rental.groupJid || rental.id;
    return (daysLeft <= 0 || rental.status === "expired") && !notices[key]?.expiredSentAt;
  });

  for (const rental of fiveDayRows) {
    const key = rental.groupJid || rental.id;
    const target = rentalStoreOwnerNotificationTarget(db, rental);
    if (!target) continue;
    const delivery = await sendWhatsAppMessage(db, {
      to: target,
      text: rentalExpiringNotificationText(db, rental, Number(rental.daysLeft || 0)),
    });
    await updateDb((current) => {
      current.whatsappRentalNotices = current.whatsappRentalNotices || {};
      current.whatsappRentalNotices[key] = {
        ...(current.whatsappRentalNotices[key] || {}),
        fiveDaySentAt: delivery.sent ? nowText() : "",
        fiveDayError: delivery.sent ? "" : delivery.reason || "whatsapp_send_failed",
        fiveDayTarget: target,
      };
      return current.whatsappRentalNotices[key];
    });
  }

  for (const rental of expiredRows) {
    const key = rental.groupJid || rental.id;
    const target = rentalStoreOwnerNotificationTarget(db, rental);
    if (!target) continue;
    const delivery = await sendWhatsAppMessage(db, {
      to: target,
      text: rentalExpiredNotificationText(db, rental),
    });
    await updateDb((current) => {
      current.whatsappRentalNotices = current.whatsappRentalNotices || {};
      current.whatsappRentalNotices[key] = {
        ...(current.whatsappRentalNotices[key] || {}),
        expiredSentAt: delivery.sent ? nowText() : "",
        expiredError: delivery.sent ? "" : delivery.reason || "whatsapp_send_failed",
        expiredTarget: target,
      };
      return current.whatsappRentalNotices[key];
    });
  }
}

async function runRentalReminderJob() {
  try {
    await notifyRentalReminders();
  } catch (error) {
    console.warn("[RENTAL] Gagal cek notifikasi sewa:", error.message || error);
  }

  try {
    const cleanup = await cleanupExpiredRentalGroupLists();
    if (cleanup.cleaned > 0) {
      await updateDb((db) => {
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "whatsapp",
          title: "List grup expired dibersihkan",
          description: `${cleanup.cleaned} list grup yang expired lebih dari 30 hari dihapus otomatis dari database list WhatsApp.`,
          createdAt: nowText(),
        });
        return cleanup;
      });
    }
  } catch (error) {
    console.warn("[RENTAL] Gagal cleanup list grup expired:", error.message || error);
  }
}

async function markRentalJoinedNotice(rental, delivery) {
  const key = rental.groupJid || rental.id;
  if (!key) return;
  await updateDb((db) => {
    db.whatsappRentalNotices = db.whatsappRentalNotices || {};
    db.whatsappRentalNotices[key] = {
      ...(db.whatsappRentalNotices[key] || {}),
      joinedSentAt: delivery.sent ? nowText() : "",
      joinedError: delivery.sent ? "" : delivery.reason || "whatsapp_send_failed",
      joinedTarget: rentalStoreOwnerNotificationTarget(db, rental),
    };
    return db.whatsappRentalNotices[key];
  });
}

async function sendRentalJoinedNotifications(rentals = []) {
  if (!rentals.length) return [];
  const db = await readDb();
  const results = [];
  for (const rental of rentals) {
    const delivery = await notifyOwnerRentalJoined(db, {
      rental,
      addedDays: rental.daysLeft,
      previousDays: 0,
      totalDays: rental.daysLeft,
      source: "WhatsApp",
    });
    await markRentalJoinedNotice(rental, delivery);
    results.push({ id: rental.id, groupJid: rental.groupJid, ...delivery });
  }
  return results;
}

function normalizeSyncedGroup(group = {}) {
  const groupJid = String(group.group_jid || group.groupJid || group.id || "").trim();
  if (!groupJid.endsWith("@g.us")) return null;
  return {
    groupJid,
    name: String(group.group_name || group.groupName || group.name || groupJid).trim() || groupJid,
    members: Number(group.participant_count || group.participantCount || group.members || 0),
    owner: String(group.owner_name || group.ownerName || group.owner || group.owner_jid || group.ownerJid || "").trim(),
    contact: String(group.owner_number || group.ownerNumber || "").replace(/[^\d]/g, ""),
    description: String(group.description || "").trim(),
    syncedAt: String(group.synced_at || group.syncedAt || new Date().toISOString()).trim(),
  };
}

function syncWhatsappGroups(db, groups = [], source = "bot") {
  const normalizedGroups = (Array.isArray(groups) ? groups : []).map(normalizeSyncedGroup).filter(Boolean);
  const now = new Date().toISOString();
  db.whatsappRentals = db.whatsappRentals || [];
  db.whatsappGroupDirectory = db.whatsappGroupDirectory || [];

  const directoryByJid = new Map((db.whatsappGroupDirectory || []).map((group) => [group.groupJid, group]));
  for (const group of normalizedGroups) {
    directoryByJid.set(group.groupJid, {
      ...(directoryByJid.get(group.groupJid) || {}),
      ...group,
      source,
      syncedAt: group.syncedAt || now,
    });
  }
  db.whatsappGroupDirectory = Array.from(directoryByJid.values()).sort((a, b) => String(a.name || a.groupJid).localeCompare(String(b.name || b.groupJid)));

  const rentalById = new Map(db.whatsappRentals.map((rental) => [rental.id, rental]));
  let updatedRentals = 0;
  const joinedRentals = [];
  db.whatsappRentalNotices = db.whatsappRentalNotices || {};
  for (const group of normalizedGroups) {
    const rental = rentalById.get(group.groupJid) || db.whatsappRentals.find((item) => item.groupJid === group.groupJid);
    if (!rental) continue;
    const key = rental.groupJid || rental.id || group.groupJid;
    const shouldNotifyJoined = rental.joinStatus !== "joined" && !db.whatsappRentalNotices[key]?.joinedSentAt;
    Object.assign(rental, {
      name: group.name || rental.name,
      members: group.members || rental.members || 0,
      // See `mergedWhatsappRentals`: capacity is what was sold, not a headcount.
      // Overwriting it with the group's member count destroyed the owner's
      // recorded seat allocation on every sync.
      capacity: Number(rental.capacity || 0),
      owner: group.owner || rental.owner || "",
      contact: rental.contact || group.contact || "",
      groupJid: group.groupJid,
      joinStatus: "joined",
      joinError: "",
      syncedAt: group.syncedAt || now,
    });
    if (shouldNotifyJoined) {
      joinedRentals.push({ ...rental });
    }
    updatedRentals += 1;
  }

  return {
    total: normalizedGroups.length,
    updatedRentals,
    joinedRentals,
    directoryTotal: db.whatsappGroupDirectory.length,
    syncedAt: now,
  };
}

function normalizeRentalPatch(body, fallback = {}) {
  return {
    name: String(body.name ?? fallback.name ?? "").trim(),
    owner: String(body.owner ?? fallback.owner ?? "").trim(),
    contact: String(body.contact ?? fallback.contact ?? "").trim(),
    product: String(body.product ?? fallback.product ?? "").trim(),
    members: Number(body.members ?? fallback.members ?? 0),
    capacity: Number(body.capacity ?? fallback.capacity ?? 0),
    helpedOrders: Number(body.helpedOrders ?? fallback.helpedOrders ?? 0),
    monthlyPrice: Number(body.monthlyPrice ?? fallback.monthlyPrice ?? 0),
    startedAt: String(body.startedAt ?? fallback.startedAt ?? "").trim(),
    endsAt: String(body.endsAt ?? fallback.endsAt ?? "").trim(),
    daysLeft: Number(body.daysLeft ?? fallback.daysLeft ?? 0),
    sent: Number(body.sent ?? fallback.sent ?? 0),
    replies: Number(body.replies ?? fallback.replies ?? 0),
    status: ["active", "expired", "paused"].includes(body.status) ? body.status : fallback.status || "active",
    linkGrub: String(body.linkGrub ?? fallback.linkGrub ?? "").trim(),
  };
}

function publicUser(user) {
  if (!user) return null;
  const { password: _password, passwordHash: _passwordHash, sessionVersion: _sessionVersion, ...safeUser } = user;
  return safeUser;
}

function toDateTime(value) {
  if (!value) return null;
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasTimePart(value = "") {
  return /[ T]\d{1,2}:\d{2}/.test(String(value || ""));
}

function monthNumber(value = "") {
  const key = String(value || "").trim().toLowerCase().replace(/\./g, "");
  const months = {
    jan: 0,
    januari: 0,
    feb: 1,
    februari: 1,
    mar: 2,
    maret: 2,
    apr: 3,
    april: 3,
    mei: 4,
    may: 4,
    jun: 5,
    juni: 5,
    jul: 6,
    juli: 6,
    agu: 7,
    agustus: 7,
    aug: 7,
    sep: 8,
    september: 8,
    okt: 9,
    oktober: 9,
    oct: 9,
    nov: 10,
    november: 10,
    des: 11,
    desember: 11,
    dec: 11,
  };
  return months[key];
}

function toAccountDateTime(value, options = {}) {
  if (!value) return null;
  const raw = String(value || "").trim();
  const monthMatch = raw.match(/^(\d{1,2})[\s/-]*([a-zA-Z]+)(?:[\s/-]+(\d{4}))?(?:[\s,]+(\d{1,2})[:.](\d{2}))?$/);
  if (monthMatch) {
    const month = monthNumber(monthMatch[2]);
    if (month !== undefined) {
      const reference = options.referenceDate instanceof Date && !Number.isNaN(options.referenceDate.getTime()) ? options.referenceDate : null;
      const year = Number(monthMatch[3] || reference?.getFullYear() || new Date().getFullYear());
      const hasTime = Boolean(monthMatch[4]);
      const date = new Date(year, month, Number(monthMatch[1]), Number(monthMatch[4] || 0), Number(monthMatch[5] || 0));
      if (!monthMatch[3] && reference && date.getTime() < reference.getTime() - 86400000) {
        date.setFullYear(date.getFullYear() + 1);
      }
      if (options.endOfDay && !hasTime) date.setHours(23, 59, 59, 999);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const date = new Date(dateOnly ? `${normalized}T${options.endOfDay ? "23:59:59" : "00:00:00"}` : normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMinutesText(minutes, from = new Date()) {
  const date = new Date(from.getTime() + Number(minutes || 0) * 60000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateOnlyText(date) {
  const value = date instanceof Date ? date : toDateTime(date);
  const normalized = value && !Number.isNaN(value.getTime()) ? value : new Date();
  const pad = (part) => String(part).padStart(2, "0");
  return `${normalized.getFullYear()}-${pad(normalized.getMonth() + 1)}-${pad(normalized.getDate())}`;
}

function dateTimeText(date) {
  const value = date instanceof Date ? date : toDateTime(date);
  const normalized = value && !Number.isNaN(value.getTime()) ? value : new Date();
  const pad = (part) => String(part).padStart(2, "0");
  return `${normalized.getFullYear()}-${pad(normalized.getMonth() + 1)}-${pad(normalized.getDate())} ${pad(normalized.getHours())}:${pad(normalized.getMinutes())}`;
}

function addAccountDaysText(days, from = new Date(), options = {}) {
  const date = toAccountDateTime(from) || new Date();
  date.setTime(date.getTime() + Number(days || 0) * 86400000);
  return options.keepTime || hasTimePart(from) ? dateTimeText(date) : dateOnlyText(date);
}

function durationDays(duration) {
  return subscriptionDurationDays(duration);
}

function durationParts(value = "") {
  const source = String(value || "").trim().toLowerCase();
  const amount = Number(source.match(/\d+/)?.[0] || 0);
  if (!amount) return { amount: 0, unit: "" };
  if (/(?:^|\s)\d+\s*(?:b|bln|bulan|month|months)\b/i.test(source)) return { amount, unit: "month" };
  if (/(?:^|\s)\d+\s*(?:t|thn|tahun|year|years)\b/i.test(source)) return { amount, unit: "year" };
  if (/(?:^|\s)\d+\s*(?:jam|hour|hours|hr)\b/i.test(source)) return { amount, unit: "hour" };
  if (/(?:^|\s)\d+\s*(?:d|h|hari|day|days)\b/i.test(source)) return { amount, unit: "day" };
  return { amount, unit: "" };
}

function accountExpiryFromDurationText(startedAt, durationText = "", durationDayCount = 0) {
  const start = toAccountDateTime(startedAt);
  if (!start) return "";
  const { amount, unit } = durationParts(durationText);
  let expires = null;
  if (amount && unit === "hour") expires = new Date(start.getTime() + amount * 3600000);
  else {
    const fixedDays = amount && ["month", "year", "day"].includes(unit) ? durationDays(durationText) : Number(durationDayCount || 0);
    if (!fixedDays) return "";
    expires = new Date(start);
    expires.setTime(expires.getTime() + fixedDays * 86400000);
  }
  if (!expires) return "";
  return hasTimePart(startedAt) || unit ? dateTimeText(expires) : dateOnlyText(expires);
}

function repairManagedAccountExpiry(account = {}) {
  const startedAt = toAccountDateTime(account.startedAt);
  if (!startedAt) return false;
  const { unit } = durationParts(account.duration);
  if (!["month", "year"].includes(unit)) return false;
  const computedText = accountExpiryFromDurationText(account.startedAt, account.duration);
  const computedDate = toAccountDateTime(computedText, { endOfDay: !hasTimePart(computedText), referenceDate: startedAt });
  if (!computedText || !computedDate) return false;

  const currentDate = toAccountDateTime(account.expiresAt, { endOfDay: !hasTimePart(account.expiresAt), referenceDate: startedAt });
  if (currentDate && Math.abs(currentDate.getTime() - computedDate.getTime()) < 60000) return false;

  account.expiresAt = computedText;
  const expectedDays = durationDays(account.duration);
  if (expectedDays && Number(account.durationDays || 0) !== expectedDays) account.durationDays = expectedDays;
  return true;
}

function depositBreakdown(reseller, total) {
  const depositBefore = Math.max(0, Number(reseller?.deposit || 0));
  const depositUsed = Math.min(depositBefore, Math.max(0, Number(total || 0)));
  return {
    depositBefore,
    depositUsed,
    depositAfter: Math.max(0, depositBefore - depositUsed),
    paymentDue: Math.max(0, Number(total || 0) - depositUsed),
  };
}

function parseOrderQty(value) {
  const numericValue = Number(value || 1);
  if (!Number.isFinite(numericValue)) return 1;
  return Math.max(1, Math.floor(numericValue));
}

function splitCustomerEmails(value = "") {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function splitDeviceNames(value = "") {
  return String(value || "")
    .split(/\r?\n|[,;]+|\s+\+\s+|\s+dan\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNetflixOrderProduct(product = {}) {
  const text = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  return text.includes("netflix") || String(product.code || "").toUpperCase() === "NET";
}

function productVariantText(product = {}, variant = {}) {
  return [product.id, product.code, product.name, product.category, variant?.id, variant?.code, variant?.name]
    .join(" ")
    .toLowerCase();
}

function isHboOrderProduct(product = {}, variant = {}) {
  const text = productVariantText(product, variant);
  return text.includes("hbo") || text.includes("max");
}

function isWetvOrderProduct(product = {}, variant = {}) {
  const text = productVariantText(product, variant);
  return text.includes("wetv") || String(product.code || "").toUpperCase() === "WETV";
}

function normalizeRuntimeCheckoutRequirements(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const field = String(raw.customerField || raw.field || "").trim().toLowerCase();
  if (!["email", "device", "optional", "none"].includes(field)) return null;
  return {
    customerField: field === "none" ? "optional" : field,
    required: raw.required === undefined ? field !== "optional" && field !== "none" : Boolean(raw.required),
    minItems: Math.max(1, Math.floor(Number(raw.minItems || raw.min || 1))),
    label: String(raw.label || raw.customerLabel || "").trim(),
    placeholder: String(raw.placeholder || "").trim(),
    helper: String(raw.helper || raw.description || "").trim(),
  };
}

function configuredCheckoutRequirements(product = {}, variant = {}) {
  return normalizeRuntimeCheckoutRequirements(variant?.checkoutRequirements || product?.checkoutRequirements || {});
}

function sheetCheckoutRequirements(product = {}, variant = {}) {
  return normalizeRuntimeCheckoutRequirements(variant?.sheetCheckoutRequirements || product?.sheetCheckoutRequirements || {});
}

function checkoutRequirementsForVariant(db, product = {}, variant = {}, options = {}) {
  if (
    Array.isArray(variant?.checkoutFields)
    || Array.isArray(product?.checkoutFields)
    || Array.isArray(variant?.sheetCheckoutFields)
    || Array.isArray(product?.sheetCheckoutFields)
  ) {
    return null;
  }
  const qty = Math.max(1, Math.floor(Number(options.qty || 1)));
  const configured = configuredCheckoutRequirements(product, variant);
  if (configured) {
    return {
      ...configured,
      minItems: configured.customerField === "email" ? Math.max(qty, configured.minItems) : configured.minItems,
    };
  }

  const netflix = isNetflixOrderProduct(product);
  const semiNetflix = netflix && isNetflixSemiPrivateVariant(product, variant);
  const sheetConfigured = sheetCheckoutRequirements(product, variant);
  if (sheetConfigured) {
    const minItems = sheetConfigured.customerField === "email"
      ? Math.max(qty, sheetConfigured.minItems)
      : sheetConfigured.customerField === "device" && semiNetflix
        ? Math.max(2, sheetConfigured.minItems)
        : sheetConfigured.minItems;
    return {
      ...sheetConfigured,
      minItems,
    };
  }

  const linkPool = isLinkPoolProduct(db, product, variant);
  const hbo = isHboOrderProduct(product, variant);
  const wetv = isWetvOrderProduct(product, variant);
  const productName = String(product?.name || "Produk").trim() || "Produk";

  if (linkPool) {
    return {
      customerField: "email",
      required: true,
      minItems: qty,
      label: `Email Customer ${productName}`,
      placeholder: "email customer, pisahkan jika beli banyak",
      helper: "Wajib isi email customer. Jika qty lebih dari 1, isi sejumlah qty.",
    };
  }

  if (netflix || hbo) {
    const labelProduct = netflix ? "Netflix" : "HBO";
    const minItems = semiNetflix ? 2 : 1;
    return {
      customerField: "device",
      required: true,
      minItems,
      label: `${labelProduct} Device${minItems > 1 ? ` (${minItems} device)` : ""}`,
      placeholder: minItems > 1 ? "Contoh: Smart TV Samsung, iPhone 13" : "Contoh: Smart TV Samsung",
      helper: minItems > 1
        ? `${labelProduct} Semi Private wajib isi ${minItems} device customer. Pisahkan dengan koma atau baris baru.`
        : `Wajib diisi dan sesuaikan dengan device customer untuk audit ${labelProduct}.`,
    };
  }

  if (wetv) {
    return {
      customerField: "device",
      required: true,
      minItems: 1,
      label: "Device Customer",
      placeholder: "Contoh: Android TV, iPhone, Smart TV",
      helper: "Wajib isi device customer supaya admin bisa audit akun WeTV.",
    };
  }

  return {
    customerField: "optional",
    required: false,
    minItems: 1,
    label: "Data Customer",
    placeholder: "Email, device, atau catatan customer",
    helper: "",
  };
}

function expirePendingOrders(db, now = new Date()) {
  let changed = false;
  for (const order of db.orders || []) {
    if (order.qrisStatus !== "pending") continue;
    const expiresAt = toDateTime(order.paymentExpiresAt);
    if (!expiresAt || expiresAt.getTime() > now.getTime()) continue;

    order.qrisStatus = "expired";
    order.orderStatus = "cancelled";
    order.deliveryStatus = "waiting_payment";
    changed = true;

    for (const stock of db.stock || []) {
      if (stock.reservedFor !== order.id) continue;
      clearReservedStockState(stock);
    }

    const payment = (db.payments || []).find((item) => item.ref === order.paymentRef || item.orderId === order.id);
    if (payment) payment.status = "expired";
    if (Number(order.depositUsed || 0) > 0 && !order.depositRefunded) {
      const reseller = (db.resellers || []).find((item) => item.id === order.resellerId) || activeResellerByWhatsapp(db, order.whatsapp);
      if (reseller) {
        reseller.deposit = Math.max(0, Number(reseller.deposit || 0)) + Number(order.depositUsed || 0);
        order.depositRefunded = true;
        order.depositRefundedAt = nowText();
      }
    }
    if (!order.expiredActivityLogged) {
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "order",
        title: `QRIS ${order.paymentRef || order.id} expired`,
        description: `${order.product} ${order.variant} x${order.qty || 1} dibatalkan. Stok dikembalikan ke tersedia${
          Number(order.depositUsed || 0) > 0 ? ` dan deposit ${formatRupiah(order.depositUsed)} dikembalikan.` : "."
        }`,
        createdAt: nowText(),
        orderId: order.id,
        resellerId: order.resellerId || "",
        whatsapp: normalizeWhatsappNumber(order.whatsapp || ""),
      });
      order.expiredActivityLogged = true;
    }
  }
  return changed;
}

function hasExpiredPendingOrders(db, now = new Date()) {
  return (db.orders || []).some((order) => {
    if (order.qrisStatus !== "pending") return false;
    const expiresAt = toDateTime(order.paymentExpiresAt);
    return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
  });
}

function parseFulfillmentField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(new RegExp(`^${escaped}:\\s*(.*)$`, "im"));
  return match?.[1]?.trim() || "";
}

function accountStatusFromDate(expiresAt, durationDaysValue = 0) {
  const expires = toAccountDateTime(expiresAt, { endOfDay: true });
  if (!expires) return "active";
  const msLeft = expires.getTime() - Date.now();
  if (msLeft <= 0) return "expired";
  const daysLeft = Math.ceil(msLeft / 86400000);
  if (Number(durationDaysValue || 0) >= 30 && daysLeft <= 5) return "expiring";
  return "active";
}

function isTerminalManagedAccountStatus(status = "") {
  return ["expired", "replaced", "disabled"].includes(String(status || "").toLowerCase());
}

function shouldRestoreArchivedGoogleSheetsAccount(db, account = {}, nextStatus = "") {
  if (account.sheetSource !== "google_sheets") return false;
  if (!isNetflixManagedAccount(account)) return false;
  if (["replaced", "disabled"].includes(String(account.status || "").toLowerCase())) return false;
  if (!account.hidden && !account.returnedToStockAt && String(account.status || "").toLowerCase() !== "expired") return false;
  if (String(nextStatus || "").toLowerCase() === "expired") return false;

  const linkedStock = stockForManagedAccount(db, account);
  if (!linkedStock) return false;
  const linkedStatus = String(linkedStock.status || "").toLowerCase();
  if (!["sold", "reserved"].includes(linkedStatus)) return false;
  if (account.sheetMissingArchivedAt && linkedStock.sheetRemovedAt) return false;
  return true;
}

function managedAccountIdentityKey(account = {}) {
  const stockId = String(account.stockId || "").trim();
  const sheetStockKey = String(account.sheetStockKey || "").trim();
  const orderId = String(account.orderId || account.sourceOrderId || "").trim();
  if (!orderId) return "";
  const stockKey = stockId || sheetStockKey;
  if (!stockKey) return "";
  return `${stockKey}::${orderId}`;
}

function managedAccountSortTimestamp(value = "") {
  return Number(toAccountDateTime(value, { endOfDay: !hasTimePart(value) })?.getTime() || 0);
}

function compareManagedAccountPriority(left = {}, right = {}) {
  const leftExpires = managedAccountSortTimestamp(left.expiresAt);
  const rightExpires = managedAccountSortTimestamp(right.expiresAt);
  if (rightExpires !== leftExpires) return rightExpires - leftExpires;

  const leftStarted = managedAccountSortTimestamp(left.startedAt);
  const rightStarted = managedAccountSortTimestamp(right.startedAt);
  if (rightStarted !== leftStarted) return rightStarted - leftStarted;

  const leftSheet = left.sheetSource === "google_sheets" ? 1 : 0;
  const rightSheet = right.sheetSource === "google_sheets" ? 1 : 0;
  if (rightSheet !== leftSheet) return rightSheet - leftSheet;

  const leftKey = left.sheetStockKey ? 1 : 0;
  const rightKey = right.sheetStockKey ? 1 : 0;
  if (rightKey !== leftKey) return rightKey - leftKey;

  const leftSource = String(left.source || "");
  const rightSource = String(right.source || "");
  if (leftSource !== rightSource) {
    if (rightSource === "google_sheets") return 1;
    if (leftSource === "google_sheets") return -1;
  }

  return String(right.id || "").localeCompare(String(left.id || ""));
}

function dedupeLiveManagedAccounts(db) {
  db.managedAccounts = db.managedAccounts || [];
  const groups = managedAccountDuplicateGroups(db);

  let updated = 0;
  for (const accounts of groups.values()) {
    if (accounts.length < 2) continue;
    const sorted = accounts.slice().sort(compareManagedAccountPriority);
    const keeper = sorted[0];
    const archivedAt = nowText();
    for (const duplicate of sorted.slice(1)) {
      if (!duplicate.hidden) {
        duplicate.hidden = true;
        updated += 1;
      }
      if (!duplicate.returnedToStockAt) {
        duplicate.returnedToStockAt = archivedAt;
        updated += 1;
      }
      if (duplicate.status !== "replaced") {
        duplicate.status = "replaced";
        updated += 1;
      }
      if (duplicate.duplicateOfAccountId !== keeper.id) {
        duplicate.duplicateOfAccountId = keeper.id;
        updated += 1;
      }
      if (duplicate.duplicateArchivedAt !== archivedAt) {
        duplicate.duplicateArchivedAt = archivedAt;
        updated += 1;
      }
    }
  }
  return updated;
}

function dedupeLiveSheetRowAccounts(db) {
  db.managedAccounts = db.managedAccounts || [];
  const groups = new Map();
  for (const account of db.managedAccounts) {
    if (account.hidden || account.returnedToStockAt) continue;
    if (["replaced", "disabled"].includes(String(account.status || "").toLowerCase())) continue;
    const linkedStock = stockForManagedAccount(db, account);
    const sheetStockKey = String(account.sheetStockKey || linkedStock?.sheetStockKey || "").trim();
    if (!sheetStockKey) continue;
    const list = groups.get(sheetStockKey) || [];
    list.push(account);
    groups.set(sheetStockKey, list);
  }

  let updated = 0;
  for (const [sheetStockKey, accounts] of groups) {
    if (accounts.length < 2) continue;
    const matchingStocks = (db.stock || []).filter((item) => (
      String(item.sheetStockKey || "").trim() === sheetStockKey
      && String(item.status || "").toLowerCase() !== "removed"
      && !item.sheetRemovedAt
    ));
    const stock = matchingStocks.find((item) => String(item.sheetOrderId || "").trim()) || matchingStocks[0] || null;
    const sheetOrderId = String(stock?.sheetOrderId || "").trim();
    const ranked = accounts.slice().sort((left, right) => {
      const leftOrder = orderForManagedAccount(db, left);
      const rightOrder = orderForManagedAccount(db, right);
      const leftSynced = String(leftOrder?.googleSheetsSyncStatus || "").toLowerCase() === "synced" ? 1 : 0;
      const rightSynced = String(rightOrder?.googleSheetsSyncStatus || "").toLowerCase() === "synced" ? 1 : 0;
      if (rightSynced !== leftSynced) return rightSynced - leftSynced;
      const leftPaidValue = Number(leftOrder?.total || 0) > 0 ? 1 : 0;
      const rightPaidValue = Number(rightOrder?.total || 0) > 0 ? 1 : 0;
      if (rightPaidValue !== leftPaidValue) return rightPaidValue - leftPaidValue;
      const leftMatches = sheetOrderId && String(left.orderId || left.sourceOrderId || "").trim() === sheetOrderId ? 1 : 0;
      const rightMatches = sheetOrderId && String(right.orderId || right.sourceOrderId || "").trim() === sheetOrderId ? 1 : 0;
      if (rightMatches !== leftMatches) return rightMatches - leftMatches;
      return compareManagedAccountPriority(left, right);
    });
    const keeper = ranked[0];
    const archivedAt = nowText();
    for (const duplicate of ranked.slice(1)) {
      duplicate.hidden = true;
      duplicate.returnedToStockAt = duplicate.returnedToStockAt || archivedAt;
      duplicate.status = "replaced";
      duplicate.duplicateOfAccountId = keeper.id;
      duplicate.duplicateArchivedAt = archivedAt;
      duplicate.sheetRowDuplicateArchived = true;
      updated += 1;
    }
  }
  return updated;
}

function dedupeLiveNetflixSlotAccounts(db) {
  db.managedAccounts = db.managedAccounts || [];
  const groups = new Map();
  for (const account of db.managedAccounts || []) {
    if (account.hidden || account.returnedToStockAt) continue;
    const status = String(account.status || accountStatusFromDate(account.expiresAt, account.durationDays)).toLowerCase();
    if (["expired", "replaced", "disabled"].includes(status)) continue;
    if (isMalformedManagedAccount(account)) continue;
    const key = managedAccountSlotKey(account);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(account);
    groups.set(key, list);
  }

  let updated = 0;
  for (const accounts of groups.values()) {
    if (accounts.length < 2) continue;
    // Distinct rows that are still assigned in Google Sheets are intentional
    // reuse history. Sheets owns those assignments, so local repair may only
    // archive non-Sheet duplicates around them.
    const sheetAssignments = accounts.filter((account) => (
      String(account.sheetSource || account.source || "").toLowerCase() === "google_sheets"
      && String(account.sheetStockKey || "").trim()
      && String(account.sheetSellerInput || account.reseller || account.buyer || "").trim()
    ));
    const sorted = accounts.slice().sort(compareManagedAccountPriority);
    const keeper = sheetAssignments.slice().sort(compareManagedAccountPriority)[0] || sorted[0];
    const duplicates = sheetAssignments.length
      ? sorted.filter((account) => !sheetAssignments.includes(account))
      : sorted.slice(1);
    const archivedAt = nowText();
    for (const duplicate of duplicates) {
      if (!duplicate.hidden) {
        duplicate.hidden = true;
        updated += 1;
      }
      if (!duplicate.returnedToStockAt) {
        duplicate.returnedToStockAt = archivedAt;
        updated += 1;
      }
      if (duplicate.status !== "replaced") {
        duplicate.status = "replaced";
        updated += 1;
      }
      if (duplicate.duplicateOfAccountId !== keeper.id) {
        duplicate.duplicateOfAccountId = keeper.id;
        updated += 1;
      }
      if (duplicate.duplicateArchivedAt !== archivedAt) {
        duplicate.duplicateArchivedAt = archivedAt;
        updated += 1;
      }
      duplicate.slotConflictArchived = true;
    }
  }
  return updated;
}

function archiveMalformedManagedAccounts(db) {
  db.managedAccounts = db.managedAccounts || [];
  let updated = 0;
  const archivedAt = nowText();
  for (const account of db.managedAccounts || []) {
    if (account.hidden || account.returnedToStockAt) continue;
    if (!isMalformedManagedAccount(account)) continue;
    if (!account.hidden) {
      account.hidden = true;
      updated += 1;
    }
    if (!account.returnedToStockAt) {
      account.returnedToStockAt = archivedAt;
      updated += 1;
    }
    if (account.status !== "expired") {
      account.status = "expired";
      updated += 1;
    }
    account.sheetMalformedArchivedAt = archivedAt;
  }
  return updated;
}

function archiveReturnedGoogleSheetsManagedAccounts(db) {
  db.managedAccounts = db.managedAccounts || [];
  let updated = 0;
  const archivedAt = nowText();
  for (const account of db.managedAccounts || []) {
    if (!account || account.hidden || account.returnedToStockAt) continue;
    const linkedStock = stockForManagedAccount(db, account);
    const sheetBacked = String(account.sheetSource || account.source || "").toLowerCase() === "google_sheets"
      || String(linkedStock?.sheetSource || "").toLowerCase() === "google_sheets"
      || Boolean(linkedStock?.sheetStockKey);
    if (!sheetBacked) continue;
    if (account.sheetClearedAt) {
      if (!account.hidden) {
        account.hidden = true;
        updated += 1;
      }
      if (!account.returnedToStockAt) {
        account.returnedToStockAt = account.sheetClearedAt || archivedAt;
        updated += 1;
      }
      if (account.status !== "expired") {
        account.status = "expired";
        updated += 1;
      }
      continue;
    }
    if (!linkedStock) continue;
    const stockStatus = String(linkedStock.status || "").toLowerCase();
    const stockReturned = stockStatus === "available"
      && !String(linkedStock.soldAt || "").trim()
      && !String(linkedStock.reservedFor || "").trim()
      && !String(linkedStock.reservedAccountId || "").trim();
    const stockRemoved = stockStatus === "removed" || Boolean(linkedStock.sheetRemovedAt);
    if (!stockReturned && !stockRemoved) continue;
    if (!account.hidden) {
      account.hidden = true;
      updated += 1;
    }
    if (!account.returnedToStockAt) {
      account.returnedToStockAt = archivedAt;
      updated += 1;
    }
    if (!account.sheetClearedAt) {
      account.sheetClearedAt = archivedAt;
      updated += 1;
    }
    if (account.status !== "expired") {
      account.status = "expired";
      updated += 1;
    }
  }
  return updated;
}

function managedAccountDuplicateGroups(db, options = {}) {
  const includeTerminal = options.includeTerminal === true;
  const groups = new Map();
  for (const account of db.managedAccounts || []) {
    if (account.hidden || account.returnedToStockAt) continue;
    if (!includeTerminal && isTerminalManagedAccountStatus(account.status || accountStatusFromDate(account.expiresAt, account.durationDays))) continue;
    const key = managedAccountIdentityKey(account);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(account);
    groups.set(key, list);
  }
  return new Map([...groups.entries()].filter(([, accounts]) => accounts.length > 1));
}

function normalizeManagedAccountDurations(db) {
  let updated = 0;
  for (const account of db.managedAccounts || []) {
    if (["replaced", "disabled"].includes(String(account.status || "").toLowerCase())) continue;
    let changed = false;
    if (repairManagedAccountExpiry(account)) {
      changed = true;
    }
    const startedAt = toAccountDateTime(account.startedAt);
    const expiresAt = toAccountDateTime(account.expiresAt, { endOfDay: !hasTimePart(account.expiresAt), referenceDate: startedAt });
    let currentDays = Number(account.durationDays || 0);
    if (startedAt && expiresAt) {
      currentDays = Math.round((expiresAt.getTime() - startedAt.getTime()) / 86400000);
      if (!account.durationDays && currentDays > 0) {
        account.durationDays = currentDays;
        changed = true;
      }
    }

    const nextStatus = accountStatusFromDate(account.expiresAt, account.durationDays || currentDays);
    if (shouldRestoreArchivedGoogleSheetsAccount(db, account, nextStatus)) {
      account.hidden = false;
      delete account.archivedAt;
      delete account.returnedToStockAt;
      changed = true;
    } else if (account.returnedToStockAt) {
      if (changed) updated += 1;
      continue;
    }

    if (account.status !== nextStatus) {
      account.status = nextStatus;
      changed = true;
    }
    if (changed) updated += 1;
  }
  updated += archiveMalformedManagedAccounts(db);
  updated += archiveReturnedGoogleSheetsManagedAccounts(db);
  updated += dedupeLiveManagedAccounts(db);
  updated += dedupeLiveSheetRowAccounts(db);
  updated += dedupeLiveNetflixSlotAccounts(db);
  return updated;
}

function refreshManagedAccountStatuses(db) {
  return normalizeManagedAccountDurations(db);
}

function backfillManagedAccountsFromCompletedOrders(db) {
  db.managedAccounts = db.managedAccounts || [];
  let created = 0;

  for (const order of db.orders || []) {
    if (order.orderStatus !== "completed" && order.deliveryStatus !== "sent") continue;
    const linkedAccounts = directManagedAccountsForOrder(db, order, { includeHidden: true });
    const deliveredStockIds = Array.isArray(order.deliveredStockIds) ? order.deliveredStockIds.filter(Boolean) : [];
    const expectedCount = Math.max(1, Number(order.qty || order.quantity || 1), deliveredStockIds.length);
    if (linkedAccounts.length >= expectedCount) continue;
    const rebuilt = rebuildManagedAccountsForOrder(db, order, { source: "completed_order_backfill" });
    created += rebuilt.created.length;
  }

  return created;
}

function isFulfilledProductOrder(order = {}) {
  if (!order || order.type === "deposit_topup" || order.orderType === "deposit_topup") return false;
  return order.qrisStatus === "paid" || order.orderStatus === "completed" || order.deliveryStatus === "sent";
}

function orderMatchesSheetStockProduct(order = {}, stock = {}) {
  const stockProductId = String(stock.productId || "").trim();
  const orderProductId = String(order.productId || "").trim();
  if (stockProductId && orderProductId && stockProductId !== orderProductId) return false;
  // Historical fulfillment may have selected a slot from a sibling variant.
  // Product + reseller + exact duration + payment time are the stable join;
  // variant/pool metadata cannot veto an otherwise unique Sheet assignment.
  return true;
}

function reconcileGoogleSheetsStockOrderLinks(db) {
  db.stock = db.stock || [];
  db.orders = db.orders || [];
  db.managedAccounts = db.managedAccounts || [];
  const matches = [];
  const maxTimeDistanceMs = 15 * 60 * 1000;

  for (const stock of db.stock) {
    if (!isGoogleSheetsBackedStock(stock) || String(stock.status || "").toLowerCase() !== "sold") continue;
    const stockId = String(stock.id || "").trim();
    const sellerText = String(stock.sheetSellerInput || stock.reseller || stock.buyer || "").trim();
    const reseller = resellerBySellerText(db, sellerText) || resellerById(db, stock.resellerId);
    const soldAt = toAccountDateTime(stock.soldAt);
    const soldDurationDays = Math.max(0, Number(stock.soldDurationDays || durationDays(stock.soldDuration)));
    if (!stockId || !reseller?.id || !soldAt || !soldDurationDays) continue;

    const candidates = db.orders
      .filter((order) => {
        if (!isFulfilledProductOrder(order) || !orderMatchesSheetStockProduct(order, stock)) return false;
        const orderReseller = resellerById(db, order.resellerId) || activeResellerByWhatsapp(db, order.whatsapp);
        if (orderReseller?.id !== reseller.id) return false;
        const orderDurationDays = Math.max(0, Number(order.durationDays || durationDays(order.duration)));
        if (orderDurationDays !== soldDurationDays) return false;
        const orderAt = toAccountDateTime(order.paidAt || order.createdAt);
        return Boolean(orderAt) && Math.abs(orderAt.getTime() - soldAt.getTime()) <= maxTimeDistanceMs;
      })
      .map((order) => ({
        order,
        distance: Math.abs(toAccountDateTime(order.paidAt || order.createdAt).getTime() - soldAt.getTime()),
      }))
      .sort((left, right) => left.distance - right.distance);

    if (!candidates.length) continue;
    if (candidates.length > 1 && candidates[0].distance === candidates[1].distance) continue;
    matches.push({ stock, order: candidates[0].order, reseller, distance: candidates[0].distance });
  }

  matches.sort((left, right) => left.distance - right.distance);
  const orderUsage = new Map();
  const accepted = [];
  for (const match of matches) {
    const orderId = String(match.order.id || "").trim();
    const capacity = Math.max(1, Number(match.order.qty || match.order.quantity || 1));
    const used = orderUsage.get(orderId) || 0;
    if (used >= capacity) continue;
    orderUsage.set(orderId, used + 1);
    accepted.push(match);
  }

  let updated = 0;
  for (const { stock, order, reseller } of accepted) {
    const stockId = String(stock.id || "").trim();
    for (const candidate of db.orders) {
      const before = Array.isArray(candidate.deliveredStockIds) ? candidate.deliveredStockIds : [];
      const next = before.filter((item) => String(item || "").trim() !== stockId);
      if (candidate.id === order.id) next.push(stockId);
      const unique = [...new Set(next.map((item) => String(item || "").trim()).filter(Boolean))];
      if (JSON.stringify(before) !== JSON.stringify(unique)) {
        candidate.deliveredStockIds = unique;
        updated += 1;
      }
    }

    if (String(stock.sheetOrderId || "").trim() !== String(order.id || "").trim()) {
      stock.sheetOrderId = order.id;
      updated += 1;
    }
    const canonicalName = canonicalResellerDisplayName(reseller, stock.sheetSellerInput || stock.reseller || "");
    const canonicalWhatsapp = primaryResellerWhatsapp(reseller);
    for (const account of db.managedAccounts.filter((item) => String(item.stockId || "").trim() === stockId)) {
      const expected = {
        orderId: order.id,
        sourceOrderId: order.id,
        resellerId: reseller.id,
        reseller: canonicalName,
        buyer: stock.sheetSellerInput || canonicalName,
        whatsapp: canonicalWhatsapp,
        startedAt: stock.soldAt,
        duration: stock.soldDuration,
        durationDays: Number(stock.soldDurationDays || 0),
        expiresAt: stock.soldExpiresAt || stock.expiresAt || "",
      };
      updated += applyManagedAccountOwnershipSnapshot(account, { reseller, expected }, {
        forceCanonical: true,
        forceOrderLinks: true,
        forceTemporal: true,
      });
      account.sheetSellerInput = stock.sheetSellerInput || account.sheetSellerInput || "";
    }
  }
  return updated;
}

function syncSoldStockMetadata(db) {
  db.stock = db.stock || [];
  let updated = 0;

  for (const stock of db.stock) {
    if (!stock || String(stock.status || "").toLowerCase() !== "sold") continue;
    const stockId = String(stock.id || "").trim();
    if (!stockId) continue;
    const linkedAccount = (db.managedAccounts || []).find((account) => String(account.stockId || "").trim() === stockId)
      || null;
    const linkedOrder = linkedAccount
      ? orderForManagedAccount(db, linkedAccount)
      : (db.orders || []).find((order) => (order.deliveredStockIds || []).some((candidate) => String(candidate || "").trim() === stockId)) || null;

    const sheetBacked = isGoogleSheetsBackedStock(stock);
    const expectedBuyer = String(sheetBacked ? (stock.sheetSellerInput || stock.buyer || linkedAccount?.buyer || "") : (linkedAccount?.buyer || linkedOrder?.customer || stock.buyer || "")).trim();
    const expectedReseller = String(sheetBacked
      ? (stock.reseller || stock.sheetSellerInput || linkedAccount?.reseller || "")
      : (
        linkedAccount?.reseller
        || canonicalResellerDisplayName(resellerById(db, linkedOrder?.resellerId) || activeResellerByWhatsapp(db, linkedOrder?.whatsapp), linkedOrder?.reseller || "")
        || stock.reseller
        || ""
      )).trim();
    const expectedOrderId = String(linkedOrder?.id || stock.sheetOrderId || "").trim();
    const expectedSoldAt = String(sheetBacked ? (stock.soldAt || linkedAccount?.startedAt || "") : (linkedAccount?.startedAt || linkedOrder?.paidAt || linkedOrder?.createdAt || stock.soldAt || "")).trim();
    const expectedDuration = String(sheetBacked ? (stock.soldDuration || linkedAccount?.duration || "") : (linkedAccount?.duration || linkedOrder?.duration || stock.soldDuration || "")).trim();
    const expectedDurationDays = Math.max(0, Number(sheetBacked ? (stock.soldDurationDays || linkedAccount?.durationDays || 0) : (linkedAccount?.durationDays || linkedOrder?.durationDays || stock.soldDurationDays || 0)));

    if (expectedBuyer && String(stock.buyer || "").trim() !== expectedBuyer) {
      stock.buyer = expectedBuyer;
      updated += 1;
    }
    if (expectedReseller && String(stock.reseller || "").trim() !== expectedReseller) {
      stock.reseller = expectedReseller;
      updated += 1;
    }
    if (expectedOrderId && String(stock.sheetOrderId || "").trim() !== expectedOrderId) {
      stock.sheetOrderId = expectedOrderId;
      updated += 1;
    }
    if (expectedSoldAt && String(stock.soldAt || "").trim() !== expectedSoldAt) {
      stock.soldAt = expectedSoldAt;
      updated += 1;
    }
    if (expectedDuration && String(stock.soldDuration || "").trim() !== expectedDuration) {
      stock.soldDuration = expectedDuration;
      updated += 1;
    }
    if (expectedDurationDays > 0 && Number(stock.soldDurationDays || 0) !== expectedDurationDays) {
      stock.soldDurationDays = expectedDurationDays;
      updated += 1;
    }
  }

  return updated;
}

function syncManagedAccountCredentialsFromOrders(db) {
  db.managedAccounts = db.managedAccounts || [];
  let updated = 0;

  for (const account of db.managedAccounts) {
    if (account.hidden || account.returnedToStockAt) continue;
    if (["expired", "replaced", "disabled"].includes(String(account.status || accountStatusFromDate(account.expiresAt, account.durationDays)).toLowerCase())) continue;
    const stock = stockForManagedAccount(db, account);
    if (!stock) continue;
    const stockId = String(stock.id || account.stockId || "").trim();
    const order = (db.orders || []).find((item) => (item.deliveredStockIds || []).includes(stockId));
    const fulfillment = String(order?.fulfillmentText || "");
    const password = stock?.password || parseFulfillmentField(fulfillment, "Password") || "";
    const profile = stock?.profile || parseFulfillmentField(fulfillment, "Profile") || "";
    const pin = stock?.pin || parseFulfillmentField(fulfillment, "PIN") || "";
    const signInCode = stock?.signInCode || parseFulfillmentField(fulfillment, "Sign-in code") || "";
    const verificationCode = stock?.verificationCode || parseFulfillmentField(fulfillment, "Verification code") || "";
    const resetLink = stock?.resetLink || "";
    const householdLink = stock?.householdLink || "";
    const sheetBacked = String(account.sheetSource || account.source || "").toLowerCase() === "google_sheets"
      || String(stock?.sheetSource || "").toLowerCase() === "google_sheets";

    let changed = false;
    if (password && account.password !== password) {
      account.password = password;
      changed = true;
    }
    if (profile && account.profile !== profile) {
      account.profile = profile;
      changed = true;
    }
    if (pin && account.pin !== pin) {
      account.pin = pin;
      changed = true;
    }
    if (signInCode && account.signInCode !== signInCode) {
      account.signInCode = signInCode;
      changed = true;
    }
    if (verificationCode && account.verificationCode !== verificationCode) {
      account.verificationCode = verificationCode;
      changed = true;
    }
    if (resetLink && account.resetLink !== resetLink) {
      account.resetLink = resetLink;
      changed = true;
    }
    if (householdLink && account.householdLink !== householdLink) {
      account.householdLink = householdLink;
      changed = true;
    }
    if (sheetBacked && stock?.password && account.password !== stock.password) {
      account.password = stock.password;
      changed = true;
    }
    if (sheetBacked && stock?.profile && account.profile !== stock.profile) {
      account.profile = stock.profile;
      changed = true;
    }
    if (sheetBacked && stock?.pin && account.pin !== stock.pin) {
      account.pin = stock.pin;
      changed = true;
    }
    if (changed) updated += 1;
  }

  return updated;
}

function syncNetflixManagedPasswordConsensus(db) {
  db.managedAccounts = db.managedAccounts || [];
  let updated = 0;
  const byEmail = new Map();

  for (const account of db.managedAccounts) {
    if (account.hidden || account.returnedToStockAt) continue;
    const status = String(account.status || accountStatusFromDate(account.expiresAt, account.durationDays)).toLowerCase();
    if (["expired", "replaced", "disabled"].includes(status)) continue;
    if (isMalformedManagedAccount(account)) continue;
    if (!isNetflixManagedAccount(account)) continue;
    if (String(account.sheetSource || account.source || "").toLowerCase() === "google_sheets") continue;
    const emailKey = String(account.email || "").trim().toLowerCase();
    const password = String(account.password || "").trim();
    if (!emailKey || !password) continue;
    const list = byEmail.get(emailKey) || [];
    list.push(account);
    byEmail.set(emailKey, list);
  }

  for (const accounts of byEmail.values()) {
    if (accounts.length < 2) continue;
    const passwordGroups = new Map();
    for (const account of accounts) {
      const key = String(account.password || "").trim();
      const list = passwordGroups.get(key) || [];
      list.push(account);
      passwordGroups.set(key, list);
    }
    if (passwordGroups.size <= 1) continue;

    const canonicalPassword = [...passwordGroups.entries()]
      .sort((left, right) => {
        if (right[1].length !== left[1].length) return right[1].length - left[1].length;
        const leftKeeper = left[1].slice().sort(compareManagedAccountPriority)[0];
        const rightKeeper = right[1].slice().sort(compareManagedAccountPriority)[0];
        return compareManagedAccountPriority(leftKeeper, rightKeeper);
      })[0]?.[0] || "";
    if (!canonicalPassword) continue;

    for (const account of accounts) {
      if (String(account.password || "").trim() === canonicalPassword) continue;
      account.password = canonicalPassword;
      const linkedStock = stockForManagedAccount(db, account);
      if (linkedStock && String(linkedStock.password || "").trim() !== canonicalPassword) {
        linkedStock.password = canonicalPassword;
        updated += 1;
      }
      updated += 1;
    }
  }

  return updated;
}

function managedAccountOwnershipSnapshot(db, account = {}, options = {}) {
  const order = options.order || orderForManagedAccount(db, account);
  const stock = options.stock || stockForManagedAccount(db, account);
  const reseller = options.reseller || resolveManagedAccountReseller(db, account, { order });
  const sheetBacked = String(account.sheetSource || account.source || stock?.sheetSource || "").toLowerCase() === "google_sheets";
  const orderOwnsStock = Boolean(order?.id && account.stockId && (order.deliveredStockIds || []).some((item) => String(item || "").trim() === String(account.stockId || "").trim()));
  const whatsapp = normalizeWhatsappNumber(order?.whatsapp || account.whatsapp || primaryResellerWhatsapp(reseller) || "");
  const resellerName = reseller?.name || reseller?.username || "";
  const orderId = String(order?.id || "").trim();
  const useSheetTemporal = sheetBacked && stock;
  const startedAt = String(useSheetTemporal ? (stock.soldAt || account.startedAt || "") : (orderOwnsStock ? (order?.paidAt || order?.createdAt || stock?.soldAt || account.startedAt || "") : (account.startedAt || order?.paidAt || order?.createdAt || stock?.soldAt || ""))).trim();
  const duration = String(useSheetTemporal ? (stock.soldDuration || account.duration || "") : (orderOwnsStock ? (order?.duration || stock?.soldDuration || account.duration || "") : (account.duration || order?.duration || stock?.soldDuration || ""))).trim();
  const durationDaysValue = Math.max(0, Number(useSheetTemporal ? (stock.soldDurationDays || account.durationDays || 0) : (orderOwnsStock ? (order?.durationDays || stock?.soldDurationDays || account.durationDays || 0) : (account.durationDays || order?.durationDays || stock?.soldDurationDays || 0))));
  const expiresAt = String(useSheetTemporal ? (stock.soldExpiresAt || stock.expiresAt || account.expiresAt || "") : (orderOwnsStock ? (order?.expiresAt || "") : (account.expiresAt || order?.expiresAt || ""))).trim()
    || (startedAt && durationDaysValue > 0 ? addAccountDaysText(durationDaysValue, startedAt, { keepTime: true }) : "");
  const buyer = String(account.buyer || order?.customer || resellerName || whatsapp || "").trim();
  return {
    order,
    stock,
    reseller,
    orderOwnsStock,
    expected: {
      whatsapp,
      resellerId: reseller?.id || "",
      reseller: resellerName,
      buyer,
      orderId,
      sourceOrderId: orderId,
      startedAt,
      duration,
      durationDays: durationDaysValue,
      expiresAt,
    },
  };
}

function canonicalResellerDisplayName(reseller = null, fallback = "") {
  const source = safeResellerRecord(reseller);
  return String(source.name || source.username || primaryResellerWhatsapp(source) || fallback || "").trim();
}

function applyManagedAccountOwnershipSnapshot(account = {}, snapshot = {}, options = {}) {
  const expected = snapshot.expected || {};
  let updated = 0;
  const forceCanonical = options.forceCanonical === true;
  const forceOrderLinks = options.forceOrderLinks === true;
  const forceTemporal = options.forceTemporal === true;
  const resellerIdChanged = Boolean(expected.resellerId && account.resellerId !== expected.resellerId);

  if (expected.whatsapp && account.whatsapp !== expected.whatsapp) {
    account.whatsapp = expected.whatsapp;
    updated += 1;
  }
  if (expected.resellerId && account.resellerId !== expected.resellerId) {
    account.resellerId = expected.resellerId;
    updated += 1;
  }

  const currentResellerLooksLikeNumber = normalizeWhatsappNumber(account.reseller || "");
  if (
    expected.reseller
    && account.reseller !== expected.reseller
    && (
      forceCanonical
      || (expected.resellerId && String(account.resellerId || "").trim() === String(expected.resellerId || "").trim())
      || resellerIdChanged
      || !account.reseller
      || currentResellerLooksLikeNumber
      || (snapshot.reseller && sellerTextMatchesReseller(account.reseller, snapshot.reseller))
    )
  ) {
    account.reseller = expected.reseller;
    updated += 1;
  }

  if (expected.buyer && (!account.buyer || forceCanonical) && account.buyer !== expected.buyer) {
    account.buyer = expected.buyer;
    updated += 1;
  }

  if (expected.orderId && (forceOrderLinks || !account.orderId) && account.orderId !== expected.orderId) {
    account.orderId = expected.orderId;
    updated += 1;
  }
  if (expected.sourceOrderId && (forceOrderLinks || !account.sourceOrderId) && account.sourceOrderId !== expected.sourceOrderId) {
    account.sourceOrderId = expected.sourceOrderId;
    updated += 1;
  }
  if (expected.startedAt && (forceTemporal || !account.startedAt) && account.startedAt !== expected.startedAt) {
    account.startedAt = expected.startedAt;
    updated += 1;
  }
  if (expected.duration && (forceTemporal || !account.duration) && account.duration !== expected.duration) {
    account.duration = expected.duration;
    updated += 1;
  }
  if (expected.durationDays > 0 && (forceTemporal || !account.durationDays) && Number(account.durationDays || 0) !== expected.durationDays) {
    account.durationDays = expected.durationDays;
    updated += 1;
  }
  if (expected.expiresAt && (forceTemporal || !account.expiresAt) && account.expiresAt !== expected.expiresAt) {
    account.expiresAt = expected.expiresAt;
    updated += 1;
  }
  return updated;
}

function syncManagedAccountWhatsappFromOrders(db) {
  db.managedAccounts = db.managedAccounts || [];
  let updated = 0;

  for (const account of db.managedAccounts) {
    const snapshot = managedAccountOwnershipSnapshot(db, account);
    updated += applyManagedAccountOwnershipSnapshot(account, snapshot, {
      forceOrderLinks: snapshot.orderOwnsStock,
      forceTemporal: snapshot.orderOwnsStock,
    });
  }

  return updated;
}

function rebuildManagedAccountsForOrder(db, order = {}, options = {}) {
  db.managedAccounts = db.managedAccounts || [];
  if (!order?.id) return { created: [], skippedReason: "order_not_found" };
  if (order.type === "deposit_topup" || order.orderType === "deposit_topup") {
    return { created: [], skippedReason: "deposit_order" };
  }

  const product = getProduct(db, order.productId) || (db.products || []).find((item) => item.name === order.product);
  const variant = getVariant(db, product?.id, order.variantId) || product?.variants?.find((item) => item.id === order.customerVariantId || item.code === order.variantCode || item.name === order.variant);
  if (!product || !variant) return { created: [], skippedReason: "product_variant_missing" };
  if (isLinkPoolProduct(db, product, variant)) return { created: [], skippedReason: "link_pool_manual_only" };

  const linkedAccounts = directManagedAccountsForOrder(db, order, { includeHidden: true });
  const existingStockIds = new Set(linkedAccounts.map((item) => String(item.stockId || "").trim()).filter(Boolean));
  const deliveredStockIds = Array.isArray(order.deliveredStockIds) ? order.deliveredStockIds : [];
  const deliveredStocks = deliveredStockIds
    .map((stockId) => (db.stock || []).find((item) => String(item.id || "").trim() === String(stockId || "").trim()))
    .filter(Boolean);
  if (!deliveredStocks.length) return { created: [], skippedReason: "delivered_stock_missing" };

  const reseller = resellerById(db, order.resellerId) || activeResellerByWhatsapp(db, order.whatsapp);
  const created = [];
  for (const stock of deliveredStocks) {
    if (existingStockIds.has(String(stock.id || "").trim())) continue;
    if (stockHasConflictingHistoricalOrders(db, stock, order)) continue;
    const sheetBacked = String(stock.sheetSource || "").toLowerCase() === "google_sheets";
    const liveSheetStatus = String(stock.status || "").toLowerCase();
    if (sheetBacked && liveSheetStatus !== "sold") continue;
    const durationDayCount = Math.max(0, Number(order.durationDays || durationDays(order.duration)));
    const startedAt = String(order.paidAt || order.createdAt || stock.soldAt || nowText()).trim();
    const account = {
      id: makeId("acc"),
      stockId: stock.id,
      orderId: order.id,
      sourceOrderId: order.id,
      resellerId: order.resellerId || reseller?.id || "",
      product: product.name,
      productId: product.id,
      variant: order.customerVariant || order.variant || variant.name,
      variantId: order.customerVariantId || order.variantId || variant.id,
      variantCode: order.customerVariantCode || order.variantCode || variant.code,
      stockPoolKey: order.stockPoolKey || variantStockGroupKey(product, variant),
      duration: order.duration || "",
      durationDays: durationDayCount,
      email: stock.email || "",
      password: stock.password || "",
      buyer: order.customer || "",
      reseller: reseller?.name || reseller?.username || order.reseller || order.whatsapp || "",
      whatsapp: normalizeWhatsappNumber(order.whatsapp || primaryResellerWhatsapp(reseller) || ""),
      profile: stock.profile || "",
      pin: stock.pin || "",
      signInCode: stock.signInCode || "",
      verificationCode: stock.verificationCode || "",
      resetLink: stock.resetLink || "",
      householdLink: stock.householdLink || "",
      device: order.device || stock.device || "",
      sheetSource: stock.sheetSource || "",
      sheetName: stock.sheetName || "",
      sheetRow: stock.sheetRow || 0,
      sheetPool: stock.sheetPool || "",
      sheetPoolSchema: stock.sheetPoolSchema || "",
      sheetStartColumn: stock.sheetStartColumn || 0,
      sheetStockKey: stock.sheetStockKey || "",
      startedAt,
      expiresAt: order.expiresAt || (durationDayCount > 0 ? addAccountDaysText(durationDayCount, startedAt, { keepTime: true }) : ""),
      status: accountStatusFromDate(order.expiresAt || (durationDayCount > 0 ? addAccountDaysText(durationDayCount, startedAt, { keepTime: true }) : ""), durationDayCount),
      source: options.source || "order_rebuild",
      rebuiltAt: nowText(),
    };
    if (overlappingLiveSlotAccount(db, account)) continue;
    created.push(account);
  }

  if (created.length) {
    db.managedAccounts.push(...created);
    syncManagedAccountWhatsappFromOrders(db);
  }
  return { created, skippedReason: created.length ? "" : "nothing_to_rebuild" };
}

function repairCompletedOrderSheetAssignment(db, orderId = "") {
  const wantedId = String(orderId || "").trim();
  const order = (db.orders || []).find((item) => item.id === wantedId || item.paymentRef === wantedId);
  if (!order) return { ok: false, status: 404, reason: "order_not_found" };
  const deliveredIds = new Set((order.deliveredStockIds || []).map((item) => String(item || "").trim()).filter(Boolean));
  const recoverableFailedCommit = (
    deliveredIds.size > 0
    && String(order.deliveryStatus || "").toLowerCase() === "sheet_sync_failed"
    && Boolean(order.fulfillmentText)
  );
  if (!isFulfilledProductOrder(order) && !recoverableFailedCommit) {
    return { ok: false, status: 409, reason: "order_not_fulfilled", order };
  }

  const deliveredStocks = (db.stock || []).filter((stock) => (
    deliveredIds.has(String(stock.id || "").trim())
    || String(stock.sheetOrderId || "").trim() === String(order.id || "").trim()
  ));
  if (!deliveredStocks.length) return { ok: false, status: 409, reason: "delivered_stock_missing", order };

  const terminalStatuses = new Set(["expired", "replaced", "disabled"]);
  for (const stock of deliveredStocks) {
    const stockId = String(stock.id || "").trim();
    const conflictingAccount = (db.managedAccounts || []).find((account) => {
      if (String(account.stockId || "").trim() !== stockId) return false;
      if (account.hidden || account.returnedToStockAt) return false;
      if (terminalStatuses.has(String(account.status || "").trim().toLowerCase())) return false;
      return String(account.orderId || account.sourceOrderId || "").trim() !== String(order.id || "").trim();
    });
    const conflictingOrderId = String(stock.sheetOrderId || "").trim();
    const staleHistoricalOrderLink = (
      conflictingOrderId
      && conflictingOrderId !== order.id
      && hasOnlyHistoricalManagedAssignment(db.managedAccounts, stockId, conflictingOrderId)
    );
    if (
      conflictingAccount
      || (
        conflictingOrderId
        && conflictingOrderId !== order.id
        && String(stock.status || "").toLowerCase() === "sold"
        && !staleHistoricalOrderLink
      )
    ) {
      return {
        ok: false,
        status: 409,
        reason: "stock_owned_by_another_order",
        order,
        stockId,
        conflictingOrderId: conflictingAccount?.orderId || conflictingAccount?.sourceOrderId || conflictingOrderId,
      };
    }
  }

  const reseller = resellerById(db, order.resellerId) || activeResellerByWhatsapp(db, order.whatsapp);
  const repairedAt = nowText();
  const startedAt = String(order.paidAt || order.createdAt || repairedAt).trim();
  const durationDayCount = Math.max(1, Number(order.durationDays || durationDays(order.duration) || 1));
  const expiresAt = String(order.expiresAt || addAccountDaysText(durationDayCount, startedAt, { keepTime: true })).trim();

  order.deliveredStockIds = [...new Set(deliveredStocks.map((stock) => String(stock.id || "").trim()).filter(Boolean))];
  for (const stock of deliveredStocks) {
    stock.status = "sold";
    stock.soldAt = startedAt;
    stock.soldDuration = order.duration || stock.soldDuration || "";
    stock.soldDurationDays = durationDayCount;
    stock.soldExpiresAt = expiresAt;
    stock.sheetOrderId = order.id;
    stock.resellerId = order.resellerId || reseller?.id || stock.resellerId || "";
    stock.reseller = reseller?.name || reseller?.username || order.reseller || stock.reseller || "";
    stock.buyer = order.customer || stock.buyer || "";
    stock.whatsapp = normalizeWhatsappNumber(order.whatsapp || primaryResellerWhatsapp(reseller) || stock.whatsapp || "");
    delete stock.sheetRemovedAt;
    delete stock.reservedFor;
    delete stock.reservedAccountId;
    delete stock.reservedUntil;
    delete stock.reservedAt;
  }

  let restored = 0;
  for (const account of db.managedAccounts || []) {
    const linkedOrderId = String(account.orderId || account.sourceOrderId || "").trim();
    if (linkedOrderId !== order.id || !order.deliveredStockIds.includes(String(account.stockId || "").trim())) continue;
    account.hidden = false;
    account.status = accountStatusFromDate(expiresAt, durationDayCount);
    account.orderId = order.id;
    account.sourceOrderId = order.id;
    account.resellerId = order.resellerId || reseller?.id || account.resellerId || "";
    account.reseller = reseller?.name || reseller?.username || order.reseller || account.reseller || "";
    account.whatsapp = normalizeWhatsappNumber(order.whatsapp || primaryResellerWhatsapp(reseller) || account.whatsapp || "");
    account.startedAt = startedAt;
    account.duration = order.duration || account.duration || "";
    account.durationDays = durationDayCount;
    account.expiresAt = expiresAt;
    account.repairedAt = repairedAt;
    delete account.returnedToStockAt;
    delete account.sheetClearedAt;
    delete account.archivedAt;
    restored += 1;
  }

  const rebuilt = rebuildManagedAccountsForOrder(db, order, { source: "owner_sheet_repair" });
  const accounts = directManagedAccountsForOrder(db, order, { includeHidden: false });
  if (!accounts.length) {
    return { ok: false, status: 409, reason: rebuilt.skippedReason || "managed_account_rebuild_failed", order };
  }
  return { ok: true, order, accounts, restored, rebuilt: rebuilt.created.length };
}

function repairManagedAccountOwnership(db, options = {}) {
  db.managedAccounts = db.managedAccounts || [];
  const scopeAccountId = String(options.accountId || "").trim();
  const scopeOrderId = String(options.orderId || "").trim();
  const scopeResellerId = String(options.resellerId || "").trim();
  let matched = 0;
  let repaired = 0;
  const changedAccountIds = [];
  const changedOrderIds = new Set();

  for (const account of db.managedAccounts) {
    const snapshot = managedAccountOwnershipSnapshot(db, account);
    const relatedOrderId = String(snapshot.order?.id || account.orderId || account.sourceOrderId || "").trim();
    const relatedResellerId = String(snapshot.reseller?.id || account.resellerId || snapshot.order?.resellerId || "").trim();
    if (scopeAccountId && String(account.id || "").trim() !== scopeAccountId) continue;
    if (scopeOrderId && relatedOrderId !== scopeOrderId) continue;
    if (scopeResellerId && relatedResellerId !== scopeResellerId) continue;
    matched += 1;
    const changed = applyManagedAccountOwnershipSnapshot(account, snapshot, {
      forceCanonical: true,
      forceOrderLinks: true,
      forceTemporal: false,
    });
    if (changed > 0) {
      repaired += changed;
      changedAccountIds.push(account.id);
      if (relatedOrderId) changedOrderIds.add(relatedOrderId);
    }
  }

  const rebuildResults = [];
  const candidateOrders = (db.orders || []).filter((order) => {
    if (scopeOrderId && String(order.id || "").trim() !== scopeOrderId) return false;
    if (scopeResellerId && String(order.resellerId || "").trim() !== scopeResellerId) return false;
    if (scopeAccountId) return false;
    const delivery = String(order.deliveryStatus || "").toLowerCase();
    const status = String(order.orderStatus || "").toLowerCase();
    return ["sent", "failed", "paid", "processing"].includes(delivery) || ["completed", "processing"].includes(status);
  });
  for (const order of candidateOrders) {
    const linkedAccounts = directManagedAccountsForOrder(db, order, { includeHidden: true });
    const qty = Math.max(1, Number(order.qty || 1));
    if (linkedAccounts.length >= qty) continue;
    const rebuilt = rebuildManagedAccountsForOrder(db, order, { source: "reseller_repair" });
    if (rebuilt.created.length) {
      rebuildResults.push({ orderId: order.id, created: rebuilt.created.length });
      changedOrderIds.add(order.id);
      changedAccountIds.push(...rebuilt.created.map((item) => item.id));
    }
  }

  return {
    matched,
    repaired,
    rebuilt: rebuildResults.reduce((sum, item) => sum + Number(item.created || 0), 0),
    rebuildResults,
    changedAccountIds,
    changedOrderIds: [...changedOrderIds],
  };
}

function safeAccountForAccess(account) {
  return {
    id: account.id,
    product: account.product,
    variant: account.variant || "",
    email: account.email,
    loginPhone: account.loginPhone || "",
    profile: account.profile || "",
    startedAt: account.startedAt || "",
    expiresAt: account.expiresAt || "",
    status: account.status || "active",
  };
}

function isNetflixManagedAccount(account = {}) {
  return [account.product, account.productId, account.variant, account.variantCode]
    .join(" ")
    .toLowerCase()
    .includes("netflix");
}

function isDisneyManagedAccount(account = {}) {
  return [account.product, account.productId, account.variant, account.variantCode]
    .join(" ")
    .toLowerCase()
    .includes("disney");
}

function findProductByName(db, name = "") {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  return (db.products || []).find((product) => String(product.name || "").trim().toLowerCase() === wanted) || null;
}

function resolveAccountProductVariant(db, input = {}) {
  const product = getProduct(db, input.productId) || findProductByName(db, input.product) || (db.products || [])[0] || null;
  if (!product) return { product: null, variant: null };
  const variantText = String(input.variant || "").trim().toLowerCase();
  const variantCode = String(input.variantCode || "").trim().toUpperCase();
  const variant =
    (product.variants || []).find((item) => item.id === input.variantId)
    || (product.variants || []).find((item) => String(item.code || "").trim().toUpperCase() === variantCode)
    || (product.variants || []).find((item) => String(item.name || "").trim().toLowerCase() === variantText)
    || (product.variants || []).find((item) => isVariantOrderable(product, item))
    || (product.variants || [])[0]
    || null;
  return { product, variant };
}

function syncPasswordByEmail(db, email, password, options = {}) {
  const key = normalizeEmailKey(email);
  if (!key) return { stockUpdated: 0, accountUpdated: 0, affectedAccounts: [] };

  const nextPassword = String(password ?? "");
  const affectedAccounts = [];
  let stockMatched = 0;
  let accountMatched = 0;
  let stockUpdated = 0;
  let accountUpdated = 0;

  for (const stock of db.stock || []) {
    if (normalizeEmailKey(stock.email) !== key) continue;
    stockMatched += 1;
    if (String(stock.password ?? "") !== nextPassword) {
      stock.password = nextPassword;
      stockUpdated += 1;
    }
  }

  for (const account of db.managedAccounts || []) {
    if (normalizeEmailKey(account.email) !== key) continue;
    const accountStatus = accountStatusFromDate(account.expiresAt, account.durationDays);
    if (account.status === "expired" || accountStatus === "expired") continue;
    accountMatched += 1;
    affectedAccounts.push(account);
    if (String(account.password ?? "") !== nextPassword) {
      account.password = nextPassword;
      accountUpdated += 1;
    }
  }

  if (!stockUpdated && !accountUpdated && !affectedAccounts.length) {
    return { stockUpdated, accountUpdated, affectedAccounts };
  }

  db.activities = db.activities || [];
  db.activities.unshift({
    id: makeId("act"),
    type: "account",
    title: `Password akun ${email} disinkronkan`,
    description: `Password untuk ${email} disamakan di ${stockMatched} stok dan ${accountMatched} akun reseller aktif. History expired tidak diubah.`,
    createdAt: nowText(),
    accountId: options.sourceAccountId || "",
    accountEmail: email,
  });

  const loggedKeys = new Set();
  for (const account of affectedAccounts) {
    const logKey = `${account.resellerId || ""}::${normalizeWhatsappNumber(account.whatsapp || "")}::${account.id}`;
    if (loggedKeys.has(logKey)) continue;
    loggedKeys.add(logKey);
    db.activities.unshift({
      id: makeId("act"),
      type: "account",
      title: `Password akun ${email} diperbarui`,
      description: `Password akun ${[account.product, account.variant].filter(Boolean).join(" - ") || email} diperbarui oleh owner.`,
      createdAt: nowText(),
      resellerId: account.resellerId || "",
      whatsapp: normalizeWhatsappNumber(account.whatsapp || ""),
      accountId: account.id,
      accountEmail: email,
    });
  }

  return { stockUpdated, accountUpdated, affectedAccounts };
}

function strictAccountNotificationReseller(db, account = {}) {
  const resellerId = String(account.resellerId || "").trim();
  if (resellerId) {
    const reseller = (db.resellers || []).find((item) => item.id === resellerId && item.isActive !== false);
    if (reseller) return reseller;
    return null;
  }

  const whatsapp = normalizeWhatsappNumber(account.whatsapp || "");
  if (!whatsapp) return null;
  return activeResellerByWhatsapp(db, whatsapp);
}

function accountChangeFields(before = {}, after = {}) {
  const fields = [
    ["email", "Email/Account"],
    ["password", "Password/Link"],
    ["profile", "Nama profil"],
    ["pin", "PIN"],
  ];
  return fields
    .filter(([key]) => String(before[key] ?? "") !== String(after[key] ?? ""))
    .map(([key, label]) => ({ key, label }));
}

function accountCredentialLabel(account = {}) {
  const text = [account.product, account.productId, account.variant, account.variantCode, account.accountType, account.source]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("canva")) return { identity: "Email customer", secret: "Link Canva" };
  if (text.includes("viu") || text.includes("vidio")) return { identity: "Account", secret: "Password" };
  return { identity: "Email akun", secret: /^https?:\/\//i.test(String(account.password || "")) ? "Password/Link" : "Password" };
}

async function notifyResellerAccountChanged(db, account = {}, changes = [], options = {}) {
  const filteredChanges = (changes || []).filter(Boolean);
  if (!filteredChanges.length) return { sent: false, skipped: true, reason: "no_changes" };
  const reseller = strictAccountNotificationReseller(db, account);
  if (!reseller?.id) {
    account.lastChangeNotificationAt = nowText();
    account.lastChangeNotificationStatus = "skipped";
    account.lastChangeNotificationError = "reseller_not_found";
    return { sent: false, skipped: true, reason: "reseller_not_found" };
  }
  const target = primaryResellerWhatsapp(reseller) || normalizeWhatsappNumber(account.whatsapp || "");

  const dedupeKey = [
    reseller.id,
    account.id || normalizeEmailKey(account.email || ""),
    normalizeEmailKey(account.email || ""),
    filteredChanges.map((item) => item.key).sort().join(","),
  ].join("::");
  if (options.dedupeSet?.has(dedupeKey)) return { sent: false, skipped: true, reason: "duplicate_notification" };
  options.dedupeSet?.add(dedupeKey);

  const sentAt = nowText();
  const labels = filteredChanges.map((item) => item.label).filter(Boolean).join(", ") || "Data akun";
  const productLabel = [account.product, account.variant].filter(Boolean).join(" - ") || account.email || "akun";
  db.activities = db.activities || [];
  db.activities.unshift({
    id: makeId("act"),
    type: "account",
    title: "Data akun diperbarui",
    description: `${labels} untuk ${productLabel} diperbarui oleh owner. Gunakan data terbaru di Manage Account.`,
    createdAt: sentAt,
    resellerId: reseller.id,
    whatsapp: target,
    accountId: account.id || "",
    accountEmail: account.email || "",
    product: account.product || "",
    variant: account.variant || "",
    source: "panel_account_change",
    changedFields: filteredChanges.map((item) => item.key),
  });
  account.lastChangeNotificationAt = sentAt;
  account.lastChangeNotificationStatus = "panel";
  account.lastChangeNotificationError = "";
  return { sent: false, panel: true, logged: true, reason: "panel_notification_only" };
}

async function syncCredentialsToSheetsSafely(db, options = {}) {
  try {
    const result = await syncAccountCredentialsToGoogleSheets(db, options);
    return result;
  } catch (error) {
    const message = error.message || "google_sheets_credential_sync_failed";
    db.activities = db.activities || [];
    db.activities.unshift({
      id: makeId("act"),
      type: "stock",
      title: "Sync password ke Google Sheets gagal",
      description: `Password ${options.email || options.stockIds?.[0] || "akun"} sudah tersimpan di web, tapi belum terkirim ke Sheets: ${message}`,
      createdAt: nowText(),
      accountId: options.accountIds?.[0] || "",
      accountEmail: options.email || "",
    });
    return { ok: false, error: message };
  }
}

function buildManagedAccountInput(db, body = {}) {
  const { product, variant } = resolveAccountProductVariant(db, body);
  if (!product || !variant || !isVariantOrderable(product, variant)) {
    const error = new Error("Produk atau varian akun tidak valid");
    error.status = 400;
    throw error;
  }

  const reseller = (db.resellers || []).find((item) => item.id === body.resellerId) || activeResellerByWhatsapp(db, body.whatsapp || "");
  const email = String(body.email || "").trim();
  if (!email) {
    const error = new Error("Email akun wajib diisi");
    error.status = 400;
    throw error;
  }
  const usageMode = String(body.usageMode || body.source || "").toLowerCase().includes("daily") ? "daily" : "manual";
  const startedAt = String(body.startedAt || (usageMode === "daily" ? dateTimeText(new Date()) : todayText())).trim();
  const durationLabel = normalizeDurationLabel(body.duration || "1 Bulan", variant);
  const requestedDurationDays = Number(body.durationDays || 0);
  const durationDayCount = Number.isFinite(requestedDurationDays) && requestedDurationDays > 0 ? Math.floor(requestedDurationDays) : durationDays(durationLabel);
  const expiresAt = String(body.expiresAt || addAccountDaysText(durationDayCount, startedAt, { keepTime: usageMode === "daily" })).trim();
  const whatsapp = normalizeWhatsappNumber(body.whatsapp || reseller?.whatsapp || "");

  return {
    id: makeId("acc"),
    stockId: "",
    manual: true,
    source: "manual_input",
    usageMode,
    snapshotAt: nowText(),
    resellerId: reseller?.id || String(body.resellerId || "").trim(),
    product: product.name,
    productId: product.id,
    variant: variant.name,
    variantId: variant.id,
    variantCode: variant.code,
    stockPoolKey: variantStockGroupKey(product, variant),
    duration: durationLabel,
    durationDays: durationDayCount,
    email,
    password: String(body.password || ""),
    buyer: String(body.buyer || body.customer || reseller?.name || whatsapp || "").trim(),
    reseller: String(body.reseller || reseller?.name || whatsapp || "").trim(),
    whatsapp,
    profile: String(body.profile || ""),
    pin: String(body.pin || ""),
    signInCode: String(body.signInCode || ""),
    verificationCode: String(body.verificationCode || ""),
    resetLink: String(body.resetLink || ""),
    householdLink: String(body.householdLink || ""),
    startedAt,
    expiresAt,
    status: body.status || accountStatusFromDate(expiresAt, durationDayCount),
    hidden: false,
  };
}

function buildDailyStockAssignment(db, stock = {}, body = {}) {
  if (!stock || stock.status !== "available") {
    const error = new Error("Stok harus berstatus tersedia sebelum assign harian");
    error.status = 400;
    throw error;
  }
  const product = getProduct(db, stock.productId);
  const stockVariant = product?.variants?.find((item) => item.id === stock.variantId);
  if (!product || !stockVariant) {
    const error = new Error("Produk atau varian stok tidak valid");
    error.status = 400;
    throw error;
  }
  const customerVariant = product.variants?.find((item) => item.id === body.variantId) || stockVariant;
  const reseller = (db.resellers || []).find((item) => item.id === body.resellerId) || activeResellerByWhatsapp(db, body.whatsapp || "");
  if (!reseller) {
    const error = new Error("Reseller tujuan wajib dipilih");
    error.status = 400;
    throw error;
  }
  const durationDayCount = Math.max(1, Math.floor(Number(body.durationDays || 1)));
  const startedAt = String(body.startedAt || dateTimeText(new Date())).trim();
  const expiresAt = String(body.expiresAt || addAccountDaysText(durationDayCount, startedAt, { keepTime: true })).trim();
  const whatsapp = normalizeWhatsappNumber(body.whatsapp || reseller.whatsapp || "");
  return {
    id: makeId("acc"),
    stockId: stock.id,
    manual: true,
    source: "assign_daily",
    usageMode: "daily",
    snapshotAt: nowText(),
    resellerId: reseller.id,
    product: product.name,
    productId: product.id,
    variant: customerVariant.name,
    variantId: customerVariant.id,
    variantCode: customerVariant.code,
    stockPoolKey: variantStockGroupKey(product, stockVariant),
    duration: `${durationDayCount} Hari`,
    durationDays: durationDayCount,
    email: stock.email || "",
    password: stock.password || "",
    buyer: String(body.buyer || reseller.name || whatsapp || "").trim(),
    reseller: reseller.name || whatsapp || "",
    whatsapp,
    profile: stock.profile || "",
    pin: stock.pin || "",
    signInCode: stock.signInCode || "",
    verificationCode: stock.verificationCode || "",
    resetLink: stock.resetLink || "",
    householdLink: stock.householdLink || "",
    device: String(body.device || stock.device || "").trim(),
    sheetSource: stock.sheetSource || "",
    sheetStockKey: stock.sheetStockKey || "",
    sheetPool: stock.sheetPool || "",
    sheetPoolSchema: stock.sheetPoolSchema || "",
    sheetName: stock.sheetName || "",
    sheetRow: stock.sheetRow || 0,
    sheetStartColumn: stock.sheetStartColumn || 0,
    startedAt,
    expiresAt,
    status: accountStatusFromDate(expiresAt, durationDayCount),
    hidden: false,
  };
}

function managedAccountPoolKey(db, account = {}) {
  if (account.stockPoolKey) return account.stockPoolKey;
  const { product, variant } = resolveAccountProductVariant(db, account);
  return product && variant ? variantStockGroupKey(product, variant) : "";
}

function isExpiredManagedAccountForReturn(account = {}) {
  const status = String(account.status || "").toLowerCase();
  return status === "expired" || accountStatusFromDate(account.expiresAt, account.durationDays) === "expired";
}

function stockProductVariant(db, stock = {}) {
  const product = getProduct(db, stock.productId);
  const variant = product?.variants?.find((item) => item.id === stock.variantId) || null;
  return { product, variant };
}

function remainingAccountDuration(account = {}) {
  const startedAt = toAccountDateTime(account.startedAt);
  const expires = toAccountDateTime(account.expiresAt, { endOfDay: !hasTimePart(account.expiresAt), referenceDate: startedAt });
  if (!expires) return { days: 0, expiresAt: "", label: "0 hari" };
  const msLeft = expires.getTime() - Date.now();
  if (msLeft <= 0) return { days: 0, expiresAt: dateTimeText(expires), label: "0 hari" };
  const hours = Math.ceil(msLeft / 3600000);
  return {
    days: Math.max(1, Math.ceil(hours / 24)),
    expiresAt: hasTimePart(account.expiresAt) ? dateTimeText(expires) : dateOnlyText(expires),
    label: hours < 48 ? `${hours} jam` : `${Math.ceil(hours / 24)} hari`,
  };
}

function accountStartedAtMs(account = {}) {
  return Number(toAccountDateTime(account.startedAt)?.getTime() || 0);
}

function findAccountForLookup(db, auth, email = "") {
  const key = normalizeEmailKey(email);
  if (!key) return null;
  return visibleManagedAccountsForAuth(db, auth)
    .filter(isNetflixManagedAccount)
    .filter((item) => normalizeEmailKey(item.email) === key)
    .sort((a, b) => {
      const aStatus = accountStatusFromDate(a.expiresAt, a.durationDays);
      const bStatus = accountStatusFromDate(b.expiresAt, b.durationDays);
      const aActive = a.status !== "replaced" && a.status !== "disabled" && aStatus !== "expired" ? 1 : 0;
      const bActive = b.status !== "replaced" && b.status !== "disabled" && bStatus !== "expired" ? 1 : 0;
      return bActive - aActive || accountStartedAtMs(b) - accountStartedAtMs(a);
    })[0] || null;
}

function normalizeLookupPhone(value = "") {
  return normalizeWhatsappNumber(value || "");
}

function findDisneyAccountForLookup(db, auth, target = "") {
  const key = normalizeLookupPhone(target);
  if (!key) return null;
  return visibleManagedAccountsForAuth(db, auth)
    .filter(isDisneyManagedAccount)
    .filter((item) => normalizeLookupPhone(item.loginPhone || item.email || "") === key)
    .sort((a, b) => {
      const aStatus = accountStatusFromDate(a.expiresAt, a.durationDays);
      const bStatus = accountStatusFromDate(b.expiresAt, b.durationDays);
      const aActive = a.status !== "replaced" && a.status !== "disabled" && aStatus !== "expired" ? 1 : 0;
      const bActive = b.status !== "replaced" && b.status !== "disabled" && bStatus !== "expired" ? 1 : 0;
      return bActive - aActive || accountStartedAtMs(b) - accountStartedAtMs(a);
    })[0] || null;
}

function historicalAccountForLookup(db, auth, email = "") {
  const key = normalizeEmailKey(email);
  if (!key || auth?.role !== "reseller") return null;
  const reseller = authReseller(db, auth);
  if (!reseller) return null;
  const resellerWhatsapp = primaryResellerWhatsapp(reseller);
  const ownedStockIds = ownedStockIdsForReseller(db, auth);
  return (db.managedAccounts || [])
    .filter((item) => normalizeEmailKey(item.email) === key)
    .filter((item) => managedAccountBelongsToReseller(db, auth, item, { reseller, resellerWhatsapp, ownedStockIds }))
    .sort((a, b) => accountStartedAtMs(b) - accountStartedAtMs(a))[0] || null;
}

function historicalDisneyAccountForLookup(db, auth, target = "") {
  const key = normalizeLookupPhone(target);
  if (!key || auth?.role !== "reseller") return null;
  const reseller = authReseller(db, auth);
  if (!reseller) return null;
  const resellerWhatsapp = primaryResellerWhatsapp(reseller);
  const ownedStockIds = ownedStockIdsForReseller(db, auth);
  return (db.managedAccounts || [])
    .filter(isDisneyManagedAccount)
    .filter((item) => normalizeLookupPhone(item.loginPhone || item.email || "") === key)
    .filter((item) => managedAccountBelongsToReseller(db, auth, item, { reseller, resellerWhatsapp, ownedStockIds }))
    .sort((a, b) => accountStartedAtMs(b) - accountStartedAtMs(a))[0] || null;
}

function inactiveLookupResult(account, type = "") {
  const reason = account?.status === "replaced"
    ? "account_replaced"
    : account?.status === "disabled"
      ? "account_disabled"
      : account?.returnedToStockAt || account?.hidden
        ? "account_archived"
        : "account_expired";
  const error = reason === "account_replaced"
    ? "Akun sudah replaced, lookup kode tidak aktif."
    : reason === "account_disabled"
      ? "Akun sudah nonaktif, lookup kode tidak aktif."
      : reason === "account_archived"
        ? "Akun ini sudah tidak aktif dan sudah dipindahkan dari akses reseller aktif."
        : "Akun sudah expired, lookup kode tidak aktif.";
  return {
    source: "history",
    kind: ["reset", "household"].includes(type) ? "link" : "code",
    value: "",
    reason,
    error,
  };
}

function gmailOAuthState() {
  const createdAt = Date.now();
  const payload = `${createdAt}`;
  return `${payload}.${crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url")}`;
}

function verifyGmailOAuthState(state) {
  const [payload, signature] = String(state || "").split(".");
  if (!payload || !signature) return false;
  const expected = crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
  if (expected !== signature) return false;
  return Date.now() - Number(payload) < 10 * 60 * 1000;
}

function gmailOAuthConfigured(db) {
  const settings = ownerIntegrationSettings(db);
  return Boolean(settings.gmail.clientId && settings.gmail.clientSecret && settings.gmail.redirectUri);
}

function isGmailOAuthInvalidError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("expired or revoked") || message.includes("invalid_grant") || message.includes("token has been expired") || message.includes("token has been revoked");
}

function gmailConnectionInfo(db) {
  const settings = ownerIntegrationSettings(db);
  const imapConfigured = gmailImapConfigured(db);
  const oauthConfigured = gmailOAuthConfigured(db);
  const mode = imapConfigured ? "imap" : "oauth";
  const configured = imapConfigured || oauthConfigured;
  const hasToken = Boolean(firstUsableSecret(db.settings?.gmailRefreshToken, process.env.GMAIL_REFRESH_TOKEN));
  const invalid = String(db.settings?.gmailOAuthStatus || "").toLowerCase() === "invalid";
  return {
    configured,
    mode,
    connected: imapConfigured ? true : oauthConfigured && hasToken && !invalid,
    needsOAuth: imapConfigured ? false : oauthConfigured && (!hasToken || invalid),
    error: imapConfigured ? "" : invalid ? String(db.settings?.gmailLastError || "OAuth Gmail perlu disambungkan ulang") : "",
  };
}

function gmailImapConfigured(db) {
  const settings = ownerIntegrationSettings(db);
  return Boolean(settings.gmail.imapHost && settings.gmail.imapPort && settings.gmail.imapUser && settings.gmail.imapPassword);
}

function gmailLookupMode(db) {
  const settings = ownerIntegrationSettings(db);
  if (gmailImapConfigured(db)) return "imap";
  if (settings.gmail.mode === "oauth" && gmailOAuthConfigured(db) && firstUsableSecret(db.settings?.gmailRefreshToken, process.env.GMAIL_REFRESH_TOKEN)) return "oauth";
  if (gmailOAuthConfigured(db) && firstUsableSecret(db.settings?.gmailRefreshToken, process.env.GMAIL_REFRESH_TOKEN)) return "oauth";
  return "";
}

async function validateGmailConnectionForStatus(db) {
  if (gmailImapConfigured(db)) return;
  if (!gmailOAuthConfigured(db)) return;
  const refreshToken = firstUsableSecret(db.settings?.gmailRefreshToken, process.env.GMAIL_REFRESH_TOKEN);
  if (!refreshToken) return;
  try {
    await gmailAccessToken(db);
    db.settings = db.settings || {};
    if (String(db.settings.gmailOAuthStatus || "").toLowerCase() === "invalid") {
      db.settings.gmailOAuthStatus = "connected";
      db.settings.gmailLastError = "";
      db.settings.gmailLastErrorAt = "";
    }
  } catch (error) {
    if (error?.oauthInvalid || isGmailOAuthInvalidError(error)) {
      db.settings = db.settings || {};
      db.settings.gmailOAuthStatus = "invalid";
      db.settings.gmailLastError = error.message || "OAuth Gmail perlu disambungkan ulang";
      db.settings.gmailLastErrorAt = nowText();
    }
  }
}

async function gmailAccessToken(db) {
  const settings = ownerIntegrationSettings(db);
  const refreshToken = firstUsableSecret(db.settings?.gmailRefreshToken, process.env.GMAIL_REFRESH_TOKEN);
  if (!settings.gmail.clientId || !settings.gmail.clientSecret || !refreshToken) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.gmail.clientId,
      client_secret: settings.gmail.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error(payload.error_description || payload.error || "Gmail OAuth perlu disambungkan ulang");
    if (isGmailOAuthInvalidError(error)) error.oauthInvalid = true;
    throw error;
  }
  return payload.access_token;
}

function decodeBase64Url(data = "") {
  const normalized = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function htmlToText(value = "") {
  return String(value || "")
    .replace(/<(?:blockquote|div|table|tr|td|tbody|thead|tfoot|section|article|aside|font|span|p)[^>]*(?:gmail_quote|gmail_extra|protonmail_quote|outlook_message_header|MsoQuote|yahoo_quoted|apple-mail-quote|gmail_attr)[^>]*>[\s\S]*?<\/(?:blockquote|div|table|tr|td|tbody|thead|tfoot|section|article|aside|font|span|p)>/gi, " ")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/[\u034F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function collectGmailBodyParts(payload, acc = []) {
  if (!payload) return acc;
  if (payload.body?.data) {
    acc.push({
      mimeType: payload.mimeType || "",
      text: decodeBase64Url(payload.body.data),
    });
  }
  for (const part of payload.parts || []) {
    collectGmailBodyParts(part, acc);
  }
  return acc;
}

function gmailHeader(message, name) {
  return (message.payload?.headers || []).find((header) => String(header.name || "").toLowerCase() === name.toLowerCase())?.value || "";
}

function trimQuotedEmailText(text = "") {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n");
  const cleaned = [];
  for (const line of lines) {
    if (/^\s*(?:>+|on .+ wrote:|wrote:|-----original message-----|----- forwarded message -----|original message|forwarded message|from:\s|sent:\s|to:\s|subject:\s|gmail_quote|show quoted text|see more|view entire message)/i.test(line)) break;
    cleaned.push(line);
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function gmailMessageText(message) {
  const parts = collectGmailBodyParts(message.payload || {});
  const html = parts.filter((part) => part.mimeType.includes("html")).map((part) => part.text).join("\n");
  const plain = parts.filter((part) => part.mimeType.includes("plain")).map((part) => part.text).join("\n");
  const htmlText = trimQuotedEmailText(htmlToText(html));
  const plainText = trimQuotedEmailText(plain);
  return {
    html,
    htmlText,
    text: [htmlText, plainText].filter(Boolean).join("\n"),
  };
}

function decodeQuotedPrintable(value = "") {
  return String(value || "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodeMimeWord(value = "") {
  return String(value || "").replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_match, charset, encoding, encoded) => {
    try {
      const normalizedCharset = String(charset || "utf-8").toLowerCase();
      const bytes = String(encoding).toUpperCase() === "B"
        ? Buffer.from(encoded, "base64")
        : Buffer.from(decodeQuotedPrintable(String(encoded).replace(/_/g, " ")), "binary");
      if (normalizedCharset.includes("utf") || normalizedCharset.includes("ascii")) return bytes.toString("utf8");
      if (normalizedCharset.includes("iso-8859-1") || normalizedCharset.includes("latin")) return bytes.toString("latin1");
      return bytes.toString("utf8");
    } catch {
      return _match;
    }
  });
}

async function readListUpdateAudit() {
  const candidates = [
    whatsappDatabasePath("list-updates.json"),
    path.join(legacyRootDir, "apps", "bot", "database", "list-updates.json"),
  ];
  for (const filePath of candidates) {
    const rows = await readJsonIfExists(filePath, []);
    if (Array.isArray(rows) && rows.length) return rows;
  }
  return [];
}

function parseRawEmailHeaders(raw = "") {
  const headerText = String(raw || "").split(/\r?\n\r?\n/)[0] || "";
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, " ");
  return unfolded
    .split(/\r?\n/)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) return null;
      return {
        name: line.slice(0, separator).trim(),
        value: decodeMimeWord(line.slice(separator + 1).trim()),
      };
    })
    .filter(Boolean);
}

function rawEmailBody(raw = "") {
  const text = String(raw || "");
  const separator = text.search(/\r?\n\r?\n/);
  if (separator === -1) return text;
  return text.slice(separator).trim();
}

function headerValue(headers = [], name = "") {
  return headers.find((header) => header.name.toLowerCase() === String(name || "").toLowerCase())?.value || "";
}

function parseContentType(value = "") {
  const source = String(value || "");
  const mimeType = (source.split(";")[0] || "text/plain").trim().toLowerCase();
  const boundary = source.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.[1]
    || source.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.[2]
    || "";
  return { mimeType, boundary };
}

function splitMimeMultipart(body = "", boundary = "") {
  if (!boundary) return [];
  const lines = String(body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const marker = `--${boundary}`;
  const parts = [];
  let current = null;
  for (const line of lines) {
    if (line === marker || line === `${marker}--`) {
      if (current) parts.push(current.join("\n").trim());
      current = line === `${marker}--` ? null : [];
      if (line === `${marker}--`) break;
      continue;
    }
    if (current) current.push(line);
  }
  if (current?.length) parts.push(current.join("\n").trim());
  return parts.filter(Boolean);
}

function decodeMimeBody(body = "", encoding = "") {
  const normalized = String(body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/base64/i.test(encoding)) {
    try {
      return Buffer.from(normalized.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return normalized;
    }
  }
  const decoded = /quoted-printable/i.test(encoding) || /=\r?\n|=[0-9A-F]{2}/i.test(normalized)
    ? decodeQuotedPrintable(normalized)
    : normalized;
  return decoded.replace(/\n{3,}/g, "\n\n");
}

function collectRawEmailTextParts(raw = "", acc = { html: [], plain: [] }) {
  const headers = parseRawEmailHeaders(raw);
  const body = rawEmailBody(raw);
  const { mimeType, boundary } = parseContentType(headerValue(headers, "content-type"));
  if (mimeType.startsWith("multipart/")) {
    for (const part of splitMimeMultipart(body, boundary)) {
      collectRawEmailTextParts(part, acc);
    }
    return acc;
  }

  const encoding = headerValue(headers, "content-transfer-encoding");
  const decoded = decodeMimeBody(body, encoding);
  if (mimeType.includes("html")) {
    acc.html.push(decoded);
  } else if (mimeType.includes("plain") || !mimeType || mimeType === "text/plain") {
    acc.plain.push(decoded);
  }
  return acc;
}

function imapRawToGmailMessage(raw = "", uid = "", internalDate = "") {
  const headers = parseRawEmailHeaders(raw);
  const parts = collectRawEmailTextParts(raw);
  const html = parts.html.join("\n");
  const plain = parts.plain.join("\n");
  const payloadParts = [];
  if (html) {
    payloadParts.push({
      mimeType: "text/html",
      body: { data: Buffer.from(html).toString("base64url") },
    });
  }
  if (plain) {
    payloadParts.push({
      mimeType: "text/plain",
      body: { data: Buffer.from(plain).toString("base64url") },
    });
  }
  const htmlText = trimQuotedEmailText(htmlToText(html));
  const plainText = trimQuotedEmailText(plain);
  const fallbackBody = html || plain || decodeMimeBody(rawEmailBody(raw), headerValue(headers, "content-transfer-encoding"));
  return {
    id: String(uid || ""),
    snippet: [htmlText, plainText].filter(Boolean).join("\n").slice(0, 500),
    internalDate: internalDate ? String(new Date(internalDate).getTime()) : "",
    payload: {
      mimeType: payloadParts.length > 1 ? "multipart/alternative" : payloadParts[0]?.mimeType || "text/plain",
      headers,
      body: payloadParts.length ? {} : { data: Buffer.from(fallbackBody).toString("base64url") },
      parts: payloadParts,
    },
  };
}

const unicodeDigitRanges = [
  [0xff10, 0xff19], // Fullwidth
  [0x0660, 0x0669], // Arabic-Indic
  [0x06f0, 0x06f9], // Eastern Arabic / Persian
  [0x0966, 0x096f], // Devanagari
  [0x09e6, 0x09ef], // Bengali
  [0x0e50, 0x0e59], // Thai
  [0x0ed0, 0x0ed9], // Lao
  [0x1040, 0x1049], // Myanmar
];

function normalizeUnicodeDigits(value = "") {
  return String(value || "").replace(
    /[\uFF10-\uFF19\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\u0E50-\u0E59\u0ED0-\u0ED9\u1040-\u1049]/g,
    (char) => {
      const codePoint = char.codePointAt(0);
      const range = unicodeDigitRanges.find(([start, end]) => codePoint >= start && codePoint <= end);
      return range ? String(codePoint - range[0]) : char;
    },
  );
}

function normalizeAccessText(value = "") {
  return normalizeUnicodeDigits(value).replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function normalizeAccessCode(value = "") {
  return normalizeAccessText(value).replace(/[\s-]+/g, "").trim();
}

function expectedCodeLengths(expectedLength) {
  const values = Array.isArray(expectedLength) ? expectedLength : [expectedLength];
  return new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0));
}

function isLikelyAccessCode(value = "", acceptedLengths = new Set()) {
  const code = normalizeAccessCode(value).toUpperCase();
  if (!code || !acceptedLengths.has(code.length)) return false;
  if (!/\d/.test(code)) return false;
  if (!/^[A-Z0-9]+$/.test(code)) return false;
  const ignoredWords = new Set([
    "YOUR",
    "KODE",
    "CODE",
    "LINK",
    "GET",
    "LOGIN",
    "RESET",
    "HOUSE",
    "EMAIL",
    "AKUN",
    "SANDI",
    "PIN",
  ]);
  return !ignoredWords.has(code);
}

function findAccessCodesInText(text = "", acceptedLengths = new Set()) {
  const source = normalizeAccessText(text);
  return Array.from(source.matchAll(/(?:^|[^A-Z0-9])((?:[A-Z0-9][\s-]*){4,10})(?:[^A-Z0-9]|$)/gi))
    .map((match) => normalizeAccessCode(match[1]))
    .filter((code) => isLikelyAccessCode(code, acceptedLengths));
}

function findDigitAccessCodesInText(text = "", acceptedLengths = new Set()) {
  const source = normalizeAccessText(text);
  return Array.from(source.matchAll(/(?:^|[^\d])((?:\d[\s-]*){4,8})(?:[^\d]|$)/g))
    .map((match) => normalizeAccessCode(match[1]))
    .filter((code) => isLikelyAccessCode(code, acceptedLengths));
}

function extractNearbyCode(text, hints, expectedLength) {
  const source = normalizeAccessText(text);
  const acceptedLengths = expectedCodeLengths(expectedLength);
  for (const hint of hints) {
    const normalizedHint = normalizeAccessText(hint).toLowerCase();
    const index = source.toLowerCase().indexOf(normalizedHint);
    if (index === -1) continue;
    const area = source.slice(Math.max(0, index - 260), index + 360);
    const spaced = findDigitAccessCodesInText(area, acceptedLengths)
      .find((code) => isLikelyAccessCode(code, acceptedLengths));
    if (spaced) return spaced;
    const nearby = findAccessCodesInText(area, acceptedLengths)
      .find((code) => isLikelyAccessCode(code, acceptedLengths));
    if (nearby) return nearby;
    const alnum = Array.from(area.matchAll(/(?:code|kode|verification|sign[-\s]?in)[\s\S]{0,80}?([A-Z0-9]{4,10})/gi))
      .map((match) => normalizeAccessCode(match[1]))
      .find((code) => isLikelyAccessCode(code, acceptedLengths));
    if (alnum) return alnum;
  }
  return "";
}

function extractNetflixSigninCode(text = "") {
  const source = String(text || "");
  const acceptedLengths = expectedCodeLengths(4);
  const titlePattern = /(?:masukkan\s+kode\s+ini\s+untuk\s+masuk|enter\s+this\s+code\s+to\s+sign\s+in)/gi;
  const titleMatches = Array.from(source.matchAll(titlePattern));
  for (let index = titleMatches.length - 1; index >= 0; index -= 1) {
    const titleMatch = titleMatches[index];
    const afterTitle = source.slice((titleMatch.index || 0) + titleMatch[0].length, (titleMatch.index || 0) + titleMatch[0].length + 260);
    const lines = afterTitle
      .split(/\r?\n/)
      .map((line) => normalizeAccessCode(line))
      .filter(Boolean);
    const directLine = lines.find((line) => isLikelyAccessCode(line, acceptedLengths));
    if (directLine) return directLine;
    const directCode = findDigitAccessCodesInText(afterTitle, acceptedLengths)
      .find((code) => isLikelyAccessCode(code, acceptedLengths));
    if (directCode) return directCode;
  }
  const patterns = [
    /(?:enter\s+this\s+code\s+to\s+sign\s+in|masukkan\s+kode\s+(?:di\s+atas\s+)?(?:di\s+)?(?:perangkatmu|perangkat|device))[\s\S]{0,260}?((?:\d[\s-]*){4})/i,
    /((?:\d[\s-]*){4})[\s\S]{0,260}?(?:masukkan\s+kode\s+(?:di\s+atas\s+)?(?:di\s+)?(?:perangkatmu|perangkat|device)|untuk\s+masuk\s+ke\s+netflix|enter\s+this\s+code\s+to\s+sign\s+in|enter\s+this\s+code\s+on)/i,
    /(?:kode\s+masuk(?:mu)?|sign[-\s]?in\s+code|login\s+code|kode\s+login)[^\d]{0,260}?((?:\d[\s-]*){4})/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const code = normalizeAccessCode(match?.[1] || "");
    if (isLikelyAccessCode(code, acceptedLengths)) return code;
  }
  const hints = ["kode masukmu", "kode masuk", "kode login", "untuk masuk ke netflix", "masukkan kode di atas", "enter this code to sign in"];
  return extractNearbyCode(source, hints, 4);
}

function stripAccessUrlTail(value = "") {
  let output = String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();

  for (let index = 0; index < 8; index += 1) {
    const before = output;
    output = output
      .replace(/(?:%5D|%29|%7D|%3E|%22|%27|%2C|%2E|%3B|%0A|%0D)+$/gi, "")
      .replace(/(?:\]\)|\]\}|\)\]|\]\]|&gt;)+$/gi, "")
      .replace(/[\]\)}>"',.;]+$/g, "")
      .trim();
    if (output === before) break;
  }

  const firstWhitespace = output.search(/\s/);
  if (firstWhitespace > -1) output = output.slice(0, firstWhitespace);
  return output
    .replace(/(?:%5D|%29|%7D|%3E|\]|\)|\})+$/gi, "")
    .trim();
}

function decodeAccessHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_match, num) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function decodeAccessEscapes(value = "") {
  return String(value || "")
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function unwrapAccessRedirectUrl(value = "") {
  const url = String(value || "").trim();
  try {
    const parsed = new URL(url);
    const isRedirectHost = /(^|\.)google\.[a-z.]+$|(^|\.)googleusercontent\.com$|(^|\.)youtube\.com$/i.test(parsed.hostname);
    const nested = parsed.searchParams.get("url") || parsed.searchParams.get("q") || parsed.searchParams.get("u");
    if (isRedirectHost && nested && /^https?:\/\//i.test(nested)) return nested;
  } catch {
    // keep original URL when it is not a redirect wrapper
  }
  return url;
}

function decodeAccessUrl(value = "") {
  const compact = decodeAccessEscapes(decodeAccessHtmlEntities(String(value || "")))
    .replace(/=\r?\n/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
  const decoded = stripAccessUrlTail(decodeAccessHtmlEntities(decodeAccessEscapes(decodeQuotedPrintable(compact))));
  const unwrapped = unwrapAccessRedirectUrl(decoded);
  return stripAccessUrlTail(unwrapped);
}

function strongestAccessUrl(urls = [], predicate = () => true) {
  const clean = Array.from(new Set(urls.map((url) => decodeAccessUrl(url)).filter((url) => /^https?:\/\//i.test(url))));
  return clean
    .filter(predicate)
    .sort((a, b) => b.length - a.length)[0] || "";
}

function accessAnchorLinksFromMessage(html = "") {
  return Array.from(String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => ({
      url: decodeAccessUrl(match[1]),
      text: htmlToText(match[2]),
    }))
    .filter((link) => /^https?:\/\//i.test(link.url));
}

function accessLinksFromMessage(html = "", combined = "") {
  const anchorLinks = accessAnchorLinksFromMessage(html);
  const priorityLinks = anchorLinks
    .filter((link) => /dapatkan\s+kode|get\s+(?:the\s+)?code|access\s+code|kode|reset\s+password|password\s+reset|atur\s+ulang\s+(?:kata\s+)?sandi|ubah\s+(?:kata\s+)?sandi|ganti\s+(?:kata\s+)?sandi|change\s+password/i.test(link.text))
    .map((link) => link.url);
  const hrefs = anchorLinks.map((link) => link.url);
  const textUrls = Array.from(String(combined || "").matchAll(/https?:\/\/[^\s<>"']+/gi)).map((match) => decodeAccessUrl(match[0]));
  return Array.from(new Set([...priorityLinks, ...hrefs, ...textUrls])).filter((url) => /^https?:\/\//i.test(url));
}

function isNetflixResetPasswordUrl(url = "") {
  const value = String(url || "").trim();
  try {
    const parsed = new URL(value);
    const hostOk = /(?:^|\.)netflix\.com$/i.test(parsed.hostname);
    const pathOk = /^\/password\/?$/i.test(parsed.pathname);
    const tokenOk = parsed.searchParams.has("nftoken") || /[?&]nftoken=/i.test(value);
    return hostOk && pathOk && tokenOk;
  } catch {
    return /^https?:\/\/(?:www\.)?netflix\.com\/password\b/i.test(value) && /[?&]nftoken=/i.test(value);
  }
}

/* Is this a Netflix household/travel verification link, the one that carries
 * the `nftoken` a customer has to open before their code appears?
 *
 * Household had no validator at all. `pickAccessLink` was called with the
 * keyword list `["household", "updatehousehold", "verify", "travel", ...]`
 * matched against the *URL*, and with `allowFallback = true` -- so when nothing
 * matched it returned the longest URL left in the message. A Netflix footer
 * link. The reseller was handed it, and the panel labelled it "Link household".
 * `reset` has had this check the whole time (`isNetflixResetPasswordUrl`), which
 * is why it never had the same problem.
 *
 * The shape is the one Netflix actually sends:
 *   https://www.netflix.com/account/travel/verify?nftoken=...&messageGuid=...
 *
 * Being strict here is the point. A link that is not this is not a household
 * link, and saying "not found" is a far smaller failure than handing someone a
 * footer URL to send to a customer. */
function isNetflixHouseholdUrl(url = "") {
  const value = String(url || "").trim();
  const tokenOk = /[?&]nftoken=/i.test(value);
  if (!tokenOk) return false;
  try {
    const parsed = new URL(value);
    const hostOk = /(?:^|\.)netflix\.com$/i.test(parsed.hostname);
    const pathOk = /^\/(?:account\/travel|travel|simplesetup|household)\b/i.test(parsed.pathname);
    return hostOk && pathOk;
  } catch {
    return /^https?:\/\/(?:www\.)?netflix\.com\/(?:account\/travel|travel|simplesetup|household)\b/i.test(value);
  }
}

/** The household link, or nothing. There is deliberately no "longest link" fallback. */
function pickHouseholdLink(html = "", combined = "") {
  const links = accessLinksFromMessage(html, combined)
    .map((url) => decodeAccessUrl(url))
    .filter((url) => isNetflixHouseholdUrl(url));
  return strongestAccessUrl(links, isNetflixHouseholdUrl);
}

function pickResetPasswordLink(html = "", combined = "") {
  const resetText = /reset\s+(?:your\s+)?password|password\s+reset|atur\s+ulang\s+(?:kata\s+)?sandi|mengatur\s+ulang\s+(?:kata\s+)?sandi|set\s+a\s+new\s+password|forgot\s+(?:your\s+)?password/i;
  const buttonLinks = accessAnchorLinksFromMessage(html)
    .filter((link) => resetText.test(link.text) && isNetflixResetPasswordUrl(link.url))
    .map((link) => decodeAccessUrl(link.url))
    .filter((url) => isNetflixResetPasswordUrl(url));
  if (buttonLinks.length) return strongestAccessUrl(buttonLinks, isNetflixResetPasswordUrl);

  const otherLinks = accessLinksFromMessage(html, combined)
    .map((url) => decodeAccessUrl(url))
    .filter((url) => isNetflixResetPasswordUrl(url));
  return strongestAccessUrl(otherLinks, isNetflixResetPasswordUrl);
}

function extractFirstAccessCode(text = "", expectedLength) {
  const source = normalizeAccessText(text);
  const acceptedLengths = expectedCodeLengths(expectedLength);
  const directLine = source
    .split(/\r?\n/)
    .map((line) => normalizeAccessCode(line))
    .find((code) => isLikelyAccessCode(code, acceptedLengths));
  if (directLine) return directLine;
  return (
    findDigitAccessCodesInText(source, acceptedLengths).find((code) => isLikelyAccessCode(code, acceptedLengths)) ||
    findAccessCodesInText(source, acceptedLengths).find((code) => isLikelyAccessCode(code, acceptedLengths)) ||
    ""
  );
}

function extractCodeFromLabeledMessage(text = "", hints = [], expectedLength) {
  return extractNearbyCode(text, hints, expectedLength) || extractFirstAccessCode(text, expectedLength);
}

function isNetflixAccount(account = {}) {
  return /netflix|net\b|nf\b/i.test([account.product, account.productName, account.variant, account.variantCode, account.variantName, account.productId, account.variantId].join(" "));
}

function isNetflixMessage(message, combined = "") {
  const from = gmailHeader(message, "From");
  return /netflix/i.test([from, gmailHeader(message, "Subject"), combined].join(" "));
}

const ACCOUNT_ACCESS_MAX_AGE_MS = 15 * 60 * 1000;
const ACCOUNT_ACCESS_LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_ACCESS_CLOCK_SKEW_MS = 2 * 60 * 1000;
const accountAccessLookupInflight = new Map();
const gmailHealthService = createGmailHealthService({
  createClient: (config) => new ImapFlow({
    ...config,
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  }),
});

function accountAccessMaxAgeMs(type = "") {
  return ["reset", "household"].includes(String(type || "").toLowerCase())
    ? ACCOUNT_ACCESS_LINK_MAX_AGE_MS
    : ACCOUNT_ACCESS_MAX_AGE_MS;
}

function accountAccessCandidateWindowMs(type = "") {
  return ["reset", "household"].includes(String(type || "").toLowerCase())
    ? ACCOUNT_ACCESS_LINK_MAX_AGE_MS
    : 20 * 60 * 1000;
}

function accountAccessTargetAddress(account = {}, type = "") {
  if (String(type || "").toLowerCase() === "disney_otp") {
    return String(account.otpEmail || account.email || "").trim().toLowerCase();
  }
  return String(account.email || "").trim().toLowerCase();
}

function isFreshAccountAccessMessage(dateMs = 0, nowMs = Date.now(), type = "") {
  const value = Number(dateMs || 0);
  if (!Number.isFinite(value) || value <= 0) return false;
  return value >= nowMs - accountAccessMaxAgeMs(type) && value <= nowMs + ACCOUNT_ACCESS_CLOCK_SKEW_MS;
}

/* How many aged-out messages the failure path is willing to open.
 *
 * This runs only after the fresh search came up empty, and a mailbox that has
 * been receiving Netflix mail for a year has a long tail of them. Three is the
 * newest few: enough to catch "the customer triggered it just after the window
 * closed", which is the case worth reporting, without making the reseller wait
 * to be told their code expired. */
const STALE_ACCESS_CANDIDATES = 3;

/**
 * "No code in the mailbox" and "the code is in the mailbox, 40 minutes old"
 * are different problems with opposite remedies -- wait, or ask the customer to
 * send another one -- and the lookup used to return the same `not_found` for
 * both. The reseller was told the email had not arrived while it sat in
 * `NF_VERIF` the whole time, which is the worst of the two answers: it teaches
 * the customer to trigger the email again, and it does not teach the operator
 * that the window is what bit them.
 *
 * So the aged-out messages are kept instead of dropped, and this is the one
 * that reports them. It runs the *same* extractor the fresh path runs, so what
 * comes back is a message the lookup genuinely would have returned had it
 * arrived in time -- not merely an old email that happens to share the label.
 */
async function staleAccessResult(type, staleItems, nowMs, account = {}, extra = {}) {
  const seen = new Set();
  const candidates = [...staleItems]
    .sort((left, right) => Number(right.dateMs || 0) - Number(left.dateMs || 0))
    // One Netflix email lives in the label, in All Mail, and in the inbox at
    // once, so the IMAP walk reports the same message three times. Without
    // this the three-slot budget is spent on one email and a genuinely older
    // second-newest code never gets examined.
    .filter((item) => {
      const key = String(item.message?.id || item.uid || `${item.dateMs}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, STALE_ACCESS_CANDIDATES);

  for (const item of candidates) {
    const extracted = await extractAccessValue(type, item.message, account);
    if (!extracted?.value) continue;
    const ageMs = Math.max(0, nowMs - Number(item.dateMs || 0));
    return {
      ...extra,
      source: "gmail",
      reason: "stale",
      value: "",
      staleMessage: {
        subject: gmailHeader(item.message, "Subject"),
        from: gmailHeader(item.message, "From"),
        date: gmailHeader(item.message, "Date"),
        internalDate: item.message.internalDate || "",
        dateMs: item.dateMs,
        ageMinutes: Math.max(1, Math.round(ageMs / 60000)),
        windowMinutes: Math.round(accountAccessMaxAgeMs(type) / 60000),
      },
    };
  }
  return null;
}

function isNetflixSigninMessage(text = "") {
  const source = String(text || "");
  return /enter\s+this\s+code\s+to\s+sign\s+in|your\s+sign[-\s]?in\s+code|kode\s+masuk(?:mu)?|masukkan\s+kode\s+(?:di\s+atas\s+)?(?:di\s+)?(?:perangkatmu|perangkat|device)[\s\S]{0,120}(?:masuk|netflix)|untuk\s+masuk\s+ke\s+netflix/i.test(source);
}

function isNetflixAccessVerification(text = "") {
  const source = String(text || "");
  return /verification\s+code\s*[.:]?\s*expires\s+in\s+15|verify\s+with\s+this\s+code|someone\s+is\s+trying\s+to\s+access\s+your\s+account|you(?:'|\u2019)ll\s+have\s+15\s+minutes|verifikasi\s+dengan\s+kode\s+ini|kode\s+verifikasi[\s\S]{0,90}15\s*(?:mnt|menit|min)|kode\s+ini\s+akan\s+(?:kedaluwarsa|kadaluarsa|berakhir)[\s\S]{0,80}15\s*(?:mnt|menit|min)|(?:seseorang|ada\s+yang)\s+(?:mencoba|ingin)\s+(?:mengakses|akses)\s+akun(?:mu| kamu)?/i.test(source);
}

async function extractAccessValue(type, message, account = {}) {
  const subject = gmailHeader(message, "Subject");
  const { html, htmlText, text } = gmailMessageText(message);
  const bodyVisible = htmlText || text;
  const combined = [subject, text].join("\n");
  const visibleCombined = [subject, bodyVisible].join("\n");
  const extractionVisible = bodyVisible || combined;
  const extractionText = text || combined;
  const normalizedVisible = normalizeAccessText(extractionVisible);
  const normalizedCombined = normalizeAccessText(combined);
  const normalizedText = normalizeAccessText(extractionText);
  const normalizedAll = normalizeAccessText([subject, bodyVisible, text].filter(Boolean).join("\n"));
  if (type === "disney_otp") {
    const source = [subject, bodyVisible, text].filter(Boolean).join("\n");
    const sender = gmailHeader(message, "From");
    if (!/disney/i.test(sender) && !/kode otp|kode otp anda|kata sandi verifikasi email anda|disney/i.test(source)) return null;
    const code =
      source.match(/\b(\d{4})\b/)?.[1]
      || normalizedAll.match(/\b(\d{4})\b/)?.[1]
      || "";
    return code
      ? { kind: "code", value: code, label: "Disney OTP 4 digit", score: /disney/i.test(source) ? 95 : 70 }
      : null;
  }
  if (type === "reset") {
    const preferred =
      pickResetPasswordLink(html, extractionVisible) ||
      pickResetPasswordLink(html, extractionText) ||
      pickResetPasswordLink(html, combined);
    return preferred ? { kind: "link", value: preferred, label: "Link reset password", score: 20 } : null;
  }
  if (type === "household") {
    const preferred =
      pickHouseholdLink(html, extractionVisible) ||
      pickHouseholdLink(html, extractionText) ||
      pickHouseholdLink(html, combined);
    return preferred ? { kind: "link", value: preferred, label: "Link household", score: 80 } : null;
  }
  if (type === "verification") {
    const source = normalizedAll || normalizedVisible || normalizedCombined;
    if (isNetflixAccountChangeVerification(source)) return null;
    // A ten-minute window with no fifteen-minute one is Netflix's account
    // change mail, which carries its own six-digit code. Returning that as a
    // sign-in code hands the reseller a number Netflix will reject. When the
    // message mentions both, it is an access mail that happens to have a
    // fifteen-minute window in its footer, and the code is worth returning --
    // which is the opposite of what this rule used to do.
    if (hasTenMinuteExpiry(source) && !hasFifteenMinuteExpiry(source)) return null;
  }
  const hints = type === "signin"
    ? ["enter this code to sign in", "your sign-in code", "sign-in code", "sign in code", "kode masuk", "kode login", "login code"]
    : ["kode verifikasi. kedaluwarsa", "verification code. expires", "kode verifikasi", "verification code", "kode keamanan", "security code", "verify"];
  const expectedLength = type === "signin" ? 4 : 6;
  const code =
    (type === "signin" ? extractNetflixSigninCode(normalizedVisible) : extractNetflixVerificationCode(normalizedVisible)) ||
    (type === "signin" ? extractNetflixSigninCode(normalizedText) : extractNetflixVerificationCode(normalizedText)) ||
    (type === "signin" ? extractNetflixSigninCode(normalizedCombined) : extractNetflixVerificationCode(normalizedCombined)) ||
    extractCodeFromLabeledMessage(normalizedVisible || normalizedCombined || extractionVisible || combined, hints, expectedLength);
  return code
    ? {
        kind: "code",
        value: code,
        label: type === "verification" ? "Kode verifikasi 15 menit" : type === "signin" ? "Sign-in code 4 digit" : undefined,
        score:
          (type === "signin" ? 80 : 0) +
          (type === "verification" ? 80 : 0) +
          (isNetflixMessage(message, combined) ? 10 : 0),
      }
    : null;
}

async function lookupGmailAccessValue(db, account, type) {
  const key = [
    String(type || "").toLowerCase(),
    String(account?.id || ""),
    accountAccessTargetAddress(account, type),
  ].join(":");
  if (accountAccessLookupInflight.has(key)) return accountAccessLookupInflight.get(key);
  const promise = lookupGmailAccessValueFresh(db, account, type).finally(() => {
    accountAccessLookupInflight.delete(key);
  });
  accountAccessLookupInflight.set(key, promise);
  return promise;
}

async function lookupGmailAccessValueFresh(db, account, type) {
  const mode = gmailLookupMode(db);
  if (mode === "imap") return lookupImapAccessValue(db, account, type);

  const token = await gmailAccessToken(db);
  if (!token) {
    if (gmailImapConfigured(db)) return lookupImapAccessValue(db, account, type);
    return { source: "fallback", reason: "gmail_not_connected", value: "" };
  }

  const email = accountAccessTargetAddress(account, type);
  const accessQueries = accountAccessGmailQueries(type, email);
  if (!accessQueries.length) return { source: "gmail", reason: "label_not_configured", value: "" };
  const messageMap = new Map();
  for (const query of accessQueries) {
    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", "50");
    listUrl.searchParams.set("includeSpamTrash", "true");

    const listResponse = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    const listPayload = await listResponse.json().catch(() => ({}));
    if (!listResponse.ok) throw new Error(listPayload.error?.message || "Gmail lookup gagal");
    for (const item of listPayload.messages || []) {
      if (item?.id && !messageMap.has(item.id)) messageMap.set(item.id, item);
    }
  }

  const messages = Array.from(messageMap.values());
  const nowMs = Date.now();
  const hydratedMessages = [];
  const staleMessages = [];
  for (const item of messages) {
    const messageResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const message = await messageResponse.json().catch(() => ({}));
    if (!messageResponse.ok) continue;
    const dateMs = Number(message.internalDate || 0) || Date.parse(gmailHeader(message, "Date") || "") || 0;
    if (!isFreshAccountAccessMessage(dateMs, nowMs, type)) {
      staleMessages.push({ message, dateMs });
      continue;
    }
    hydratedMessages.push({
      message,
      dateMs,
    });
  }

  hydratedMessages.sort((a, b) => Number(b.dateMs || 0) - Number(a.dateMs || 0));
  const newestFreshDateMs = Number(hydratedMessages[0]?.dateMs || 0);
  const candidateWindowMs = accountAccessCandidateWindowMs(type);

  for (const item of hydratedMessages) {
    if (newestFreshDateMs && Number(item.dateMs || 0) < newestFreshDateMs - candidateWindowMs) break;
    const extracted = await extractAccessValue(type, item.message, account);
    if (!extracted?.value) continue;
    return {
      source: "gmail",
      messageId: item.message.id,
      subject: gmailHeader(item.message, "Subject"),
      from: gmailHeader(item.message, "From"),
      date: gmailHeader(item.message, "Date"),
      internalDate: item.message.internalDate || "",
      dateMs: item.dateMs,
      ...extracted,
    };
  }

  const stale = await staleAccessResult(type, staleMessages, nowMs, account);
  if (stale) return stale;

  if (gmailImapConfigured(db) && mode !== "imap") {
    return lookupImapAccessValue(db, account, type);
  }
  return { source: "gmail", reason: "not_found", value: "" };
}

/* Was this message sent *to* this customer?
 *
 * The test used to be `raw.includes(email) || envelopeTargets.includes(email)`,
 * and the first half is the problem. `raw` is the whole message, so it matches
 * the address anywhere in it: in a quoted reply, in a signature, in a footer,
 * in the body of a mail Netflix addressed to somebody else. NF_VERIF and
 * NF_HOUSE are the owner's labels and collect mail for every customer the owner
 * has ever sold to, so a lookup for one customer would happily return another
 * customer's code. A reseller reading someone else's code and handing it to a
 * customer is a wrong answer, not a missing one.
 *
 * The envelope is the only trustworthy answer here: it is what the server
 * recorded as the recipient, not something the body merely mentions. It is
 * checked for `to`, `cc`, and `bcc` because Netflix does not consistently pick
 * one -- a household mail can arrive with the customer in `bcc`.
 *
 * `Delivered-To` is consulted as a fallback for the case the envelope cannot
 * cover: a message with no envelope recipients at all. It is read from the raw
 * headers only, and it is parsed as an address, not substring-matched, so a
 * `Delivered-To` that merely mentions the customer somewhere in prose does not
 * open the gate. */
function imapSentToRecipient(item = {}, email = "") {
  const wanted = String(email || "").trim().toLowerCase();
  if (!wanted) return false;

  const envelopeTargets = [
    ...(item.envelope?.to || []),
    ...(item.envelope?.cc || []),
    ...(item.envelope?.bcc || []),
  ].map((address) => String(address?.address || "").trim().toLowerCase());
  if (envelopeTargets.length) return envelopeTargets.includes(wanted);

  const raw = Buffer.isBuffer(item.source) ? item.source.toString("utf8") : Buffer.from(item.source || "").toString("utf8");
  const header = String(raw).split(/\r?\n\r?\n/, 1)[0] || "";
  for (const line of header.split(/\r?\n/)) {
    if (!/^delivered-to\s*:/i.test(line)) continue;
    // Only the address itself: `<ada@kya.baby>` or a bare one. A prose mention
    // inside a Delivered-To header is not a delivery record.
    const value = line.replace(/^delivered-to\s*:/i, "");
    const addresses = value.match(/[^\s<>,;:"]+@[^\s<>,;:"]+/g) || [];
    if (addresses.some((address) => address.toLowerCase() === wanted)) return true;
  }
  return false;
}

async function lookupImapAccessValue(db, account, type) {
  const settings = ownerIntegrationSettings(db).gmail;
  if (!gmailImapConfigured(db)) return { source: "fallback", reason: "imap_not_connected", value: "" };

  const email = accountAccessTargetAddress(account, type);
  if (!email) return { source: "gmail", reason: "missing_email", value: "" };

  const client = new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: settings.imapSecure,
    auth: {
      user: settings.imapUser,
      pass: settings.imapPassword,
    },
    logger: false,
  });

  try {
    await client.connect();
    const availableMailboxes = await client.list().catch(() => []);
    const { paths: mailboxes, unresolved: unresolvedLabels } = accountAccessMailboxPaths(type, availableMailboxes);
    const hydratedMessages = [];
    const staleMessages = [];
    const nowMs = Date.now();
    const mailboxErrors = [];

    for (const mailbox of mailboxes) {
      let lock = null;
      try {
        lock = await client.getMailboxLock(mailbox);
        const since = new Date(Date.now() - accountAccessMaxAgeMs(type) - 5 * 60 * 1000);
        const matches = await client.search({ since }, { uid: true });
        const uids = Array.from(matches || [])
          .map((uid) => Number(uid))
          .filter((uid) => Number.isFinite(uid))
          .sort((a, b) => b - a)
          .slice(0, 80);

        for await (const item of client.fetch(uids, { uid: true, envelope: true, internalDate: true, source: true }, { uid: true })) {
          const raw = Buffer.isBuffer(item.source) ? item.source.toString("utf8") : Buffer.from(item.source || "").toString("utf8");
          if (!imapSentToRecipient(item, email)) continue;
          if (type !== "disney_otp" && isNetflixAccount(account) && !/netflix/i.test(raw)) continue;

          const message = imapRawToGmailMessage(raw, item.uid, item.internalDate);
          const dateMs = Number(message.internalDate || 0) || Date.parse(gmailHeader(message, "Date") || "") || 0;
          if (!isFreshAccountAccessMessage(dateMs, nowMs, type)) {
            staleMessages.push({ message, dateMs, mailbox });
            continue;
          }
          hydratedMessages.push({
            mailbox,
            dateMs,
            uid: String(item.uid || ""),
            message,
          });
        }
      } catch (error) {
        mailboxErrors.push(`${mailbox}: ${error.message || "label tidak bisa dibuka"}`);
      } finally {
        if (lock) lock.release();
      }
    }

    hydratedMessages.sort((a, b) => Number(b.dateMs || 0) - Number(a.dateMs || 0));
    const newestFreshDateMs = Number(hydratedMessages[0]?.dateMs || 0);
    const candidateWindowMs = accountAccessCandidateWindowMs(type);
    for (const item of hydratedMessages) {
      if (newestFreshDateMs && Number(item.dateMs || 0) < newestFreshDateMs - candidateWindowMs) break;
      const extracted = await extractAccessValue(type, item.message, account);
      if (!extracted?.value) continue;
      return {
        source: "gmail",
        mode: "imap",
        mailbox: item.mailbox,
        messageId: item.uid,
        subject: gmailHeader(item.message, "Subject"),
        from: gmailHeader(item.message, "From"),
        date: gmailHeader(item.message, "Date"),
        internalDate: item.message.internalDate || "",
        dateMs: item.dateMs,
        ...extracted,
      };
    }

    const stale = await staleAccessResult(type, staleMessages, nowMs, account, { mode: "imap" });
    if (stale) return stale;

    if (mailboxes.length && mailboxErrors.length === mailboxes.length) {
      return { source: "gmail", mode: "imap", reason: "label_not_found", error: `Label Gmail tidak bisa dibuka: ${mailboxErrors.join("; ")}`, value: "" };
    }
    /* The label exists under some other spelling, or not at all.
     *
     * A wrong-case label used to throw, and the throw was recorded and then
     * dropped: the test above only fires when *every* mailbox failed, and All
     * Mail opens fine, so one bad label among several good ones left nothing
     * behind but a `not_found` -- the same answer as a customer who never
     * pressed send, for a code sitting unread in the label. Now the label is
     * either opened under its real name, or named here, so the reseller learns
     * the label itself is the problem rather than the customer's email. */
    if (unresolvedLabels.length) {
      return {
        source: "gmail",
        mode: "imap",
        reason: "label_unresolved",
        error: `Label ${unresolvedLabels.join(", ")} tidak ditemukan di Gmail owner. Cek penamaan label di Gmail, atau samakan dengan nama yang terpasang di server.`,
        value: "",
      };
    }
    return { source: "gmail", mode: "imap", reason: "not_found", value: "" };
  } finally {
    await client.logout().catch(() => {});
  }
}

async function lookupAccountAccessValue(db, account, type) {
  let gmailResult = null;
  try {
    gmailResult = await lookupGmailAccessValue(db, account, type);
  } catch (error) {
    const classified = classifyGmailConnectionError(error);
    gmailResult = { source: "gmail", reason: "gmail_error", error: classified.message, value: "" };
    if (error?.oauthInvalid || isGmailOAuthInvalidError(error)) {
      db.settings = db.settings || {};
      db.settings.gmailOAuthStatus = "invalid";
      db.settings.gmailLastError = error.message || "OAuth Gmail perlu disambungkan ulang";
      db.settings.gmailLastErrorAt = nowText();
    }
  }

  if (gmailResult?.value) return gmailResult;
  return {
    ...gmailResult,
    source: gmailResult?.source || "fallback",
    kind: ["reset", "household"].includes(type) ? "link" : "code",
    value: "",
  };
}

const accessLookupLabels = {
  signin: "Sign-in code",
  verification: "Verification code",
  reset: "Reset password link",
  household: "Link household",
  disney_otp: "Disney OTP code",
};

function accessLookupLabel(type = "") {
  return accessLookupLabels[type] || "Account access";
}

function accessLookupSourceLabel(source = "") {
  if (source === "gmail") return "Gmail owner";
  if (source === "managed_account") return "data manual akun";
  if (source === "fallback") return "fallback";
  return source || "unknown";
}

function appendAccessLookupActivity(db, auth, { account = null, email = "", type = "", result = {}, status = "" } = {}) {
  if (!db || !auth) return;
  const ownerLookup = auth.role === "owner";
  const reseller = authReseller(db, auth);
  const resellerName = ownerLookup ? "Owner" : reseller?.name || reseller?.username || account?.reseller || account?.buyer || "Reseller";
  const resellerWhatsapp = normalizeWhatsappNumber(account?.whatsapp || reseller?.whatsapp || "");
  const label = accessLookupLabel(type);
  const valueFound = Boolean(String(result?.value || "").trim());
  const normalizedStatus = status || (valueFound ? "success" : result?.reason || result?.error || "not_found");
  const targetEmail = type === "disney_otp"
    ? normalizeLookupPhone(account?.loginPhone || email)
    : normalizeEmailKey(account?.email || email);
  const source = accessLookupSourceLabel(result?.source);
  const statusLabel = valueFound ? "berhasil" : "belum tersedia";
  const productLabel = [account?.product, account?.variant].filter(Boolean).join(" - ");
  db.activities = db.activities || [];
  db.activities.unshift({
    id: makeId("act"),
    type: "security",
    title: `${resellerName}: ${label} ${statusLabel}`,
    description: valueFound
      ? `${resellerName} mengambil ${label} untuk ${targetEmail || "-"}${productLabel ? ` (${productLabel})` : ""} dari ${source}.`
      : `${resellerName} mencoba ${label} untuk ${targetEmail || "-"}${productLabel ? ` (${productLabel})` : ""}, tetapi belum tersedia (${normalizedStatus}).`,
    createdAt: nowText(),
    resellerId: ownerLookup ? "" : reseller?.id || account?.resellerId || auth.sub || "",
    whatsapp: resellerWhatsapp,
    actorName: resellerName,
    actorRole: ownerLookup ? "owner" : auth.role || "reseller",
    actorWhatsapp: resellerWhatsapp,
    accountId: account?.id || "",
    accountEmail: targetEmail,
    product: account?.product || "",
    variant: account?.variant || "",
    lookupLabel: label,
    lookupType: type,
    lookupSource: result?.source || "",
    lookupStatus: normalizedStatus,
    lookupSuccess: valueFound,
  });
}

function getPakasirCredentials(db) {
  const project = firstConfigured(db.settings?.pakasirMerchantId, db.settings?.pakasirProject, process.env.PAKASIR_PROJECT);
  const apiKey = firstUsableSecret(db.settings?.pakasirApiKey, process.env.PAKASIR_API_KEY);
  return {
    project,
    apiKey,
    configured: Boolean(project && apiKey),
  };
}

function buildPakasirPaymentLink({ project, amount, orderId }) {
  if (!project || !amount || !orderId) return "";
  const url = new URL(`https://app.pakasir.com/pay/${project}/${amount}`);
  url.searchParams.set("order_id", orderId);
  url.searchParams.set("qris_only", "1");
  return url.toString();
}

function derivePakasirTotalPayment(amount = 0, fee = 0, providerTotal = 0) {
  return deriveProviderTotalPayment(amount, fee, providerTotal);
}

function parsePakasirTransaction(payload = {}) {
  const payment = payload?.payment && typeof payload.payment === "object" ? payload.payment : null;
  const transaction = payload?.transaction && typeof payload.transaction === "object" ? payload.transaction : payment;
  const amount = Number(transaction?.amount || payment?.amount || 0);
  const fee = Number(transaction?.fee || payment?.fee || 0);
  const providerTotal = Number(transaction?.total_payment || payment?.total_payment || 0);
  return {
    orderId: String(transaction?.order_id || payment?.order_id || "").trim(),
    amount,
    fee,
    totalPayment: derivePakasirTotalPayment(amount, fee, providerTotal),
    paymentMethod: String(transaction?.payment_method || payment?.payment_method || "qris").trim(),
    paymentNumber: String(transaction?.payment_number || payment?.payment_number || transaction?.qr_string || payment?.qr_string || "").trim(),
    qrString: String(transaction?.qr_string || payment?.qr_string || "").trim(),
    // No image field, deliberately. The provider returns the raw QRIS string
    // only, and the dashboard draws the code from it in the browser rather than
    // loading a picture of a payment over the network. See apps/dashboard/src/lib/qrisQr.ts.
    expiredAt: transaction?.expired_at || payment?.expired_at || null,
    raw: transaction || payment || payload || {},
  };
}

async function fetchPakasirTransactionDetail(db, order = {}, payment = {}) {
  const credentials = getPakasirCredentials(db);
  const amount = Math.max(0, Number(payment.amount || order.paymentDue || order.qrisAmount || order.total || 0));
  const orderId = String(payment.ref || order.paymentRef || order.id || "").trim();
  if (!credentials.configured || !amount || !orderId) {
    return {
      ok: false,
      skipped: true,
      reason: !credentials.configured ? "pakasir_not_configured" : !amount ? "amount_missing" : "order_id_missing",
    };
  }

  const url = new URL("https://app.pakasir.com/api/transactiondetail");
  url.searchParams.set("project", credentials.project);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("order_id", orderId);
  url.searchParams.set("api_key", credentials.apiKey);

  try {
    const { response, payload } = await requestPakasirJsonWithRetry(url, {
      headers: { Accept: "application/json" },
    });
    const transaction = parsePakasirTransaction(payload);
    const raw = transaction.raw || payload?.transaction || payload?.payment || payload?.data || payload || {};
    const status = String(raw.status || raw.payment_status || payload?.status || "").trim().toLowerCase();
    if (!response.ok) {
      return {
        ok: false,
        status,
        httpStatus: response.status,
        error: payload?.message || payload?.error || `Pakasir detail gagal (${response.status})`,
        payload,
      };
    }
    return {
      ok: true,
      status,
      paid: pakasirStatusIsPaid(status),
      paidAt: raw.completed_at || raw.paid_at || raw.settled_at || "",
      transaction,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message?.includes("timeout") ? "Pakasir detail timeout." : error.message || "Pakasir detail gagal.",
    };
  }
}

async function createPakasirQris(db, order) {
  const credentials = getPakasirCredentials(db);
  const amount = Math.max(0, Number(order.paymentDue ?? order.qrisAmount ?? order.total ?? 0));
  const paymentUrl = buildPakasirPaymentLink({
    project: credentials.project,
    amount,
    orderId: order.paymentRef,
  });
  const fallback = {
    provider: "pakasir",
    paymentUrl,
    qrisText: paymentUrl || `QRIS ${order.paymentRef} ${order.total}`,
  };

  if (!credentials.configured) {
    return {
      ...fallback,
      providerStatus: "not_configured",
      providerError: "PAKASIR_PROJECT atau PAKASIR_API_KEY belum tersedia.",
    };
  }

  try {
    const { response, payload } = await requestPakasirJsonWithRetry("https://app.pakasir.com/api/transactioncreate/qris", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: credentials.project,
        order_id: order.paymentRef,
        amount,
        api_key: credentials.apiKey,
      }),
    });
    if (!response.ok) {
      throw new Error(payload?.error || `Pakasir QRIS gagal dibuat (${response.status})`);
    }
    const transaction = parsePakasirTransaction(payload);
    let fee = Number(transaction.fee || 0);
    let totalPayment = derivePakasirTotalPayment(amount, fee, transaction.totalPayment);
    let providerDetail = null;
    if (!fee || totalPayment <= amount) {
      providerDetail = await fetchPakasirTransactionDetail(db, order, {
        ref: order.paymentRef,
        amount,
      }).catch((error) => ({ ok: false, error: error.message || "Pakasir detail gagal." }));
      if (providerDetail?.transaction) {
        fee = Number(providerDetail.transaction.fee || fee || 0);
        totalPayment = derivePakasirTotalPayment(amount, fee, providerDetail.transaction.totalPayment || totalPayment);
      }
    }
    return {
      ...fallback,
      providerStatus: "created",
      providerRaw: payload,
      providerDetailStatus: providerDetail?.status || "",
      providerDetailError: providerDetail && !providerDetail.ok ? providerDetail.error || providerDetail.reason || "" : "",
      providerDetailRaw: providerDetail?.payload || undefined,
      paymentMethod: transaction.paymentMethod,
      paymentNumber: transaction.paymentNumber,
      qrString: transaction.qrString,
      fee,
      totalPayment,
      providerExpiresAt: transaction.expiredAt,
      qrisText: transaction.qrString || transaction.paymentNumber || paymentUrl || fallback.qrisText,
    };
  } catch (error) {
    return {
      ...fallback,
      providerStatus: "error",
      providerError: error.message?.includes("timeout") ? "Pakasir timeout." : error.message || "Pakasir tidak tersedia.",
    };
  }
}

function shouldRefreshGoogleSheetsForResellerView(db, auth, options = {}) {
  if (auth?.role !== "reseller" && !(auth?.role === "owner" && options.allowOwner === true)) return false;
  if (!googleSheetsConfigured(db)) return false;
  const maxAgeMs = Math.max(60_000, Number(process.env.RESELLER_VIEW_SHEETS_MAX_AGE_MS || 60_000));
  const lastSyncAt = toDateTime(db.settings?.googleSheetsLastSyncAt || "");
  if (!lastSyncAt) return true;
  return Date.now() - lastSyncAt.getTime() >= maxAgeMs;
}

async function refreshResellerViewFromGoogleSheets(db, auth, reason = "reseller_view_refresh", options = {}) {
  const bypassStaleWindow = options.forceRecent === true;
  const assertRequiredSections = (result) => {
    const requiredError = googleSheetsRequiredSectionsError(result || {}, options.requiredSections || []);
    if (requiredError) throw requiredError;
    if (options.requireAll === true && result?.ok === false) {
      const error = new Error(`Sync Google Sheets tidak lengkap: ${(result.failedSections || []).join(", ") || "unknown"}`);
      error.status = 503;
      error.code = "google_sheets_sync_failed";
      throw error;
    }
  };
  if (!bypassStaleWindow && !shouldRefreshGoogleSheetsForResellerView(db, auth, options)) {
    try {
      assertRequiredSections(db.settings?.googleSheetsLastSyncSummary || {});
    } catch (error) {
      if (options.throwOnFailure === true) throw error;
      return false;
    }
    return false;
  }
  try {
    const result = await syncGoogleSheetsStockSafely(db, { silent: true, reason });
    assertRequiredSections(result);
    return true;
  } catch (error) {
    const friendly = friendlyGoogleSheetsError(error);
    if (options.throwOnFailure === true) throw friendly;
    if (friendly.code !== "google_sheets_rate_limited") {
      console.warn(`[ResellerView] Google Sheets refresh skipped: ${friendly.message || friendly}`);
    }
    return false;
  }
}

function normalizeResellerInput(body, fallback = {}) {
  const name = String(body.name ?? fallback.name ?? "").trim();
  const username = String(body.username ?? fallback.username ?? (name || "reseller"))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".");
  return {
    name,
    username,
    password: String(body.password ?? fallback.password ?? "").trim(),
    email: String(body.email ?? fallback.email ?? "").trim(),
    whatsapp: normalizeWhatsappNumber(
      body.whatsapp ??
        body.phone ??
        body.telepon ??
        body.telp ??
        body.contact ??
        fallback.whatsapp ??
        fallback.phone ??
        fallback.telepon ??
        fallback.telp ??
        fallback.contact ??
        "",
    ),
    isActive: body.isActive === undefined ? fallback.isActive !== false : Boolean(body.isActive),
    orders: Number(body.orders ?? fallback.orders ?? 0),
    revenue: Number(body.revenue ?? fallback.revenue ?? 0),
    deposit: Number(body.deposit ?? fallback.deposit ?? 0),
    joinedAt: String(body.joinedAt ?? fallback.joinedAt ?? todayText()).trim(),
    allowedAccessTools: normalizeResellerAccessTools(
      body.allowedAccessTools === undefined ? fallback.allowedAccessTools : body.allowedAccessTools,
      fallback.allowedAccessTools,
    ),
  };
}

function findDuplicateReseller(db, input = {}, exceptId = "") {
  const whatsapp = normalizeWhatsappNumber(input.whatsapp || "");
  if (whatsapp) {
    const duplicate = (db.resellers || []).find((item) => {
      if (exceptId && item.id === exceptId) return false;
      return resellerNumberCandidates(item).has(whatsapp);
    });
    if (duplicate) return { field: "whatsapp", reseller: duplicate };
  }

  const username = normalizeLoginIdentifier(input.username || "");
  if (username) {
    const duplicate = (db.resellers || []).find((item) => {
      if (exceptId && item.id === exceptId) return false;
      return normalizeLoginIdentifier(item.username || "") === username;
    });
    if (duplicate) return { field: "username", reseller: duplicate };
  }

  const email = normalizeLoginIdentifier(input.email || "");
  if (email) {
    const duplicate = (db.resellers || []).find((item) => {
      if (exceptId && item.id === exceptId) return false;
      return normalizeLoginIdentifier(item.email || "") === email;
    });
    if (duplicate) return { field: "email", reseller: duplicate };
  }

  return null;
}

function throwDuplicateResellerError(duplicate) {
  const reseller = duplicate?.reseller || {};
  const status = reseller.isActive === false ? "nonaktif" : "aktif";
  const fieldLabel = duplicate?.field === "whatsapp" ? "nomor WhatsApp" : duplicate?.field === "username" ? "username" : "email";
  const identity = reseller.name || reseller.username || primaryResellerWhatsapp(reseller) || reseller.id;
  const error = new Error(`Reseller sudah ${status}: ${identity}. ${fieldLabel} ini sudah dipakai, edit akun reseller yang sudah ada.`);
  error.status = 409;
  throw error;
}

function normalizeResellerSelfInput(body, current = {}) {
  const name = String(body.name ?? current.name ?? "").trim();
  const username = String(current.username ?? (name || "reseller"))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".");
  return {
    name,
    username,
    email: String(body.email ?? current.email ?? "").trim(),
    whatsapp: current.whatsapp,
    phone: current.phone,
    telepon: current.telepon,
    telp: current.telp,
    contact: current.contact,
    isActive: current.isActive !== false,
    orders: Number(current.orders || 0),
    revenue: Number(current.revenue || 0),
    deposit: Number(current.deposit || 0),
    joinedAt: String(current.joinedAt || todayText()).trim(),
    allowedAccessTools: resellerAccessTools(current),
  };
}

function safeResellerForSelf(reseller = {}) {
  const { password, passwordHash, ...safe } = reseller;
  return {
    ...safe,
    allowedAccessTools: resellerAccessTools(safe),
  };
}

function safePublicOrder(order = {}, options = {}) {
  const includeFulfillment = options.includeFulfillment === true;
  const delivered = (
    order.orderStatus === "completed"
    || order.deliveryStatus === "sent"
    || order.deliveryStatus === "stock_unavailable_deposit"
    || (order.qrisStatus === "paid" && order.fulfillmentText)
  );
  return {
    id: order.id,
    paymentRef: order.paymentRef,
    product: order.product,
    productId: order.productId,
    variant: order.variant,
    variantId: order.variantId,
    variantCode: order.variantCode,
    customerVariant: order.customerVariant,
    customerVariantId: order.customerVariantId,
    customerVariantCode: order.customerVariantCode,
    duration: order.duration,
    durationDays: order.durationDays,
    qty: order.qty,
    total: order.total,
    paymentDue: order.paymentDue,
    device: order.device,
    qrisStatus: order.qrisStatus,
    orderStatus: order.orderStatus,
    deliveryStatus: order.deliveryStatus,
    deliveryError: order.deliveryError,
    paymentMethod: order.paymentMethod,
    qrisUrl: order.qrisUrl,
    paymentExpiresAt: order.paymentExpiresAt,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    channel: order.channel,
    type: order.type,
    orderType: order.orderType,
    stockPolicy: order.stockPolicy,
    stockRaceDepositAmount: order.stockRaceDepositAmount,
    stockRaceDepositCreditedAt: order.stockRaceDepositCreditedAt,
    fulfillmentText: delivered && includeFulfillment ? order.fulfillmentText || "" : "",
    snkText: delivered && includeFulfillment ? order.snkText || "" : "",
  };
}

function safePublicPayment(payment = {}, order = null) {
  const fee = Number(payment.fee || order?.paymentFee || 0);
  const amount = Number(payment.amount || order?.paymentDue || 0);
  return {
    ref: payment.ref,
    orderId: payment.orderId,
    status: payment.status,
    amount: payment.amount,
    provider: payment.provider,
    createdAt: payment.createdAt,
    expiresAt: payment.expiresAt,
    paymentUrl: payment.paymentUrl || order?.qrisUrl || "",
    qrisText: payment.qrisText || payment.qrString || payment.paymentNumber || payment.paymentUrl || `QRIS ${payment.ref} ${payment.amount}`,
    qrString: payment.qrString || "",
    paymentNumber: payment.paymentNumber || "",
    providerStatus: payment.providerStatus || "pending",
    providerError: payment.providerError || "",
    fee,
    totalPayment: derivePakasirTotalPayment(amount, fee, payment.totalPayment),
    paymentMethod: payment.paymentMethod,
    order: order ? safePublicOrder(order) : null,
  };
}

const {
  pakasirStatusIsPaid,
  prepareManualApprovedOrderForFulfillment,
  preparePaidOrderForFulfillment,
  reconcilePakasirPaymentInDb,
} = createPaymentReconciliationService({
  activeResellerByWhatsapp,
  dateTimeText,
  derivePakasirTotalPayment,
  fetchPakasirTransactionDetail,
  formatRupiah,
  fulfillPaidOrderAndNotify,
  makeId,
  normalizeWhatsappNumber,
  nowText,
  toDateTime,
});

async function getWhatsAppBotStatus(db) {
  const tokens = configuredTokens(
    firstUsableSecret(db.settings?.whatsappBotToken),
    firstUsableSecret(process.env.WHATSAPP_BOT_TOKEN),
  );
  const botUrl = firstConfigured(process.env.WHATSAPP_BOT_URL, db.settings?.whatsappBotUrl, "http://127.0.0.1:4016");
  const integrations = ownerIntegrationSettings(db);
  const base = {
    connected: false,
    state: "disconnected",
    ownerWhatsAppNumber: db.settings.ownerWhatsAppNumber,
    inboundWebhookUrl: integrations.bailey.webhookUrl,
    publicUrl: integrations.bailey.publicUrl,
    botUrl,
    supportedCommands: ["#balance", "#deposit NOMINAL", ".addbalance NOMINAL (owner)"],
  };
  if (!tokens.length || !botUrl) return { ...base, error: "whatsapp_bot_not_configured" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.WHATSAPP_BOT_TIMEOUT_MS || 3000));
  try {
    const url = new URL("/session/status", botUrl);
    let lastError = null;
    for (const token of tokens) {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.success !== false) {
        return {
          ...base,
          ...body,
          connected: Boolean(body.connected),
          state: body.state || (body.connected ? "open" : "disconnected"),
          qrAvailable: Boolean(body.qr_available || body.qrAvailable),
          pairingAvailable: Boolean(body.pairing_available || body.pairingAvailable || body.pairing_code || body.pairingCode),
          pairingCode: String(body.pairing_code || body.pairingCode || ""),
          publicQrUrl: body.public_qr_url || body.publicQrUrl || "",
          lastError: String(body.last_error || body.lastError || ""),
        };
      }
      lastError = new Error(body.error || `whatsapp_bot_http_${response.status}`);
    }
    throw lastError || new Error("whatsapp_bot_unavailable");
  } catch (error) {
    return {
      ...base,
      error: error.name === "AbortError" ? "whatsapp_bot_timeout" : error.message || "whatsapp_bot_unavailable",
      lastError: error.name === "AbortError" ? "whatsapp_bot_timeout" : error.message || "whatsapp_bot_unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function execFileText(command, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 2500, ...options }, (error, stdout) => {
      if (error) {
        resolve("");
        return;
      }
      resolve(String(stdout || ""));
    });
  });
}

function bytesFromKb(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number * 1024 : 0;
}

async function readSwapInfo() {
  if (process.platform !== "linux") {
    return { total: 0, used: 0, free: 0, enabled: false };
  }
  const raw = await fs.readFile("/proc/meminfo", "utf8").catch(() => "");
  const values = Object.fromEntries(
    raw
      .split("\n")
      .map((line) => line.match(/^(\w+):\s+(\d+)/))
      .filter(Boolean)
      .map((match) => [match[1], Number(match[2])]),
  );
  const total = bytesFromKb(values.SwapTotal);
  const free = bytesFromKb(values.SwapFree);
  return {
    total,
    free,
    used: Math.max(0, total - free),
    enabled: total > 0,
  };
}

async function readDiskInfo() {
  if (process.platform !== "linux") {
    return { mount: "/", total: 0, used: 0, free: 0, percent: 0 };
  }
  const raw = await execFileText("df", ["-kP", "/"]);
  const [, line = ""] = raw.trim().split("\n");
  const parts = line.trim().split(/\s+/);
  const total = bytesFromKb(parts[1]);
  const used = bytesFromKb(parts[2]);
  const free = bytesFromKb(parts[3]);
  return {
    mount: parts[5] || "/",
    total,
    used,
    free,
    percent: total ? Math.round((used / total) * 100) : 0,
  };
}

async function readPm2Info() {
  const raw = await execFileText("pm2", ["jlist"]);
  try {
    const apps = JSON.parse(raw || "[]");
    const app = apps.find((item) => item.name === "kavya") || apps[0] || null;
    if (!app) {
      return { available: false, name: "kavya", status: "unknown", restartCount: 0, memory: 0, cpu: 0, uptime: 0 };
    }
    const startedAt = Number(app.pm2_env?.pm_uptime || 0);
    return {
      available: true,
      name: app.name || "kavya",
      status: app.pm2_env?.status || "unknown",
      restartCount: Number(app.pm2_env?.restart_time || 0),
      memory: Number(app.monit?.memory || 0),
      cpu: Number(app.monit?.cpu || 0),
      uptime: startedAt ? Math.max(0, Date.now() - startedAt) : 0,
    };
  } catch {
    return { available: false, name: "kavya", status: "unknown", restartCount: 0, memory: 0, cpu: 0, uptime: 0 };
  }
}

async function readTunnelInfo(db) {
  const configured = Boolean(firstUsableSecret(process.env.CLOUDFLARED_TOKEN, db.settings?.cloudflareTunnelToken));
  const raw = process.platform === "linux" ? await execFileText("pgrep", ["-fa", "cloudflared"]) : "";
  return {
    configured,
    running: /cloudflared/i.test(raw),
    publicDomain: publicWebsiteUrl(db, { fallback: localOrigin }),
  };
}

function systemWarnings({ memory, disk, swap, pm2, whatsapp, tunnel }) {
  const warnings = [];
  if (memory.available < 300 * 1024 * 1024) warnings.push("RAM available di bawah 300 MB.");
  if (disk.percent >= 80) warnings.push("Disk usage sudah di atas 80%.");
  if (!swap.enabled) warnings.push("Swap belum aktif.");
  if (pm2.status !== "online") warnings.push("PM2 Kavya tidak online.");
  if (!whatsapp.connected) warnings.push("WhatsApp belum connected.");
  if (tunnel.configured && !tunnel.running) warnings.push("Cloudflare Tunnel belum running.");
  return warnings;
}

async function statFileSafe(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

async function directorySummary(dirPath) {
  const resolved = path.resolve(dirPath);
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const files = [];
    let totalSize = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(resolved, entry.name);
      const stat = await statFileSafe(filePath);
      if (!stat) continue;
      totalSize += stat.size;
      files.push({
        name: entry.name,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = files[0] || null;
    return {
      path: resolved,
      exists: true,
      count: files.length,
      totalSize,
      latestName: latest?.name || "",
      latestSize: latest?.size || 0,
      latestAt: latest?.modifiedAt || "",
    };
  } catch {
    return {
      path: resolved,
      exists: false,
      count: 0,
      totalSize: 0,
      latestName: "",
      latestSize: 0,
      latestAt: "",
    };
  }
}

async function readDatabaseInfo() {
  const stat = await statFileSafe(databasePath);
  return {
    path: databasePath,
    exists: Boolean(stat),
    size: stat?.size || 0,
    modifiedAt: stat?.mtime?.toISOString?.() || "",
    version: getDbVersion(),
  };
}

async function readBackupInfo() {
  const fallbackDir = path.join(path.dirname(databasePath), "backups");
  return directorySummary(process.env.RUNTIME_BACKUP_DIR || process.env.BACKUP_DIR || fallbackDir);
}

function readIntegrationInfo(db, whatsapp, tunnel, gmailRuntimeHealth = null) {
  const pakasir = getPakasirCredentials(db);
  const gmailInfo = gmailConnectionInfo(db);
  const whatsappInboundConfigured = Boolean(firstUsableSecret(db.settings?.whatsappInboundToken, process.env.WHATSAPP_INBOUND_TOKEN));
  const ownerWhatsAppNumber = normalizeWhatsappNumber(db.settings?.ownerWhatsAppNumber || process.env.OWNER_WHATSAPP_NUMBER || "");
  const sheetsHealth = googleSheetsSyncHealth(db.settings || {});
  return {
    pakasir: {
      configured: pakasir.configured,
      merchantId: pakasir.project || "",
    },
    gmail: {
      connected: gmailRuntimeHealth?.checked ? Boolean(gmailRuntimeHealth.connected) : gmailInfo.connected,
      needsOAuth: gmailInfo.needsOAuth,
      error: gmailRuntimeHealth?.checked ? gmailRuntimeHealth.error || "" : gmailInfo.error,
      inboxEmail: firstConfigured(db.settings?.gmailInboxEmail, process.env.GMAIL_INBOX_EMAIL),
    },
    googleSheets: {
      configured: googleSheetsConfigured(db),
      lastSyncAt: db.settings?.googleSheetsLastSyncAt || "",
      lastSyncAttemptAt: sheetsHealth.lastAttemptAt,
      healthy: sheetsHealth.healthy,
      failedSections: sheetsHealth.failedSections,
      lastSyncSummary: db.settings?.googleSheetsLastSyncSummary || null,
    },
    whatsapp: {
      connected: Boolean(whatsapp.connected),
      state: whatsapp.state || "disconnected",
      inboundConfigured: whatsappInboundConfigured,
      ownerWhatsAppNumber,
    },
    cloudflare: {
      configured: Boolean(tunnel.configured),
      running: Boolean(tunnel.running),
      publicDomain: tunnel.publicDomain || "",
    },
  };
}

async function buildSystemStatus(db) {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const gmailSettings = ownerIntegrationSettings(db).gmail;
  const gmailRuntimePromise = gmailImapConfigured(db)
    ? gmailHealthService.check({
        host: gmailSettings.imapHost,
        port: gmailSettings.imapPort,
        secure: gmailSettings.imapSecure,
        auth: { user: gmailSettings.imapUser, pass: gmailSettings.imapPassword },
      })
    : Promise.resolve(null);
  const [disk, swap, pm2, whatsapp, tunnel, database, backup, gmailRuntimeHealth] = await Promise.all([
    readDiskInfo(),
    readSwapInfo(),
    readPm2Info(),
    getWhatsAppBotStatus(db),
    readTunnelInfo(db),
    readDatabaseInfo(),
    readBackupInfo(),
    gmailRuntimePromise,
  ]);
  const memory = {
    total: totalMemory,
    free: freeMemory,
    used: Math.max(0, totalMemory - freeMemory),
    available: freeMemory,
    percent: totalMemory ? Math.round(((totalMemory - freeMemory) / totalMemory) * 100) : 0,
  };
  const status = {
    ok: true,
    checkedAt: new Date().toISOString(),
    server: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      os: `${os.type()} ${os.release()}`,
      cpus: os.cpus().length,
      uptime: os.uptime(),
      loadavg: os.loadavg(),
    },
    memory,
    disk,
    swap,
    pm2,
    whatsapp: {
      connected: Boolean(whatsapp.connected),
      state: whatsapp.state || "disconnected",
      error: whatsapp.error || whatsapp.last_error || "",
    },
    tunnel,
    integrations: readIntegrationInfo(db, whatsapp, tunnel, gmailRuntimeHealth),
    database,
    backup,
    // `backup` above counts files sitting on this disk. This says whether the
    // scheduled backup actually ran and reached the owner -- which the
    // filesystem cannot answer, and which is the question that matters, because
    // those files live on the same VPS that would take them down.
    backupHealth: assessBackupHealth({
      backupState: db.settings?.backupState,
      intervalMs: backupIntervalMs(),
    }),
    warnings: [],
  };
  status.warnings = systemWarnings(status);
  return status;
}

function createdAtMs(value = "") {
  const date = toAccountDateTime(value, { endOfDay: !hasTimePart(value) });
  return date?.getTime?.() || 0;
}

function newestFirst(left = {}, right = {}) {
  return createdAtMs(right.createdAt || right.reviewedAt || right.paidAt || right.expiresAt || right.startedAt)
    - createdAtMs(left.createdAt || left.reviewedAt || left.paidAt || left.expiresAt || left.startedAt);
}

function severityRank(value = "") {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}

function compareQueueItems(left = {}, right = {}) {
  const severityDiff = severityRank(right.severity || "") - severityRank(left.severity || "");
  if (severityDiff) return severityDiff;
  return newestFirst(left, right);
}

function truncText(value = "", max = 180) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}...`;
}

function daysLeftUntil(value = "") {
  const date = toAccountDateTime(value, { endOfDay: !hasTimePart(value) });
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function resellerDisplayName(reseller = {}, fallback = "") {
  return reseller?.name || reseller?.username || primaryResellerWhatsapp(reseller) || fallback || "";
}

function orderDisplayName(order = {}) {
  const qty = Math.max(1, Number(order.qty || 1));
  return [order.product || "Produk", order.variant || "", order.duration || "", qty > 1 ? `x${qty}` : ""].filter(Boolean).join(" ");
}

function operationLink({ orderId = "", accountId = "", stockId = "", requestId = "", groupId = "", resellerId = "", productId = "" } = {}) {
  if (orderId) return `/dashboard/orders?order=${encodeURIComponent(orderId)}`;
  if (accountId) return `/dashboard/accounts?account=${encodeURIComponent(accountId)}`;
  if (stockId) return `/dashboard/stock?stock=${encodeURIComponent(stockId)}`;
  if (requestId) return `/dashboard/resellers?deposit=${encodeURIComponent(requestId)}`;
  if (resellerId) return `/dashboard/resellers?reseller=${encodeURIComponent(resellerId)}`;
  if (productId) return `/dashboard/products?product=${encodeURIComponent(productId)}`;
  if (groupId) return `/dashboard/whatsapp?group=${encodeURIComponent(groupId)}`;
  return "/dashboard/operations";
}

function pushTraceEvent(events, event) {
  if (!event?.createdAt) return;
  if (events.some((item) => item.id === event.id)) return;
  events.push(event);
}

function buildOrderTraceEvents(db, order = {}) {
  const payment = (db.payments || []).find((item) => item.orderId === order.id || item.ref === order.paymentRef) || null;
  const deliveredAccounts = deliveredAccountsForOrder(db, order, { includeHidden: true });
  const deliveredAccountIds = new Set(deliveredAccounts.map((item) => String(item.id || "").trim()).filter(Boolean));
  const reservedStocks = (Array.isArray(order.reservedStockIds) ? order.reservedStockIds : [])
    .map((stockId) => (db.stock || []).find((item) => String(item.id || "").trim() === String(stockId || "").trim()))
    .filter(Boolean);
  const events = [];

  pushTraceEvent(events, {
    id: `${order.id}:created`,
    type: "order",
    tone: "slate",
    title: "Order dibuat",
    detail: `${orderDisplayName(order)} untuk ${order.customer || order.reseller || order.whatsapp || "reseller"}.`,
    createdAt: order.createdAt || "",
  });

  if (payment?.createdAt) {
    pushTraceEvent(events, {
      id: `${order.id}:payment-created`,
      type: "payment",
      tone: "amber",
      title: "Invoice pembayaran dibuat",
      detail: `${payment.provider || order.paymentMethod || "payment"} ${payment.ref || order.paymentRef || ""}`.trim(),
      createdAt: payment.createdAt,
    });
  }

  if (reservedStocks.length) {
    pushTraceEvent(events, {
      id: `${order.id}:reserved`,
      type: "stock",
      tone: "amber",
      title: "Stok direserve untuk invoice ini",
      detail: `${reservedStocks.length} stok ditahan sementara sampai batas bayar.`,
      createdAt: reservedStocks[0]?.reservedAt || order.createdAt || "",
    });
  }

  if (Number(order.depositUsed || 0) > 0) {
    pushTraceEvent(events, {
      id: `${order.id}:deposit-used`,
      type: "deposit",
      tone: "amber",
      title: "Deposit reseller terpakai",
      detail: `${formatRupiah(Number(order.depositUsed || 0))} dipakai untuk order ini.`,
      createdAt: order.createdAt || "",
    });
  }

  if (payment?.paidAt || order.paidAt) {
    pushTraceEvent(events, {
      id: `${order.id}:paid`,
      type: "payment",
      tone: "emerald",
      title: "Pembayaran diterima",
      detail: `${formatRupiah(Number(payment?.totalPayment || order.paymentDue || order.total || 0))} diterima.`,
      createdAt: payment?.paidAt || order.paidAt,
    });
  }

  if (order.fulfillmentSentAt) {
    pushTraceEvent(events, {
      id: `${order.id}:fulfilled`,
      type: "delivery",
      tone: "emerald",
      title: "Akun terkirim",
      detail: `${Math.max(0, deliveredAccounts.length)} akun tertaut ke order ini.`,
      createdAt: order.fulfillmentSentAt,
    });
  }

  if (order.whatsappNotificationSentAt) {
    pushTraceEvent(events, {
      id: `${order.id}:notify`,
      type: "whatsapp",
      tone: "emerald",
      title: "Notifikasi WhatsApp terkirim",
      detail: order.whatsappNotificationStatus || "sent",
      createdAt: order.whatsappNotificationSentAt,
    });
  }

  if (order.googleSheetsSyncStatus === "synced") {
    const syncAt = deliveredAccounts
      .map((account) => String(account.googleSheetsSyncedAt || "").trim())
      .filter(Boolean)
      .sort()
      .at(-1) || order.fulfillmentSentAt || order.createdAt || "";
    pushTraceEvent(events, {
      id: `${order.id}:sheets-synced`,
      type: "sheet",
      tone: "emerald",
      title: "Google Sheets tersinkron",
      detail: deliveredAccounts.length
        ? `${deliveredAccounts.length} akun sudah terdorong ke Sheets.`
        : "Data order berhasil tercatat ke Google Sheets.",
      createdAt: syncAt,
    });
  }

  if (order.googleSheetsSyncStatus === "failed") {
    pushTraceEvent(events, {
      id: `${order.id}:sheets-failed`,
      type: "sheet",
      tone: "red",
      title: "Sync Google Sheets gagal",
      detail: "Order ini perlu dicek karena dorongan ke Sheets gagal atau belum lengkap.",
      createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
    });
  }

  if (order.depositRefunded) {
    pushTraceEvent(events, {
      id: `${order.id}:refund`,
      type: "deposit",
      tone: "emerald",
      title: "Deposit dikembalikan",
      detail: `${formatRupiah(Number(order.depositUsed || 0))} dikreditkan kembali ke reseller.`,
      createdAt: order.depositRefundedAt || order.paymentExpiresAt || order.createdAt || "",
    });
  }

  if (order.stockRaceDepositCreditedAt) {
    pushTraceEvent(events, {
      id: `${order.id}:stock-race`,
      type: "deposit",
      tone: "red",
      title: "Stok habis, dana masuk saldo",
      detail: `${formatRupiah(Number(order.stockRaceDepositAmount || order.total || 0))} masuk ke saldo reseller.`,
      createdAt: order.stockRaceDepositCreditedAt,
    });
  }

  if (order.latePaidDepositCreditedAt) {
    pushTraceEvent(events, {
      id: `${order.id}:late-paid`,
      type: "deposit",
      tone: "amber",
      title: "Pembayaran telat masuk saldo",
      detail: `${formatRupiah(Number(order.latePaidDepositAmount || order.paymentDue || order.total || 0))} dikreditkan ke saldo reseller.`,
      createdAt: order.latePaidDepositCreditedAt,
    });
  }

  if (order.deliveryError) {
    pushTraceEvent(events, {
      id: `${order.id}:delivery-error`,
      type: "delivery",
      tone: "red",
      title: "Delivery perlu perhatian",
      detail: truncText(order.deliveryError, 220),
      createdAt: order.fulfillmentSentAt || payment?.paidAt || order.paidAt || order.createdAt || "",
    });
  }

  if (String(order.qrisStatus || "").toLowerCase() === "expired") {
    pushTraceEvent(events, {
      id: `${order.id}:expired`,
      type: "payment",
      tone: "red",
      title: "Invoice expired",
      detail: `Batas bayar order ini lewat di ${order.paymentExpiresAt || "-"}.`,
      createdAt: order.paymentExpiresAt || order.createdAt || "",
    });
  }

  for (const activity of db.activities || []) {
    const activityOrderId = String(activity.orderId || "").trim();
    const activityAccountId = String(activity.accountId || "").trim();
    if (activityOrderId !== String(order.id || "").trim() && !deliveredAccountIds.has(activityAccountId)) continue;
    pushTraceEvent(events, {
      id: activity.id || `${order.id}:activity:${activity.title || activity.description}`,
      type: activity.type || "activity",
      tone: activity.type === "security" ? "violet" : activity.type === "account" ? "amber" : activity.type === "order" ? "slate" : activity.type === "whatsapp" ? "emerald" : "slate",
      title: activity.title || "Aktivitas",
      detail: truncText(activity.description, 220),
      createdAt: activity.createdAt || "",
    });
  }

  return events.sort((left, right) => createdAtMs(left.createdAt) - createdAtMs(right.createdAt));
}

function ownerSearchMatches(query = "", values = []) {
  const wanted = String(query || "").trim().toLowerCase();
  if (!wanted) return false;
  return values.some((value) => String(value || "").toLowerCase().includes(wanted));
}

function buildOwnerSearch(db, rawQuery = "") {
  const query = String(rawQuery || "").trim();
  const empty = {
    query,
    total: 0,
    groups: {
      orders: [],
      accounts: [],
      stock: [],
      resellers: [],
      products: [],
    },
  };
  if (!query) return empty;

  const productsById = new Map((db.products || []).map((item) => [String(item.id || "").trim(), item]));
  const productVariantMaps = new Map((db.products || []).map((product) => [
    String(product.id || "").trim(),
    new Map((product.variants || []).map((variant) => [String(variant.id || "").trim(), variant])),
  ]));

  const orders = (db.orders || [])
    .filter((order) => ownerSearchMatches(query, [
      order.id,
      order.paymentRef,
      order.customer,
      order.reseller,
      order.whatsapp,
      order.product,
      order.variant,
      order.variantCode,
      order.note,
    ]))
    .sort(newestFirst)
    .slice(0, 8)
    .map((order) => ({
      id: order.id,
      type: "order",
      group: "orders",
      title: `${order.id} - ${order.product} ${order.variant || ""}`.trim(),
      subtitle: [order.reseller || order.customer || "-", order.whatsapp || "-", order.paymentRef || "-"].filter(Boolean).join(" • "),
      detail: `${order.orderStatus || "-"} / ${order.deliveryStatus || "-"} / ${formatRupiah(Number(order.total || 0))}`,
      href: operationLink({ orderId: order.id }),
      createdAt: order.createdAt || "",
      status: order.orderStatus || "",
    }));

  const accounts = (db.managedAccounts || [])
    .filter((account) => ownerSearchMatches(query, [
      account.id,
      account.email,
      account.stockId,
      account.orderId,
      account.sourceOrderId,
      account.product,
      account.variant,
      account.reseller,
      account.buyer,
      account.whatsapp,
      account.device,
    ]))
    .sort(newestFirst)
    .slice(0, 8)
    .map((account) => ({
      id: account.id,
      type: "account",
      group: "accounts",
      title: `${account.email || account.id} - ${account.product || "-"} ${account.variant || ""}`.trim(),
      subtitle: [account.reseller || account.buyer || "-", account.orderId || account.sourceOrderId || "-", account.stockId || "-"].filter(Boolean).join(" • "),
      detail: `${account.status || "-"} • mulai ${account.startedAt || "-"} • exp ${account.expiresAt || "-"}`,
      href: operationLink({ accountId: account.id }),
      createdAt: account.startedAt || account.createdAt || "",
      status: account.status || "",
    }));

  const stock = (db.stock || [])
    .filter((item) => {
      const product = productsById.get(String(item.productId || "").trim());
      const variant = productVariantMaps.get(String(item.productId || "").trim())?.get(String(item.variantId || "").trim());
      return ownerSearchMatches(query, [
        item.id,
        item.email,
        item.profile,
        item.status,
        item.productId,
        item.variantId,
        item.reservedFor,
        item.sheetStockKey,
        product?.name,
        variant?.name,
        variant?.code,
      ]);
    })
    .sort(newestFirst)
    .slice(0, 8)
    .map((item) => {
      const product = productsById.get(String(item.productId || "").trim());
      const variant = productVariantMaps.get(String(item.productId || "").trim())?.get(String(item.variantId || "").trim());
      return {
        id: item.id,
        type: "stock",
        group: "stock",
        title: `${item.email || item.id} - ${product?.name || item.productId || "-"} ${variant?.name || ""}`.trim(),
        subtitle: [item.id, item.status || "-", item.reservedFor || item.sheetStockKey || "-"].filter(Boolean).join(" • "),
        detail: [item.profile ? `profile ${item.profile}` : "", item.sheetName ? `${item.sheetName}:${item.sheetRow || "-"}` : ""].filter(Boolean).join(" • ") || "Stok account",
        href: operationLink({ stockId: item.id }),
        createdAt: item.soldAt || item.reservedAt || item.createdAt || "",
        status: item.status || "",
      };
    });

  const resellers = (db.resellers || [])
    .filter((reseller) => ownerSearchMatches(query, [
      reseller.id,
      reseller.name,
      reseller.username,
      reseller.email,
      reseller.whatsapp,
    ]))
    .sort((left, right) => String(left.name || left.username || "").localeCompare(String(right.name || right.username || "")))
    .slice(0, 8)
    .map((reseller) => ({
      id: reseller.id,
      type: "reseller",
      group: "resellers",
      title: reseller.name || reseller.username || reseller.id,
      subtitle: [reseller.username || "-", reseller.whatsapp || "-", reseller.email || "-"].filter(Boolean).join(" • "),
      detail: `${reseller.isActive === false ? "nonaktif" : "aktif"} • saldo ${formatRupiah(Number(reseller.deposit || 0))}`,
      href: operationLink({ resellerId: reseller.id }),
      createdAt: reseller.joinedAt || "",
      status: reseller.isActive === false ? "inactive" : "active",
    }));

  const products = (db.products || [])
    .filter((product) => ownerSearchMatches(query, [
      product.id,
      product.name,
      product.code,
      product.category,
      ...(product.variants || []).flatMap((variant) => [variant.id, variant.name, variant.code]),
    ]))
    .slice(0, 8)
    .map((product) => {
      const lock = activeOrderLock(product, null);
      return {
        id: product.id,
        type: "product",
        group: "products",
        title: `${product.name} (${product.code || "-"})`,
        subtitle: [product.category || "-", `${(product.variants || []).length} variant`].join(" • "),
        detail: lock?.enabled || lock ? `order locked${lock.reason ? ` • ${lock.reason}` : ""}` : (product.description || "Produk"),
        href: operationLink({ productId: product.id }),
        createdAt: product.archivedAt || "",
        status: product.isArchived ? "archived" : product.isActive ? "active" : "inactive",
      };
    });

  const groups = { orders, accounts, stock, resellers, products };
  return {
    query,
    total: Object.values(groups).reduce((sum, list) => sum + list.length, 0),
    groups,
  };
}

function buildReconcileReport(db) {
  const issues = [];
  const stocks = db.stock || [];
  const accounts = db.managedAccounts || [];
  const orders = db.orders || [];
  const stockById = new Map(stocks.map((item) => [String(item.id || "").trim(), item]));
  const orderById = new Map(orders.map((item) => [String(item.id || "").trim(), item]));

  for (const stock of stocks) {
    const linkedAccounts = accounts.filter((account) => (
      String(account.stockId || "").trim() === String(stock.id || "").trim()
      || (stock.sheetStockKey && account.sheetStockKey && String(account.sheetStockKey) === String(stock.sheetStockKey))
    ));
    const activeLinked = linkedAccounts.filter((account) => !account.hidden && !account.returnedToStockAt && !isTerminalManagedAccountStatus(account.status || accountStatusFromDate(account.expiresAt, account.durationDays)));

    if (stock.status === "available" && activeLinked.length) {
      issues.push({
        id: `stock-available-linked-${stock.id}`,
        severity: "high",
        kind: "stock",
        title: "Stok available tapi masih dipakai akun aktif",
        detail: `${stock.email || stock.id} masih tertaut ke ${activeLinked.length} akun aktif.`,
        // Not owner-fixable: the Sheets row says the account is unsold and
        // local state says an active account is using it. Both readings come
        // from correct data; the disagreement is ours.
        ownerFixable: false,
        createdAt: stock.soldAt || stock.createdAt || "",
        stockId: stock.id,
        href: operationLink({ stockId: stock.id }),
      });
    }

    if (stock.status === "reserved") {
      const reservedOrder = orderById.get(String(stock.reservedFor || "").trim());
      const expiredReservation = reservedOrder && (
        reservedOrder.qrisStatus === "expired"
        || reservedOrder.orderStatus === "cancelled"
        || (reservedOrder.paymentExpiresAt && createdAtMs(reservedOrder.paymentExpiresAt) && createdAtMs(reservedOrder.paymentExpiresAt) < Date.now())
      );
      if (!reservedOrder || expiredReservation) {
        issues.push({
          id: `stock-reserved-stale-${stock.id}`,
          severity: "high",
          kind: "stock",
          title: "Reservasi stok stale",
          detail: `${stock.email || stock.id} masih reserved untuk ${stock.reservedFor || "order tidak dikenal"}.`,
          // The reservation is ours and the order it waited on is gone. No Sheet
          // edit clears this -- the release button on this row does.
          ownerFixable: false,
          createdAt: stock.reservedAt || stock.createdAt || "",
          stockId: stock.id,
          orderId: stock.reservedFor || "",
          href: operationLink({ stockId: stock.id }),
        });
      }
    }

    if (stock.status === "sold" && !linkedAccounts.length && createdAtMs(stock.createdAt || "") >= Date.now() - 90 * 86400000) {
      issues.push({
        id: `stock-sold-orphan-${stock.id}`,
        severity: "medium",
        kind: "stock",
        title: "Stok sold tanpa jejak akun",
        detail: `${stock.email || stock.id} sudah sold tapi tidak ada managed account yang tertaut.`,
        // The sale is correctly recorded; the account record it should have
        // created is absent. Nothing to correct in the Sheet.
        ownerFixable: false,
        createdAt: stock.soldAt || stock.createdAt || "",
        stockId: stock.id,
        href: operationLink({ stockId: stock.id }),
      });
    }

    if (stock.sheetSource === "google_sheets" && (!stock.sheetName || !stock.sheetRow)) {
      issues.push({
        id: `stock-sheet-meta-${stock.id}`,
        severity: "low",
        kind: "sheet",
        title: "Metadata Sheets stok belum lengkap",
        detail: `${stock.email || stock.id} belum punya sheetName/sheetRow yang lengkap.`,
        // sheetName/sheetRow are recorded by the sync, not typed by the owner.
        // There is no cell she can fill to make this go away.
        ownerFixable: false,
        createdAt: stock.createdAt || "",
        stockId: stock.id,
        href: operationLink({ stockId: stock.id }),
      });
    }

    if (stock.historyConflict && Array.isArray(stock.historyConflictOrderIds) && stock.historyConflictOrderIds.length > 1) {
      issues.push({
        id: `stock-history-conflict-${stock.id}`,
        severity: "high",
        kind: "stock",
        title: "Riwayat stok bentrok ke banyak order",
        detail: `${stock.email || stock.id} / ${stock.profile || "-"} pernah tertaut ke ${stock.historyConflictOrderIds.length} order. Auto-backfill diblok agar slot ini tidak hidup lagi ke reseller lain.`,
        // One account reaching several orders is a fulfilment-side conflict.
        // The Sheet row is a single correct row.
        ownerFixable: false,
        createdAt: stock.soldAt || stock.historyConflictDetectedAt || stock.createdAt || "",
        stockId: stock.id,
        href: operationLink({ stockId: stock.id }),
      });
    }
  }

  for (const [key, duplicateAccounts] of managedAccountDuplicateGroups(db).entries()) {
    const keeper = duplicateAccounts.slice().sort(compareManagedAccountPriority)[0];
    issues.push({
      id: `managed-duplicate-identity-${keeper?.id || key}`,
      severity: "high",
      kind: "account",
      title: "Managed account aktif dobel untuk stok/order yang sama",
        // Two live records for one account. The owner did not create the second
        // one, so there is nothing in Sheets to correct.
        ownerFixable: false,
      detail: `${duplicateAccounts.length} record aktif menunjuk identitas ${key}. Ini rawan bikin panel dobel dan salah baca stok.`,
      createdAt: keeper?.startedAt || keeper?.snapshotAt || "",
      accountId: keeper?.id || "",
      stockId: keeper?.stockId || "",
      orderId: keeper?.orderId || keeper?.sourceOrderId || "",
      href: operationLink({ accountId: keeper?.id || "" }),
    });
  }

  for (const account of accounts) {
    // Deliberately does NOT skip hidden/returned accounts the way the loops above
    // do. archiveMalformedManagedAccounts runs on every boot and hides exactly
    // these rows to keep them out of the reseller panel (index.js:3213), so by
    // the time this report runs the account it needs to warn about has already
    // been hidden by the thing that detected it. Skipping hidden rows here made
    // this finding unreachable: it could never fire, and the "kamu yang perbaiki"
    // count was structurally always zero. Hiding the row stops it being sold;
    // it does not stop the owner from needing to know it is broken.
    if (!isMalformedManagedAccount(account)) continue;
    // A genuinely returned or deliberately archived row is not this report's
    // business. Only the ones the malformed-archive itself touched count.
    if ((account.hidden || account.returnedToStockAt) && !account.sheetMalformedArchivedAt) continue;
    issues.push({
      id: `managed-malformed-${account.id}`,
      severity: "high",
      kind: "account",
      title: "Managed account malformed dari Google Sheets",
      detail: `${account.id} punya data akun tidak valid (${account.email || "-"} / password kosong). Row ini disembunyikan dari panel reseller sampai Sheet dibetulkan.`,
      // Whichever cell is empty, the owner typed the Sheet. Filling it resolves
      // the finding outright.
      ownerFixable: true,
      createdAt: account.startedAt || account.snapshotAt || "",
      accountId: account.id,
      stockId: account.stockId || "",
      orderId: account.orderId || account.sourceOrderId || "",
      href: operationLink({ accountId: account.id }),
    });
  }

  for (const account of accounts) {
    const status = String(account.status || accountStatusFromDate(account.expiresAt, account.durationDays)).toLowerCase();
    const startedAt = toAccountDateTime(account.startedAt);
    const expiresAt = toAccountDateTime(account.expiresAt, { endOfDay: !hasTimePart(account.expiresAt), referenceDate: startedAt });
    const relatedOrderId = String(account.orderId || account.sourceOrderId || "").trim();

    if (account.stockId && !stockById.has(String(account.stockId || "").trim()) && !isVirtualManagedStockLink(account)) {
      issues.push({
        id: `account-stock-missing-${account.id}`,
        severity: "medium",
        kind: "account",
        title: "Managed account kehilangan stock asal",
        detail: `${account.email || account.id} tertaut ke stock ${account.stockId}, tapi stock itu tidak ada di database.`,
        // A dangling reference in our own records. The Sheet row it came from
        // may well be perfectly correct.
        ownerFixable: false,
        createdAt: account.startedAt || account.createdAt || "",
        accountId: account.id,
        stockId: account.stockId,
        href: operationLink({ accountId: account.id }),
      });
    }

    if (relatedOrderId && !orderById.has(relatedOrderId)) {
      issues.push({
        id: `account-order-missing-${account.id}`,
        severity: "medium",
        kind: "account",
        title: "Managed account kehilangan order asal",
        detail: `${account.email || account.id} masih mengarah ke order ${relatedOrderId}, tapi order itu tidak ditemukan.`,
        ownerFixable: false,
        createdAt: account.startedAt || account.createdAt || "",
        accountId: account.id,
        orderId: relatedOrderId,
        href: operationLink({ accountId: account.id }),
      });
    }

    if (startedAt && expiresAt && expiresAt.getTime() <= startedAt.getTime()) {
      issues.push({
        id: `account-duration-invalid-${account.id}`,
        severity: "high",
        kind: "account",
        title: "Tanggal akun tidak valid",
        detail: `${account.email || account.id} punya expiry <= start (${account.startedAt || "-"} -> ${account.expiresAt || "-"})`,
        // TANGGAL or DURASI in the Sheet is wrong -- an expiry at or before the
        // start date. Only the owner can say which of the two is right.
        ownerFixable: true,
        createdAt: account.startedAt || account.createdAt || "",
        accountId: account.id,
        href: operationLink({ accountId: account.id }),
      });
    }

    if (status === "expired" && !account.hidden && !account.returnedToStockAt) {
      issues.push({
        id: `account-expired-live-${account.id}`,
        severity: "high",
        kind: "expiry",
        title: "Akun sudah expired tapi belum dibersihkan",
        detail: `${account.email || account.id} masih visible walau sudah expired.`,
        // The Sheet is fine -- the account really did expire. The cleanup job is
        // supposed to have retired it and did not, so this is ours.
        ownerFixable: false,
        createdAt: account.expiresAt || account.startedAt || "",
        accountId: account.id,
        href: operationLink({ accountId: account.id }),
      });
    }

    if (account.sheetSource === "google_sheets" && (!account.sheetName || !account.sheetRow)) {
      issues.push({
        id: `account-sheet-meta-${account.id}`,
        severity: "low",
        kind: "sheet",
        title: "Metadata Sheets akun belum lengkap",
        detail: `${account.email || account.id} belum punya sheetName/sheetRow yang lengkap.`,
        ownerFixable: false,
        createdAt: account.startedAt || account.createdAt || "",
        accountId: account.id,
        href: operationLink({ accountId: account.id }),
      });
    }
  }

  for (const order of orders) {
    if (order.type === "deposit_topup" || order.orderType === "deposit_topup") continue;
    if (createdAtMs(order.createdAt || "") < Date.now() - 60 * 86400000) continue;
    const linkedAccounts = deliveredAccountsForOrder(db, order, { includeHidden: true });
    const coverage = deliveryAuditCoverage(order, linkedAccounts, db.activities || []);
    if (
      (order.deliveryStatus === "sent" || order.orderStatus === "completed")
      && coverage.missingHistoricalCount > 0
    ) {
      issues.push({
        id: `order-missing-account-${order.id}`,
        severity: "high",
        kind: "order",
        title: "Order selesai tanpa jejak akun",
        detail: `${order.id} sudah ${order.deliveryStatus || order.orderStatus} tapi belum punya akun tertaut.`,
        // The customer received something we cannot account for. That is our
        // record-keeping gap, not a Sheet the owner left half-finished.
        ownerFixable: false,
        createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }
  }

  const sorted = issues.sort(compareQueueItems);
  return {
    summary: {
      total: sorted.length,
      high: sorted.filter((item) => item.severity === "high").length,
      medium: sorted.filter((item) => item.severity === "medium").length,
      low: sorted.filter((item) => item.severity === "low").length,
      // Split by who can act. Most of what this report finds is the system
      // disagreeing with itself, and the owner cannot fix that by editing a
      // Sheet -- so a single "3 stock anomalies" number sent them to the wrong
      // place. The high-severity split is the one that decides the next action.
      highOwnerFixable: sorted.filter((item) => item.severity === "high" && item.ownerFixable).length,
      highSystemSide: sorted.filter((item) => item.severity === "high" && !item.ownerFixable).length,
      managedDuplicates: sorted.filter((item) => item.id.startsWith("managed-duplicate-identity-")).length,
    },
    issues: sorted.slice(0, 40),
  };
}

function buildSheetsRowAudit(db) {
  const rows = (db.stock || []).filter(isGoogleSheetsBackedStock);
  const accounts = db.managedAccounts || [];
  const orders = db.orders || [];
  const issues = [];
  const affectedStockIds = new Set();
  const deliveredOwners = new Map();

  for (const order of orders) {
    for (const rawStockId of order.deliveredStockIds || []) {
      const stockId = String(rawStockId || "").trim();
      if (!stockId) continue;
      const owners = deliveredOwners.get(stockId) || [];
      owners.push(order);
      deliveredOwners.set(stockId, owners);
    }
  }

  // Which of these codes are the owner's to fix in the Sheet, and which are the
  // system disagreeing with itself.
  //
  // `invalid`, `ambiguous` and `condition` all describe cells the owner typed:
  // a blank identity, a SELLER that names nobody, a KONDISI AKUN value we do not
  // recognise or that says the account is broken. Editing that cell resolves the
  // finding outright. `mismatch` and `duplicate` describe our own bookkeeping --
  // a sold row with no managed account, two accounts on one Stock ID, web data
  // that drifted from the Sheet. No Sheet edit fixes those; we have to reconcile
  // our records, and telling the owner to go edit a correct Sheet wastes the one
  // thing she is good at doing quickly.
  const OWNER_FIXABLE_SHEET_CODES = new Set(["invalid", "ambiguous", "condition"]);

  const addIssue = (stock, severity, code, title, detail) => {
    const stockId = String(stock?.id || "").trim();
    if (stockId) affectedStockIds.add(stockId);
    issues.push({
      id: `sheet-row-${code}-${stockId || issues.length}`,
      severity,
      kind: "sheet",
      code,
      title,
      detail,
      ownerFixable: OWNER_FIXABLE_SHEET_CODES.has(code),
      stockId,
      sheetName: stock?.sheetName || "",
      sheetRow: Number(stock?.sheetRow || 0),
      identity: stock?.loginPhone || stock?.email || stock?.profile || stockId,
      createdAt: stock?.sheetLastSyncedAt || stock?.soldAt || "",
      href: operationLink({ stockId }),
    });
  };

  for (const stock of rows) {
    const sold = String(stock.status || "").toLowerCase() === "sold";
    const condition = String(stock.accountCondition || "NORMAL").trim().toUpperCase();
    const linked = accounts.filter((account) => (
      String(account.stockId || "").trim() === String(stock.id || "").trim()
      && isDeliverableManagedAccount({
        ...account,
        status: account.status || accountStatusFromDate(account.expiresAt, account.durationDays),
      })
    ));
    const sellerInput = String(stock.sheetSellerInput || "").trim();
    const resolvedSeller = sellerInput ? resellerBySellerText(db, sellerInput) : null;

    if (!stock.sheetName || !Number(stock.sheetRow || 0) || (!stock.email && !stock.loginPhone && !stock.password)) {
      addIssue(stock, "high", "invalid", "Baris Sheets tidak valid", "Identitas akun atau metadata sheet/row belum lengkap.");
    }
    if (stock.accountConditionKnown === false) {
      addIssue(stock, "high", "ambiguous", "Kondisi akun tidak dikenal", `KONDISI AKUN '${stock.accountConditionRaw || condition || "-"}' diblokir sampai diperiksa Owner.`);
    } else if (stock.accountConditionBlocked) {
      addIssue(stock, condition === "BERMASALAH" || condition === "DISABLED" ? "high" : "medium", "condition", "Kondisi akun perlu perhatian", `KONDISI AKUN ${condition}; baris tidak dihitung sebagai stok tersedia.`);
    }
    if (stock.sheetResellerConflict || (sold && sellerInput && !resolvedSeller)) {
      addIssue(stock, "high", "ambiguous", "Seller Sheets ambigu", `SELLER '${sellerInput || "-"}' belum mengarah ke tepat satu reseller aktif.`);
    }
    if (sold && (!stock.soldAt || !Number(stock.soldDurationDays || 0))) {
      addIssue(stock, "high", "invalid", "Assignment Sheets belum lengkap", "SELLER terisi tetapi TANGGAL atau DURASI belum valid.");
    }
    if (sold && linked.length === 0) {
      addIssue(stock, "high", "mismatch", "Akun sold belum tampil di Manage Account", "Baris terjual di Sheets belum mempunyai managed account aktif.");
    }
    if (!sold && linked.length > 0 && !stockBlockedByAccountCondition(stock)) {
      addIssue(stock, "high", "mismatch", "Baris kosong masih memiliki akun aktif", `${linked.length} managed account masih aktif walau SELLER di Sheets kosong.`);
    }
    if (sold && linked.length > 1) {
      addIssue(stock, "high", "duplicate", "Satu baris memiliki beberapa akun aktif", `${linked.length} managed account aktif menunjuk Stock ID yang sama.`);
    }
    const ownerOrders = deliveredOwners.get(String(stock.id || "").trim()) || [];
    if (ownerOrders.length > 1) {
      addIssue(stock, "high", "duplicate", "Stock ID dipakai beberapa order", `${ownerOrders.length} order masih mencantumkan Stock ID ini.`);
    }
    if (sold && linked[0]) {
      const account = linked[0];
      const temporalMismatch = String(account.startedAt || "").trim() !== String(stock.soldAt || "").trim()
        || Number(account.durationDays || 0) !== Number(stock.soldDurationDays || 0)
        || String(account.expiresAt || "").trim() !== String(stock.soldExpiresAt || stock.expiresAt || "").trim();
      const sellerMismatch = resolvedSeller?.id && String(account.resellerId || "").trim() !== String(resolvedSeller.id || "").trim();
      if (temporalMismatch || sellerMismatch) {
        addIssue(stock, "high", "mismatch", "Data web berbeda dari Sheets", [temporalMismatch ? "tanggal/durasi" : "", sellerMismatch ? "seller" : ""].filter(Boolean).join(" dan ") + " tidak sama.");
      }
    }
  }

  const paidNotDelivered = orders.filter((order) => (
    String(order.qrisStatus || "").toLowerCase() === "paid"
    && String(order.deliveryStatus || "").toLowerCase() !== "sent"
    && !isCreditedStockUnavailableOrder(order)
    && !["deposit_topup"].includes(String(order.orderType || order.type || "").toLowerCase())
  )).length;
  const sorted = issues.sort(compareQueueItems);
  return {
    checkedAt: new Date().toISOString(),
    summary: {
      rowsRead: rows.length,
      matched: Math.max(0, rows.length - affectedStockIds.size),
      invalid: sorted.filter((item) => item.code === "invalid").length,
      ambiguous: sorted.filter((item) => item.code === "ambiguous").length,
      mismatch: sorted.filter((item) => item.code === "mismatch").length,
      duplicateStock: sorted.filter((item) => item.code === "duplicate").length,
      paidNotDelivered,
    },
    issues: sorted.slice(0, 100),
  };
}

function buildDeliveryAuditQueue(db) {
  const issues = [];
  const orders = (db.orders || []).filter((order) => order.type !== "deposit_topup" && order.orderType !== "deposit_topup");

  for (const order of orders) {
    const recentMoment = Math.max(
      createdAtMs(order.fulfillmentSentAt || ""),
      createdAtMs(order.paidAt || ""),
      createdAtMs(order.createdAt || ""),
    );
    if (recentMoment && recentMoment < Date.now() - 90 * 86400000) continue;

    const delivery = String(order.deliveryStatus || "").toLowerCase();
    const status = String(order.orderStatus || "").toLowerCase();
    const qty = Math.max(1, Number(order.qty || 1));
    const linkedAccounts = deliveredAccountsForOrder(db, order, { includeHidden: true });
    const {
      historical: uniqueLinkedAccounts,
      active: activeLinkedAccounts,
    } = classifyDeliveryAuditAccounts(linkedAccounts);
    const historicalDeliveryVerified = hasHistoricalDeliveryEvidence(db.activities || [], order);
    const removedConflictStocks = Array.isArray(order.historyConflictRemovedStockIds) ? order.historyConflictRemovedStockIds.filter(Boolean) : [];
    const missingSheetAccounts = activeLinkedAccounts.filter((account) => (
      String(account.sheetSource || "").toLowerCase() === "google_sheets"
      && (!account.sheetName || !account.sheetRow)
    ));

    if (delivery === "needs_redelivery" || removedConflictStocks.length) {
      issues.push({
        id: `delivery-order-redelivery-${order.id}`,
        severity: "high",
        kind: "delivery",
        title: "Order perlu redelivery",
        detail: `${order.id} kehilangan stock delivery karena konflik histori${removedConflictStocks.length ? ` (${removedConflictStocks.length} stock dicabut)` : ""}. Order ini perlu akun pengganti atau follow-up manual.`,
        createdAt: order.redeliveryFlaggedAt || order.historyConflictRemovedAt || order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }

    if ((delivery === "sent" || status === "completed") && uniqueLinkedAccounts.length === 0 && !historicalDeliveryVerified) {
      issues.push({
        id: `delivery-order-missing-${order.id}`,
        severity: "high",
        kind: "delivery",
        title: "Order selesai tapi akun belum tertaut",
        detail: `${order.id} sudah ${order.deliveryStatus || order.orderStatus}, tapi belum ada akun yang tertaut ke history delivery.`,
        createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
      continue;
    }

    if ((delivery === "sent" || status === "completed") && uniqueLinkedAccounts.length < qty && !historicalDeliveryVerified) {
      issues.push({
        id: `delivery-order-under-${order.id}`,
        severity: "high",
        kind: "delivery",
        title: "Jumlah akun terkirim kurang dari qty order",
        detail: `${order.id} butuh ${qty} akun, tapi baru ${uniqueLinkedAccounts.length} akun unik yang tertaut.`,
        createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }

    if (activeLinkedAccounts.length > qty) {
      issues.push({
        id: `delivery-order-over-${order.id}`,
        severity: "high",
        kind: "delivery",
        title: "Jumlah akun tertaut melebihi qty order",
        detail: `${order.id} qty ${qty}, tapi ada ${activeLinkedAccounts.length} akun aktif unik tertaut. Ini sinyal double drop yang perlu diperiksa.`,
        createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }

    if (missingSheetAccounts.length) {
      issues.push({
        id: `delivery-sheet-pending-${order.id}`,
        severity: uniqueLinkedAccounts.length ? "medium" : "high",
        kind: "sheet",
        title: "Akun terkirim belum punya metadata Sheets lengkap",
        detail: `${order.id} punya ${missingSheetAccounts.length} akun delivery tanpa sheetName/sheetRow lengkap.`,
        createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }

    if ((delivery === "sent" || status === "completed") && order.whatsappNotificationStatus === "failed") {
      issues.push({
        id: `delivery-wa-failed-${order.id}`,
        severity: "medium",
        kind: "whatsapp",
        title: "Akun selesai diproses tapi notif WhatsApp gagal",
        detail: truncText(order.whatsappNotificationError || order.deliveryError || `Notif untuk ${order.id} gagal terkirim.`, 220),
        createdAt: order.whatsappNotificationSentAt || order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }

    // The S&K leg is a second, independent message (fulfillment-notification-
    // service.js:142-147), so it can fail while the account message succeeds.
    // Its status was recorded correctly and read by nothing, which meant a
    // customer could be left holding an account and no way to prove ownership,
    // with an order the dashboard showed as fully delivered.
    //
    // Kept separate from the item above rather than merged: one is "the account
    // message did not arrive", the other is "the account arrived but the S&K
    // did not". They need different checks on the owner's side, and folding
    // them together would make a half-delivery indistinguishable from a
    // fully-failed one.
    if ((delivery === "sent" || status === "completed") && order.whatsappSnkNotificationStatus === "failed") {
      issues.push({
        id: `delivery-snk-failed-${order.id}`,
        severity: "high",
        kind: "notification",
        title: "SnK gagal terkirim padahal akun sudah dikirim",
        detail: truncText(order.whatsappSnkNotificationError || `Pesan SnK untuk ${order.id} gagal terkirim. Customer sudah dapat akunnya tanpa bukti kepemilikan.`, 220),
        createdAt: order.whatsappSnkNotificationSentAt || order.whatsappNotificationSentAt || order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }
  }

  const sorted = issues.sort(compareQueueItems);
  return {
    summary: {
      total: sorted.length,
      high: sorted.filter((item) => item.severity === "high").length,
      missingAccounts: sorted.filter((item) => item.id.startsWith("delivery-order-missing-") || item.id.startsWith("delivery-order-under-")).length,
      duplicateDrops: sorted.filter((item) => item.id.startsWith("delivery-order-over-")).length,
      sheetPending: sorted.filter((item) => item.id.startsWith("delivery-sheet-pending-")).length,
      whatsappFailed: sorted.filter((item) => item.id.startsWith("delivery-wa-failed-")).length,
    },
    items: sorted.slice(0, 40),
  };
}

function buildReservedStockQueue(db) {
  const issues = [];
  const stocks = db.stock || [];
  const ordersById = new Map((db.orders || []).map((item) => [String(item.id || "").trim(), item]));
  const activeAccountsById = new Map(
    (db.managedAccounts || [])
      .filter((account) => !account.hidden && !account.returnedToStockAt)
      .map((account) => [String(account.id || "").trim(), account]),
  );

  for (const stock of stocks) {
    if (String(stock.status || "").toLowerCase() !== "reserved") continue;
    const order = ordersById.get(String(stock.reservedFor || "").trim()) || null;
    const linkedAccount = activeAccountsById.get(String(stock.reservedAccountId || "").trim()) || null;
    const { product, variant } = stockProductVariant(db, stock);
    const reservedUntilMs = createdAtMs(stock.reservedUntil || "");
    const orderUntilMs = createdAtMs(order?.paymentExpiresAt || "");
    const stale = !order
      || String(order?.orderStatus || "").toLowerCase() === "cancelled"
      || String(order?.qrisStatus || "").toLowerCase() === "expired"
      || Boolean((reservedUntilMs && reservedUntilMs < Date.now()) || (orderUntilMs && orderUntilMs < Date.now()));
    const waitingPayment = Boolean(order && !linkedAccount && !stale);
    const linkedDaily = Boolean(linkedAccount);
    const title = stale
      ? "Reserved stock stale"
      : linkedDaily
        ? "Reserved stock dipakai akun harian"
        : "Reserved stock menunggu order selesai";
    issues.push({
      id: `stock-lock-${stock.id}`,
      severity: stale ? "high" : waitingPayment ? "medium" : "low",
      kind: "stock_lock",
      title,
      detail: [
        stock.email || stock.id,
        product?.name || stock.productId || "-",
        variant?.name || stock.variantId || "-",
        linkedDaily ? `akun ${linkedAccount.email || linkedAccount.id}` : order ? `order ${order.id}` : "order hilang",
        stock.reservedUntil ? `s/d ${stock.reservedUntil}` : "",
      ].filter(Boolean).join(" • "),
      createdAt: stock.reservedAt || order?.createdAt || stock.createdAt || "",
      stockId: stock.id,
      orderId: order?.id || "",
      accountId: linkedAccount?.id || "",
      href: operationLink({ stockId: stock.id }),
    });
  }

  const sorted = issues.sort(compareQueueItems);
  return {
    summary: {
      total: sorted.length,
      stale: sorted.filter((item) => item.severity === "high").length,
      waitingPayment: sorted.filter((item) => item.title === "Reserved stock menunggu order selesai").length,
      linkedDaily: sorted.filter((item) => item.title === "Reserved stock dipakai akun harian").length,
    },
    items: sorted.slice(0, 50),
  };
}

function buildExpiryQueue(db) {
  const expiringSoon = [];
  const expiredActive = [];
  const durationAnomalies = [];

  for (const account of db.managedAccounts || []) {
    const status = String(account.status || accountStatusFromDate(account.expiresAt, account.durationDays)).toLowerCase();
    const daysLeft = daysLeftUntil(account.expiresAt);
    const startedAt = toAccountDateTime(account.startedAt);
    const expiresAt = toAccountDateTime(account.expiresAt, { endOfDay: !hasTimePart(account.expiresAt), referenceDate: startedAt });
    const row = {
      id: account.id,
      accountId: account.id,
      stockId: account.stockId || "",
      orderId: account.orderId || account.sourceOrderId || "",
      product: account.product || "",
      variant: account.variant || "",
      email: account.email || "",
      buyer: account.buyer || "",
      reseller: account.reseller || "",
      status,
      startedAt: account.startedAt || "",
      expiresAt: account.expiresAt || "",
      daysLeft,
      href: operationLink({ accountId: account.id }),
    };

    if (startedAt && expiresAt && expiresAt.getTime() <= startedAt.getTime()) {
      durationAnomalies.push({
        ...row,
        severity: "high",
        needsAction: "Periksa tanggal mulai dan expiry. Data durasi tidak valid.",
      });
    }

    if (account.hidden || account.returnedToStockAt) continue;
    if (status === "expired") {
      expiredActive.push({
        ...row,
        severity: "high",
        needsAction: "Return ke stok atau arsipkan jika memang sudah tidak dipakai.",
      });
      continue;
    }
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 5) {
      expiringSoon.push({
        ...row,
        severity: daysLeft <= 1 ? "high" : daysLeft <= 3 ? "medium" : "low",
        needsAction: daysLeft <= 1 ? "Siapkan cleanup atau gantian akun." : "Monitor agar cleanup tepat waktu.",
      });
    }
  }

  return {
    summary: {
      expiringSoon: expiringSoon.length,
      expiredActive: expiredActive.length,
      durationAnomalies: durationAnomalies.length,
    },
    expiringSoon: expiringSoon.sort(compareQueueItems).slice(0, 30),
    expiredActive: expiredActive.sort(compareQueueItems).slice(0, 30),
    durationAnomalies: durationAnomalies.sort(compareQueueItems).slice(0, 20),
  };
}

function buildWalletLedger(db) {
  const entries = [];
  const summaryByReseller = new Map();

  const ensureResellerSummary = (resellerId = "", fallbackName = "", fallbackWhatsapp = "") => {
    const reseller = (db.resellers || []).find((item) => item.id === resellerId) || null;
    const key = resellerId || normalizeWhatsappNumber(fallbackWhatsapp) || normalizeLoginIdentifier(fallbackName) || "unknown";
    if (!summaryByReseller.has(key)) {
      summaryByReseller.set(key, {
        resellerId: reseller?.id || resellerId || "",
        resellerName: resellerDisplayName(reseller, fallbackName || fallbackWhatsapp || "Unknown"),
        whatsapp: primaryResellerWhatsapp(reseller) || normalizeWhatsappNumber(fallbackWhatsapp) || "",
        currentBalance: Number(reseller?.deposit || 0),
        totalTopup: 0,
        totalSpent: 0,
        totalRefund: 0,
        totalLateCredit: 0,
        totalOrders: 0,
      });
    }
    return summaryByReseller.get(key);
  };

  const pushEntry = (entry) => {
    entries.push(entry);
    const summary = ensureResellerSummary(entry.resellerId, entry.resellerName, entry.whatsapp);
    if (entry.kind === "credit") summary.totalTopup += Number(entry.amount || 0);
    if (entry.type === "order_spend") {
      summary.totalSpent += Number(entry.amount || 0);
      summary.totalOrders += 1;
    }
    if (entry.type === "deposit_refund" || entry.type === "stock_race_credit") {
      summary.totalRefund += Number(entry.amount || 0);
    }
    if (entry.type === "late_paid_credit") {
      summary.totalLateCredit += Number(entry.amount || 0);
    }
  };

  for (const order of db.orders || []) {
    const reseller = (db.resellers || []).find((item) => item.id === order.resellerId) || null;
    const resellerName = resellerDisplayName(reseller, order.reseller || order.customer || order.whatsapp || "");
    const whatsapp = primaryResellerWhatsapp(reseller) || normalizeWhatsappNumber(order.whatsapp || "");

    if (Number(order.depositUsed || 0) > 0) {
      pushEntry({
        id: `ledger-spend-${order.id}`,
        type: "order_spend",
        kind: "debit",
        resellerId: order.resellerId || "",
        resellerName,
        whatsapp,
        amount: Number(order.depositUsed || 0),
        balanceBefore: Number(order.depositBefore || 0),
        balanceAfter: Number(order.depositAfter || 0),
        orderId: order.id,
        createdAt: order.createdAt || "",
        status: order.orderStatus || "",
        detail: `${orderDisplayName(order)} memakai deposit.`,
      });
    }

    if (order.depositRefunded && Number(order.depositUsed || 0) > 0) {
      pushEntry({
        id: `ledger-refund-${order.id}`,
        type: "deposit_refund",
        kind: "credit",
        resellerId: order.resellerId || "",
        resellerName,
        whatsapp,
        amount: Number(order.depositUsed || 0),
        orderId: order.id,
        createdAt: order.depositRefundedAt || order.createdAt || "",
        status: "refund",
        detail: `Refund deposit untuk ${orderDisplayName(order)}.`,
      });
    }

    if (order.stockRaceDepositCreditedAt) {
      pushEntry({
        id: `ledger-stock-race-${order.id}`,
        type: "stock_race_credit",
        kind: "credit",
        resellerId: order.resellerId || "",
        resellerName,
        whatsapp,
        amount: Number(order.stockRaceDepositAmount || order.total || 0),
        balanceBefore: Number(order.depositBefore || 0),
        balanceAfter: Number(order.depositAfter || 0),
        orderId: order.id,
        createdAt: order.stockRaceDepositCreditedAt,
        status: "credited",
        detail: `Dana order ${order.id} dikreditkan karena stok habis.`,
      });
    }

    if (order.latePaidDepositCreditedAt) {
      pushEntry({
        id: `ledger-late-paid-${order.id}`,
        type: "late_paid_credit",
        kind: "credit",
        resellerId: order.resellerId || "",
        resellerName,
        whatsapp,
        amount: Number(order.latePaidDepositAmount || order.paymentDue || order.total || 0),
        balanceBefore: Number(order.depositBefore || 0),
        balanceAfter: Number(order.depositAfter || 0),
        orderId: order.id,
        createdAt: order.latePaidDepositCreditedAt,
        status: "credited",
        detail: `Pembayaran telat untuk ${order.id} masuk ke saldo reseller.`,
      });
    }

    if ((order.type === "deposit_topup" || order.orderType === "deposit_topup") && (order.deliveryStatus === "sent" || order.orderStatus === "completed")) {
      pushEntry({
        id: `ledger-topup-${order.id}`,
        type: "deposit_topup_paid",
        kind: "credit",
        resellerId: order.resellerId || "",
        resellerName,
        whatsapp,
        amount: Number(order.depositAdded || order.total || 0),
        balanceBefore: Number(order.depositBefore || 0),
        balanceAfter: Number(order.depositAfter || 0),
        orderId: order.id,
        createdAt: order.paidAt || order.fulfillmentSentAt || order.createdAt || "",
        status: "paid",
        detail: "Top up saldo QRIS otomatis berhasil.",
      });
    }
  }

  for (const request of db.depositRequests || []) {
    if (String(request.status || "").toLowerCase() !== "approved" || request.orderId) continue;
    pushEntry({
      id: `ledger-manual-${request.id}`,
      type: "manual_topup",
      kind: "credit",
      resellerId: request.resellerId || "",
      resellerName: request.resellerName || request.whatsapp || "Reseller",
      whatsapp: normalizeWhatsappNumber(request.whatsapp || ""),
      amount: Number(request.amount || 0),
      requestId: request.id,
      createdAt: request.reviewedAt || request.createdAt || "",
      status: "approved",
      detail: `Approve manual deposit ${request.method || "manual"}.`,
    });
  }

  const resellerSummaries = Array.from(summaryByReseller.values())
    .sort((left, right) => Number(right.currentBalance || 0) - Number(left.currentBalance || 0));
  const allEntries = [...entries].sort(compareQueueItems);
  const sortedEntries = allEntries.slice(0, 120);
  return {
    summary: {
      totalBalance: resellerSummaries.reduce((sum, item) => sum + Number(item.currentBalance || 0), 0),
      totalTopup: allEntries.filter((item) => item.kind === "credit").reduce((sum, item) => sum + Number(item.amount || 0), 0),
      totalSpent: allEntries.filter((item) => item.type === "order_spend").reduce((sum, item) => sum + Number(item.amount || 0), 0),
      resellerCount: resellerSummaries.length,
      pendingRequests: (db.depositRequests || []).filter((item) => String(item.status || "pending").toLowerCase() === "pending").length,
    },
    resellerSummaries,
    entries: sortedEntries,
  };
}

function buildResellerHealthQueue(db) {
  const issues = [];
  const activeAccounts = (db.managedAccounts || []).filter((account) => !account.hidden && !account.returnedToStockAt);
  const activeOrders = (db.orders || []).filter((order) => order.type !== "deposit_topup" && order.orderType !== "deposit_topup");

  for (const reseller of db.resellers || []) {
    const syncStatus = String(reseller.googleSheetsResellerSyncStatus || "").toLowerCase();
    if (!["pending", "conflict"].includes(syncStatus)) continue;
    issues.push({
      id: `reseller-sheet-sync-${reseller.id}`,
      severity: syncStatus === "conflict" ? "high" : "medium",
      kind: "reseller",
      title: syncStatus === "conflict" ? "Data reseller bentrok di Google Sheets" : "Sinkronisasi data reseller tertunda",
      detail: `${reseller.username || reseller.name || reseller.id} belum tersinkron aman ke tab data reseller. Jalankan Sinkronkan Data Reseller dari panel Owner.`,
      createdAt: reseller.googleSheetsResellerSyncAttemptedAt || reseller.selfRegisteredAt || reseller.joinedAt || "",
      resellerId: reseller.id,
      href: "/owner-v2/resellers",
    });
  }

  for (const account of activeAccounts) {
    if (isMalformedManagedAccount(account)) {
      issues.push({
        id: `reseller-account-malformed-${account.id}`,
        severity: "high",
        kind: "reseller",
        title: "Akun reseller tampil kosong karena row Sheets rusak",
        detail: `${account.id} terbaca sebagai ${account.email || "-"} dengan password kosong. Biasanya kolom ACCOUNT/PASSWORD di Sheets bergeser atau tidak terisi benar.`,
        createdAt: account.startedAt || account.createdAt || "",
        accountId: account.id,
        stockId: account.stockId || "",
        orderId: account.orderId || account.sourceOrderId || "",
        href: operationLink({ accountId: account.id }),
        resellerId: account.resellerId || "",
      });
      continue;
    }
    const snapshot = managedAccountOwnershipSnapshot(db, account);
    const currentResellerId = String(account.resellerId || "").trim();
    const expectedResellerId = String(snapshot.expected?.resellerId || "").trim();
    const currentWhatsapp = normalizeWhatsappNumber(account.whatsapp || "");
    const expectedWhatsapp = normalizeWhatsappNumber(snapshot.expected?.whatsapp || "");
    if (!expectedResellerId && !expectedWhatsapp) {
      if (String(account.orderId || account.sourceOrderId || "").trim() || account.stockId) {
        const isLegacyLink = ["link_pool_sheet", "canva_sheet"].includes(String(account.source || ""));
        issues.push({
          id: `${isLegacyLink ? "reseller-link-owner-missing" : "reseller-owner-missing"}-${account.id}`,
          severity: "high",
          kind: "reseller",
          title: isLegacyLink ? "Akun link pool legacy belum punya owner reseller" : "Managed account belum punya owner reseller yang jelas",
          detail: isLegacyLink
            ? `${account.email || account.id} masih aktif di Canva/link pool, tapi metadata reseller kosong. Biasanya ini bikin Manage Account reseller tidak sinkron.`
            : `${account.email || account.id} masih aktif, tapi owner reseller tidak bisa dipastikan dari order/WhatsApp.`,
          createdAt: account.startedAt || account.createdAt || "",
          accountId: account.id,
          stockId: account.stockId || "",
          orderId: account.orderId || account.sourceOrderId || "",
          href: operationLink({ accountId: account.id }),
          resellerId: "",
        });
      }
      continue;
    }
    const resellerNameChanged = Boolean(snapshot.expected?.reseller && account.reseller !== snapshot.expected.reseller);
    const resellerIdChanged = Boolean(expectedResellerId && currentResellerId !== expectedResellerId);
    const whatsappChanged = Boolean(expectedWhatsapp && currentWhatsapp !== expectedWhatsapp);
    const orderLinkMissing = Boolean(snapshot.order?.id && (!account.orderId || !account.sourceOrderId));
    if (resellerIdChanged || whatsappChanged || resellerNameChanged || orderLinkMissing) {
      issues.push({
        id: `reseller-owner-drift-${account.id}`,
        severity: resellerIdChanged || orderLinkMissing ? "high" : "medium",
        kind: "reseller",
        title: "Ownership akun reseller drift",
        detail: `${account.email || account.id} tersimpan untuk ${account.reseller || account.resellerId || "-"}, tapi hasil resolve mengarah ke ${snapshot.expected?.reseller || expectedResellerId || expectedWhatsapp || "-"}.`,
        createdAt: account.startedAt || account.createdAt || "",
        accountId: account.id,
        stockId: account.stockId || "",
        orderId: snapshot.order?.id || account.orderId || account.sourceOrderId || "",
        href: operationLink({ accountId: account.id }),
        resellerId: expectedResellerId || currentResellerId || "",
      });
    }
  }

  for (const order of activeOrders) {
    const orderMoment = createdAtMs(order.createdAt || "");
    if (orderMoment && orderMoment < Date.now() - 90 * 86400000) continue;
    const delivery = String(order.deliveryStatus || "").toLowerCase();
    const status = String(order.orderStatus || "").toLowerCase();
    const linkedAccounts = deliveredAccountsForOrder(db, order, { includeHidden: true });
    const coverage = deliveryAuditCoverage(order, linkedAccounts, db.activities || []);
    if ((delivery === "sent" || status === "completed") && coverage.missingHistoricalCount > 0) {
      issues.push({
        id: `reseller-order-missing-accounts-${order.id}`,
        severity: "high",
        kind: "reseller",
        title: "Order reseller selesai tapi Manage Account belum lengkap",
        detail: `${order.id} butuh ${coverage.qty} akun, tapi jejak delivery valid baru ${coverage.historicalCount}. Ini yang bikin panel reseller terasa kosong atau tidak sinkron.`,
        createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
        resellerId: order.resellerId || "",
      });
    }
    if (coverage.activeCount > coverage.qty) {
      issues.push({
        id: `reseller-order-duplicate-${order.id}`,
        severity: "high",
        kind: "reseller",
        title: "Order reseller terindikasi double drop",
        detail: `${order.id} qty ${coverage.qty}, tapi ada ${coverage.activeCount} akun aktif tertaut. Perlu cek sebelum reseller lihat data ganda.`,
        createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
        resellerId: order.resellerId || "",
      });
    }
  }

  for (const [key, duplicateAccounts] of managedAccountDuplicateGroups(db).entries()) {
    const keeper = duplicateAccounts.slice().sort(compareManagedAccountPriority)[0];
    const resellerId = String(keeper?.resellerId || "").trim();
    issues.push({
      id: `reseller-managed-duplicate-${keeper?.id || key}`,
      severity: "high",
      kind: "reseller",
      title: "Manage Account reseller dobel untuk stok/order yang sama",
      detail: `${duplicateAccounts.length} record aktif menunjuk ${key}. Reseller bisa lihat akun ganda walau stok fisiknya satu.`,
      createdAt: keeper?.startedAt || keeper?.snapshotAt || "",
      accountId: keeper?.id || "",
      stockId: keeper?.stockId || "",
      orderId: keeper?.orderId || keeper?.sourceOrderId || "",
      href: operationLink({ accountId: keeper?.id || "" }),
      resellerId,
    });
  }

  const netflixByEmail = new Map();
  for (const account of activeAccounts) {
    if (isMalformedManagedAccount(account)) continue;
    if (!isNetflixManagedAccount(account)) continue;
    const emailKey = String(account.email || "").trim().toLowerCase();
    if (!emailKey) continue;
    const list = netflixByEmail.get(emailKey) || [];
    list.push(account);
    netflixByEmail.set(emailKey, list);
  }

  for (const [email, accounts] of netflixByEmail.entries()) {
    if (accounts.length < 2) continue;
    const passwords = [...new Set(accounts.map((account) => String(account.password || "").trim()).filter(Boolean))];
    if (passwords.length <= 1) continue;
    const keeper = accounts.slice().sort(compareManagedAccountPriority)[0];
    issues.push({
      id: `reseller-password-drift-${keeper?.id || email}`,
      severity: "high",
      kind: "reseller",
      title: "Password akun Netflix tidak konsisten untuk email yang sama",
      detail: `${email} dipakai di ${accounts.length} slot aktif dengan ${passwords.length} password berbeda. Ini biasanya drift dari Sheets atau password account berubah sebagian.`,
      createdAt: keeper?.startedAt || keeper?.snapshotAt || "",
      accountId: keeper?.id || "",
      stockId: keeper?.stockId || "",
      orderId: keeper?.orderId || keeper?.sourceOrderId || "",
      href: operationLink({ accountId: keeper?.id || "" }),
      resellerId: keeper?.resellerId || "",
    });
  }

  const sorted = issues.sort(compareQueueItems);
  return {
    summary: {
      total: sorted.length,
      high: sorted.filter((item) => item.severity === "high").length,
      medium: sorted.filter((item) => item.severity === "medium").length,
      missingOwner: sorted.filter((item) => item.id.startsWith("reseller-owner-missing-")).length,
      legacyLinkOwnerless: sorted.filter((item) => item.id.startsWith("reseller-link-owner-missing-")).length,
      orderMissingAccounts: sorted.filter((item) => item.id.startsWith("reseller-order-missing-accounts-")).length,
      duplicateDrops: sorted.filter((item) => item.id.startsWith("reseller-order-duplicate-")).length,
      managedDuplicates: sorted.filter((item) => item.id.startsWith("reseller-managed-duplicate-")).length,
    },
    items: sorted.slice(0, 50),
  };
}

async function buildWhatsAppHealth(db) {
  const [status, rentals] = await Promise.all([
    getWhatsAppBotStatus(db),
    mergedWhatsappRentals(db, { includeExpired: true }),
  ]);
  const recentMessages = (db.whatsappMessages || [])
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      direction: item.direction || "unknown",
      from: item.from || "",
      to: item.to || "",
      body: truncText(item.body, 220),
      createdAt: item.createdAt || "",
    }));

  const silentGroups = rentals
    .filter((item) => item.status === "active")
    .map((item) => {
      const reasons = [];
      if (!String(item.groupJid || "").trim().endsWith("@g.us")) reasons.push("JID grup belum tersinkron");
      if (item.joinStatus !== "joined") reasons.push(item.joinError ? `Join error: ${item.joinError}` : "Bot belum benar-benar join");
      if (Number(item.listCount || 0) <= 0) reasons.push("List grup masih kosong");
      return {
        id: item.id,
        groupId: item.id,
        name: item.name || item.groupJid || item.id,
        groupJid: item.groupJid || "",
        daysLeft: Number(item.daysLeft || 0),
        joinStatus: item.joinStatus || "",
        joinError: item.joinError || "",
        listCount: Number(item.listCount || 0),
        severity: reasons.length >= 2 ? "high" : reasons.length ? "medium" : "low",
        reason: reasons.join(". "),
        href: operationLink({ groupId: item.id }),
      };
    })
    .filter((item) => item.reason)
    .sort(compareQueueItems);

  const recentFailures = [
    ...(db.orders || [])
      .filter((order) => order.whatsappNotificationStatus === "failed" || order.whatsappDeliveryStatus === "failed")
      .map((order) => ({
        id: `wa-fail-${order.id}`,
        title: `Notif WhatsApp gagal untuk ${order.id}`,
        detail: truncText(order.whatsappNotificationError || order.deliveryError || "Pengiriman WhatsApp gagal.", 220),
        createdAt: order.whatsappNotificationSentAt || order.fulfillmentSentAt || order.createdAt || "",
        severity: "high",
        href: operationLink({ orderId: order.id }),
      })),
    ...silentGroups.map((group) => ({
      id: `wa-group-${group.id}`,
      title: `Grup ${group.name} perlu dicek`,
      detail: group.reason,
      createdAt: "",
      severity: group.severity,
      href: group.href,
    })),
  ].sort(compareQueueItems).slice(0, 20);

  const last24h = Date.now() - 86400000;
  return {
    summary: {
      connected: Boolean(status.connected),
      recentInbound: recentMessages.filter((item) => item.direction === "inbound" && createdAtMs(item.createdAt) >= last24h).length,
      recentOutbound: recentMessages.filter((item) => item.direction === "outbound" && createdAtMs(item.createdAt) >= last24h).length,
      silentGroups: silentGroups.length,
      failures: recentFailures.length,
    },
    connection: {
      connected: Boolean(status.connected),
      state: status.state || "disconnected",
      error: status.error || status.last_error || "",
      publicQrUrl: status.publicQrUrl || "",
      ownerWhatsAppNumber: status.ownerWhatsAppNumber || "",
      lastReconnectAt: status.last_reconnect_at || status.lastReconnectAt || "",
      nextReconnectDelayMs: Number(status.next_reconnect_delay_ms || status.nextReconnectDelayMs || 0),
      lastDisconnectAt: status.last_disconnect_at || status.lastDisconnectAt || "",
      lastDisconnectReason: status.last_disconnect_reason || status.lastDisconnectReason || "",
      reconnectAttempts: Number(status.reconnect_attempts || status.reconnectAttempts || 0),
      warmingUp: Boolean(status.warming_up || status.warmingUp),
    },
    recentMessages,
    silentGroups: silentGroups.slice(0, 20),
    recentFailures,
  };
}

function buildManualQueue(db, reconcile, expiry, wallet, whatsappHealth, resellerHealth) {
  const items = [];

  for (const order of db.orders || []) {
    if (order.deliveryStatus === "failed") {
      items.push({
        id: `manual-order-failed-${order.id}`,
        severity: "high",
        kind: "order",
        title: `Delivery gagal: ${order.id}`,
        detail: truncText(order.deliveryError || `${orderDisplayName(order)} gagal terkirim.`, 220),
        createdAt: order.fulfillmentSentAt || order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
      continue;
    }
    if (order.qrisStatus === "paid" && !["sent", "stock_unavailable_deposit", "late_paid_deposit"].includes(String(order.deliveryStatus || "")) && order.orderStatus !== "completed") {
      items.push({
        id: `manual-order-paid-${order.id}`,
        severity: "high",
        kind: "order",
        title: `Order paid belum selesai: ${order.id}`,
        detail: `${orderDisplayName(order)} sudah paid tapi status delivery masih ${order.deliveryStatus || order.orderStatus || "-"}.`,
        createdAt: order.paidAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }
    if (order.deliveryStatus === "stock_unavailable_deposit" && !isCreditedStockUnavailableOrder(order)) {
      items.push({
        id: `manual-order-stockrace-${order.id}`,
        severity: "high",
        kind: "order",
        title: `Kredit saldo order ${order.id} belum terverifikasi`,
        detail: "Order ditandai stok habis, tetapi marker kredit saldo belum lengkap. Periksa ledger sebelum tindakan apa pun.",
        createdAt: order.stockRaceDepositCreditedAt || order.createdAt || "",
        orderId: order.id,
        href: operationLink({ orderId: order.id }),
      });
    }
  }

  for (const request of db.depositRequests || []) {
    if (String(request.status || "pending").toLowerCase() !== "pending") continue;
    items.push({
      id: `manual-deposit-${request.id}`,
      severity: "medium",
      kind: "deposit",
      title: `Deposit request menunggu review`,
      detail: `${request.resellerName || request.whatsapp || "Reseller"} meminta ${formatRupiah(Number(request.amount || 0))}.`,
      createdAt: request.createdAt || "",
      requestId: request.id,
      href: operationLink({ requestId: request.id }),
    });
  }

  for (const claim of db.warrantyClaims || []) {
    if (!claim.stockReviewTriggered) continue;
    const syncStatus = String(claim.stockReviewSyncStatus || "").toLowerCase();
    if (!["pending", "failed"].includes(syncStatus)) continue;
    items.push({
      id: `manual-warranty-review-${claim.id}`,
      severity: syncStatus === "failed" ? "high" : "medium",
      kind: "warranty_stock_review",
      title: `Stok ${syncStatus === "failed" ? "gagal ditandai" : "menunggu tanda"} DIPERIKSA`,
      detail: `${Number(claim.stockReviewProfileCount || 0)} profil pada akun login yang sama memiliki klaim. Stok tetap dikunci lokal sampai sinkronisasi Sheets selesai.`,
      createdAt: claim.stockReviewSyncUpdatedAt || claim.updatedAt || claim.createdAt || "",
      orderId: claim.orderId || "",
      accountId: claim.accountId || "",
      stockId: claim.stockId || "",
      href: "/owner-v2/warranty",
    });
  }

  /* This loop used to sit at the tail of `buildWalletLedger`, pushing onto a
     bare `items` that function never declared. `buildWalletLedger` returns a
     ledger -- credits, debits, balances -- and a queue item is neither, so the
     block was pasted into the wrong function by whoever added it. Because
     `warranty-service.js` sets `replacementSyncStatus` to "pending" on every
     manual replacement, the bug was not dormant: the first dealer whose
     warranty replacement awaited sync threw `ReferenceError: items is not
     defined`, which failed the whole Operations Center request and, in Phase
     6, the reseller's balance ledger too. Both call this function. It is here
     now, beside the other warranty queue loop, where `items` exists. */
  for (const claim of db.warrantyClaims || []) {
    const syncStatus = String(claim.replacementSyncStatus || "").toLowerCase();
    if (!["failed", "pending"].includes(syncStatus)) continue;
    items.push({
      id: `manual-warranty-sync-${claim.id}`,
      severity: syncStatus === "failed" ? "high" : "medium",
      kind: "warranty_sync",
      title: `Sinkronisasi penggantian garansi ${claim.id} ${syncStatus === "failed" ? "gagal" : "belum selesai"}`,
      detail: "Penggantian sudah dikunci di database. Buka Warranty Center dan coba sinkronisasi ulang tanpa memilih stok lain.",
      createdAt: claim.replacementSyncFailedAt || claim.replacementSyncStartedAt || claim.updatedAt || claim.createdAt || "",
      orderId: claim.orderId || "",
      accountId: claim.replacement?.newAccountId || claim.accountId || "",
      stockId: claim.replacement?.newStockId || "",
      href: "/owner-v2/warranty",
    });
  }

  for (const issue of reconcile.issues.filter((item) => item.severity === "high").slice(0, 10)) {
    items.push({
      id: `manual-reconcile-${issue.id}`,
      severity: issue.severity,
      kind: issue.kind,
      title: issue.title,
      detail: issue.detail,
      createdAt: issue.createdAt || "",
      href: issue.href || "/dashboard/operations",
      orderId: issue.orderId || "",
      accountId: issue.accountId || "",
      stockId: issue.stockId || "",
    });
  }

  for (const group of whatsappHealth.silentGroups.slice(0, 10)) {
    items.push({
      id: `manual-wa-${group.id}`,
      severity: group.severity || "medium",
      kind: "whatsapp",
      title: `Grup ${group.name} perlu sinkronisasi`,
      detail: group.reason,
      createdAt: "",
      groupId: group.id,
      href: group.href,
    });
  }

  for (const account of expiry.expiredActive.slice(0, 10)) {
    items.push({
      id: `manual-expiry-${account.accountId}`,
      severity: "high",
      kind: "expiry",
      title: `Akun expired belum dibersihkan`,
      detail: `${account.email || account.accountId} (${account.product} ${account.variant}) masih aktif di daftar.`,
      createdAt: account.expiresAt || "",
      accountId: account.accountId,
      href: account.href,
    });
  }

  for (const issue of (resellerHealth?.items || []).filter((item) => item.severity === "high").slice(0, 10)) {
    items.push({
      id: `manual-reseller-${issue.id}`,
      severity: issue.severity,
      kind: issue.kind,
      title: issue.title,
      detail: issue.detail,
      createdAt: issue.createdAt || "",
      href: issue.href || "/dashboard/operations",
      orderId: issue.orderId || "",
      accountId: issue.accountId || "",
      stockId: issue.stockId || "",
      resellerId: issue.resellerId || "",
    });
  }

  const sorted = items.sort(compareQueueItems).slice(0, 50);
  return {
    summary: {
      total: sorted.length,
      high: sorted.filter((item) => item.severity === "high").length,
      medium: sorted.filter((item) => item.severity === "medium").length,
      low: sorted.filter((item) => item.severity === "low").length,
      pendingDeposits: wallet.summary.pendingRequests,
    },
    items: sorted,
  };
}

let automatedSheetsAuditSnapshot = null;

async function buildOperationsAudit(db) {
  const deliveryAudit = buildDeliveryAuditQueue(db);
  const stockLocks = buildReservedStockQueue(db);
  const reconcile = buildReconcileReport(db);
  const expiry = buildExpiryQueue(db);
  const wallet = buildWalletLedger(db);
  const reseller = buildResellerHealthQueue(db);
  const sheetsAudit = buildSheetsRowAudit(db);
  const whatsapp = await buildWhatsAppHealth(db);
  const manual = buildManualQueue(db, reconcile, expiry, wallet, whatsapp, reseller);
  return {
    checkedAt: new Date().toISOString(),
    deliveryAudit,
    stockLocks,
    reconcile,
    expiry,
    wallet,
    reseller,
    sheetsAudit: {
      ...sheetsAudit,
      automatedCheckedAt: automatedSheetsAuditSnapshot?.checkedAt || "",
      automatedSummary: automatedSheetsAuditSnapshot?.summary || null,
    },
    whatsapp,
    manual,
  };
}

function scheduleKavyaRestart() {
  const command = process.env.KAVYA_RESTART_COMMAND || "pm2 restart kavya --update-env";
  const isWindows = process.platform === "win32";
  const child = spawn(isWindows ? "cmd.exe" : "sh", isWindows ? ["/c", command] : ["-lc", `sleep 1; ${command}`], {
    cwd: legacyRootDir,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

async function ensureRuntimeSettings() {
  const db = await readDb();
  const settingsMigration = createSettingsMigrationService({ nowText });
  const startupSettingsMigration = createSettingsStartupMigrationService({
    databasePath,
    fsApi: fs,
    makeId,
    migration: settingsMigration,
    now: () => new Date(),
    nowText,
  });
  const migrationResult = await startupSettingsMigration.run(db);
  let changed = false;
  if (migrationResult.changed) changed = true;
  db.settings = { ...(db.settings || {}) };
  const settings = db.settings;
  const setDefault = (key, value) => {
    if (settings[key]) return;
    const normalized = String(value || "").trim();
    if (!normalized) return;
    settings[key] = normalized;
    changed = true;
  };
  const setIfConfigured = (key, value) => {
    const normalized = normalizeConfiguredUrl(value);
    if (!normalized || settings[key] === normalized) return;
    settings[key] = normalized;
    changed = true;
  };

  const envPublicDomain = normalizeConfiguredUrl(process.env.PUBLIC_DOMAIN);
  const defaultPublicDomain = normalizeConfiguredUrl(
    firstConfigured(envPublicDomain, settings.publicDomain, settings.botPublicUrl, `http://${host}:${port}`),
  );
  const envCloudflaredToken = firstUsableSecret(process.env.CLOUDFLARED_TOKEN);

  if (envCloudflaredToken) {
    if (settings.cloudflareTunnelToken !== envCloudflaredToken) {
      settings.cloudflareTunnelToken = envCloudflaredToken;
      changed = true;
    }
  } else if (settings.cloudflareTunnelToken) {
    delete settings.cloudflareTunnelToken;
    changed = true;
  }

  setIfConfigured("publicDomain", envPublicDomain || defaultPublicDomain);
  setIfConfigured("botPublicUrl", normalizeConfiguredUrl(process.env.BOT_PUBLIC_URL) || defaultPublicDomain);
  const envOwnerUsername = firstConfigured(process.env.OWNER_USERNAME, process.env.OWNER_LOGIN_USERNAME);
  if (envOwnerUsername && settings.ownerUsername !== envOwnerUsername) {
    settings.ownerUsername = envOwnerUsername;
    changed = true;
  }
  const envOwnerEmail = firstConfigured(process.env.OWNER_EMAIL, process.env.OWNER_LOGIN_EMAIL);
  if (envOwnerEmail && settings.ownerEmail !== envOwnerEmail) {
    settings.ownerEmail = envOwnerEmail;
    changed = true;
  }
  const envOwnerPassword = firstUsableSecret(process.env.OWNER_PASSWORD, process.env.OWNER_LOGIN_PASSWORD);
  const storedOwnerPassword = firstUsableSecret(settings.ownerPassword);
  if (envOwnerPassword && !verifyPassword(envOwnerPassword, settings.ownerPasswordHash || "")) {
    settings.ownerPasswordHash = hashPassword(envOwnerPassword);
    delete settings.ownerPassword;
    changed = true;
  } else if (!settings.ownerPasswordHash && storedOwnerPassword && storedOwnerPassword !== "admin12345") {
    settings.ownerPasswordHash = hashPassword(storedOwnerPassword);
    delete settings.ownerPassword;
    changed = true;
  } else if (!settings.ownerPasswordHash && envOwnerPassword) {
    settings.ownerPasswordHash = hashPassword(envOwnerPassword);
    delete settings.ownerPassword;
    changed = true;
  } else if (settings.ownerPassword) {
    delete settings.ownerPassword;
    changed = true;
  }
  for (const reseller of db.resellers || []) {
    if (!reseller.passwordHash && reseller.password) {
      reseller.passwordHash = hashPassword(reseller.password);
      delete reseller.password;
      changed = true;
    } else if (reseller.passwordHash && reseller.password) {
      delete reseller.password;
      changed = true;
    }
  }
  setDefault("baileySessionId", process.env.WHATSAPP_BAILEY_SESSION_ID || "kavya-main");
  setDefault("baileyBotNumber", process.env.WHATSAPP_BOT_NUMBER || settings.ownerWhatsAppNumber || process.env.OWNER_WHATSAPP_NUMBER || "");
  setIfConfigured("whatsappBotPublicUrl", process.env.WHATSAPP_BOT_PUBLIC_URL || `${defaultPublicDomain}/whatsapp-bot`);
  setIfConfigured("baileyWebhookUrl", process.env.WHATSAPP_INBOUND_WEBHOOK_URL || `${defaultPublicDomain}/api/whatsapp/inbound`);
  setIfConfigured("baileyQrisGenerateUrl", `${defaultPublicDomain}/api/orders`);
  setIfConfigured("gmailRedirectUri", process.env.GMAIL_REDIRECT_URI || `${defaultPublicDomain}/api/gmail/oauth/callback`);
  setDefault("whatsappBotToken", firstUsableSecret(process.env.WHATSAPP_BOT_TOKEN) || randomSecret("wabot"));
  setDefault("whatsappInboundToken", firstUsableSecret(process.env.WHATSAPP_INBOUND_TOKEN) || randomSecret("wain"));
  setDefault("pakasirApiKey", firstUsableSecret(process.env.PAKASIR_API_KEY));
  setDefault("pakasirWebhookSecret", firstUsableSecret(process.env.PAKASIR_WEBHOOK_SECRET));
  setDefault("gmailClientSecret", firstUsableSecret(process.env.GMAIL_CLIENT_SECRET));

  if (!settings.managedAccountsBackfilledAt) {
    backfillManagedAccountsFromCompletedOrders(db);
    settings.managedAccountsBackfilledAt = nowText();
    changed = true;
  }

  if (!settings.managedAccountsFulfillmentBackfilledAt) {
    backfillManagedAccountsFromCompletedOrders(db);
    settings.managedAccountsFulfillmentBackfilledAt = nowText();
    changed = true;
  }

  if (!settings.managedAccountsPasswordBackfilledAt) {
    syncManagedAccountCredentialsFromOrders(db);
    syncNetflixManagedPasswordConsensus(db);
    settings.managedAccountsPasswordBackfilledAt = nowText();
    changed = true;
  }

  if (!settings.managedAccountsWhatsappBackfilledAt) {
    syncManagedAccountWhatsappFromOrders(db);
    settings.managedAccountsWhatsappBackfilledAt = nowText();
    changed = true;
  }

  if (!settings.managedAccountsThirtyDayBackfilledAt) {
    normalizeManagedAccountDurations(db);
    settings.managedAccountsThirtyDayBackfilledAt = nowText();
    changed = true;
  }

  if (reconcileGoogleSheetsStockOrderLinks(db)) {
    changed = true;
  }

  if (backfillManagedAccountsFromCompletedOrders(db)) {
    changed = true;
  }

  if (syncNetflixManagedPasswordConsensus(db)) {
    changed = true;
  }

  if (normalizeManagedAccountDurations(db)) {
    changed = true;
  }

  if (syncSoldStockMetadata(db)) {
    changed = true;
  }

  if (syncHistoricalStockConflicts(db)) {
    changed = true;
  }

  if (changed) {
    await writeDb(db);
  }
}

async function proxyWhatsAppBotRequest(req, res, next) {
  try {
    const db = await readDb();
    const botUrl = firstConfigured(process.env.WHATSAPP_BOT_URL, db.settings?.whatsappBotUrl, "http://127.0.0.1:4016");
    const incoming = new URL(req.originalUrl || req.url, "http://localhost");
    const upstream = new URL(botUrl);
    upstream.pathname = incoming.pathname.replace(/^\/whatsapp-bot/, "") || "/";
    upstream.search = "";

    const headers = {};
    if (req.get("accept")) headers.accept = req.get("accept");
    if (req.get("content-type")) headers["content-type"] = req.get("content-type");
    const botToken = firstUsableSecret(db.settings?.whatsappBotToken, process.env.WHATSAPP_BOT_TOKEN);
    if (!botToken) {
      const error = new Error("Token bot WhatsApp belum dikonfigurasi");
      error.status = 503;
      throw error;
    }
    headers.authorization = `Bearer ${botToken}`;

    const response = await fetch(upstream, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body || {}),
    });
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    next(error);
  }
}

registerSystemRoutes(app, {
  ensureDb,
  firstConfigured,
  getDbVersion,
  getPakasirCredentials,
  googleSheetsConfigured,
  googleSheetsSyncHealth,
  maintenanceMode,
  makeId,
  mergedWhatsappRentals,
  nowText,
  onDbChange,
  readActiveLegacyGroupLists,
  readLegacyGroupLists,
  readListUpdateAudit,
  readDb,
  readDbSnapshot,
  requireAuth,
  setMaintenanceMode,
  updateDb,
  warrantyWhatsAppNumber,
  rentalMirrorHealth: () => rentalMirror.health(),
});

registerAuthRoutes(app, {
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
});

registerSettingsRoutes(app, {
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
});

// The pure half of the public precheck: a snapshot in, a decision out. Shared
// by the read-only fast path in the route and by the locked refresh below, so
// the two cannot drift into answering different questions.
const catalogPrecheckHelpers = {
  availableStockCount,
  durationAllowedForVariant,
  getProduct,
  isVariantOrderable,
  normalizeDurationLabel,
  orderLockError,
  publicCatalog,
};

async function refreshCatalogStock(request) {
  return updateDb(async (db) => {
    const before = evaluateCatalogPrecheck(db, request, catalogPrecheckHelpers);
    if (!before.ok) throw before.error;

    await syncSheetsForProductOrThrow(db, before.product, "catalog_precheck", { force: true });

    // The sync can retire the product, take the lock, or move the count, so
    // the decision has to be made again against the refreshed data.
    const after = evaluateCatalogPrecheck(db, request, catalogPrecheckHelpers);
    if (!after.ok) throw after.error;

    return {
      ok: true,
      productId: after.productId,
      variantId: after.variantId,
      stockCount: after.stockCount,
      catalog: after.catalog,
    };
  });
}

registerCatalogRoutes(app, {
  activeResellerByWhatsapp,
  applyWaPriceSync,
  catalogPrecheckCooldownMs: GOOGLE_SHEETS_CATALOG_PRECHECK_COOLDOWN_MS,
  catalogPrecheckHelpers,
  findWaPriceSource,
  legacyRootDir,
  makeId,
  nowText,
  previewWaPriceSync,
  publicCatalog,
  readDb,
  readDbSnapshot,
  refreshCatalogStock,
  requireAuth,
  resellerRequiredMessage,
  updateDb,
});

function normalizeCode(value, fallback) {
  return String(value || fallback || "PRD").trim().toUpperCase().replace(/\s+/g, "-").slice(0, 24);
}

function normalizeCheckoutRequirementsInput(input = {}, fallback = {}) {
  const source = input && typeof input === "object" ? input : {};
  const previous = fallback && typeof fallback === "object" ? fallback : {};
  const field = String(source.customerField ?? source.field ?? previous.customerField ?? previous.field ?? "").trim().toLowerCase();
  const normalizedField = ["email", "device", "optional", "none"].includes(field) ? (field === "none" ? "optional" : field) : "";
  if (!normalizedField) return previous && Object.keys(previous).length ? previous : undefined;
  return {
    customerField: normalizedField,
    required: source.required === undefined ? previous.required !== undefined ? Boolean(previous.required) : normalizedField !== "optional" : Boolean(source.required),
    minItems: Math.max(1, Math.floor(Number(source.minItems ?? previous.minItems ?? 1))),
    label: String(source.label ?? source.customerLabel ?? previous.label ?? "").trim(),
    placeholder: String(source.placeholder ?? previous.placeholder ?? "").trim(),
    helper: String(source.helper ?? source.description ?? previous.helper ?? "").trim(),
  };
}

function normalizeMessageTemplatesInput(input = {}, fallback = {}) {
  const source = input && typeof input === "object" ? input : {};
  const previous = fallback && typeof fallback === "object" ? fallback : {};
  return {
    delivery: String(source.delivery ?? previous.delivery ?? "").trim(),
    warranty: String(source.warranty ?? previous.warranty ?? "").trim(),
  };
}

function normalizeCheckoutFieldsInput(input, fallback) {
  const source = Array.isArray(input) ? input : Array.isArray(fallback) ? fallback : null;
  if (!source) return undefined;
  return source.map((field) => normalizeCheckoutField(field)).filter(Boolean);
}

function normalizeOrderLockInput(input = undefined, fallback = {}) {
  const hasSource = input && typeof input === "object";
  const source = hasSource ? input : {};
  const previous = fallback && typeof fallback === "object" ? fallback : {};
  const enabled = hasSource
    ? Boolean(source.enabled ?? source.isLocked ?? previous.enabled ?? previous.isLocked ?? false)
    : Boolean(previous.enabled ?? previous.isLocked ?? false);
  return {
    enabled,
    reason: enabled ? String(source.reason ?? previous.reason ?? "").trim() : "",
    updatedAt: String(source.updatedAt ?? previous.updatedAt ?? "").trim(),
    updatedBy: String(source.updatedBy ?? previous.updatedBy ?? "").trim(),
    scope: String(source.scope ?? previous.scope ?? "").trim() || "",
  };
}

function activeOrderLock(product = {}, variant = null) {
  if (product?.orderLock?.enabled) {
    return {
      scope: "product",
      reason: String(product.orderLock.reason || "").trim(),
      updatedAt: String(product.orderLock.updatedAt || "").trim(),
      updatedBy: String(product.orderLock.updatedBy || "").trim(),
    };
  }
  if (variant?.orderLock?.enabled) {
    return {
      scope: "variant",
      reason: String(variant.orderLock.reason || "").trim(),
      updatedAt: String(variant.orderLock.updatedAt || "").trim(),
      updatedBy: String(variant.orderLock.updatedBy || "").trim(),
    };
  }
  return null;
}

function isOrderLocked(product = {}, variant = null) {
  return Boolean(activeOrderLock(product, variant));
}

function orderLockError(product = {}, variant = null) {
  const lock = activeOrderLock(product, variant);
  if (!lock) return null;
  const target = lock.scope === "variant"
    ? `${product?.name || "Produk"} ${variant?.name || ""}`.trim()
    : product?.name || "Produk";
  const reason = lock.reason ? ` Alasan: ${lock.reason}` : "";
  const error = new Error(`Order untuk ${target} sedang dikunci owner.${reason}`);
  error.status = 409;
  error.code = "order_locked";
  error.lock = lock;
  return error;
}

function normalizeProductInput(body, fallback = {}) {
  const code = normalizeCode(body.code, fallback.code || body.name || fallback.name);
  const variants = Array.isArray(body.variants) ? body.variants : fallback.variants || [];
  const productRequirements = normalizeCheckoutRequirementsInput(body.checkoutRequirements, fallback.checkoutRequirements);
  const productCheckoutFields = normalizeCheckoutFieldsInput(body.checkoutFields, fallback.checkoutFields);
  const messageTemplates = normalizeMessageTemplatesInput(body.messageTemplates, fallback.messageTemplates);
  const orderLock = normalizeOrderLockInput(body.orderLock, fallback.orderLock);

  return {
    name: String(body.name ?? fallback.name ?? "").trim(),
    description: String(body.description ?? fallback.description ?? "Produk baru.").trim(),
    category: String(body.category ?? fallback.category ?? "Custom").trim(),
    isActive: body.isActive === undefined ? fallback.isActive !== false : Boolean(body.isActive),
    isArchived: body.isArchived === undefined ? Boolean(fallback.isArchived) : Boolean(body.isArchived),
    archivedAt: body.archivedAt === undefined ? String(fallback.archivedAt || "") : String(body.archivedAt || "").trim(),
    resellerOnly: body.resellerOnly === undefined ? Boolean(fallback.resellerOnly) : Boolean(body.resellerOnly),
    needsProfile: body.needsProfile === undefined ? Boolean(fallback.needsProfile) : Boolean(body.needsProfile),
    needsPin: body.needsPin === undefined ? Boolean(fallback.needsPin) : Boolean(body.needsPin),
    ...(productRequirements ? { checkoutRequirements: productRequirements } : {}),
    ...(productCheckoutFields ? { checkoutFields: productCheckoutFields } : {}),
    messageTemplates,
    deliveryTemplate: String(body.deliveryTemplate ?? fallback.deliveryTemplate ?? ""),
    deliveryTemplateVersion: Math.max(0, Number(body.deliveryTemplateVersion ?? fallback.deliveryTemplateVersion ?? 0)),
    requiredDeliveryFields: Array.isArray(body.requiredDeliveryFields)
      ? body.requiredDeliveryFields
      : Array.isArray(fallback.requiredDeliveryFields)
        ? fallback.requiredDeliveryFields
        : [],
    deliveryTemplateUpdatedAt: String(body.deliveryTemplateUpdatedAt ?? fallback.deliveryTemplateUpdatedAt ?? ""),
    deliveryTemplateUpdatedBy: String(body.deliveryTemplateUpdatedBy ?? fallback.deliveryTemplateUpdatedBy ?? ""),
    orderLock,
    code,
    variants: variants.map((variant, index) => {
      const fallbackVariant = (fallback.variants || []).find((item) => item.id === variant.id || item.code === variant.code) || {};
      const variantCode = normalizeCode(variant.code, `${code}-${index + 1}`);
      const prices = Object.fromEntries(
        Object.entries(variant.prices || {})
          .map(([duration, amount]) => [duration, Number(amount)])
          .filter(([duration, amount]) => duration && Number.isFinite(amount)),
      );
      const snkMonthly = String(
        variant.snkMonthly ??
          variant.monthlySnk ??
          variant.snk ??
          fallbackVariant.snkMonthly ??
          fallbackVariant.monthlySnk ??
          fallbackVariant.snk ??
          "",
      ).trim();
      const snkDaily = String(
        variant.snkDaily ??
          variant.dailySnk ??
          fallbackVariant.snkDaily ??
          fallbackVariant.dailySnk ??
          "",
      ).trim();

      return {
        id: String(variant.id || variantCode.toLowerCase()),
        code: variantCode,
        name: String(variant.name || variantCode).trim(),
        description: String(variant.description || "").trim(),
        isActive: variant.isActive === undefined ? variant.isActive !== false : Boolean(variant.isActive),
        durationModes: normalizeDurationModes(variant.durationModes ?? fallbackVariant.durationModes),
        prices: Object.keys(prices).length ? prices : { "1 Bulan": 0 },
        snk: snkMonthly,
        snkMonthly,
        snkDaily,
        ...(normalizeCheckoutRequirementsInput(variant.checkoutRequirements, fallbackVariant.checkoutRequirements) ? {
          checkoutRequirements: normalizeCheckoutRequirementsInput(variant.checkoutRequirements, fallbackVariant.checkoutRequirements),
        } : {}),
        ...(normalizeCheckoutFieldsInput(variant.checkoutFields, fallbackVariant.checkoutFields) ? {
          checkoutFields: normalizeCheckoutFieldsInput(variant.checkoutFields, fallbackVariant.checkoutFields),
        } : {}),
        orderLock: normalizeOrderLockInput(variant.orderLock, fallbackVariant.orderLock),
        deliveryTemplate: String(variant.deliveryTemplate ?? fallbackVariant.deliveryTemplate ?? ""),
        deliveryTemplateVersion: Math.max(0, Number(
          variant.deliveryTemplateVersion
          ?? fallbackVariant.deliveryTemplateVersion
          ?? ((variant.deliveryTemplate ?? fallbackVariant.deliveryTemplate) ? 1 : 0),
        )),
        requiredDeliveryFields: Array.isArray(variant.requiredDeliveryFields)
          ? variant.requiredDeliveryFields
          : Array.isArray(fallbackVariant.requiredDeliveryFields)
            ? fallbackVariant.requiredDeliveryFields
            : [],
        deliveryTemplateUpdatedAt: String(variant.deliveryTemplateUpdatedAt ?? fallbackVariant.deliveryTemplateUpdatedAt ?? ""),
        deliveryTemplateUpdatedBy: String(variant.deliveryTemplateUpdatedBy ?? fallbackVariant.deliveryTemplateUpdatedBy ?? ""),
        warrantyTemplate: String(variant.warrantyTemplate ?? fallbackVariant.warrantyTemplate ?? "").trim(),
      };
    }),
  };
}

function productDependencySummary(db, product = {}) {
  const productId = product.id || "";
  const productName = String(product.name || "").trim().toLowerCase();
  const productCode = String(product.code || "").trim().toLowerCase();
  const productKeys = new Set([productId, productName, productCode].filter(Boolean));
  const productMatches = (value) => value && productKeys.has(String(value).trim().toLowerCase());
  const stock = (db.stock || []).filter((item) => item.productId === productId).length;
  const accounts = (db.managedAccounts || []).filter((account) => {
    return account.productId === productId || productMatches(account.product) || productMatches(account.productCode);
  }).length;
  const orders = (db.orders || []).filter((order) => {
    return order.productId === productId || productMatches(order.product) || productMatches(order.productCode);
  }).length;
  return {
    stock,
    accounts,
    orders,
    total: stock + accounts + orders,
  };
}

function productDependencyMessage(summary) {
  return [
    summary.stock ? `${summary.stock} stok` : "",
    summary.accounts ? `${summary.accounts} akun reseller` : "",
    summary.orders ? `${summary.orders} order` : "",
  ].filter(Boolean).join(", ");
}

registerProductAdminRoutes(app, {
  makeId,
  normalizeProductInput,
  nowText,
  productDependencyMessage,
  productDependencySummary,
  readDb,
  requireAuth,
  updateDb,
});

registerStockRoutes(app, {
  buildDailyStockAssignment,
  createdAtMs,
  getProduct,
  getVariant,
  isCanvaProduct,
  isGoogleSheetsBackedStock,
  linkPoolAvailableCount,
  makeId,
  normalizeWhatsappNumber,
  notifyResellerAccountChanged,
  nowText,
  ownerProfile,
  pushAccountsToGoogleSheets,
  readDb,
  requireAuth,
  syncCredentialsToSheetsSafely,
  syncPasswordByEmail,
  todayText,
  updateDb,
});



registerSheetsRoutes(app, {
  buildSheetsSyncPreview,
  cloneForPreview,
  enableMaintenanceMode,
  ensureGoogleSheetsTemplate,
  ensureNetflixSheetsTemplate,
  friendlyGoogleSheetsError,
  googleSheetsConfigured,
  googleSheetsPublicSettings,
  googleSheetsRequiredSectionsError,
  googleSheetsSyncHealth,
  previewAccountSheetMapping,
  readDb,
  requireAuth,
  syncGoogleSheetsStockSafely,
  syncDataResellersToGoogleSheets,
  updateDb,
});

function cloneForPreview(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function statusOfAccount(account = {}) {
  return String(account.status || accountStatusFromDate(account.expiresAt, account.durationDays)).toLowerCase();
}

function collectSyncWarnings(result = {}) {
  const warnings = [];
  const visit = (value, pathLabel = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.warnings)) {
      for (const warning of value.warnings) {
        const text = String(warning || "").trim();
        if (text) warnings.push(pathLabel ? `${pathLabel}: ${text}` : text);
      }
    }
    const errorText = String(value.error || value.reason || "").trim();
    if (value.ok === false && errorText) warnings.push(pathLabel ? `${pathLabel}: ${errorText}` : errorText);
    for (const [key, child] of Object.entries(value)) {
      if (!child || typeof child !== "object") continue;
      if (key === "warnings") continue;
      visit(child, pathLabel ? `${pathLabel}.${key}` : key);
    }
  };
  visit(result);
  return [...new Set(warnings)].slice(0, 80);
}

function buildSheetsSyncPreview(beforeDb, afterDb, syncResult = {}) {
  const beforeStock = new Map((beforeDb.stock || []).map((item) => [item.id, item]));
  const afterStock = new Map((afterDb.stock || []).map((item) => [item.id, item]));
  const beforeAccounts = new Map((beforeDb.managedAccounts || []).map((item) => [item.id, item]));
  const afterAccounts = new Map((afterDb.managedAccounts || []).map((item) => [item.id, item]));
  let addStock = 0;
  let soldStock = 0;
  let availableStock = 0;
  let removedStock = 0;
  let expiredAccounts = 0;
  const changes = [];

  const describeStock = (item = {}) => ({
    stockId: item.id || "",
    sheetName: item.sheetName || "",
    sheetRow: Number(item.sheetRow || 0),
    identity: item.loginPhone || item.email || item.profile || item.id || "-",
    profile: item.profile || "",
  });
  const addChange = (item, type, fields = []) => {
    changes.push({ ...describeStock(item), type, fields });
  };

  for (const [id, next] of afterStock.entries()) {
    const previous = beforeStock.get(id);
    if (!previous) {
      addStock += 1;
      addChange(next, "added", ["baris baru"]);
      continue;
    }
    const changedFields = [
      ["status", previous.status, next.status],
      ["seller", previous.sheetSellerInput || previous.reseller, next.sheetSellerInput || next.reseller],
      ["tanggal", previous.soldAt, next.soldAt],
      ["durasi", previous.soldDuration, next.soldDuration],
      ["expiry", previous.soldExpiresAt || previous.expiresAt, next.soldExpiresAt || next.expiresAt],
      ["password/link", previous.password, next.password],
      ["profil", previous.profile, next.profile],
    ].filter(([, before, after]) => String(before || "") !== String(after || ""))
      .map(([field, before, after]) => `${field}: ${before || "-"} -> ${after || "-"}`);
    if (changedFields.length) addChange(next, "updated", changedFields);
    if (previous.status !== "sold" && next.status === "sold") soldStock += 1;
    if (previous.status !== "available" && next.status === "available") availableStock += 1;
    if (previous.status !== "removed" && next.status === "removed") removedStock += 1;
  }

  for (const [id, previous] of beforeStock.entries()) {
    if (!afterStock.has(id) && isGoogleSheetsBackedStock(previous)) addChange(previous, "removed", ["baris tidak ditemukan setelah sync"]);
  }

  for (const [id, next] of afterAccounts.entries()) {
    const previous = beforeAccounts.get(id);
    const previousStatus = previous ? statusOfAccount(previous) : "";
    const nextStatus = statusOfAccount(next);
    if ((!previous || !["expired", "replaced", "disabled"].includes(previousStatus)) && (nextStatus === "expired" || next.hidden)) {
      expiredAccounts += 1;
    }
  }

  return {
    addStock,
    soldStock,
    availableStock,
    removedStock,
    expiredAccounts,
    warnings: collectSyncWarnings(syncResult),
    changes: changes.slice(0, 150),
    rowAudit: buildSheetsRowAudit(afterDb),
    summary: syncResult,
  };
}



registerOrderRoutes(app, {
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
  readDbSnapshot,
  recordPublicTrackingAudit,
  refreshOrderDeliveryTemplateSnapshot,
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
});

registerResellerRoutes(app, {
  authReseller,
  buildWalletLedger,
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
  shouldEnablePakasirMaintenance,
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
});

function buildAccountAuditTrail(db, account = {}) {
  const orderId = String(account.orderId || account.sourceOrderId || "").trim();
  const stockId = String(account.stockId || "").trim();
  const order = (db.orders || []).find((item) => String(item.id || "").trim() === orderId) || null;
  const stock = (db.stock || []).find((item) => String(item.id || "").trim() === stockId) || null;
  const events = [];
  const add = (type, title, detail, createdAt, source = "system") => {
    if (!createdAt) return;
    events.push({ id: `${type}-${events.length}-${createdAt}`, type, title, detail, createdAt, source });
  };
  add("sheet", "Assignment terbaca dari Sheets", `${account.sheetName || stock?.sheetName || "-"} row ${account.sheetRow || stock?.sheetRow || "-"}; seller ${account.sheetSellerInput || stock?.sheetSellerInput || account.reseller || "-"}.`, account.startedAt || stock?.soldAt, "google_sheets");
  if (order) {
    add("order", "Order dibuat", `${order.id} - ${order.product || account.product || "-"} ${order.variant || account.variant || ""}.`, order.createdAt, "order");
    add("payment", "Pembayaran diterima", `${order.paymentMethod || "Pembayaran"}; status ${order.qrisStatus || "paid"}.`, order.paidAt, "payment");
    add("delivery", "Akun dikirim", `Stock ${stockId || "-"} tertaut ke order ${order.id}.`, order.fulfillmentSentAt || (order.deliveryStatus === "sent" ? order.paidAt : ""), "fulfillment");
  }
  for (const activity of db.activities || []) {
    const related = String(activity.accountId || "").trim() === String(account.id || "").trim()
      || (orderId && String(activity.orderId || "").trim() === orderId)
      || (stockId && String(activity.stockId || "").trim() === stockId);
    if (!related) continue;
    add("activity", activity.title || "Aktivitas", activity.description || "", activity.createdAt, activity.type || "activity");
  }
  add("current", "Snapshot saat ini", `${account.status || accountStatusFromDate(account.expiresAt, account.durationDays)}; ${account.duration || `${account.durationDays || 0} hari`}; expiry ${account.expiresAt || "-"}.`, account.updatedAt || account.googleSheetsSyncedAt || account.sheetLastSyncedAt || account.snapshotAt, "snapshot");
  return events
    .filter((event, index, list) => list.findIndex((candidate) => candidate.title === event.title && candidate.createdAt === event.createdAt && candidate.detail === event.detail) === index)
    .sort((left, right) => createdAtMs(right.createdAt) - createdAtMs(left.createdAt))
    .slice(0, 80);
}

registerAccountRoutes(app, {
  accessLookupLabel,
  accountChangeFields,
  accountStatusFromDate,
  appendAccessLookupActivity,
  authReseller,
  backfillManagedAccountsFromCompletedOrders,
  buildAccountAuditTrail,
  buildManagedAccountInput,
  canonicalResellerDisplayName,
  clearAccountsInGoogleSheets,
  createDeliveryTemplateSnapshot,
  findAccountForLookup,
  findDisneyAccountForLookup,
  gmailConnectionInfo,
  historicalAccountForLookup,
  historicalDisneyAccountForLookup,
  inactiveLookupResult,
  isDisneyManagedAccount,
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
  pushAccountsToGoogleSheets,
  readDbSnapshot,
  refreshManagedAccountStatuses,
  refreshResellerViewFromGoogleSheets,
  requireAuth,
  resellerAccessTools,
  resellerById,
  safeAccountForAccess,
  stockForManagedAccount,
  syncCredentialsToSheetsSafely,
  syncHistoricalStockConflicts,
  syncManagedAccountCredentialsFromOrders,
  syncManagedAccountWhatsappFromOrders,
  syncNetflixManagedPasswordConsensus,
  syncPasswordByEmail,
  syncSoldStockMetadata,
  updateDb,
  visibleManagedAccountsForAuth,
});

registerWarrantyRoutes(app, {
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
});

function archiveOldActivities(db, keepDays = 5) {
  const activities = Array.isArray(db.activities) ? db.activities : [];
  if (!activities.length) return false;
  const cutoff = Date.now() - Math.max(1, Number(keepDays || 5)) * 86400000;
  const active = [];
  const archived = [];
  for (const activity of activities) {
    const date = toDateTime(activity.createdAt);
    if (date && date.getTime() < cutoff) archived.push({ ...activity, archivedAt: nowText() });
    else active.push(activity);
  }
  if (!archived.length) return false;
  db.activities = active;
  db.archivedActivities = [...archived, ...(db.archivedActivities || [])].slice(0, 5000);
  return true;
}

const readMaintenanceService = createReadMaintenanceService({
  archiveOldActivities,
  expirePendingOrders,
  hasExpiredPendingOrders,
  readDbSnapshot,
  updateDb,
});

const operationsRepairService = createOperationsRepairService({
  makeId,
  nowText,
  reconcileGoogleSheetsStockOrderLinks,
  refreshManagedAccountStatuses,
  repairHistoricalStockReuse,
  repairManagedAccountOwnership,
  snapshotVersion,
  syncGoogleSheetsStockSafely,
  syncHistoricalStockConflicts,
  syncManagedAccountWhatsappFromOrders,
  syncSoldStockMetadata,
});

registerOperationsRoutes(app, {
  activityBelongsToReseller,
  applyOperationsAction: operationsRepairService.apply,
  buildOperationsAudit,
  buildOwnerSearch,
  buildSystemStatus,
  previewOperationsAction: operationsRepairService.preview,
  readDb,
  readDbSnapshot,
  requireAuth,
  scheduleKavyaRestart,
  snapshotVersion,
  updateDb,
});

registerWhatsAppRoutes(app, {
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
  syncGroupsThroughBot,
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
});

registerPaymentRoutes(app, {
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
});

app.use("/whatsapp-bot", requireAuth(["owner"]), proxyWhatsAppBotRequest);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan" });
});

app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.path === "/order-tracking") res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.sendFile(path.join(distDir, "index.html"), (error) => {
    if (error) next();
  });
});

app.use(async (error, req, res, _next) => {
  if (error?.maintenance?.reason) {
    await updateDb((db) => {
      if (error.maintenance.source !== "google_sheets" || !isGoogleSheetsQuotaError(error.maintenance.reason || "")) {
        enableMaintenanceMode(db, error.maintenance.reason, error.maintenance.source || "system");
      }
      return null;
    }).catch(() => undefined);
  }
  const status = error.status || 500;
  if (status === 429 && error.retryAfterSeconds) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterSeconds))));
  }
  console.error({ event: "http_error", requestId: req.requestId, status, error });
  res.status(status).json({ error: status >= 500 ? "Server error. Hubungi owner dengan nomor referensi ini." : error.message || "Server error", requestId: req.requestId });
});

await ensureDb();
await ensureRuntimeSettings();
authSecret();
app.listen(port, host, () => {
  console.log(`Kavya API running at http://${host}:${port}`);
  console.log(`Database: ${databasePath}`);
});

/**
 * Schedule one of the background jobs, or do not.
 *
 * This server is not a library you can start read-only. Starting it writes to
 * the real database, the real Google Sheets, and sends real WhatsApp messages:
 * the expiry job fires five seconds after boot, the payment sync at fifteen,
 * and the rest follow every thirty seconds to the hour. Running a second
 * instance next to the production one -- which is what a local `npm run dev`
 * used to do -- means two processes expiring the same pending orders, syncing
 * the same payments, and writing the same spreadsheet at once.
 *
 * So the jobs are opt-out rather than opt-in, and switching them off is a
 * single environment variable:
 *
 *   DISABLE_BACKGROUND_JOBS=1 npm run dev
 *
 * The API still serves every request, which is all a UI review needs. The one
 * thing it will not do is move on its own -- nothing expires, nothing syncs,
 * nothing messages anyone. Anything that changes state still has to be
 * requested by hand through the API, which is the point.
 */
const backgroundJobsDisabled = ["1", "true", "yes", "on"]
  .includes(String(process.env.DISABLE_BACKGROUND_JOBS || "").trim().toLowerCase());

const scheduledJobs = [];

/**
 * Run `job` once after `firstDelayMs`, then every `everyMs`.
 *
 * Named per job so a developer reading the startup log can see exactly which
 * ones are running, rather than inferring it from the absence of output.
 */
function scheduleJob(name, job, firstDelayMs, everyMs) {
  if (backgroundJobsDisabled) {
    scheduledJobs.push({ name, status: "skipped" });
    return;
  }
  setTimeout(job, firstDelayMs);
  setInterval(job, everyMs);
  scheduledJobs.push({ name, status: "scheduled" });
}

/**
 * Print what the schedule actually came to, once every job has declared itself.
 *
 * This runs after the last `scheduleJob` call on purpose. Announcing "jobs are
 * active" before they are registered would be a claim the log could not back up
 * -- a job added below, or a `scheduleJob` that returned early, would leave the
 * banner lying. The list is built from the same calls that armed the timers, so
 * it is the schedule rather than a summary of the schedule.
 */
function reportScheduledJobs() {
  const running = scheduledJobs.filter((entry) => entry.status === "scheduled").map((entry) => entry.name);
  const skipped = scheduledJobs.filter((entry) => entry.status === "skipped").map((entry) => entry.name);

  if (backgroundJobsDisabled) {
    console.warn(
      `[jobs] DISABLE_BACKGROUND_JOBS is set -- none of the ${scheduledJobs.length} background jobs will run. `
      + "The API serves requests, but nothing expires, syncs, or messages anyone on its own.",
    );
  } else {
    console.warn(
      `[jobs] Background jobs are ACTIVE -- this process writes to the database, writes to Google Sheets, `
      + `and sends WhatsApp messages: ${running.join(", ")}. Set DISABLE_BACKGROUND_JOBS=1 for a read-only run.`,
    );
  }

  // A job that declared itself and then did not arm a timer is a bug in
  // `scheduleJob`, and the one place it would be visible is this line.
  if (skipped.length > 0 && !backgroundJobsDisabled) {
    console.warn(`[jobs] ${skipped.length} job(s) declared but not scheduled: ${skipped.join(", ")}`);
  }
}

scheduleJob("rental-reminder", runRentalReminderJob, 10_000, 60 * 60 * 1000);

let googleSheetsStockSyncRunning = false;

async function runGoogleSheetsStockSyncJob() {
  if (googleSheetsStockSyncRunning) return;
  googleSheetsStockSyncRunning = true;
  try {
    const result = await updateDb(async (db) => {
      if (!googleSheetsConfigured(db)) return { skipped: true };
      return syncGoogleSheetsStockSafely(db, { silent: true, reason: "scheduled_sync" });
    });
    if (!result?.skipped) {
      await reportOperationalHealth({
        key: "google_sheets",
        label: "Google Sheets",
        ok: result?.ok !== false,
        detail: (result?.failedSections || []).join(", ") || "sinkronisasi tidak lengkap",
      });
    }
  } catch (error) {
    console.warn(`[GoogleSheets] sync skipped: ${error.message || error}`);
    await reportOperationalHealth({
      key: "google_sheets",
      label: "Google Sheets",
      ok: false,
      detail: error.message || "scheduled sync failed",
    });
  } finally {
    googleSheetsStockSyncRunning = false;
  }
}

scheduleJob("google-sheets-stock-sync", runGoogleSheetsStockSyncJob, 20_000, 3 * 60 * 1000);

async function runReadOnlySheetsAuditJob() {
  try {
    const db = await readDb();
    automatedSheetsAuditSnapshot = buildSheetsRowAudit(db);
  } catch (error) {
    console.warn(`[SheetsAudit] read-only audit skipped: ${error.message || error}`);
  }
}

scheduleJob("sheets-audit", runReadOnlySheetsAuditJob, 30_000, 10 * 60 * 1000);

let pakasirPaymentSyncRunning = false;

/**
 * How many payments one scheduled tick will ask the provider about.
 *
 * Shared by both passes in `runPakasirPaymentSyncJob` so a late arrival can
 * never crowd out a live payment: the live loop runs first and the recovery
 * loop only fills whatever budget is left.
 */
const PAKASIR_SYNC_CHECK_LIMIT = 8;

async function runPakasirPaymentSyncJob() {
  if (pakasirPaymentSyncRunning) return;
  pakasirPaymentSyncRunning = true;
  try {
    const recovered = await updateDb(async (db) => {
      const targets = [];
      const ordersByRef = new Map((db.orders || []).map((order) => [order.paymentRef, order]));
      const dueForCheck = (payment, order) => {
        const nextCheckAt = toDateTime(payment.nextPaymentCheckAt || order.nextPaymentCheckAt || "");
        return !(nextCheckAt && nextCheckAt.getTime() > Date.now());
      };
      // Live payments first, on the path that has always run. They get the
      // whole per-tick budget before a single late arrival is considered --
      // a payment that is about to clear must never be queued behind one that
      // has already missed its deadline.
      for (const payment of db.payments || []) {
        if (payment.provider !== "pakasir") continue;
        const order = ordersByRef.get(payment.ref);
        if (!order) continue;
        const orderStatus = String(order.orderStatus || "").toLowerCase();
        const deliveryStatus = String(order.deliveryStatus || "").toLowerCase();
        if (
          deliveryStatus === "sent"
          || ["completed", "fulfilled", "cancelled", "expired", "refunded", "failed", "failed_permanent"].includes(orderStatus)
        ) continue;
        const status = String(payment.status || order.qrisStatus || "").toLowerCase();
        if (!["pending", "created", "waiting_payment", ""].includes(status)) continue;
        if (!dueForCheck(payment, order)) continue;
        targets.push({ ref: payment.ref, allowLatePaymentRecovery: false });
        if (targets.length >= PAKASIR_SYNC_CHECK_LIMIT) break;
      }
      // Then the late arrivals: payments for orders cancelled within the
      // twenty-four hours that follow their own deadline (see
      // `late-payment-recovery.js`). Previously these were skipped outright,
      // which meant a payment landing after its own expiry survived only if the
      // Pakasir webhook happened to arrive. Both remaining recovery paths --
      // the webhook and the owner's manual reconcile -- are push-based, so a
      // lost webhook left the customer's money with the platform and nothing
      // anywhere recorded that it was ever owed.
      const seen = new Set(targets.map((target) => target.ref));
      for (const payment of db.payments || []) {
        if (payment.provider !== "pakasir" || seen.has(payment.ref)) continue;
        const order = ordersByRef.get(payment.ref);
        if (!order) continue;
        if (!isLatePaymentRecoveryCandidate(payment, order, { now: Date.now(), toDateTime })) continue;
        if (!dueForCheck(payment, order)) continue;
        targets.push({ ref: payment.ref, allowLatePaymentRecovery: true });
        if (targets.length >= PAKASIR_SYNC_CHECK_LIMIT) break;
      }
      for (const target of targets) {
        await reconcilePakasirPaymentInDb(db, target.ref, {
          throttleMs: 15_000,
          source: "scheduled_pakasir_sync",
          allowLatePaymentRecovery: target.allowLatePaymentRecovery,
        });
      }
      return {
        checked: targets.length,
        // Counted as selected, not as recovered: most of these are expired
        // orders that never get paid, and calling that a recovery would put a
        // number on the health card the code cannot actually support.
        lateChecked: targets.filter((target) => target.allowLatePaymentRecovery).length,
      };
    });
    await reportOperationalHealth({
      key: "pakasir_sync",
      label: "Pemeriksaan pembayaran",
      ok: true,
      // Reported so late-payment watching is visible rather than invisible.
      // Without it, the fact that a recovery pass runs at all -- and that it is
      // still looking at an order from three hours ago -- is guesswork.
      detail: recovered.lateChecked > 0
        ? `${recovered.checked} diperiksa, ${recovered.lateChecked} lewat masa QRIS`
        : "",
    });
  } catch (error) {
    console.warn(`[Pakasir] payment sync skipped: ${error.message || error}`);
    await reportOperationalHealth({
      key: "pakasir_sync",
      label: "Pemeriksaan pembayaran",
      ok: false,
      detail: error.message || "payment sync failed",
    });
  } finally {
    pakasirPaymentSyncRunning = false;
  }
}

scheduleJob("pakasir-payment-sync", runPakasirPaymentSyncJob, 15_000, 30_000);

async function runExpiredOrderMaintenanceJob() {
  try {
    await readMaintenanceService.runExpiredOrders();
  } catch (error) {
    console.warn(`[OrderExpiry] maintenance skipped: ${error.message || error}`);
  }
}

/*
 * How long an activity stays in the live `activities` array.
 *
 * This was 5 days, chosen when the array was housekeeping for a noisy log and
 * nothing read it. Two things changed. The owner console and the dealer panel
 * both read this trail, and Phase 6 put money and stock-release records in it --
 * "this account went back on sale" is not something that stops being true after
 * a week. Archiving moves the row to `archivedActivities`, which still exists
 * and is still readable via `?scope=archived`, so nothing is deleted here; this
 * only decides what the default view shows.
 *
 * 30 days. `archivedActivities` is capped at 5000 entries, so the archive is
 * bounded regardless, and the live array stays small enough to read on every
 * request.
 */
const ACTIVITY_ARCHIVE_KEEP_DAYS = 30;

async function runActivityArchiveJob() {
  try {
    await readMaintenanceService.runActivityArchive({ keepDays: ACTIVITY_ARCHIVE_KEEP_DAYS });
  } catch (error) {
    console.warn(`[ActivityArchive] maintenance skipped: ${error.message || error}`);
  }
}

scheduleJob("expired-order-maintenance", runExpiredOrderMaintenanceJob, 5_000, 30_000);
scheduleJob("activity-archive", runActivityArchiveJob, 60_000, 60 * 60 * 1000);

let fulfillmentRepairRunning = false;

// How many times one order may be re-fulfilled before the job stops touching
// it. At the 45s interval below this is roughly an hour of retrying.
//
// The five ways fulfillment fails are all deterministic data problems -- a
// variant that no longer exists, a product template with fewer customer emails
// than the quantity bought, a reseller that was deleted. None of them is fixed
// by trying again, so an uncapped loop never converges: it re-runs the same
// failing lookup roughly 1,900 times a day, forever, and each pass re-enters
// the stock allocation path for stock that cannot be delivered. An hour is long
// enough to ride out a transient Sheets or network blip, and short enough that
// a genuinely broken order reaches the owner as a visible problem instead of
// silent background churn.
const FULFILLMENT_REPAIR_MAX_ATTEMPTS = 80;

async function runFulfillmentRepairJob() {
  if (fulfillmentRepairRunning) return;
  fulfillmentRepairRunning = true;
  try {
    await updateDb(async (db) => {
      const paidStatuses = new Set(["paid", "processing", "paid_after_expired", "paid_by_deposit"]);
      const notificationRetryCooldownMs = 2 * 60 * 1000;
      const candidates = (db.orders || [])
        .filter((order) => {
          if (!order || !order.id) return false;
          const deliveryStatus = String(order.deliveryStatus || "").toLowerCase();
          const orderStatus = String(order.orderStatus || "").toLowerCase();
          if (deliveryStatus === "stock_unavailable_deposit" || deliveryStatus === "late_paid_deposit") return false;
          if (String(order.orderType || order.type || "").toLowerCase() === "deposit_topup") return false;
          // Already given up on. Terminal, so it is never re-selected -- not even
          // by the notification branch below, which only ever runs for orders
          // that reached "sent".
          if (deliveryStatus === "abandoned") return false;
          const sentButNotifFailed = (
            (deliveryStatus === "sent" || orderStatus === "completed")
            && Boolean(order.fulfillmentText)
            && String(order.whatsappNotificationStatus || "").toLowerCase() !== "sent"
          );
          if (sentButNotifFailed) {
            const lastAttemptMs = Number(toDateTime(order.whatsappNotificationAttemptedAt || order.whatsappNotificationSentAt || "")?.getTime() || 0);
            return !lastAttemptMs || (Date.now() - lastAttemptMs) >= notificationRetryCooldownMs;
          }
          if (deliveryStatus === "sent") return false;
          if (deliveryStatus === "failed" && Number(order.fulfillmentRepairAttempts || 0) >= FULFILLMENT_REPAIR_MAX_ATTEMPTS) return false;
          if (paidStatuses.has(deliveryStatus)) return true;
          if (String(order.qrisStatus || "").toLowerCase() === "paid") return true;
          if (orderStatus === "paid") return true;
          return false;
        })
        .sort((a, b) => Number(toDateTime(b.paidAt || b.updatedAt || b.createdAt || b.orderAt)?.getTime() || 0) - Number(toDateTime(a.paidAt || a.updatedAt || a.createdAt || a.orderAt)?.getTime() || 0))
        .slice(0, 8);

      for (const order of candidates) {
        // Counted before the attempt, and only for orders that are genuinely
        // unsent. The WhatsApp-notification branch re-runs for orders that
        // already reached "sent" and only resends the message; counting those
        // here would abandon a delivered order over a notification problem,
        // which would be strictly worse than the notification never arriving.
        const unsent = String(order.deliveryStatus || "").toLowerCase() !== "sent" && String(order.orderStatus || "").toLowerCase() !== "completed";
        if (unsent) {
          order.fulfillmentRepairAttempts = Number(order.fulfillmentRepairAttempts || 0) + 1;
          order.fulfillmentRepairLastAttemptAt = nowText();
        }
        await fulfillPaidOrderAndNotify(db, order.id);
        // The attempt either succeeded or left a reason. If it used up the last
        // try and still failed, stop: mark it so no future pass selects it, and
        // keep the reason so the owner sees why on the queue row. `failed` alone
        // would let the filter re-pick it forever, which is what this cap exists
        // to prevent.
        const stillUnsent = String(order.deliveryStatus || "").toLowerCase() !== "sent";
        if (unsent && stillUnsent && Number(order.fulfillmentRepairAttempts || 0) >= FULFILLMENT_REPAIR_MAX_ATTEMPTS) {
          order.deliveryStatus = "abandoned";
          order.deliveryError = order.deliveryError || `Gagal terkirim setelah ${FULFILLMENT_REPAIR_MAX_ATTEMPTS} percobaan otomatis. Perbaiki penyebabnya lalu kirim ulang manual.`;
          order.abandonedAt = nowText();
          console.warn(`[Fulfillment] ${order.id} abandoned after ${FULFILLMENT_REPAIR_MAX_ATTEMPTS} attempts: ${order.deliveryError}`);
        }
      }
      return { checked: candidates.length };
    });
    await reportOperationalHealth({
      key: "fulfillment_repair",
      label: "Pemulihan fulfillment",
      ok: true,
    });
  } catch (error) {
    console.warn(`[Fulfillment] repair skipped: ${error.message || error}`);
    await reportOperationalHealth({
      key: "fulfillment_repair",
      label: "Pemulihan fulfillment",
      ok: false,
      detail: error.message || "fulfillment repair failed",
    });
  } finally {
    fulfillmentRepairRunning = false;
  }
}

scheduleJob("fulfillment-repair", runFulfillmentRepairJob, 20_000, 45_000);

let warrantyOverdueAlertRunning = false;

async function runWarrantyOverdueAlertJob() {
  if (warrantyOverdueAlertRunning) return;
  warrantyOverdueAlertRunning = true;
  try {
    const db = await readDbSnapshot();
    const nowMs = Date.now();
    const ownerUrl = joinPublicUrl(db, "/owner-v2/warranty", { fallback: localOrigin });
    const candidates = (db.warrantyClaims || [])
      .filter((claim) => ["submitted", "reviewing", "waiting_evidence"].includes(String(claim.status || "").toLowerCase()))
      .filter((claim) => !claim.overdueOwnerNotificationAt)
      .map((claim) => {
        const dueMs = Number(toDateTime(claim.reviewDueAt || "")?.getTime() || 0);
        const startedMs = Number(toDateTime(claim.holdStartedAt || claim.createdAt || "")?.getTime() || 0);
        return { claim, dueMs, startedMs };
      })
      .filter((item) => item.dueMs > 0 && item.dueMs <= nowMs)
      .sort((left, right) => left.dueMs - right.dueMs)
      .slice(0, 5);

    for (const item of candidates) {
      const elapsedMinutes = item.startedMs > 0 ? Math.max(0, Math.ceil((nowMs - item.startedMs) / 60000)) : 0;
      const claimForMessage = {
        ...item.claim,
        reviewElapsedMinutes: elapsedMinutes || item.claim.reviewElapsedMinutes || 0,
        reviewOverdue: true,
      };
      const delivery = await sendWhatsAppMessage(db, {
        to: warrantyWhatsAppNumber(db),
        text: buildWarrantyOverdueNotification(db, claimForMessage, { ownerUrl }),
      });
      await updateDb((currentDb) => {
        const current = (currentDb.warrantyClaims || []).find((claim) => claim.id === item.claim.id);
        if (!current) return null;
        current.reviewOverdue = true;
        current.reviewElapsedMinutes = claimForMessage.reviewElapsedMinutes;
        current.overdueOwnerNotificationAt = delivery.sent ? nowText() : "";
        current.overdueOwnerNotificationStatus = delivery.sent ? "sent" : "failed";
        current.overdueOwnerNotificationError = delivery.sent ? "" : String(delivery.reason || "whatsapp_delivery_failed").slice(0, 160);
        current.updatedAt = nowText();
        return current;
      });
    }
  } catch (error) {
    console.warn(`[Warranty] overdue alert skipped: ${error.message || error}`);
  } finally {
    warrantyOverdueAlertRunning = false;
  }
}

scheduleJob("warranty-overdue-alert", runWarrantyOverdueAlertJob, 90_000, 15 * 60 * 1000);

let whatsappHealthAlertRunning = false;

async function runWhatsAppHealthAlertJob() {
  if (whatsappHealthAlertRunning) return;
  whatsappHealthAlertRunning = true;
  try {
    const status = await getWhatsAppBotStatus(await readDb());
    await reportOperationalHealth({
      key: "whatsapp",
      label: "WhatsApp Bot",
      ok: status.connected === true && status.state === "open",
      detail: status.error || status.state || "disconnected",
    });
  } catch (error) {
    await reportOperationalHealth({
      key: "whatsapp",
      label: "WhatsApp Bot",
      ok: false,
      detail: error.message || "health check failed",
    });
  } finally {
    whatsappHealthAlertRunning = false;
  }
}

scheduleJob("whatsapp-health-alert", runWhatsAppHealthAlertJob, 45_000, 2 * 60 * 1000);

scheduleJob("rental-mirror-reconciliation", () => rentalMirror.reconcile().catch(() => undefined), 1000, 30_000);
reportScheduledJobs();
