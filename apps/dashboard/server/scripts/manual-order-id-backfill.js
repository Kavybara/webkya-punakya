#!/usr/bin/env node
import process from "node:process";
import {
  backfillManualSheetOrderIds,
  setGoogleSheetsMutationObserver,
} from "../google-sheets.js";
import { readDb, updateDb } from "../store.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmation = args.find((arg) => arg.startsWith("--confirmation="))?.slice("--confirmation=".length) || "";
if (apply && confirmation !== "BACKFILL-MANUAL-ORDER-IDS") {
  throw new Error("Apply membutuhkan --confirmation=BACKFILL-MANUAL-ORDER-IDS");
}

let googleSheetsWriterCalls = 0;
setGoogleSheetsMutationObserver(() => { googleSheetsWriterCalls += 1; });
let result;
try {
  result = apply
    ? await updateDb((db) => backfillManualSheetOrderIds(db, { dryRun: false }))
    : await backfillManualSheetOrderIds(await readDb(), { dryRun: true });
} finally {
  setGoogleSheetsMutationObserver(null);
}

console.log(JSON.stringify({
  ...result,
  proof: {
    databaseWriterCalls: apply ? 1 : 0,
    googleSheetsWriterCalls,
  },
}, null, 2));
