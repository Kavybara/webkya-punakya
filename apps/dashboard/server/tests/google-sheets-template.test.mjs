import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVA_USAGE_HEADERS,
  DISNEY_HEADERS,
  SHEET_HEADERS,
  SIMPLE_ACCOUNT_HEADERS,
  UNIVERSAL_ACCOUNT_HEADERS,
} from "../google-sheets/schema.js";

test("profile pool template follows the owner sheet column order", () => {
  assert.deepEqual(SHEET_HEADERS, [
    "ACCOUNT",
    "Nama profil",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "DEVICE",
    "SELLER",
    "NOMOR WA",
    "PIN",
    "ORDER ID",
    "CATATAN",
    "STOCK ID",
  ]);
});

test("split and universal templates name metadata columns without shifting them", () => {
  assert.deepEqual(SIMPLE_ACCOUNT_HEADERS, [
    "ACCOUNT",
    "PASSWORD",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "SELLER",
    "NOMOR WA",
    "ORDER ID",
    "CATATAN",
    "STOCK ID",
  ]);
  assert.deepEqual(UNIVERSAL_ACCOUNT_HEADERS, [
    "ACCOUNT",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "SELLER",
    "NOMOR WA",
    "ORDER ID",
    "CATATAN",
    "STOCK ID",
  ]);
});

test("Disney template exactly follows the owner sheet format", () => {
  assert.deepEqual(DISNEY_HEADERS, [
    "Number",
    "OTP Email",
    "Nama profil",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "DEVICE",
    "SELLER",
    "NOMOR WA",
    "ORDER ID",
    "CATATAN",
    "STOCK ID",
  ]);
});

test("Canva usage template follows the owner sheet format", () => {
  assert.deepEqual(CANVA_USAGE_HEADERS, [
    "EMAIL CUSTOMER",
    "RESELLER",
    "NOMOR WA",
    "TANGGAL BELI",
    "DURASI",
    "EXPIRED",
    "ORDER ID",
    "PLAN",
  ]);
});
