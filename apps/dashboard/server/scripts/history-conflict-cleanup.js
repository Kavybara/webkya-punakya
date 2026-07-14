import fs from "node:fs/promises";
import path from "node:path";

const defaultDatabasePath = path.resolve(process.cwd(), "apps/dashboard/runtime/kavya-db.json");
const databasePath = process.env.DATABASE_PATH || defaultDatabasePath;

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nowText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function accountScore(account = {}, orderById = new Map()) {
  const hidden = account.hidden || account.returnedToStockAt ? 0 : 1;
  const terminal = ["expired", "replaced", "disabled", "archived", "returned"].includes(String(account.status || "").toLowerCase()) ? 0 : 1;
  const expiresAt = Number(parseDate(account.expiresAt)?.getTime() || 0);
  const startedAt = Number(parseDate(account.startedAt)?.getTime() || 0);
  const orderId = String(account.orderId || account.sourceOrderId || "").trim();
  const order = orderById.get(orderId) || null;
  const orderCreated = Number(parseDate(order?.paidAt || order?.createdAt)?.getTime() || 0);
  return [hidden, terminal, expiresAt, startedAt, orderCreated, String(account.id || "")];
}

function compareScore(left = [], right = []) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? "";
    const rightValue = right[index] ?? "";
    if (leftValue === rightValue) continue;
    if (typeof leftValue === "number" && typeof rightValue === "number") return rightValue - leftValue;
    return String(rightValue).localeCompare(String(leftValue));
  }
  return 0;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

const db = JSON.parse(await fs.readFile(databasePath, "utf8"));
db.stock = db.stock || [];
db.orders = db.orders || [];
db.managedAccounts = db.managedAccounts || [];
db.activities = db.activities || [];

const orderById = new Map(db.orders.map((order) => [String(order.id || "").trim(), order]));
const orderIdsByStock = new Map();

for (const account of db.managedAccounts) {
  const stockId = String(account.stockId || "").trim();
  const orderId = String(account.orderId || account.sourceOrderId || "").trim();
  if (!stockId || !orderId) continue;
  const set = orderIdsByStock.get(stockId) || new Set();
  set.add(orderId);
  orderIdsByStock.set(stockId, set);
}

for (const order of db.orders) {
  const orderId = String(order.id || "").trim();
  if (!orderId) continue;
  for (const stockIdRaw of [...ensureArray(order.deliveredStockIds), ...ensureArray(order.historyConflictRemovedStockIds)]) {
    const stockId = String(stockIdRaw || "").trim();
    if (!stockId) continue;
    const set = orderIdsByStock.get(stockId) || new Set();
    set.add(orderId);
    orderIdsByStock.set(stockId, set);
  }
}

let conflictStocks = 0;
let archivedAccounts = 0;
let ordersDetached = 0;
let stockMetadataUpdated = 0;

for (const stock of db.stock) {
  const stockId = String(stock.id || "").trim();
  if (!stockId) continue;
  if (String(stock.sheetSource || "").toLowerCase() !== "google_sheets") continue;
  if (String(stock.status || "").toLowerCase() !== "removed") continue;
  const orderIds = [...(orderIdsByStock.get(stockId) || new Set())].filter(Boolean);
  if (orderIds.length <= 1) continue;

  conflictStocks += 1;
  const accounts = db.managedAccounts.filter((account) => String(account.stockId || "").trim() === stockId);
  const canonicalAccount = accounts.slice().sort((left, right) => compareScore(accountScore(left, orderById), accountScore(right, orderById)))[0] || null;
  const canonicalOrderId = String(canonicalAccount?.orderId || canonicalAccount?.sourceOrderId || "").trim() || orderIds.slice().sort((left, right) => {
    const leftOrder = orderById.get(left);
    const rightOrder = orderById.get(right);
    return compareScore(
      [Number(parseDate(leftOrder?.paidAt || leftOrder?.createdAt)?.getTime() || 0), left],
      [Number(parseDate(rightOrder?.paidAt || rightOrder?.createdAt)?.getTime() || 0), right],
    );
  })[0] || "";

  if (stock.historyConflict !== true) {
    stock.historyConflict = true;
    stockMetadataUpdated += 1;
  }
  const sortedOrderIds = orderIds.slice().sort();
  if (JSON.stringify(stock.historyConflictOrderIds || []) !== JSON.stringify(sortedOrderIds)) {
    stock.historyConflictOrderIds = sortedOrderIds;
    stockMetadataUpdated += 1;
  }
  if (stock.historyConflictCanonicalOrderId !== canonicalOrderId) {
    stock.historyConflictCanonicalOrderId = canonicalOrderId;
    stockMetadataUpdated += 1;
  }
  if (stock.historyConflictCanonicalAccountId !== String(canonicalAccount?.id || "")) {
    stock.historyConflictCanonicalAccountId = String(canonicalAccount?.id || "");
    stockMetadataUpdated += 1;
  }
  if (!stock.historyConflictDetectedAt) {
    stock.historyConflictDetectedAt = nowText();
    stockMetadataUpdated += 1;
  }
  if (!stock.historyConflictResolvedAt) {
    stock.historyConflictResolvedAt = nowText();
    stockMetadataUpdated += 1;
  }
  if (stock.autoBackfillBlocked !== true) {
    stock.autoBackfillBlocked = true;
    stockMetadataUpdated += 1;
  }
  if (canonicalOrderId && String(stock.sheetOrderId || "").trim() !== canonicalOrderId) {
    stock.sheetOrderId = canonicalOrderId;
    stockMetadataUpdated += 1;
  }

  for (const account of accounts) {
    if (canonicalAccount && account.id === canonicalAccount.id) continue;
    let changed = false;
    if (!account.hidden) {
      account.hidden = true;
      changed = true;
    }
    if (!account.returnedToStockAt) {
      account.returnedToStockAt = nowText();
      changed = true;
    }
    if (account.status !== "replaced") {
      account.status = "replaced";
      changed = true;
    }
    if (canonicalAccount && account.duplicateOfAccountId !== canonicalAccount.id) {
      account.duplicateOfAccountId = canonicalAccount.id;
      changed = true;
    }
    account.historyConflictArchived = true;
    if (changed) archivedAccounts += 1;
  }

  for (const orderId of orderIds) {
    if (!orderId || orderId === canonicalOrderId) continue;
    const order = orderById.get(orderId);
    if (!order) continue;
    const before = ensureArray(order.deliveredStockIds).map((item) => String(item || "").trim()).filter(Boolean);
    const after = before.filter((item) => item !== stockId);
    const removed = new Set(ensureArray(order.historyConflictRemovedStockIds).map((item) => String(item || "").trim()).filter(Boolean));
    removed.add(stockId);
    order.historyConflictRemovedStockIds = [...removed];
    order.historyConflictCanonicalOrderId = canonicalOrderId;
    order.historyConflictRemovedAt = order.historyConflictRemovedAt || nowText();
    order.deliveryStatus = "needs_redelivery";
    order.redeliveryRequired = true;
    order.redeliveryReason = `history_conflict:${stockId}`;
    order.redeliveryFlaggedAt = order.redeliveryFlaggedAt || nowText();
    if (after.length !== before.length) {
      order.deliveredStockIds = after;
      ordersDetached += 1;
    }
  }

  db.activities.unshift({
    id: `act-conflict-${stockId}`,
    type: "stock",
    title: "Riwayat stok bentrok dibersihkan",
    description: `${stock.email || stock.id} / ${stock.profile || "-"} punya ${orderIds.length} order historis. Order kanonik: ${canonicalOrderId || "-"}.`,
    createdAt: nowText(),
    stockId,
    orderId: canonicalOrderId,
  });
}

await fs.writeFile(databasePath, JSON.stringify(db, null, 2));

console.log("history-conflict-cleanup OK");
console.log(JSON.stringify({
  databasePath,
  conflictStocks,
  archivedAccounts,
  ordersDetached,
  stockMetadataUpdated,
}, null, 2));
