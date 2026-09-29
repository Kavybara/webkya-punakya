export function isSheetBackedRecord(record = {}) {
  const source = String(record.sheetSource || record.source || "").trim().toLowerCase();
  if (source === "google_sheets" || source === "google sheets") return true;
  return Boolean(String(record.sheetStockKey || "").trim() && Number(record.sheetRow || 0) > 0);
}

export function findLinkedSheetStock(stocks = [], account = {}) {
  const stockId = String(account.stockId || "").trim();
  const sheetStockKey = String(account.sheetStockKey || "").trim();
  return (stocks || []).find((stock) => (
    (stockId && String(stock.id || "").trim() === stockId)
    || (sheetStockKey && String(stock.sheetStockKey || "").trim() === sheetStockKey)
  )) || null;
}

export function isDeliverableManagedAccount(account = {}) {
  const status = String(account.status || "").trim().toLowerCase();
  return !account.hidden
    && !account.returnedToStockAt
    && !["expired", "replaced", "disabled"].includes(status);
}

export function hasOnlyHistoricalManagedAssignment(accounts = [], stockId = "", orderId = "") {
  const wantedStockId = String(stockId || "").trim();
  const wantedOrderId = String(orderId || "").trim();
  if (!wantedStockId || !wantedOrderId) return false;
  const matched = (accounts || []).filter((account) => (
    String(account.stockId || "").trim() === wantedStockId
    && String(account.orderId || account.sourceOrderId || "").trim() === wantedOrderId
  ));
  return matched.length > 0 && matched.every((account) => !isDeliverableManagedAccount(account));
}

function deliveryAuditIdentity(account = {}) {
  const stockId = String(account.stockId || "").trim();
  if (stockId) return `stock:${stockId}`;
  const sheetName = String(account.sheetName || "").trim().toLowerCase();
  const sheetRow = Number(account.sheetRow || 0);
  if (sheetName && sheetRow) return `sheet:${sheetName}:${sheetRow}`;
  const identity = String(account.email || account.loginPhone || account.id || "").trim().toLowerCase();
  const profile = String(account.profile || "").trim().toLowerCase();
  return `identity:${identity}:${profile}`;
}

function uniqueAuditAccounts(accounts = []) {
  return [...new Map(
    (accounts || [])
      .filter(Boolean)
      .map((account) => [deliveryAuditIdentity(account), account]),
  ).values()];
}

export function classifyDeliveryAuditAccounts(accounts = []) {
  return {
    historical: uniqueAuditAccounts(accounts),
    active: uniqueAuditAccounts((accounts || []).filter(isDeliverableManagedAccount)),
  };
}

export function isCreditedStockUnavailableOrder(order = {}) {
  if (String(order.deliveryStatus || "").trim().toLowerCase() !== "stock_unavailable_deposit") {
    return false;
  }
  return order.stockRaceDepositCredited === true
    || Boolean(String(order.stockRaceDepositCreditedAt || "").trim());
}

export function hasHistoricalDeliveryEvidence(activities = [], order = {}) {
  const orderId = String(order.id || "").trim();
  if (!orderId || !String(order.fulfillmentText || "").trim()) return false;
  const related = (activities || []).filter((activity) => String(activity.orderId || "").trim() === orderId);
  const completed = related.some((activity) => String(activity.title || "").trim() === `Order ${orderId} selesai`);
  const detailOpened = related.some((activity) => (
    String(activity.title || "").trim() === "Detail pengiriman dibuka"
    && String(activity.description || "").includes(`order ${orderId}`)
  ));
  return completed && detailOpened;
}

export function deliveryAuditCoverage(order = {}, accounts = [], activities = []) {
  const qty = Math.max(1, Number(order.qty || 1));
  const classified = classifyDeliveryAuditAccounts(accounts);
  const historicalDeliveryVerified = hasHistoricalDeliveryEvidence(activities, order);
  const historicalCount = historicalDeliveryVerified
    ? Math.max(qty, classified.historical.length)
    : classified.historical.length;

  return {
    ...classified,
    qty,
    historicalDeliveryVerified,
    historicalCount,
    activeCount: classified.active.length,
    missingHistoricalCount: Math.max(0, qty - historicalCount),
  };
}

export function classifySheetPushResult(result = {}, { required = false } = {}) {
  if (result.ok && !result.skipped) {
    return { status: "synced", error: "" };
  }

  const reason = String(result.reason || result.error || "google_sheets_sync_failed").trim();
  if (required) {
    return { status: "failed", error: reason };
  }

  if (result.skipped) {
    return { status: "skipped", error: "" };
  }

  return { status: "failed", error: reason };
}
