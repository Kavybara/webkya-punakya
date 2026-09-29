import crypto from "node:crypto";
import fs from "node:fs/promises";

import { previewAccountSheetMapping } from "../google-sheets.js";
import { databasePath, readDb } from "../store.js";
import {
  isVariantOrderable,
  stockForVariant,
  variantStockGroupKey,
} from "../stock-groups.js";
import { summarizeSheetMappingPreview } from "../services/sheet-mapping-readiness-service.js";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function stableDigest(value) {
  return sha256(Buffer.from(JSON.stringify(value)));
}

function canonicalReseller(db) {
  return (db.resellers || []).find((item) => (
    String(item.username || "").trim().toLowerCase() === "kya"
    && item.isActive !== false
  )) || null;
}

async function run() {
  const databaseBefore = await fs.readFile(databasePath);
  const db = await readDb();
  const reseller = canonicalReseller(db);
  const seenGroups = new Set();
  const pools = [];

  for (const product of db.products || []) {
    if (product.isActive === false) continue;
    for (const variant of product.variants || []) {
      if (!isVariantOrderable(product, variant)) continue;
      const groupKey = variantStockGroupKey(product, variant);
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      const available = stockForVariant(db, product, variant, "available");
      const candidate = available.find((stock) => (
        String(stock.sheetSource || "").trim().toLowerCase() === "google_sheets"
        && stock.sheetName
        && Number(stock.sheetRow || 0) > 0
      )) || null;
      const context = {
        groupKey,
        productId: product.id || "",
        variantId: variant.id || "",
        product: product.name || "",
        variant: variant.name || "",
        available: available.length,
        source: candidate ? "google_sheets" : available.length ? "virtual_or_local" : "empty",
      };

      if (!candidate) {
        pools.push({
          ...context,
          status: available.length ? "NO_SHEET_CANARY_REQUIRED" : "NO_READY_STOCK",
          reason: "",
          sheetName: "",
          rowNumber: 0,
          updateColumns: [],
          protectedWrites: [],
        });
        continue;
      }

      const preview = await previewAccountSheetMapping(db, {
        stockId: candidate.id,
        order: {
          id: "AUDIT-READONLY",
          resellerId: reseller?.id || "",
          reseller: reseller?.username || "",
          whatsapp: reseller?.whatsapp || "",
          duration: "1 Bulan",
          durationDays: 30,
          qty: 1,
        },
      });
      pools.push(summarizeSheetMappingPreview(preview, context));
    }
  }

  const databaseAfter = await fs.readFile(databasePath);
  const normalized = pools.map((pool) => ({
    groupKey: pool.groupKey,
    productId: pool.productId,
    variantId: pool.variantId,
    available: pool.available,
    source: pool.source,
    status: pool.status,
    reason: pool.reason,
    sheetName: pool.sheetName,
    rowNumber: pool.rowNumber,
    updateColumns: pool.updateColumns,
    protectedWrites: pool.protectedWrites,
  }));
  const report = {
    ok: databaseBefore.equals(databaseAfter),
    databaseHashBefore: sha256(databaseBefore),
    databaseHashAfter: sha256(databaseAfter),
    databaseWriterCalls: 0,
    googleSheetsWriterCalls: 0,
    digest: stableDigest(normalized),
    summary: {
      groups: pools.length,
      ready: pools.filter((item) => item.status === "READY").length,
      blocked: pools.filter((item) => item.status === "BLOCKED_PROTECTED_COLUMN" || item.status === "UNRESOLVED").length,
      noReadyStock: pools.filter((item) => item.status === "NO_READY_STOCK").length,
      nonSheet: pools.filter((item) => item.status === "NO_SHEET_CANARY_REQUIRED").length,
    },
    pools,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok || report.summary.blocked) process.exitCode = 1;
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message || "mapping_readiness_failed" }));
  process.exitCode = 1;
});
