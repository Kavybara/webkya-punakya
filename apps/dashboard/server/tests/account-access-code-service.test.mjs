import test from "node:test";
import assert from "node:assert/strict";

import {
  extractNetflixVerificationCode,
  hasFifteenMinuteExpiry,
  hasTenMinuteExpiry,
  isNetflixAccountChangeVerification,
} from "../services/account-access-code-service.js";

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

/**
 * `berlaku` is the whole point of these tests.
 *
 * Netflix's Indonesian access mail says "Kode ini berlaku selama 15 menit", and
 * the expiry list used to contain `kedaluwarsa`, `berakhir`, and `expires` but
 * not `berlaku` -- so a legitimate access code did not register as having a
 * fifteen-minute window. The ten-minute rule then read it as an account-change
 * mail and discarded it. The reseller saw `not_found` for a code that was
 * sitting in `NF_VERIF` with a working six digits in it.
 */
test("expiry detection recognises the word Indonesian Netflix actually uses", () => {
  for (const text of [
    "Kode ini berlaku selama 15 menit.",
    "Kode berlaku 15 menit.",
    "Kode ini akan berlaku 15 menit lagi.",
    "Kode ini berlaku 15 mnt.",
  ]) {
    assert.equal(hasFifteenMinuteExpiry(text), true, text);
  }

  assert.equal(hasFifteenMinuteExpiry("Kode ini berlaku selama 10 menit."), false);
  assert.equal(hasFifteenMinuteExpiry("Kode verifikasi: 593712"), false);
});

test("expiry detection still recognises the words it always knew, in either order", () => {
  assert.equal(hasFifteenMinuteExpiry("Kode ini akan kedaluwarsa dalam 15 menit."), true);
  assert.equal(hasFifteenMinuteExpiry("This code expires in 15 minutes."), true);
  assert.equal(hasFifteenMinuteExpiry("Verification code. Expires in 15 minutes"), true);
  assert.equal(hasTenMinuteExpiry("Kode berlaku 10 menit"), true);
  assert.equal(hasTenMinuteExpiry("This code expires in 10 minutes."), true);
});

/**
 * The two windows are asked as separate questions, on purpose.
 *
 * They used to be alternatives inside one predicate, which meant a sign-in mail
 * mentioning both ten and fifteen minutes was rejected outright -- and made the
 * `&& !hasFifteenMinuteExpiry` guard at the call site unreachable, because the
 * predicate had already answered true before it was consulted. Now the guard
 * does something: an access mail is one that carries the fifteen-minute window.
 */
test("an access mail that also mentions ten minutes is not mistaken for a short-window mail", () => {
  const mixed = "Kode ini berlaku selama 15 menit. Jangan bagikan ke siapa pun, berlaku 10 menit lagi sejak dikirim.";

  assert.equal(hasFifteenMinuteExpiry(mixed), true);
  assert.equal(hasTenMinuteExpiry(mixed), true);
  assert.equal(hasTenMinuteExpiry(mixed) && !hasFifteenMinuteExpiry(mixed), false);
});

/**
 * The account-change predicate answers on language, not on duration.
 *
 * It once listed a bare "10 menit" alternative, which meant it fired on any
 * message that merely mentioned ten minutes -- including the access mail above
 * -- and the call site's window check never got a turn.
 */
test("account-change detection answers on the language of changing an account", () => {
  assert.equal(isNetflixAccountChangeVerification("Konfirmasi perubahan akun Netflix Anda."), true);
  assert.equal(isNetflixAccountChangeVerification("Kode ini untuk mengonfirmasi perubahan data akun."), true);
  assert.equal(isNetflixAccountChangeVerification("Confirm your account change to continue."), true);

  for (const accessMail of [
    "Kode ini berlaku selama 15 menit. Jangan bagikan ke siapa pun.",
    "Kode berlaku 10 menit lalu orang lain bisa akses akunmu.",
    "Enter this code to sign in. Code expires in 15 minutes.",
  ]) {
    assert.equal(isNetflixAccountChangeVerification(accessMail), false, accessMail);
  }
});
