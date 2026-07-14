import { backfillGoogleSheetsOrders } from "../google-sheets.js";
import { readDb, updateDb } from "../store.js";

function parseMultiValue(args = [], name) {
  const values = [];
  for (const arg of args) {
    if (!arg.startsWith(`--${name}=`)) continue;
    values.push(...arg.slice(name.length + 3).split(",").map((item) => item.trim()).filter(Boolean));
  }
  return values;
}

function parseNumberArg(args = [], name, fallback = 0) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!match) return fallback;
  const value = Number(match.slice(name.length + 3));
  return Number.isFinite(value) ? value : fallback;
}

function printResult(result = {}, asJson = false, requestedApply = false) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`mode: ${result.dryRun === undefined ? (requestedApply ? "apply" : "dry-run") : result.dryRun ? "dry-run" : "apply"}`);
  if (result.skipped) {
    console.log(`status: skipped (${result.reason || "unknown_reason"})`);
    return;
  }
  console.log(`total accounts: ${result.totalAccounts || 0}`);
  console.log(`standard accounts: ${result.standardAccounts || 0}`);
  console.log(`usage accounts: ${result.usageAccounts || 0}`);
  console.log(`matched rows: ${result.matchedRows || 0}`);
  console.log(`unmatched accounts: ${result.unmatchedAccounts || 0}`);
  if (!result.dryRun) {
    console.log(`updated account rows: ${result.updatedAccountRows || 0}`);
    console.log(`updated usage cells: ${result.updatedUsageCells || 0}`);
  }
  const sample = result.sample || [];
  if (!sample.length) {
    console.log("sample: none");
    return;
  }
  console.log("sample:");
  for (const item of sample) {
    const cells = (item.columns || [])
      .slice(0, 6)
      .map((column) => `${column.header || column.columnIndex}: ${column.value}`)
      .join(" | ");
    console.log(`- [${item.scope}] ${item.sheetName} row ${item.rowNumber} | ${item.email} | ${item.orderId || "-"} | ${cells}`);
  }
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const asJson = args.includes("--json");
const includeHidden = args.includes("--include-hidden");
const options = {
  dryRun: !apply,
  includeHidden,
  limit: parseNumberArg(args, "limit", 0),
  sample: parseNumberArg(args, "sample", 20),
  accountIds: parseMultiValue(args, "account"),
  orderIds: parseMultiValue(args, "order"),
  emails: parseMultiValue(args, "email"),
};

const result = apply
  ? await updateDb((db) => backfillGoogleSheetsOrders(db, options))
  : await backfillGoogleSheetsOrders(await readDb(), options);

printResult(result, asJson, apply);
