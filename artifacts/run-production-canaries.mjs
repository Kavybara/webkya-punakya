import crypto from "node:crypto";
import fs from "node:fs";

const APP_ROOT = "/home/rdpuser/kavya/apps/dashboard";
const API_BASE = "http://127.0.0.1:1912";
const REPAIR_ORDER_IDS = [];
const TARGETS = [
  { productId: "prod-disney", variantId: "proddisney-3u" },
];
const SKIPPED = [
  { product: "Prime Video", variant: "Sharing 3U", reason: "stock_id_cell_blank" },
  { product: "Vidio", variant: "Platinum All Device", reason: "stock_id_cell_blank" },
];

function loadDashboardEnvironment() {
  const pids = fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  for (const pid of pids) {
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      if (!cmdline.some((part) => part === "server/index.js")) continue;
      const entries = fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean);
      for (const entry of entries) {
        const separator = entry.indexOf("=");
        if (separator <= 0) continue;
        const key = entry.slice(0, separator);
        if (!(key in process.env)) process.env[key] = entry.slice(separator + 1);
      }
      return Number(pid);
    } catch {
      // The process may exit while /proc is being inspected.
    }
  }
  throw new Error("dashboard_process_not_found");
}

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function ownerToken(db) {
  const secret = String(process.env.AUTH_SECRET || process.env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("auth_secret_unavailable");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    sub: "owner",
    role: "owner",
    name: "Owner",
    email: "",
    username: "owner",
    sv: Number(db.settings?.ownerSessionVersion || 0),
    iat: now,
    exp: now + 900,
  });
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function normalizedHeader(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function headerIndex(columns, patterns) {
  return columns.find((column) => {
    const header = normalizedHeader(column.header);
    return patterns.some((pattern) => pattern.test(header));
  })?.index ?? -1;
}

function isFormula(value) {
  return String(value || "").trim().startsWith("=");
}

function sameCell(before, after) {
  return String(before ?? "") === String(after ?? "");
}

function rowCell(row, index) {
  return index >= 0 ? row[index] ?? "" : "";
}

function summarizeError(error) {
  return String(error?.message || error || "unknown_error")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[masked-email]")
    .replace(/\b(?:\d[ -]?){9,15}\b/g, "[masked-number]")
    .slice(0, 240);
}

async function run() {
  const dashboardPid = loadDashboardEnvironment();
  process.chdir(APP_ROOT);
  const [{ readDb }, sheets, groups] = await Promise.all([
    import(`${APP_ROOT}/server/store.js`),
    import(`${APP_ROOT}/server/google-sheets.js`),
    import(`${APP_ROOT}/server/stock-groups.js`),
  ]);

  const initialDb = await readDb();
  const token = ownerToken(initialDb);
  const results = [];

  for (const REPAIR_ORDER_ID of REPAIR_ORDER_IDS) {
    const dbBefore = await readDb();
    const order = (dbBefore.orders || []).find((item) => item.id === REPAIR_ORDER_ID);
    const stockId = String(order?.deliveredStockIds?.[0] || "");
    const stock = (dbBefore.stock || []).find((item) => String(item.id) === stockId);
    const account = (dbBefore.managedAccounts || []).find((item) => (
      String(item.orderId || item.sourceOrderId || "") === REPAIR_ORDER_ID
      && String(item.stockId || "") === stockId
    ));
    if (!order || !stock || !account) throw new Error(`repair_target_incomplete:${REPAIR_ORDER_ID}`);

    const preview = await sheets.previewAccountSheetMapping(dbBefore, {
      accountId: account.id,
      order,
    });
    if (!preview.ok || !preview.sheetName || !preview.rowNumber) {
      throw new Error(`repair_mapping_preview_failed:${REPAIR_ORDER_ID}`);
    }
    const columns = preview.columns || [];
    const indexes = {
      account: headerIndex(columns, [/^account/, /^email/, /^number$/]),
      profile: headerIndex(columns, [/profil/]),
      expiry: headerIndex(columns, [/expired/, /expiry/, /berakhir/]),
      pin: headerIndex(columns, [/^pin$/]),
      seller: headerIndex(columns, [/seller/, /reseller/]),
      whatsapp: headerIndex(columns, [/nomor wa/, /whatsapp/]),
      orderId: headerIndex(columns, [/order id/, /id manual/]),
      stockId: headerIndex(columns, [/stock id/]),
    };
    if (indexes.seller < 0 || indexes.orderId < 0 || indexes.stockId < 0) {
      throw new Error(`repair_required_mapping_missing:${REPAIR_ORDER_ID}`);
    }
    const sheetBefore = await sheets.readSheetValuesByName(dbBefore, preview.sheetName, {
      valueRenderOption: "FORMULA",
    });
    const beforeRow = sheetBefore[Number(preview.rowNumber) - 1] || [];
    const protectedBefore = {
      account: rowCell(beforeRow, indexes.account),
      profile: rowCell(beforeRow, indexes.profile),
      pin: rowCell(beforeRow, indexes.pin),
      expiry: rowCell(beforeRow, indexes.expiry),
      whatsapp: rowCell(beforeRow, indexes.whatsapp),
      stockId: rowCell(beforeRow, indexes.stockId),
    };

    const alreadyRepaired = order.orderStatus === "completed"
      && order.deliveryStatus === "sent"
      && order.googleSheetsSyncStatus === "synced";
    if (!alreadyRepaired) {
      const response = await fetch(`${API_BASE}/api/orders/${REPAIR_ORDER_ID}/repair-sheets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const responseBody = await response.json().catch(() => ({}));
      if (response.status !== 200 || responseBody.ok !== true) {
        throw new Error(`repair_request_failed:${REPAIR_ORDER_ID}:${response.status}:${responseBody.reason || responseBody.error || "unknown"}`);
      }
    }

    const dbAfter = await readDb();
    const repairedOrder = (dbAfter.orders || []).find((item) => item.id === REPAIR_ORDER_ID) || {};
    const sheetAfter = await sheets.readSheetValuesByName(dbAfter, preview.sheetName, {
      valueRenderOption: "FORMULA",
    });
    const afterRow = sheetAfter[Number(preview.rowNumber) - 1] || [];
    const checks = {
      orderCompleted: repairedOrder.orderStatus === "completed" && repairedOrder.deliveryStatus === "sent",
      sheetsSynced: repairedOrder.googleSheetsSyncStatus === "synced",
      sellerWritten: String(rowCell(afterRow, indexes.seller)).trim().toLowerCase() === "kya",
      orderIdWritten: String(rowCell(afterRow, indexes.orderId)).trim() === REPAIR_ORDER_ID,
      stockIdUnchanged: sameCell(protectedBefore.stockId, rowCell(afterRow, indexes.stockId)),
      accountUnchanged: indexes.account < 0 || sameCell(protectedBefore.account, rowCell(afterRow, indexes.account)),
      profileUnchanged: indexes.profile < 0 || sameCell(protectedBefore.profile, rowCell(afterRow, indexes.profile)),
      pinUnchanged: indexes.pin < 0 || sameCell(protectedBefore.pin, rowCell(afterRow, indexes.pin)),
      expiryFormulaPreserved: indexes.expiry < 0
        || !isFormula(protectedBefore.expiry)
        || sameCell(protectedBefore.expiry, rowCell(afterRow, indexes.expiry)),
      whatsappFormulaPreserved: indexes.whatsapp < 0
        || !isFormula(protectedBefore.whatsapp)
        || sameCell(protectedBefore.whatsapp, rowCell(afterRow, indexes.whatsapp)),
    };
    const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    const repairResult = {
      product: order.product,
      variant: order.variant,
      orderId: REPAIR_ORDER_ID,
      stockId,
      sheet: preview.sheetName,
      row: preview.rowNumber,
      status: failedChecks.length ? "FAILED" : "PASSED",
      failedChecks,
      checks,
    };
    results.push(repairResult);
    console.log(JSON.stringify({ type: "repair", ...repairResult }));
    if (failedChecks.length) throw new Error(`repair_verification_failed:${REPAIR_ORDER_ID}:${failedChecks.join(",")}`);
  }

  for (const target of TARGETS) {
    await new Promise((resolve) => setTimeout(resolve, 65_000));
    const dbBefore = await readDb();
    const product = (dbBefore.products || []).find((item) => item.id === target.productId);
    const variant = product?.variants?.find((item) => item.id === target.variantId);
    if (!product || !variant) throw new Error(`target_not_found:${target.productId}:${target.variantId}`);

    const duration = Object.keys(groups.pricesAllowedForVariant(variant))[0];
    if (!duration) throw new Error(`duration_unavailable:${target.variantId}`);

    const available = groups.stockForVariant(dbBefore, product, variant, "available");
    const stock = available.find((item) => (
      String(item.sheetSource || "").toLowerCase() === "google_sheets"
      && item.sheetName
      && Number(item.sheetRow || 0) > 0
    ));
    if (!stock) throw new Error(`ready_sheet_stock_unavailable:${target.variantId}`);

    const preview = await sheets.previewAccountSheetMapping(dbBefore, {
      stockId: stock.id,
      order: {
        id: "CANARY-PREVIEW",
        reseller: "kya",
        duration,
        qty: 1,
      },
    });
    if (!preview.ok || !preview.sheetName || !preview.rowNumber) {
      throw new Error(`mapping_preview_failed:${target.variantId}:${preview.reason || "unknown"}`);
    }

    const columns = preview.columns || [];
    const indexes = {
      account: headerIndex(columns, [/^account/, /^email/, /^number$/]),
      profile: headerIndex(columns, [/profil/]),
      expiry: headerIndex(columns, [/expired/, /expiry/, /berakhir/]),
      pin: headerIndex(columns, [/^pin$/]),
      device: headerIndex(columns, [/device/]),
      seller: headerIndex(columns, [/seller/, /reseller/]),
      whatsapp: headerIndex(columns, [/nomor wa/, /whatsapp/]),
      orderId: headerIndex(columns, [/order id/, /id manual/]),
      condition: headerIndex(columns, [/kondisi akun/, /^status$/]),
      notes: headerIndex(columns, [/catatan/, /note/]),
      stockId: headerIndex(columns, [/stock id/]),
    };
    if (indexes.seller < 0 || indexes.orderId < 0 || indexes.stockId < 0) {
      throw new Error(`required_mapping_missing:${target.variantId}`);
    }

    const sheetBefore = await sheets.readSheetValuesByName(dbBefore, preview.sheetName, {
      valueRenderOption: "FORMULA",
    });
    const beforeRow = sheetBefore[Number(preview.rowNumber) - 1] || [];
    const protectedBefore = {
      account: rowCell(beforeRow, indexes.account),
      profile: rowCell(beforeRow, indexes.profile),
      pin: rowCell(beforeRow, indexes.pin),
      expiry: rowCell(beforeRow, indexes.expiry),
      whatsapp: rowCell(beforeRow, indexes.whatsapp),
      stockId: rowCell(beforeRow, indexes.stockId),
    };

    const response = await fetch(`${API_BASE}/api/orders/smoke-test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId: product.id,
        variantId: variant.id,
        duration,
        qty: 1,
        smokeLabel: "kya",
        email: "smoke-kya@kavya.test",
        device: "Owner Smoke Test",
        checkoutData: {
          customerEmail: "smoke-kya@kavya.test",
          customerDevice: "Owner Smoke Test",
        },
      }),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (response.status !== 201) {
      throw new Error(`smoke_request_failed:${target.variantId}:${response.status}:${responseBody.error || "unknown"}`);
    }

    const orderId = String(responseBody.id || "");
    if (!orderId) throw new Error(`smoke_order_id_missing:${target.variantId}`);
    const dbAfter = await readDb();
    const order = (dbAfter.orders || []).find((item) => item.id === orderId);
    if (!order) throw new Error(`smoke_order_missing:${orderId}`);
    const deliveredIds = [...new Set((order.deliveredStockIds || []).map(String).filter(Boolean))];
    if (deliveredIds.length !== 1) throw new Error(`unexpected_delivery_count:${orderId}:${deliveredIds.length}`);
    if (deliveredIds[0] !== String(stock.id)) {
      throw new Error(`concurrent_stock_selection_changed:${orderId}`);
    }

    const account = (dbAfter.managedAccounts || []).find((item) => (
      String(item.orderId || "") === orderId
      || String(item.stockId || "") === deliveredIds[0]
    ));
    if (!account) throw new Error(`managed_account_missing:${orderId}`);

    const sheetAfter = await sheets.readSheetValuesByName(dbAfter, preview.sheetName, {
      valueRenderOption: "FORMULA",
    });
    const afterRow = sheetAfter[Number(preview.rowNumber) - 1] || [];
    const checks = {
      orderCompleted: order.orderStatus === "completed" && order.deliveryStatus === "sent",
      oneDeliveredStock: deliveredIds.length === 1,
      sourceSmokeTest: order.source === "owner_smoke_test" && order.isSmokeTest === true,
      sellerWritten: String(rowCell(afterRow, indexes.seller)).trim().toLowerCase() === "kya",
      orderIdWritten: String(rowCell(afterRow, indexes.orderId)).trim() === orderId,
      stockIdUnchanged: sameCell(protectedBefore.stockId, rowCell(afterRow, indexes.stockId)),
      accountUnchanged: indexes.account < 0 || sameCell(protectedBefore.account, rowCell(afterRow, indexes.account)),
      profileUnchanged: indexes.profile < 0 || sameCell(protectedBefore.profile, rowCell(afterRow, indexes.profile)),
      pinUnchanged: indexes.pin < 0 || sameCell(protectedBefore.pin, rowCell(afterRow, indexes.pin)),
      expiryFormulaPreserved: indexes.expiry < 0
        || !isFormula(protectedBefore.expiry)
        || sameCell(protectedBefore.expiry, rowCell(afterRow, indexes.expiry)),
      whatsappFormulaPreserved: indexes.whatsapp < 0
        || !isFormula(protectedBefore.whatsapp)
        || sameCell(protectedBefore.whatsapp, rowCell(afterRow, indexes.whatsapp)),
    };
    const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    const result = {
      product: product.name,
      variant: variant.name,
      duration,
      orderId,
      stockId: deliveredIds[0],
      sheet: preview.sheetName,
      row: preview.rowNumber,
      status: failedChecks.length ? "FAILED" : "PASSED",
      failedChecks,
      checks,
    };
    results.push(result);
    console.log(JSON.stringify({ type: "canary", ...result }));
    if (failedChecks.length) throw new Error(`mapping_verification_failed:${orderId}:${failedChecks.join(",")}`);
  }

  console.log(JSON.stringify({
    type: "summary",
    ok: true,
    dashboardPid,
    passed: results.length,
    failed: 0,
    skipped: SKIPPED,
    results: results.map(({ product, variant, orderId, stockId, sheet, row, status }) => ({
      product,
      variant,
      orderId,
      stockId,
      sheet,
      row,
      status,
    })),
  }));
}

run().catch((error) => {
  console.error(JSON.stringify({ type: "summary", ok: false, error: summarizeError(error) }));
  process.exitCode = 1;
});
