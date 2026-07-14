const NETFLIX_SHARED_VARIANT_CODES = new Set(["NET-1P1U", "NET-SEMI"]);
const NETFLIX_SHARED_VARIANT_IDS = new Set(["net-1p1u", "net-semi-private"]);
const NETFLIX_2U_VARIANT_CODES = new Set(["NET-2U", "NET-2P1U", "NET-1P2U"]);
const NETFLIX_2U_VARIANT_IDS = new Set(["net-2u", "net-2p1u", "net-1p2u"]);
const NETFLIX_PRIVATE_VARIANT_CODES = new Set(["NET-PRIVATE", "NET-PRIV"]);
const NETFLIX_PRIVATE_VARIANT_IDS = new Set(["net-private", "net-priv"]);

const NETFLIX_VARIANT_ALIASES = new Map([
  ["1P1U", "shared"],
  ["1U", "shared"],
  ["NET1P1U", "shared"],
  ["NET-1P1U", "shared"],
  ["NET1U", "shared"],
  ["NET-1U", "shared"],
  ["NF1P1U", "shared"],
  ["NF-1P1U", "shared"],
  ["SEMI", "shared"],
  ["SEMIPRIV", "shared"],
  ["SEMIPRIVATE", "shared"],
  ["SEMI-PRIVATE", "shared"],
  ["NETSEMI", "shared"],
  ["NET-SEMI", "shared"],
  ["NETSEMIPRIV", "shared"],
  ["NET-SEMIPRIV", "shared"],
  ["2U", "2u"],
  ["2P1U", "2u"],
  ["1P2U", "2u"],
  ["NET2U", "2u"],
  ["NET-2U", "2u"],
  ["NET2P1U", "2u"],
  ["NET-2P1U", "2u"],
  ["NET1P2U", "2u"],
  ["NET-1P2U", "2u"],
  ["PRIV", "private"],
  ["PRIVATE", "private"],
  ["NETPRIV", "private"],
  ["NET-PRIV", "private"],
  ["NETPRIVATE", "private"],
  ["NET-PRIVATE", "private"],
]);

function normalized(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizedCode(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
}

function compactCode(value = "") {
  return normalizedCode(value).replace(/[^A-Z0-9]/g, "");
}

function isNetflixProduct(product = {}) {
  const text = [product.id, product.code, product.name, product.category].map(normalized).join(" ");
  return text.includes("netflix") || normalizedCode(product.code) === "NET";
}

export function isViuProduct(product = {}) {
  const text = [product.id, product.code, product.name, product.category].map(normalized).join(" ");
  return text.includes("viu") || normalizedCode(product.code) === "VIU";
}

export function isVidioProduct(product = {}) {
  const text = [product.id, product.code, product.name, product.category].map(normalized).join(" ");
  return text.includes("vidio") || normalizedCode(product.code) === "VIDIO";
}

export function isCanvaProduct(product = {}) {
  const text = [product.id, product.code, product.name, product.category].map(normalized).join(" ");
  return text.includes("canva") || normalizedCode(product.code) === "CANVA";
}

export function isCanvaVariant(product = {}, variant = {}) {
  if (!isCanvaProduct(product)) return false;
  if (!variant || variant.isActive === false) return false;
  return true;
}

export function isNetflixSharedVariant(product = {}, variant = {}) {
  if (!isNetflixProduct(product)) return false;
  const id = normalized(variant.id);
  const code = normalizedCode(variant.code);
  const name = normalized(variant.name);
  return NETFLIX_SHARED_VARIANT_IDS.has(id) || NETFLIX_SHARED_VARIANT_CODES.has(code) || name.includes("1p1u") || name.includes("semi");
}

export function isNetflixSemiPrivateVariant(product = {}, variant = {}) {
  if (!isNetflixProduct(product)) return false;
  const id = compactCode(variant.id);
  const code = compactCode(variant.code);
  const name = normalized(variant.name);
  return id.includes("SEMI") || code.includes("SEMI") || name.includes("semi");
}

export function isNetflixTwoUserVariant(product = {}, variant = {}) {
  if (!isNetflixProduct(product)) return false;
  const id = normalized(variant.id);
  const code = normalizedCode(variant.code);
  const name = normalized(variant.name);
  return NETFLIX_2U_VARIANT_IDS.has(id) || NETFLIX_2U_VARIANT_CODES.has(code) || /\b2u\b/.test(name) || name.includes("2p1u") || name.includes("1p2u");
}

export function isNetflixPrivateVariant(product = {}, variant = {}) {
  if (!isNetflixProduct(product)) return false;
  const id = normalized(variant.id);
  const code = normalizedCode(variant.code);
  const name = normalized(variant.name);
  return NETFLIX_PRIVATE_VARIANT_IDS.has(id) || NETFLIX_PRIVATE_VARIANT_CODES.has(code) || (name.includes("private") && !name.includes("semi"));
}

export function isViuVariant(product = {}, variant = {}) {
  return Boolean(isViuProduct(product) && variant && variant.isActive !== false);
}

function isVidioPlatinumVariant(product = {}, variant = {}) {
  if (!isVidioProduct(product) || !variant || variant.isActive === false) return false;
  const text = [variant.id, variant.code, variant.name].map(normalized).join(" ");
  return text.includes("platinum");
}

export function isVidioPlatinumTvVariant(product = {}, variant = {}) {
  if (!isVidioPlatinumVariant(product, variant)) return false;
  const text = [variant.id, variant.code, variant.name].map(normalized).join(" ");
  return /\btv\b/.test(text);
}

export function isVidioPlatinumMobileVariant(product = {}, variant = {}) {
  if (!isVidioPlatinumVariant(product, variant)) return false;
  const text = [variant.id, variant.code, variant.name].map(normalized).join(" ");
  return text.includes("mobile") || text.includes("hp") || text.includes("phone");
}

export function isVidioPlatinumAllDeviceVariant(product = {}, variant = {}) {
  if (!isVidioPlatinumVariant(product, variant)) return false;
  const text = [variant.id, variant.code, variant.name].map(normalized).join(" ");
  return text.includes("all") || text.includes("device") || text.includes("alldev");
}

export function isVariantOrderable(product = {}, variant = {}) {
  if (!product || !variant) return false;
  if (variant.isActive === false) return false;
  if (isNetflixPrivateVariant(product, variant)) return false;
  return true;
}

export function variantStockGroupKey(product = {}, variant = {}) {
  if (isNetflixSharedVariant(product, variant)) return `${product.id}::netflix-1p1u-semi`;
  if (isNetflixTwoUserVariant(product, variant)) return `${product.id}::netflix-2u`;
  if (isViuVariant(product, variant)) return `${product.id}::viu`;
  if (isVidioPlatinumTvVariant(product, variant)) return `${product.id}::vidio-platinum-tv`;
  if (isVidioPlatinumMobileVariant(product, variant)) return `${product.id}::vidio-platinum-mobile`;
  if (isVidioPlatinumAllDeviceVariant(product, variant)) return `${product.id}::vidio-platinum-all-device`;
  return `${product.id}::${variant.id}`;
}

function preferredNetflixVariant(product = {}, aliasType = "") {
  const variants = product?.variants || [];
  if (aliasType === "shared") {
    return variants.find((variant) => isNetflixSharedVariant(product, variant) && /semi/i.test(String(variant.name || variant.code || "")))
      || variants.find((variant) => isNetflixSharedVariant(product, variant));
  }
  if (aliasType === "2u") {
    return variants.find((variant) => isNetflixTwoUserVariant(product, variant));
  }
  return null;
}

function aliasTypeForCode(code = "") {
  const normalizedAlias = normalizedCode(code);
  return NETFLIX_VARIANT_ALIASES.get(normalizedAlias) || NETFLIX_VARIANT_ALIASES.get(compactCode(code)) || "";
}

export function resolveProductVariantByCode(db, code) {
  const wanted = normalizedCode(code);
  const compactWanted = compactCode(code);
  if (!wanted) return null;

  for (const product of db.products || []) {
    if (!isNetflixProduct(product)) continue;
    const aliasType = aliasTypeForCode(code);
    if (aliasType === "private") return null;
    const aliased = preferredNetflixVariant(product, aliasType);
    if (aliased && isVariantOrderable(product, aliased)) {
      return { product, variant: aliased };
    }
  }

  for (const product of db.products || []) {
    for (const variant of product.variants || []) {
      const variantCodes = [variant.code, variant.id, variant.name].map((value) => [normalizedCode(value), compactCode(value)]).flat();
      if (variantCodes.includes(wanted) || variantCodes.includes(compactWanted)) {
        if (!isVariantOrderable(product, variant)) return null;
        return { product, variant };
      }
    }
  }
  return null;
}

export function normalizeDurationLabel(duration = "", variant = {}) {
  const prices = variant?.prices || {};
  const labels = Object.keys(prices);
  if (!labels.length) return "1 Bulan";

  const source = String(duration || "").trim();
  if (!source) return labels[0];
  const lower = source.toLowerCase().replace(/\s+/g, " ");
  const exact = labels.find((label) => label.toLowerCase().replace(/\s+/g, " ") === lower);
  if (exact) return exact;

  const number = Number(source.match(/\d+/)?.[0] || 0);
  if (number > 0) {
    const unit = /tahun|year|yr/i.test(source) ? "tahun" : /\d+\s*(?:d|h)\b|hari|day/i.test(source) ? "hari" : "bulan";
    const match = labels.find((label) => {
      const labelNumber = Number(String(label).match(/\d+/)?.[0] || 0);
      const labelUnit = /tahun|year|yr/i.test(label) ? "tahun" : /hari|day|\d+\s*(?:d|h)\b/i.test(label) ? "hari" : "bulan";
      return labelNumber === number && labelUnit === unit;
    });
    if (match) return match;
  }

  const textMatch = labels.find((label) => lower && label.toLowerCase().includes(lower));
  return textMatch || labels[0];
}

export function normalizeDurationModes(modes = {}) {
  const source = modes && typeof modes === "object" ? modes : {};
  return {
    daily: source.daily !== false,
    monthly: source.monthly !== false,
  };
}

export function isDailyDurationLabel(duration = "") {
  const source = String(duration || "").trim().toLowerCase();
  return /\d+\s*(?:d|h)\b/.test(source) || source.includes("hari") || source.includes("day");
}

export function isMonthlyDurationLabel(duration = "") {
  const source = String(duration || "").trim().toLowerCase();
  return (
    source.includes("bulan") ||
    source.includes("month") ||
    source.includes("tahun") ||
    source.includes("year") ||
    source.includes("lifetime") ||
    /\d+\s*(?:b|y)\b/.test(source)
  );
}

export function durationAllowedForVariant(variant = {}, duration = "") {
  const modes = normalizeDurationModes(variant?.durationModes);
  if (isDailyDurationLabel(duration)) return modes.daily;
  if (isMonthlyDurationLabel(duration)) return modes.monthly;
  return true;
}

export function pricesAllowedForVariant(variant = {}) {
  const prices = variant?.prices || {};
  return Object.fromEntries(Object.entries(prices).filter(([duration, price]) => (
    durationAllowedForVariant(variant, duration)
    && Number(price || 0) > 0
  )));
}

export function priceForDuration(variant = {}, duration = "") {
  const label = normalizeDurationLabel(duration, variant);
  const prices = variant?.prices || {};
  return Number(prices[label] || Object.values(prices)[0] || 0);
}

export function subscriptionDurationDays(duration = "") {
  const source = String(duration || "").trim().toLowerCase();
  if (source.includes("lifetime")) return 3650;
  const amount = Math.max(1, Number(source.match(/\d+/)?.[0] || 1));
  if (source.includes("tahun") || source.includes("year")) return amount * 365;
  if (/\d+\s*(?:d|h)\b/.test(source) || source.includes("hari") || source.includes("day")) return amount;
  if (source.includes("jam") || source.includes("hour") || /\d+\s*hr\b/.test(source)) return Math.max(1, Math.ceil(amount / 24));
  return amount * 30;
}

export function stockMatchesVariant(db, stock, product, variant) {
  if (!stock || !product || !variant || stock.productId !== product.id) return false;
  const stockProduct = (db.products || []).find((item) => item.id === stock.productId) || product;
  const stockVariant = stockProduct?.variants?.find((item) => item.id === stock.variantId);
  if (!stockVariant) return stock.variantId === variant.id;
  return variantStockGroupKey(stockProduct, stockVariant) === variantStockGroupKey(product, variant);
}

export function canvaPool(db = {}) {
  const pool = db.canvaPool || db.settings?.canvaPool || {};
  const quota = Math.max(0, Math.floor(Number(pool.quota || 0)));
  return {
    id: String(pool.id || "CANVA-MAIN"),
    link: String(pool.link || pool.canvaLink || "").trim(),
    quota,
    status: String(pool.status || "active").toLowerCase(),
    notes: String(pool.notes || "").trim(),
    updatedAt: pool.updatedAt || "",
  };
}

export function canvaUsageAccounts(db = {}) {
  return (db.managedAccounts || []).filter((account) => {
    if (account.hidden || account.returnedToStockAt) return false;
    const productText = [account.productId, account.product, account.variantCode].map(normalized).join(" ");
    const isCanva = productText.includes("canva") || normalizedCode(account.variantCode) === "CANVA-MEMBER";
    if (!isCanva && account.accountType !== "canva_link" && account.source !== "canva_order") return false;
    const status = String(account.status || "active").toLowerCase();
    if (["expired", "replaced", "disabled"].includes(status)) return false;
    const expiresAt = String(account.expiresAt || "").trim();
    if (!expiresAt) return true;
    const date = new Date(expiresAt.replace(" ", "T"));
    return Number.isNaN(date.getTime()) || date.getTime() > Date.now();
  });
}

export function canvaUsedCount(db = {}) {
  return canvaUsageAccounts(db).length;
}

export function canvaAvailableCount(db = {}) {
  const pool = canvaPool(db);
  if (!pool.link || !["active", "aktif", "ready", "available"].includes(pool.status)) return 0;
  return Math.max(0, pool.quota - canvaUsedCount(db));
}

function isActiveLinkPoolStatus(value = "") {
  return ["active", "aktif", "ready", "available"].includes(String(value || "active").toLowerCase());
}

function activeLinkPoolAccounts(db = {}, pool = {}) {
  const poolId = String(pool.id || "");
  if (!poolId) return [];
  return (db.managedAccounts || []).filter((account) => {
    if (account.hidden || account.returnedToStockAt) return false;
    const accountPoolId = String(account.linkPoolId || account.canvaPoolId || "");
    if (accountPoolId !== poolId) return false;
    const status = String(account.status || "active").toLowerCase();
    if (["expired", "replaced", "disabled"].includes(status)) return false;
    const expiresAt = String(account.expiresAt || "").trim();
    if (!expiresAt) return true;
    const date = new Date(expiresAt.replace(" ", "T"));
    return Number.isNaN(date.getTime()) || date.getTime() > Date.now();
  });
}

export function linkPoolUsedCount(db = {}, pool = {}) {
  const explicit = Number(pool.used);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  return activeLinkPoolAccounts(db, pool).length;
}

export function linkPoolAvailableCount(db = {}, pool = {}) {
  const link = String(pool.link || pool.password || "").trim();
  if (!link || !isActiveLinkPoolStatus(pool.status)) return 0;
  const explicitAvailable = Number(pool.available);
  const quota = Math.max(0, Math.floor(Number(pool.quota || 0)));
  const computedAvailable = Math.max(0, quota - linkPoolUsedCount(db, pool));
  if (Number.isFinite(explicitAvailable) && explicitAvailable >= 0) {
    return Math.max(Math.floor(explicitAvailable), computedAvailable);
  }
  return computedAvailable;
}

export function linkPoolsForVariant(db = {}, product = {}, variant = {}) {
  if (!product || !variant) return [];
  const poolKey = variantStockGroupKey(product, variant);
  return (db.linkPools || [])
    .filter((pool) => {
      if (!pool || pool.productId !== product.id) return false;
      if (pool.variantId && pool.variantId !== variant.id) return false;
      if (pool.stockPoolKey && pool.stockPoolKey !== poolKey) return false;
      return linkPoolAvailableCount(db, pool) > 0;
    })
    .sort((a, b) => {
      const rowA = Number(a.sheetRow || a.rowNumber || 0);
      const rowB = Number(b.sheetRow || b.rowNumber || 0);
      if (rowA !== rowB) return rowA - rowB;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
}

export function isLinkPoolProduct(db = {}, product = {}, variant = null) {
  if (!product) return false;
  if (isCanvaProduct(product)) return true;
  return (db.linkPools || []).some((pool) => {
    if (pool.productId !== product.id) return false;
    return !variant || !pool.variantId || pool.variantId === variant.id || pool.stockPoolKey === variantStockGroupKey(product, variant);
  });
}

function linkPoolVirtualStock(db, product, variant, status) {
  const pools = linkPoolsForVariant(db, product, variant);
  if (!pools.length) return null;
  const rows = [];
  for (const pool of pools) {
    const available = linkPoolAvailableCount(db, pool);
    const sold = linkPoolUsedCount(db, pool);
    const count = status === "sold" ? sold : status === "reserved" ? 0 : available;
    for (let index = 0; index < count; index += 1) {
      rows.push({
        id: `link-slot-${pool.id}-${index + 1}`,
        productId: product.id,
        variantId: variant.id,
        email: "",
        password: pool.link,
        status: status || "available",
        stockType: "link_pool",
        linkPoolId: pool.id,
        sheetPool: pool.poolKey || pool.key || "",
        sheetPoolSchema: "link",
        sheetName: pool.sheetName || "",
        sheetRow: pool.sheetRow || 0,
      });
    }
  }
  return rows;
}

function canvaVirtualStock(db, product, variant, status) {
  if (!isCanvaProduct(product) || !isCanvaVariant(product, variant)) return null;
  const pool = canvaPool(db);
  const used = canvaUsedCount(db);
  const count = status === "sold" ? used : status === "reserved" ? 0 : canvaAvailableCount(db);
  return Array.from({ length: count }, (_, index) => ({
    id: `canva-slot-${index + 1}`,
    productId: product.id,
    variantId: variant.id,
    email: "",
    password: pool.link,
    status: status || "available",
    stockType: "canva_link_pool",
    canvaPoolId: pool.id,
  }));
}

export function stockForVariant(db, product, variant, status) {
  const linkRows = linkPoolVirtualStock(db, product, variant, status);
  if (linkRows) return linkRows;
  const canvaRows = canvaVirtualStock(db, product, variant, status);
  if (canvaRows) return canvaRows;
  return (db.stock || []).filter((stock) => {
    if (status && stock.status !== status) return false;
    const sheetAuthoritative = String(stock.sheetSource || "").toLowerCase() === "google_sheets"
      && !stock.sheetRemovedAt;
    if (status === "available" && !sheetAuthoritative && (stock.historyConflict || stock.autoBackfillBlocked)) return false;
    return stockMatchesVariant(db, stock, product, variant);
  });
}
