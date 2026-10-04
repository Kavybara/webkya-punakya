import fs from "node:fs";

const APP_ROOT = "/home/rdpuser/kavya/apps/dashboard";
const TARGETS = [
  { productId: "prod-wetv", variantId: "prodwetv-6u" },
  { productId: "prod-prime-video", variantId: "prime-sharing-3u" },
  { productId: "prod-viu", variantId: "viu-private-antilimit" },
  { productId: "prod-vidio", variantId: "vidio-platinum-tv" },
  { productId: "prod-vidio", variantId: "vidio-platinum-all-device" },
  { productId: "prod-disney", variantId: "proddisney-6u" },
  { productId: "prod-disney", variantId: "proddisney-3u" },
];

function loadDashboardEnvironment() {
  for (const pid of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      if (!cmdline.some((part) => part === "server/index.js")) continue;
      for (const entry of fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean)) {
        const separator = entry.indexOf("=");
        if (separator > 0 && !(entry.slice(0, separator) in process.env)) {
          process.env[entry.slice(0, separator)] = entry.slice(separator + 1);
        }
      }
      return;
    } catch {}
  }
  throw new Error("dashboard_process_not_found");
}

function normalize(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

loadDashboardEnvironment();
process.chdir(APP_ROOT);
const [{ readDb }, sheets, groups] = await Promise.all([
  import(`${APP_ROOT}/server/store.js`),
  import(`${APP_ROOT}/server/google-sheets.js`),
  import(`${APP_ROOT}/server/stock-groups.js`),
]);
const db = await readDb();
const output = [];

for (const target of TARGETS) {
  const product = (db.products || []).find((item) => item.id === target.productId);
  const variant = product?.variants?.find((item) => item.id === target.variantId);
  const stock = groups.stockForVariant(db, product, variant, "available").find((item) => (
    String(item.sheetSource || "").toLowerCase() === "google_sheets"
    && item.sheetName
    && Number(item.sheetRow || 0) > 0
  ));
  if (!stock) {
    output.push({ product: product?.name, variant: variant?.name, state: "NO_READY_STOCK" });
    continue;
  }
  const preview = await sheets.previewAccountSheetMapping(db, { stockId: stock.id });
  const stockIdColumn = (preview.columns || []).find((column) => normalize(column.header) === "stockid");
  if (!preview.ok || !stockIdColumn) {
    output.push({
      product: product.name,
      variant: variant.name,
      sheet: stock.sheetName,
      row: stock.sheetRow,
      state: "STOCK_ID_HEADER_MISSING",
    });
    continue;
  }
  const rows = await sheets.readSheetValuesByName(db, preview.sheetName, { valueRenderOption: "FORMULA" });
  const value = String(rows[Number(preview.rowNumber) - 1]?.[stockIdColumn.index] || "").trim();
  output.push({
    product: product.name,
    variant: variant.name,
    stockId: stock.id,
    sheet: preview.sheetName,
    row: preview.rowNumber,
    cell: `${stockIdColumn.index}:${preview.rowNumber}`,
    state: !value ? "BLANK" : value === String(stock.id) ? "MATCH" : "MISMATCH",
  });
}

console.log(JSON.stringify({ ok: true, writerCalls: 0, pools: output }));
