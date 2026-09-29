#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  assertApplyAllowed,
  planStockIdBackfill,
} from "../services/stock-id-backfill-service.js";

export function parseStockIdBackfillArgs(argv = []) {
  const value = (name) => {
    const prefix = `${name}=`;
    const direct = argv.find((arg) => arg.startsWith(prefix));
    if (direct) return direct.slice(prefix.length);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : "";
  };
  return {
    apply: argv.includes("--apply"),
    dryRun: !argv.includes("--apply") || argv.includes("--dry-run"),
    confirmProduction: argv.includes("--confirm-production"),
    confirmation: value("--confirmation"),
    databasePath: value("--database"),
    reportDir: value("--report-dir") || path.resolve("reports"),
    writeReports: !argv.includes("--no-report"),
    stdout: argv.includes("--stdout"),
  };
}

function csvCell(value) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

export function reportCsv(plan = {}) {
  const headers = [
    "status", "tab", "pool", "product", "row", "stockIdCell", "account",
    "profile", "orderId", "stockId", "reason", "relationSource", "confidence",
  ];
  return [
    headers.map(csvCell).join(","),
    ...(plan.rows || []).map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

export function reportMarkdown(plan = {}, proof = {}) {
  const totals = plan.counts || {};
  const lines = [
    "# STOCK ID Backfill Dry-Run",
    "",
    `Generated: ${plan.generatedAt || ""}`,
    "",
    "| Tab | Pool | Diperiksa | Terisi valid | Exact | Unmatched | Ambiguous | Conflict | Invalid | Empty |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...(plan.summary || []).map((row) => (
      `| ${row.tab} | ${row.pool} | ${row.checked} | ${row.alreadyFilledValid} | ${row.exact} | ${row.unmatched} | ${row.ambiguous} | ${row.conflict} | ${row.invalid} | ${row.empty} |`
    )),
    "",
    "## Total",
    "",
    ...Object.entries(totals).map(([status, count]) => `- ${status}: ${count}`),
    "",
    "## Inventory pool",
    "",
    "| Tab | Pool | Header | Kolom STOCK ID | Baris stok | Terisi | Kosong |",
    "| --- | --- | ---: | --- | ---: | ---: | ---: |",
    ...(plan.inventoryPools || []).map((pool) => (
      `| ${pool.sheetName} | ${pool.pool} | ${pool.headerRow} | ${pool.stockIdColumnLabel || "tidak ditemukan"} | ${pool.rows} | ${pool.filled} | ${pool.empty} |`
    )),
    "",
    "## No-write proof",
    "",
    `- Database SHA-256 before: \`${proof.databaseSha256Before || "n/a"}\``,
    `- Database SHA-256 after: \`${proof.databaseSha256After || "n/a"}\``,
    `- Database hash identical: ${proof.databaseHashIdentical === true ? "yes" : "no"}`,
    `- Database writer calls: ${proof.databaseWriterCalls ?? 0}`,
    `- Google Sheets writer calls: ${proof.googleSheetsWriterCalls ?? 0}`,
    "",
    "## EXACT candidates",
    "",
    ...(plan.exact?.length
      ? plan.exact.map((row) => (
        `- ${row.tab} | ${row.pool} | row ${row.row} | ${row.stockIdCell} | ${row.account || "-"} | ${row.profile || "-"} | ${row.stockId} | ${row.reason}`
      ))
      : ["- Tidak ada kandidat EXACT."]),
    "",
    "## Manual review",
    "",
    ...((plan.rows || []).filter((row) => row.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW").length
      ? (plan.rows || [])
        .filter((row) => row.status === "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW")
        .map((row) => (
          `- ${row.tab} | ${row.pool} | row ${row.row} | ${row.stockIdCell || "cell tidak tersedia"} | ${row.status} | ${row.reason}`
        ))
      : ["- Tidak ada Stock ID invalid."]),
    "",
  ];
  return lines.join("\n");
}

async function sha256File(filePath) {
  if (!filePath) return "";
  const payload = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function writeReports(reportDir, plan, proof) {
  await fs.mkdir(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, "stock-id-backfill-dry-run.json");
  const csvPath = path.join(reportDir, "stock-id-backfill-dry-run.csv");
  const markdownPath = path.join(reportDir, "stock-id-backfill-summary.md");
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify({ ...plan, proof }, null, 2)}\n`, { mode: 0o600 }),
    fs.writeFile(csvPath, `${reportCsv(plan)}\n`, { mode: 0o600 }),
    fs.writeFile(markdownPath, `${reportMarkdown(plan, proof)}\n`, { mode: 0o600 }),
  ]);
  return { jsonPath, csvPath, markdownPath };
}

async function writeRollbackManifest(reportDir, plan, prepared = {}) {
  await fs.mkdir(reportDir, { recursive: true });
  const manifestPath = path.join(reportDir, "stock-id-backfill-rollback-manifest.json");
  const snapshotPath = path.join(reportDir, "stock-id-target-snapshot-before.json");
  const candidates = (prepared.candidates || []).map((row) => ({
    spreadsheetTab: row.tab,
    pool: row.pool,
    row: row.row,
    cell: row.stockIdCell,
    before: "",
    after: row.stockId,
    stockId: row.stockId,
    reason: row.reason,
  }));
  const payload = {
    createdAt: new Date().toISOString(),
    planDigest: plan.digest,
    batchSize: prepared.batchSize,
    candidates,
    skippedDataChanged: (prepared.skipped || []).map((row) => ({
      spreadsheetTab: row.tab,
      pool: row.pool,
      row: row.row,
      cell: row.stockIdCell,
      reason: row.reason,
    })),
  };
  await Promise.all([
    fs.writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 }),
    fs.writeFile(snapshotPath, `${JSON.stringify({
      createdAt: payload.createdAt,
      planDigest: plan.digest,
      cells: candidates.map(({ spreadsheetTab, pool, row, cell, before }) => ({
        spreadsheetTab,
        pool,
        row,
        cell,
        value: before,
      })),
    }, null, 2)}\n`, { mode: 0o600 }),
  ]);
  return { manifestPath, snapshotPath };
}

export async function runStockIdBackfill(options = {}, dependencies = {}) {
  const mode = assertApplyAllowed(options);
  const {
    readDb,
    readInventory,
    applyPlan,
    setMutationObserver = () => undefined,
  } = dependencies;
  if (!readDb || !readInventory) throw new Error("Read-only dependencies belum tersedia");

  const writerCalls = [];
  setMutationObserver((event) => writerCalls.push(event.operation));
  const before = options.databasePath ? await sha256File(options.databasePath) : "";
  try {
    const db = await readDb();
    const inventoryResult = await readInventory(db);
    if (!inventoryResult?.ok) throw new Error(inventoryResult?.reason || "Inventaris Sheets gagal");
    const plan = planStockIdBackfill({ db, inventory: inventoryResult.inventory });
    plan.inventoryPools = inventoryResult.pools || [];
    let applyResult = null;
    let rollbackManifestPath = "";
    let rollbackSnapshotPath = "";
    if (mode === "apply") {
      if (!applyPlan) throw new Error("Writer apply tidak tersedia");
      applyResult = await applyPlan(db, plan, {
        confirmProduction: options.confirmProduction,
        confirmation: options.confirmation,
        batchSize: 50,
        batchDelayMs: 65_000,
        onPrepared: async (prepared) => {
          const rollback = await writeRollbackManifest(options.reportDir, plan, prepared);
          rollbackManifestPath = rollback.manifestPath;
          rollbackSnapshotPath = rollback.snapshotPath;
        },
      });
    }
    const after = options.databasePath ? await sha256File(options.databasePath) : "";
    const proof = {
      databaseSha256Before: before,
      databaseSha256After: after,
      databaseHashIdentical: Boolean(before && before === after),
      databaseWriterCalls: 0,
      googleSheetsWriterCalls: writerCalls.length,
      googleSheetsWriterOperations: writerCalls,
    };
    const files = options.writeReports === false ? {} : await writeReports(options.reportDir, plan, proof);
    return {
      plan,
      proof,
      files,
      applyResult,
      rollbackManifestPath,
      rollbackSnapshotPath,
      tabs: inventoryResult.tabs || [],
    };
  } finally {
    setMutationObserver(null);
  }
}

async function main() {
  const options = parseStockIdBackfillArgs(process.argv.slice(2));
  if (options.databasePath) process.env.DATABASE_PATH = path.resolve(options.databasePath);
  const [
    { readDbSnapshot, databasePath },
    {
      applyStockIdBackfillPlan,
      readStockIdBackfillInventory,
      setGoogleSheetsMutationObserver,
    },
  ] = await Promise.all([
    import("../store.js"),
    import("../google-sheets.js"),
  ]);
  options.databasePath ||= databasePath;
  const result = await runStockIdBackfill(options, {
    readDb: readDbSnapshot,
    readInventory: readStockIdBackfillInventory,
    applyPlan: applyStockIdBackfillPlan,
    setMutationObserver: setGoogleSheetsMutationObserver,
  });
  if (options.stdout) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    process.stdout.write(
      `STOCK ID ${result.plan.mode}: ${result.plan.rows.length} baris, ${result.plan.exact.length} EXACT. `
      + `updated=${result.applyResult?.updated ?? 0}, skipped=${result.applyResult?.skipped?.length ?? 0}. `
      + `DB unchanged=${result.proof.databaseHashIdentical}, Sheets writers=${result.proof.googleSheetsWriterCalls}.\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`stock-id-backfill failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
