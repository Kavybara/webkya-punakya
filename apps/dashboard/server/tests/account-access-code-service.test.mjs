import test from "node:test";
import assert from "node:assert/strict";

import { extractNetflixVerificationCode } from "../services/account-access-code-service.js";

test("verification parser accepts only six digit Netflix verification codes", () => {
  assert.equal(extractNetflixVerificationCode("Verifikasi dengan kode ini\n4821\nKode ini akan kedaluwarsa dalam 15 menit."), "");
  assert.equal(extractNetflixVerificationCode("Verification code: 58319. Expires in 15 minutes."), "");
  assert.equal(extractNetflixVerificationCode("Verify with this code\n731 204\nYou'll have 15 minutes."), "731204");
});

test("verification parser ignores date-like numbers and keeps the explicit code", () => {
  const message = [
    "Dikirim 31 Juli 2026",
    "Kode verifikasi: 593712",
    "Kode ini akan kedaluwarsa dalam 15 menit.",
  ].join("\n");

  assert.equal(extractNetflixVerificationCode(message), "593712");
  assert.equal(extractNetflixVerificationCode("Kode verifikasi dibuat pada 2026 dan akan kedaluwarsa dalam 15 menit."), "");
});

test("verification parser requires verification context", () => {
  assert.equal(extractNetflixVerificationCode("Nomor pesanan 4821 dibuat hari ini."), "");
  assert.equal(extractNetflixVerificationCode("PIN profil: 5937"), "");
});
