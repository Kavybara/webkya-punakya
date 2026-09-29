/**
 * Catalog precheck — the unauthenticated "can I buy this?" probe behind the
 * public checkout.
 *
 * It is deliberately split in two so the expensive half can be skipped. The
 * decision itself (is the product live, is the variant orderable, is the
 * duration allowed) is a pure read of the database, but the endpoint used to
 * run it inside `updateDb`, so every unauthenticated probe — including probes
 * for products that do not exist — serialised and rewrote the whole database
 * file just to answer "no". Only the stock refresh needs the write lock, and
 * only when the data is actually stale.
 */

import { createAttemptLimiter } from "../lib/attempt-limiter.js";

export const CATALOG_PRECHECK_UNAVAILABLE_MESSAGE = "Produk atau varian tidak tersedia untuk order baru";

/**
 * The precheck is unauthenticated and runs ahead of every checkout, so it gets
 * the same per-client budget the tracking oracle has. The default is generous
 * compared to real use — a shopper makes a handful of prechecks per product —
 * because the endpoint also fans out to Google Sheets on a cold cache.
 */
export function createCatalogPrecheckLimiter(options = {}) {
  return createAttemptLimiter({
    maxAttempts: options.maxAttempts || process.env.CATALOG_PRECHECK_MAX_ATTEMPTS || 30,
    windowMs: options.windowMs || process.env.CATALOG_PRECHECK_WINDOW_MS || 5 * 60 * 1000,
    now: options.now,
  });
}

function rejection(message, { status = 409, db, publicCatalog }) {
  const error = new Error(message);
  error.status = status;
  error.catalog = publicCatalog(db, { includeEmpty: false });
  return error;
}

/**
 * Pure evaluation against one database snapshot. Returns either the inputs the
 * caller needs for a stock refresh, or an `error` carrying the catalog so the
 * client can re-render. Never touches storage.
 */
export function evaluateCatalogPrecheck(db, request = {}, helpers = {}) {
  const {
    availableStockCount,
    durationAllowedForVariant,
    getProduct,
    isVariantOrderable,
    normalizeDurationLabel,
    orderLockError,
    publicCatalog,
  } = helpers;

  const product = getProduct(db, request.productId);
  const variant = product?.variants?.find((item) => item.id === request.variantId) || null;
  if (!product || product.isArchived || product.isActive === false || !variant || !isVariantOrderable(product, variant)) {
    return { ok: false, error: rejection(CATALOG_PRECHECK_UNAVAILABLE_MESSAGE, { db, publicCatalog }) };
  }

  const lockError = orderLockError(product, variant);
  if (lockError) {
    lockError.catalog = publicCatalog(db, { includeEmpty: false });
    return { ok: false, error: lockError };
  }

  const duration = normalizeDurationLabel(request.duration || "", variant);
  if (!durationAllowedForVariant(variant, duration)) {
    return {
      ok: false,
      error: rejection(`Durasi ${duration} sedang tidak aktif untuk ${variant.name}.`, { db, publicCatalog }),
    };
  }

  return {
    ok: true,
    product,
    variant,
    productId: product?.id || request.productId || "",
    variantId: variant?.id || request.variantId || "",
    stockCount: availableStockCount(db, product, variant),
    catalog: publicCatalog(db, { includeEmpty: false }),
  };
}

/**
 * A refresh has to run only when the product has no usable cached sync yet.
 * `syncSheetsForProductOrThrow` already answers this from
 * `settings.googleSheetsProductSyncCache` and returns a reused result, but
 * deciding it here is what lets the endpoint stay off the write path entirely
 * for a warm cache.
 */
export function catalogStockIsStale(db, product, cooldownMs) {
  const settings = db?.settings || {};
  const scope = String(product?.id || "").trim().toLowerCase();
  if (!scope) return false;

  const entries = Object.entries(settings.googleSheetsProductSyncCache || {});
  const syncedAt = entries
    .filter(([key]) => key.endsWith(`:${scope}`))
    .map(([, entry]) => Date.parse(String(entry?.syncedAt || "")))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  if (!syncedAt) return true;

  const ttl = Number(cooldownMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return true;
  const age = Date.now() - syncedAt;
  return !Number.isFinite(age) || age < 0 || age > ttl;
}
