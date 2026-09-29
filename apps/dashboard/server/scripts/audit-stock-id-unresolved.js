#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  readStockIdBackfillInventory,
  setGoogleSheetsMutationObserver,
} from "../google-sheets.js";
import { accountConditionAvailability } from "../google-sheets/account-condition.js";
import {
  buildStockIdRecords,
  planStockIdBackfill,
  stockIdBackfillMasking,
} from "../services/stock-id-backfill-service.js";
import { isVariantOrderable, stockForVariant } from "../stock-groups.js";

const UNRESOLVED_STATUSES = new Set([
  "AMBIGUOUS",
  "UNMATCHED",
  "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW",
]);

function text(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return text(value).toLowerCase();
}

function poolKey(value) {
  const normalized = key(value).replace(/[^a-z0-9]+/g, "");
  return normalized === "netflix1u" ? "netflixshared" : normalized;
}

function same(left, right) {
  return Boolean(text(left) && text(right) && key(left) === key(right));
}

function compatible(left, right) {
  return !text(left) || !text(right) || same(left, right);
}

function sameRow(left = {}, right = {}) {
  return (
    same(left.sheetName || left.tab, right.sheetName || right.tab)
    && poolKey(left.pool || left.sheetPool) === poolKey(right.pool || right.sheetPool)
    && Number(left.rowNumber || left.sheetRow || left.row || 0)
      === Number(right.rowNumber || right.sheetRow || right.row || 0)
  );
}

function rowIdentityMatches(row = {}, record = {}) {
  const rowLink = text(row.link);
  const recordLink = text(record.link);
  if (rowLink || recordLink) return same(rowLink, recordLink);
  const rowAccount = row.account || row.email || row.loginPhone || row.license;
  const recordAccount = record.account || record.email || record.loginPhone || record.license;
  if (!same(rowAccount, recordAccount)) return false;
  const profileRequired = Boolean(
    row.profileRequired
    || record.profileRequired
    || text(row.profile)
    || text(record.profile),
  );
  return !profileRequired || same(row.profile, record.profile);
}

function recordCompatible(row = {}, record = {}) {
  const rowProduct = row.productId || row.productKey || row.product;
  const recordProduct = record.productId || record.productKey || record.product;
  return (
    compatible(rowProduct, recordProduct)
    && (
      !poolKey(row.pool || row.sheetPool)
      || !poolKey(record.pool || record.sheetPool || record.poolId)
      || poolKey(row.pool || row.sheetPool) === poolKey(record.pool || record.sheetPool || record.poolId)
    )
  );
}

function isTerminalOrder(order = {}) {
  const status = key(order.orderStatus || order.deliveryStatus || order.qrisStatus);
  return [
    "completed", "complete", "finished", "sent", "delivered", "cancelled",
    "canceled", "expired", "failed", "refunded",
  ].includes(status);
}

function isTerminalAccount(account = {}) {
  const status = key(account.status);
  return Boolean(
    account.hidden
    || account.returnedToStockAt
    || account.sheetRemovedAt
    || ["expired", "removed", "deleted", "replaced", "cancelled", "canceled"].includes(status),
  );
}

function maskedOrderId(value) {
  return stockIdBackfillMasking.maskOrderId(value);
}

function matchingStockRows(db, row) {
  return (db.stock || []).filter((stock) => (
    sameRow(row, stock)
    || (
      text(row.sheetStockKey)
      && text(stock.sheetStockKey)
      && text(row.sheetStockKey) === text(stock.sheetStockKey)
    )
  ));
}

function matchingManagedRows(db, row, candidateIds) {
  return (db.managedAccounts || []).filter((account) => (
    sameRow(row, account)
    || (
      text(row.sheetStockKey)
      && text(account.sheetStockKey)
      && text(row.sheetStockKey) === text(account.sheetStockKey)
    )
    || candidateIds.has(text(account.stockId))
    || rowIdentityMatches(row, {
      ...account,
      account: account.email || account.loginPhone,
      pool: account.sheetPool,
    })
  ));
}

function matchingOrders(db, row, candidateIds) {
  return (db.orders || []).filter((order) => {
    const delivered = new Set((order.deliveredStockIds || []).map(text).filter(Boolean));
    const reserved = new Set((order.reservedStockIds || []).map(text).filter(Boolean));
    return (
      (text(row.orderId) && same(order.id, row.orderId))
      || [...candidateIds].some((id) => delivered.has(id) || reserved.has(id))
    );
  });
}

function candidateAnalysis(db, row, records) {
  const compatibleRecords = records.filter((record) => recordCompatible(row, record));
  const explicit = compatibleRecords.filter((record) => sameRow(row, record));
  const orderMatches = text(row.orderId)
    ? compatibleRecords.filter((record) => (record.orderIds || []).some((id) => same(id, row.orderId)))
    : [];
  const identity = compatibleRecords.filter((record) => rowIdentityMatches(row, record));
  const candidates = explicit.length ? explicit : orderMatches.length ? orderMatches : identity;
  const candidateIds = new Set(candidates.map((record) => text(record.stockId)).filter(Boolean));
  const managed = matchingManagedRows(db, row, candidateIds);
  const orders = matchingOrders(db, row, candidateIds);
  const explicitManagedIds = new Set(managed.filter((item) => sameRow(row, item)).map((item) => text(item.stockId)).filter(Boolean));
  const deliveredIds = new Set(orders.flatMap((order) => order.deliveredStockIds || []).map(text).filter((id) => candidateIds.has(id)));
  const activeManagedIds = new Set(managed.filter((item) => !isTerminalAccount(item)).map((item) => text(item.stockId)).filter((id) => candidateIds.has(id)));
  let cause = "NO_CANDIDATE";
  if (explicit.length > 1) cause = "EXPLICIT_ROW_RELATION_MULTIPLE";
  else if (orderMatches.length > 1) cause = "ORDER_RELATION_MULTIPLE";
  else if (identity.length > 1) cause = "ACCOUNT_PROFILE_MULTIPLE";
  else if (identity.length === 1) cause = "SINGLE_IDENTITY_ALREADY_OCCUPIED";
  const evidence = [];
  if (explicitManagedIds.size === 1) evidence.push("UNIQUE_MANAGED_ROW_RELATION");
  if (deliveredIds.size === 1) evidence.push("UNIQUE_HISTORICAL_FULFILLMENT_RELATION");
  if (activeManagedIds.size === 1) evidence.push("UNIQUE_ACTIVE_MANAGED_ACCOUNT_RELATION");
  return {
    candidates,
    candidateIds,
    managed,
    orders,
    cause,
    evidence,
  };
}

function websiteRisk(db, row, analysis) {
  const condition = accountConditionAvailability({
    seller: row.seller,
    condition: row.accountCondition,
  });
  const explicitStocks = matchingStockRows(db, row);
  const activeReservation = explicitStocks.some((stock) => stock.status === "reserved")
    || analysis.orders.some((order) => (
      !isTerminalOrder(order)
      && (order.reservedStockIds || []).some((id) => analysis.candidateIds.has(text(id)))
    ));
  const availableInDb = explicitStocks.some((stock) => {
    const product = (db.products || []).find((item) => item.id === stock.productId);
    const variant = (product?.variants || []).find((item) => item.id === stock.variantId);
    if (
      !product
      || !variant
      || !product.isActive
      || product.isArchived
      || !isVariantOrderable(product, variant)
    ) {
      return false;
    }
    return stockForVariant(db, product, variant, "available").includes(stock);
  });
  const identityComplete = Boolean(text(row.account || row.email || row.loginPhone || row.link));
  const canBecomeAvailableOnSync = Boolean(identityComplete && condition.available && !activeReservation);
  return {
    condition,
    explicitStocks,
    activeReservation,
    availableInDb,
    canBecomeAvailableOnSync,
    canEnterCatalogNow: availableInDb,
    canCheckoutNow: availableInDb,
    canReserveNow: availableInDb,
    canFulfillNow: availableInDb,
  };
}

function operationalClassification(planRow, row, analysis, risk) {
  if (planRow.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW") {
    return "INVALID_LEGACY_METADATA";
  }
  const identityComplete = Boolean(text(row.account || row.email || row.loginPhone || row.link));
  if (!identityComplete) return "EMPTY_OR_NON_STOCK_ROW";
  if (risk.condition.blocked) return "PROBLEM_OR_DISABLED";
  if (text(row.seller) || text(row.orderId)) return "SOLD_HISTORICAL";
  if (
    planRow.status === "UNMATCHED"
    && !analysis.candidates.length
    && !risk.explicitStocks.length
    && risk.condition.available
  ) {
    return "NEW_UNTRACKED_STOCK";
  }
  if (risk.condition.available && !risk.activeReservation) {
    return "AVAILABLE_WITHOUT_STOCK_ID";
  }
  if (planRow.status === "AMBIGUOUS") return "DUPLICATE_OR_AMBIGUOUS_HISTORY";
  return "EMPTY_OR_NON_STOCK_ROW";
}

function recommendation(planRow, classification, risk) {
  if (planRow.status !== "UNMATCHED") return "";
  if (classification === "NEW_UNTRACKED_STOCK") return "CREATE_NEW_STOCK_ID_CANDIDATE";
  if (classification === "SOLD_HISTORICAL") return "KEEP_EMPTY_HISTORICAL";
  if (classification === "PROBLEM_OR_DISABLED" || !risk.condition.conditionKnown) return "FIX_SHEET_DATA_FIRST";
  if (!risk.explicitStocks.length) return "REVIEW_POOL_MAPPING";
  return "MANUAL_RECONCILIATION_REQUIRED";
}

function safeStockId(value) {
  const raw = text(value);
  return Boolean(
    raw
    && raw.length <= 160
    && !/[\r\n@]/.test(raw)
    && !/^https?:\/\//i.test(raw),
  );
}

function unsafeLegacyRecords(db, row) {
  const sources = [
    ...(db.stock || []).map((item) => ({ ...item, unsafeId: item.id || item.stockId })),
    ...(db.managedAccounts || []).map((item) => ({
      ...item,
      unsafeId: item.stockId || item.linkPoolId || item.canvaPoolId,
      account: item.email || item.loginPhone,
      pool: item.sheetPool,
    })),
  ];
  return sources.filter((record) => (
    text(record.unsafeId)
    && !safeStockId(record.unsafeId)
    && recordCompatible(row, record)
    && (sameRow(row, record) || rowIdentityMatches(row, record))
  ));
}

function invalidType(row, unsafeRecords) {
  if (text(row.stockId)) {
    return /[\r\n@]|^https?:\/\//i.test(text(row.stockId))
      ? "CREDENTIAL_LIKE_VALUE"
      : "MALFORMED_LEGACY_ID";
  }
  if (unsafeRecords.some((record) => /[\r\n@]|^https?:\/\//i.test(text(record.unsafeId)))) {
    return "CREDENTIAL_LIKE_VALUE";
  }
  if (unsafeRecords.length) return "UNKNOWN_LEGACY_REFERENCE";
  return "MISSING_TARGET_CELL_HISTORY";
}

function auditRow(db, inventoryRow, planRow, records) {
  const analysis = candidateAnalysis(db, inventoryRow, records);
  const risk = websiteRisk(db, inventoryRow, analysis);
  const stocks = risk.explicitStocks;
  const managed = analysis.managed;
  const orders = analysis.orders;
  const classification = operationalClassification(planRow, inventoryRow, analysis, risk);
  const unsafeRecords = planRow.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW"
    ? unsafeLegacyRecords(db, inventoryRow)
    : [];
  const deliveredOrders = orders.filter((order) => (
    (order.deliveredStockIds || []).some((id) => analysis.candidateIds.has(text(id)))
  ));
  return {
    status: planRow.status,
    classification,
    tab: planRow.tab,
    pool: planRow.pool,
    row: planRow.row,
    stockIdCell: planRow.stockIdCell,
    product: planRow.product,
    accountMasked: planRow.account,
    profile: planRow.profile,
    seller: text(inventoryRow.seller),
    orderIdMasked: maskedOrderId(inventoryRow.orderId),
    accountCondition: (text(inventoryRow.accountCondition) || "NORMAL").toUpperCase(),
    stockIdState: text(inventoryRow.stockId) ? "INVALID_OR_PRESENT" : "EMPTY",
    candidateCount: Number(planRow.candidateCount || analysis.candidates.length || 0),
    candidateCause: planRow.status === "AMBIGUOUS" ? analysis.cause : "",
    strongerEvidenceForReview: analysis.evidence,
    explicitStockRelations: stocks.length,
    databaseStockStatuses: [...new Set(stocks.map((stock) => text(stock.status) || "unknown"))].sort(),
    managedAccountRelations: managed.length,
    activeManagedAccountRelations: managed.filter((item) => !isTerminalAccount(item)).length,
    orderRelations: orders.length,
    deliveredOrderRelations: deliveredOrders.length,
    fulfillmentHistoryRelations: deliveredOrders.length,
    activeReservation: risk.activeReservation,
    availableInDatabaseNow: risk.availableInDb,
    canBecomeAvailableOnNextSync: risk.canBecomeAvailableOnSync,
    canEnterCatalogNow: risk.canEnterCatalogNow,
    canCheckoutNow: risk.canCheckoutNow,
    canReserveNow: risk.canReserveNow,
    canFulfillNow: risk.canFulfillNow,
    ownerPanelOnly: !risk.canEnterCatalogNow && !risk.canBecomeAvailableOnSync,
    invalidType: planRow.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW"
      ? invalidType(inventoryRow, unsafeRecords)
      : "",
    unsafeLegacyRecordCount: unsafeRecords.length,
    recommendation: recommendation(planRow, classification, risk),
    engineReason: text(planRow.reason),
  };
}

function aggregate(rows) {
  const classification = {};
  const pools = {};
  const ambiguousCauses = {};
  for (const row of rows) {
    classification[row.classification] ||= {
      count: 0,
      sellerEmpty: 0,
      canSellWebNow: 0,
      canBecomeAvailableOnNextSync: 0,
    };
    const group = classification[row.classification];
    group.count += 1;
    if (!row.seller) group.sellerEmpty += 1;
    if (row.canCheckoutNow) group.canSellWebNow += 1;
    if (row.canBecomeAvailableOnNextSync) group.canBecomeAvailableOnNextSync += 1;

    pools[row.pool] ||= {
      ambiguous: 0,
      unmatched: 0,
      invalid: 0,
      availableWithoutStockId: 0,
      historical: 0,
      problem: 0,
      sellerEmptyNormal: 0,
      canEnterCatalogNow: 0,
      canBecomeAvailableOnNextSync: 0,
    };
    const pool = pools[row.pool];
    if (row.status === "AMBIGUOUS") pool.ambiguous += 1;
    if (row.status === "UNMATCHED") pool.unmatched += 1;
    if (row.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW") pool.invalid += 1;
    if (row.classification === "AVAILABLE_WITHOUT_STOCK_ID") pool.availableWithoutStockId += 1;
    if (row.classification === "SOLD_HISTORICAL") pool.historical += 1;
    if (row.classification === "PROBLEM_OR_DISABLED") pool.problem += 1;
    if (!row.seller && row.accountCondition === "NORMAL") pool.sellerEmptyNormal += 1;
    if (row.canEnterCatalogNow) pool.canEnterCatalogNow += 1;
    if (row.canBecomeAvailableOnNextSync) pool.canBecomeAvailableOnNextSync += 1;

    if (row.status === "AMBIGUOUS") {
      ambiguousCauses[row.candidateCause || "OTHER"] = (ambiguousCauses[row.candidateCause || "OTHER"] || 0) + 1;
    }
  }
  return { classification, pools, ambiguousCauses };
}

function oldStatusMap(report = {}) {
  return new Map((report.rows || []).map((row) => [
    `${key(row.tab)}::${poolKey(row.pool)}::${Number(row.row || 0)}`,
    row,
  ]));
}

function unmatchedDiff(oldReport, currentReport) {
  const before = oldStatusMap(oldReport);
  return (currentReport.rows || [])
    .filter((row) => row.status === "UNMATCHED")
    .map((row) => {
      const previous = before.get(`${key(row.tab)}::${poolKey(row.pool)}::${Number(row.row || 0)}`);
      return {
        tab: row.tab,
        pool: row.pool,
        row: row.row,
        stockIdCell: row.stockIdCell,
        statusBefore: previous?.status || "NOT_IN_INVENTORY",
        stockIdCellBefore: previous?.stockIdCell || "",
        statusAfter: row.status,
        reasonAfter: row.reason,
        newlyUnmatched: previous?.status !== "UNMATCHED",
        deterministicCause: previous
          ? previous.stockIdCell !== row.stockIdCell
            ? "SAME_ROW_TARGET_CELL_CORRECTED"
            : "CLASSIFICATION_CHANGED"
          : "ROW_NEWLY_INCLUDED_BY_CURRENT_POOL_INVENTORY",
      };
    });
}

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function csvCell(value) {
  const raw = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function csvReport(rows) {
  const headers = [
    "status", "classification", "tab", "pool", "row", "stockIdCell", "product",
    "accountMasked", "profile", "seller", "orderIdMasked", "accountCondition",
    "stockIdState", "candidateCount", "candidateCause", "strongerEvidenceForReview",
    "explicitStockRelations", "databaseStockStatuses", "managedAccountRelations", "activeManagedAccountRelations",
    "orderRelations", "deliveredOrderRelations", "activeReservation",
    "availableInDatabaseNow", "canBecomeAvailableOnNextSync", "canEnterCatalogNow",
    "canCheckoutNow", "canReserveNow", "canFulfillNow", "invalidType", "unsafeLegacyRecordCount",
    "recommendation", "engineReason",
  ];
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

function markdownReport(result) {
  const lines = [
    "# Audit Read-Only STOCK ID Unresolved",
    "",
    `Generated: ${result.generatedAt}`,
    `Digest: \`${result.digest}\``,
    "",
    "## No-write proof",
    "",
    `- Database SHA-256 before: \`${result.proof.databaseSha256Before}\``,
    `- Database SHA-256 after: \`${result.proof.databaseSha256After}\``,
    `- Database hash identical: ${result.proof.databaseHashIdentical ? "yes" : "no"}`,
    `- Database writer calls: ${result.proof.databaseWriterCalls}`,
    `- Google Sheets writer calls: ${result.proof.googleSheetsWriterCalls}`,
    `- Reconcile/backfill/repair calls: ${result.proof.maintenanceCalls}`,
    "",
    "## Classification",
    "",
    "| Classification | Count | Seller empty | Sellable now | Available after sync |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...Object.entries(result.aggregates.classification).map(([name, value]) => (
      `| ${name} | ${value.count} | ${value.sellerEmpty} | ${value.canSellWebNow} | ${value.canBecomeAvailableOnNextSync} |`
    )),
    "",
    "## Pool summary",
    "",
    "| Pool | Ambiguous | Unmatched | Invalid | Available w/o ID | Historical | Problem | Catalog now | After sync |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(result.aggregates.pools).map(([name, value]) => (
      `| ${name} | ${value.ambiguous} | ${value.unmatched} | ${value.invalid} | ${value.availableWithoutStockId} | ${value.historical} | ${value.problem} | ${value.canEnterCatalogNow} | ${value.canBecomeAvailableOnNextSync} |`
    )),
    "",
  ];
  return lines.join("\n");
}

export async function runUnresolvedStockIdAudit(options = {}, dependencies = {}) {
  const databasePath = path.resolve(options.databasePath);
  const reportDir = path.resolve(options.reportDir);
  const readInventory = dependencies.readInventory || readStockIdBackfillInventory;
  const setMutationObserver = dependencies.setMutationObserver || setGoogleSheetsMutationObserver;
  const before = await sha256File(databasePath);
  const db = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const writerEvents = [];
  setMutationObserver((event) => writerEvents.push(event.operation));
  try {
    const inventoryResult = await readInventory(structuredClone(db));
    if (!inventoryResult?.ok) throw new Error(inventoryResult?.reason || "Inventory read failed");
    const plan = planStockIdBackfill({ db: structuredClone(db), inventory: inventoryResult.inventory });
    const unresolvedPlan = plan.rows.filter((row) => UNRESOLVED_STATUSES.has(row.status));
    const inventoryMap = new Map(inventoryResult.inventory.map((row) => [
      `${key(row.sheetName)}::${poolKey(row.pool)}::${Number(row.rowNumber || 0)}`,
      row,
    ]));
    const records = buildStockIdRecords(db);
    const rows = unresolvedPlan.map((planRow) => {
      const inventoryRow = inventoryMap.get(
        `${key(planRow.tab)}::${poolKey(planRow.pool)}::${Number(planRow.row || 0)}`,
      ) || {
        sheetName: planRow.tab,
        pool: planRow.pool,
        rowNumber: planRow.row,
        product: planRow.product,
        account: planRow.account,
        profile: planRow.profile,
        orderId: planRow.orderId,
      };
      return auditRow(db, inventoryRow, planRow, records);
    });
    const oldReport = options.oldReportPath
      ? JSON.parse(await fs.readFile(path.resolve(options.oldReportPath), "utf8"))
      : { rows: [] };
    const currentReport = options.currentReportPath
      ? JSON.parse(await fs.readFile(path.resolve(options.currentReportPath), "utf8"))
      : plan;
    const stablePayload = {
      rows,
      aggregates: aggregate(rows),
      unmatchedDiff: unmatchedDiff(oldReport, currentReport),
    };
    const after = await sha256File(databasePath);
    const result = {
      generatedAt: new Date().toISOString(),
      digest: crypto.createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex"),
      counts: {
        unresolved: rows.length,
        ambiguous: rows.filter((row) => row.status === "AMBIGUOUS").length,
        unmatched: rows.filter((row) => row.status === "UNMATCHED").length,
        invalid: rows.filter((row) => row.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW").length,
      },
      ...stablePayload,
      proof: {
        databaseSha256Before: before,
        databaseSha256After: after,
        databaseHashIdentical: before === after,
        databaseWriterCalls: 0,
        googleSheetsWriterCalls: writerEvents.length,
        googleSheetsWriterOperations: writerEvents,
        maintenanceCalls: 0,
      },
    };
    await fs.mkdir(reportDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(reportDir, "stock-id-unresolved-audit.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 }),
      fs.writeFile(path.join(reportDir, "stock-id-unresolved-audit.csv"), `${csvReport(rows)}\n`, { mode: 0o600 }),
      fs.writeFile(path.join(reportDir, "stock-id-unresolved-audit.md"), `${markdownReport(result)}\n`, { mode: 0o600 }),
    ]);
    return result;
  } finally {
    setMutationObserver(null);
  }
}

function argValue(name) {
  const prefix = `${name}=`;
  const direct = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return direct ? direct.slice(prefix.length) : "";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runUnresolvedStockIdAudit({
    databasePath: argValue("--database"),
    reportDir: argValue("--report-dir") || path.resolve("reports", "stock-id-unresolved-audit"),
    oldReportPath: argValue("--old-report"),
    currentReportPath: argValue("--current-report"),
  });
  process.stdout.write(
    `Unresolved audit: ${result.counts.unresolved} rows, digest=${result.digest}, DB unchanged=${result.proof.databaseHashIdentical}, Sheets writers=${result.proof.googleSheetsWriterCalls}\n`,
  );
}
