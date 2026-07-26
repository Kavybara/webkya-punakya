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
