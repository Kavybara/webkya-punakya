import { backfillOrderHistorySheet } from "../google-sheets.js";
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

const args = process.argv.slice(2);
const options = {
  limit: parseNumberArg(args, "limit", 0),
  orderIds: parseMultiValue(args, "order"),
};

const runner = async (db) => backfillOrderHistorySheet(db, options);
const result = await updateDb(runner).catch(async () => runner(await readDb()));
console.log(JSON.stringify({ mode: "apply", ...result }, null, 2));
