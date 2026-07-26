import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ownerStockPage = await readFile(new URL("../../src/pages/owner-v2/stock/page.tsx", import.meta.url), "utf8");
const resellerAccountsPage = await readFile(new URL("../../src/pages/reseller-v2/accounts/page.tsx", import.meta.url), "utf8");
const resellerNormalizer = await readFile(new URL("../../src/lib/resellerAccounts.ts", import.meta.url), "utf8");

test("Owner Console exposes account condition as a read-only labeled column and filter", () => {
  assert.match(ownerStockPage, /header: "Kondisi akun"/);
  assert.match(ownerStockPage, /label: "Kondisi akun"/);
  assert.match(ownerStockPage, /Kondisi akun \(read-only\)/);
  assert.match(ownerStockPage, /Bermasalah/);
  assert.match(ownerStockPage, /Dinonaktifkan/);
});

test("Reseller account history shows health badges without exposing cross-account data", () => {
  assert.match(resellerAccountsPage, /Bermasalah/);
  assert.match(resellerAccountsPage, /Sedang diperiksa/);
  assert.match(resellerAccountsPage, /Sudah diganti/);
  assert.match(resellerAccountsPage, /Dinonaktifkan/);
  assert.match(resellerNormalizer, /accountCondition === "DISABLED"/);
  assert.match(resellerNormalizer, /accountCondition === "REPLACED"/);
});
