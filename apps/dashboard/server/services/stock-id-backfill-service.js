import crypto from "node:crypto";

export const BACKFILL_STATUSES = Object.freeze([
  "ALREADY_FILLED_VALID",
  "ALREADY_FILLED_CONFLICT",
  "ALREADY_FILLED_NOT_FOUND",
  "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW",
  "EXACT",
  "UNMATCHED",
  "AMBIGUOUS",
  "CONFLICT",
  "EMPTY_ROW",
  "SKIPPED",
]);

function text(value) {
  return String(value ?? "").trim();
}

function safeStockId(value) {
  const raw = text(value);
  return Boolean(
    raw
    && raw.length <= 160
    && !/[\r\n@]/.test(raw)
    && !/^https?:\/\//i.test(raw)
  );
}

function key(value) {
  return text(value).toLowerCase();
}

function poolKey(value) {
  return key(value).replace(/[^a-z0-9]+/g, "");
}

function same(left, right) {
  return Boolean(text(left) && text(right) && key(left) === key(right));
}

function compatible(left, right) {
  return !text(left) || !text(right) || same(left, right);
}

function maskIdentity(value = "") {
  const raw = text(value);
  if (!raw) return "";
  if (raw.includes("@")) {
    const [local, domain] = raw.split("@");
    return `${local.slice(0, 3)}***@${domain}`;
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      return `${new URL(raw).origin}/***`;
    } catch {
      return "***";
    }
  }
  if (/^\+?\d{8,}$/.test(raw.replace(/\s+/g, ""))) {
    const digits = raw.replace(/\D/g, "");
    return `${digits.slice(0, 4)}***${digits.slice(-3)}`;
  }
  return raw.length <= 5 ? `${raw.slice(0, 1)}***` : `${raw.slice(0, 3)}***${raw.slice(-2)}`;
}

function maskOrderId(value = "") {
  const raw = text(value);
  if (!raw) return "";
  return raw.length <= 10 ? `${raw.slice(0, 3)}***` : `${raw.slice(0, 8)}***${raw.slice(-4)}`;
}

export function stockIdBackfillRowFingerprint(row = {}) {
  const payload = {
    tab: key(row.sheetName || row.tab),
    pool: poolKey(row.pool || row.sheetPool),
    row: Number(row.rowNumber || row.sheetRow || row.row || 0),
    stockIdCell: text(row.stockIdCell).toUpperCase(),
    product: key(row.productId || row.productKey || row.product),
    account: key(row.account || row.email || row.loginIdentifier || row.loginPhone || row.license),
    profile: key(row.profile),
    link: text(row.link),
    orderId: key(row.orderId),
    seller: key(row.seller || row.reseller),
    accountCondition: key(row.accountCondition || row.condition),
    usageRow: Boolean(row.usageRow),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isRemoved(record = {}) {
  return Boolean(
    record.removed
    || record.deleted
    || record.sheetRemovedAt
    || ["removed", "deleted"].includes(key(record.status)),
  );
}

function rowIdentity(row = {}) {
  return [
    key(row.sheetName || row.tab),
    poolKey(row.pool || row.sheetPool),
    Number(row.rowNumber || row.sheetRow || 0),
  ].join("::");
}

function recordRowIdentity(record = {}) {
  return [
    key(record.sheetName || record.tab),
    poolKey(record.pool || record.sheetPool),
    Number(record.rowNumber || record.sheetRow || 0),
  ].join("::");
}

function identityPresent(row = {}) {
  return Boolean(text(row.account || row.email || row.loginIdentifier || row.loginPhone || row.link || row.license));
}

function rowPoolCompatible(row = {}, record = {}) {
  const rowPool = poolKey(row.pool || row.sheetPool);
  const recordPool = poolKey(record.pool || record.sheetPool || record.poolId);
  return !rowPool || !recordPool || rowPool === recordPool;
}

function rowProductCompatible(row = {}, record = {}) {
  const left = row.productId || row.productKey || row.product;
  const right = record.productId || record.productKey || record.product;
  return compatible(left, right);
}

function recordIdentityMatches(row = {}, record = {}) {
  const rowLink = text(row.link);
  const recordLink = text(record.link);
  if (rowLink || recordLink) return same(rowLink, recordLink);

  const rowAccount = row.account || row.email || row.loginIdentifier || row.loginPhone || row.license;
  const recordAccount = record.account || record.email || record.loginIdentifier || record.loginPhone || record.license;
  if (!same(rowAccount, recordAccount)) return false;

  const profileRequired = Boolean(row.profileRequired || record.profileRequired || text(row.profile) || text(record.profile));
  if (profileRequired && !same(row.profile, record.profile)) return false;
  return true;
}

function mergeRecord(target, source) {
  for (const field of [
    "productId", "productKey", "product", "pool", "sheetPool", "poolId",
    "sheetName", "sheetRow", "rowNumber", "sheetStockKey", "account", "email",
    "loginIdentifier", "loginPhone", "profile", "link", "license", "status",
  ]) {
    if (!text(target[field]) && text(source[field])) target[field] = source[field];
  }
  target.removed ||= isRemoved(source);
  for (const orderId of source.orderIds || []) {
    if (text(orderId)) target.orderIds.add(text(orderId));
  }
  if (text(source.orderId)) target.orderIds.add(text(source.orderId));
  if (text(source.sourceOrderId)) target.orderIds.add(text(source.sourceOrderId));
  for (const sourceName of source.sources || []) target.sources.add(sourceName);
  if (text(source.source)) target.sources.add(text(source.source));
}

export function buildStockIdRecords(db = {}) {
  const records = new Map();
  const ensure = (stockId, source = {}) => {
    const id = text(stockId);
    if (!safeStockId(id)) return null;
    if (!records.has(id)) {
      records.set(id, {
        stockId: id,
        orderIds: new Set(),
        sources: new Set(),
        removed: false,
      });
    }
    const record = records.get(id);
    mergeRecord(record, source);
    return record;
  };

  for (const stock of db.stock || []) {
    ensure(stock.id || stock.stockId, { ...stock, source: "stock" });
  }
  for (const pool of db.linkPools || []) {
    ensure(pool.id || pool.stockId, {
      ...pool,
      pool: pool.poolKey || pool.key,
      sheetPool: pool.poolKey || pool.key,
      link: pool.link,
      source: "link_pool",
    });
  }
  for (const account of db.managedAccounts || []) {
    const stockId = account.stockId || account.linkPoolId || account.canvaPoolId;
    ensure(stockId, {
      ...account,
      pool: account.sheetPool,
      account: account.email || account.loginIdentifier || account.loginPhone,
      source: "managed_account",
    });
  }
  for (const order of db.orders || []) {
    for (const stockId of order.deliveredStockIds || []) {
      ensure(stockId, {
        productId: order.productId,
        product: order.product,
        pool: order.stockGroupKey || order.sheetPool,
        orderId: order.id,
        source: "fulfillment",
      });
    }
  }

  return [...records.values()].map((record) => ({
    ...record,
    orderIds: [...record.orderIds].sort(),
    sources: [...record.sources].sort(),
  }));
}

function buildUnsafeStockIdRecords(db = {}) {
  const records = [];
  const add = (stockId, source = {}) => {
    const id = text(stockId);
    if (!id || safeStockId(id)) return;
    records.push({
      ...source,
      stockId: "[unsafe-stock-id]",
      removed: isRemoved(source),
    });
  };

  for (const stock of db.stock || []) {
    add(stock.id || stock.stockId, { ...stock, source: "stock" });
  }
  for (const pool of db.linkPools || []) {
    add(pool.id || pool.stockId, {
      ...pool,
      pool: pool.poolKey || pool.key,
      sheetPool: pool.poolKey || pool.key,
      link: pool.link,
      source: "link_pool",
    });
  }
  for (const account of db.managedAccounts || []) {
    add(account.stockId || account.linkPoolId || account.canvaPoolId, {
      ...account,
      pool: account.sheetPool,
      account: account.email || account.loginIdentifier || account.loginPhone,
      source: "managed_account",
    });
  }
  return records;
}

function classifyFilled(row, recordById, duplicateFilledIds) {
  const stockId = text(row.stockId);
  if (!safeStockId(stockId)) {
    return result(row, "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW", {
      stockId: "[unsafe-stock-id]",
      reason: "nilai pada sel STOCK ID bukan format Stock ID yang aman",
      manualReview: true,
    });
  }
  const record = recordById.get(stockId);
  if (!record) {
    return result(row, "ALREADY_FILLED_NOT_FOUND", {
      stockId,
      reason: "stockId pada Sheet tidak ditemukan di snapshot VPS",
    });
  }
  const conflicts = [];
  if (duplicateFilledIds.has(stockId)) conflicts.push("stockId dipakai lebih dari satu baris Sheet");
  if (!rowProductCompatible(row, record)) conflicts.push("produk Sheet dan VPS berbeda");
  if (!rowPoolCompatible(row, record)) conflicts.push("pool Sheet dan VPS berbeda");
  if (identityPresent(row) && !recordIdentityMatches(row, record)) conflicts.push("identitas account/profile/link berbeda");
  if (conflicts.length) {
    return result(row, "ALREADY_FILLED_CONFLICT", { stockId, reason: conflicts.join("; ") });
  }
  return result(row, "ALREADY_FILLED_VALID", {
    stockId,
    reason: "stockId terisi dan relasinya konsisten dengan snapshot VPS",
  });
}

function strictCandidates(row, records) {
  return records.filter((record) => (
    !isRemoved(record)
    && rowProductCompatible(row, record)
    && rowPoolCompatible(row, record)
  ));
}

function chooseEmptyRow(row, records, unsafeRecords, occupiedIds) {
  if (!identityPresent(row)) {
    return result(row, "EMPTY_ROW", { reason: "identitas utama stok kosong" });
  }
  const unsafeMatches = unsafeRecords.filter((record) => (
    !isRemoved(record)
    && rowProductCompatible(row, record)
    && rowPoolCompatible(row, record)
    && (
      (
        Number(row.rowNumber || row.sheetRow || 0) > 0
        && recordRowIdentity(record) === rowIdentity(row)
      )
      || recordIdentityMatches(row, record)
    )
  ));
  if (unsafeMatches.length) {
    return result(row, "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW", {
      reason: "baris terhubung ke record VPS dengan Stock ID legacy yang tidak valid",
      candidateCount: unsafeMatches.length,
      manualReview: true,
    });
  }
  const candidates = strictCandidates(row, records);
  const explicit = candidates.filter((record) => (
    Number(row.rowNumber || row.sheetRow || 0) > 0
    && recordRowIdentity(record) === rowIdentity(row)
  ));
  if (explicit.length) return finalizeCandidates(row, explicit, records, occupiedIds, "explicit sheet/tab/pool/row relation");

  const orderId = text(row.orderId);
  if (orderId) {
    const orderMatches = candidates.filter((record) => record.orderIds.some((id) => same(id, orderId)));
    if (orderMatches.length) return finalizeCandidates(row, orderMatches, records, occupiedIds, "unique exact Order ID relation");
  }

  const identityMatches = candidates.filter((record) => recordIdentityMatches(row, record));
  if (!identityMatches.length) {
    const crossPoolMatches = records.filter((record) => !isRemoved(record) && recordIdentityMatches(row, record));
    if (crossPoolMatches.length) {
      return result(row, "CONFLICT", {
        reason: "identitas ditemukan tetapi produk atau pool bertentangan",
        candidateCount: crossPoolMatches.length,
      });
    }
    return result(row, row.usageRow ? "SKIPPED" : "UNMATCHED", {
      reason: row.usageRow
        ? "usage row tidak memiliki relasi stockId eksplisit"
        : "tidak ada record VPS dengan identitas exact pada produk/pool yang sama",
    });
  }
  return finalizeCandidates(row, identityMatches, records, occupiedIds, "exact product + pool + account/profile/link");
}

function finalizeCandidates(row, candidates, allRecords, occupiedIds, source) {
  const unique = [...new Map(candidates.map((candidate) => [candidate.stockId, candidate])).values()];
  if (unique.length !== 1) {
    return result(row, "AMBIGUOUS", {
      reason: `${unique.length} kandidat VPS memenuhi relasi exact`,
      candidateCount: unique.length,
    });
  }
  const candidate = unique[0];
  if (identityPresent(row) && !recordIdentityMatches(row, candidate)) {
    return result(row, "CONFLICT", {
      stockId: candidate.stockId,
      reason: "relasi ditemukan tetapi account/profile/link bertentangan",
    });
  }
  if (occupiedIds.has(candidate.stockId)) {
    return result(row, "CONFLICT", {
      stockId: candidate.stockId,
      reason: "stockId kandidat sudah digunakan oleh baris Sheet lain",
    });
  }
  const rowOrderId = text(row.orderId);
  if (rowOrderId && candidate.orderIds.length && !candidate.orderIds.some((id) => same(id, rowOrderId))) {
    return result(row, "CONFLICT", {
      stockId: candidate.stockId,
      reason: "Order ID Sheet bertentangan dengan relasi order VPS",
    });
  }
  const sameIdRecords = allRecords.filter((record) => record.stockId === candidate.stockId);
  if (sameIdRecords.some((record) => isRemoved(record))) {
    return result(row, "CONFLICT", {
      stockId: candidate.stockId,
      reason: "record VPS terindikasi removed/deleted",
    });
  }
  return result(row, "EXACT", {
    stockId: candidate.stockId,
    reason: source,
    relationSource: candidate.sources.join(", "),
    confidence: "EXACT",
  });
}

function result(row, status, extra = {}) {
  const output = {
    status,
    tab: text(row.sheetName || row.tab),
    pool: text(row.pool || row.sheetPool),
    product: text(row.product || row.productKey || row.productId),
    row: Number(row.rowNumber || row.sheetRow || 0),
    stockIdCell: text(row.stockIdCell),
    account: maskIdentity(row.account || row.email || row.loginIdentifier || row.loginPhone || row.link || row.license),
    profile: text(row.profile),
    orderId: maskOrderId(row.orderId),
    rowFingerprint: stockIdBackfillRowFingerprint(row),
    ...extra,
  };
  if (output.stockId && !safeStockId(output.stockId)) output.stockId = "[unsafe-stock-id]";
  return output;
}

export function planStockIdBackfill({ db = {}, inventory = [] } = {}) {
  const records = buildStockIdRecords(db);
  const unsafeRecords = buildUnsafeStockIdRecords(db);
  const recordById = new Map(records.map((record) => [record.stockId, record]));
  const filledCounts = new Map();
  for (const row of inventory) {
    const id = text(row.stockId);
    if (id) filledCounts.set(id, (filledCounts.get(id) || 0) + 1);
  }
  const duplicateFilledIds = new Set([...filledCounts].filter(([, count]) => count > 1).map(([id]) => id));
  const occupiedIds = new Set([...filledCounts.keys()]);

  const rows = [];
  for (const row of inventory) {
    const item = text(row.stockId)
      ? classifyFilled(row, recordById, duplicateFilledIds)
      : chooseEmptyRow(row, records, unsafeRecords, occupiedIds);
    rows.push(item);
    if (item.status === "EXACT" && safeStockId(item.stockId)) occupiedIds.add(item.stockId);
  }
  const representedUnsafeRows = new Set(rows
    .filter((item) => item.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW")
    .map((item) => `${key(item.tab)}::${poolKey(item.pool)}::${Number(item.row || 0)}`));
  for (const record of unsafeRecords) {
    const identity = `${key(record.sheetName || record.tab)}::${poolKey(record.pool || record.sheetPool)}::${Number(record.rowNumber || record.sheetRow || 0)}`;
    if (representedUnsafeRows.has(identity)) continue;
    representedUnsafeRows.add(identity);
    rows.push(result(record, "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW", {
      reason: "metadata VPS mengarah ke Stock ID legacy yang tidak valid; kolom Sheet perlu diperiksa manual",
      manualReview: true,
    }));
  }
  rows.sort((left, right) => (
    left.tab.localeCompare(right.tab)
    || left.pool.localeCompare(right.pool)
    || left.row - right.row
    || left.status.localeCompare(right.status)
  ));

  const summaryByPool = new Map();
  for (const item of rows) {
    const summaryKey = `${item.tab}::${item.pool}`;
    if (!summaryByPool.has(summaryKey)) {
      summaryByPool.set(summaryKey, {
        tab: item.tab,
        pool: item.pool,
        checked: 0,
        alreadyFilledValid: 0,
        exact: 0,
        unmatched: 0,
        ambiguous: 0,
        conflict: 0,
        invalid: 0,
        empty: 0,
        skipped: 0,
      });
    }
    const summary = summaryByPool.get(summaryKey);
    summary.checked += 1;
    if (item.status === "ALREADY_FILLED_VALID") summary.alreadyFilledValid += 1;
    if (item.status === "EXACT") summary.exact += 1;
    if (item.status === "UNMATCHED" || item.status === "ALREADY_FILLED_NOT_FOUND") summary.unmatched += 1;
    if (item.status === "AMBIGUOUS") summary.ambiguous += 1;
    if (item.status.includes("CONFLICT")) summary.conflict += 1;
    if (item.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW") summary.invalid += 1;
    if (item.status === "EMPTY_ROW") summary.empty += 1;
    if (item.status === "SKIPPED") summary.skipped += 1;
  }

  const counts = Object.fromEntries(BACKFILL_STATUSES.map((status) => [
    status,
    rows.filter((row) => row.status === status).length,
  ]));
  return {
    mode: "dry-run",
    generatedAt: new Date().toISOString(),
    counts,
    summary: [...summaryByPool.values()].sort((a, b) => `${a.tab}:${a.pool}`.localeCompare(`${b.tab}:${b.pool}`)),
    rows,
    exact: rows.filter((row) => row.status === "EXACT"),
    digest: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

export function assertApplyAllowed(options = {}) {
  if (!options.apply) return "dry-run";
  if (!options.confirmProduction || options.confirmation !== "BACKFILL_STOCK_ID") {
    throw new Error("--apply memerlukan --confirm-production dan --confirmation=BACKFILL_STOCK_ID");
  }
  return "apply";
}

export const stockIdBackfillMasking = Object.freeze({ maskIdentity, maskOrderId });
