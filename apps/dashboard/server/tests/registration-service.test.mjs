import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupRegistrationOtps,
  normalizeRegistrationInput,
  registrationRateLimit,
  selfRegistrationWelcomeMessage,
  validateRegistrationInput,
} from "../services/registration-service.js";

test("registration input normalizes Indonesian WhatsApp and identity fields", () => {
  const input = normalizeRegistrationInput({
    name: "  Nadia   Store ",
    username: "Nadia.Store",
    email: "NADIA@example.com",
    whatsapp: "0812-3456-7890",
    password: "masuk123",
    confirmPassword: "masuk123",
  });
  assert.equal(input.name, "Nadia Store");
  assert.equal(input.username, "nadia.store");
  assert.equal(input.email, "nadia@example.com");
  assert.equal(input.whatsapp, "6281234567890");
  assert.equal(validateRegistrationInput(input), "");
});

test("registration rejects mismatched password and invalid username", () => {
  const input = normalizeRegistrationInput({
    name: "Nadia",
    username: "na",
    email: "nadia@example.com",
    whatsapp: "081234567890",
    password: "masuk123",
    confirmPassword: "beda1234",
  });
  assert.match(validateRegistrationInput(input), /Username/);
  input.username = "nadia";
  assert.match(validateRegistrationInput(input), /Konfirmasi/);
});

test("registration OTP enforces resend and hourly limits", () => {
  const now = 1_000_000;
  const records = [{ whatsapp: "6281234567890", createdAtMs: now - 20_000 }];
  assert.equal(registrationRateLimit(records, "6281234567890", now).reason, "resend_wait");
  const many = Array.from({ length: 5 }, (_, index) => ({ whatsapp: "6281234567890", createdAtMs: now - index * 70_000 }));
  assert.equal(registrationRateLimit(many, "6281234567890", now).reason, "hourly_limit");
});

test("OTP records remain for rate limiting until the 24-hour audit window ends", () => {
  const now = 100_000_000;
  const db = {
    registrationOtps: [
      { id: "old", createdAtMs: now - 24 * 60 * 60 * 1000 - 1, expiresAtMs: now - 1 },
      { id: "expired", createdAtMs: now - 20 * 60 * 1000, expiresAtMs: now - 10 * 60 * 1000, codeHash: "hash", passwordHash: "hash" },
      { id: "active", createdAtMs: now - 60_000, expiresAtMs: now + 60_000, codeHash: "hash", passwordHash: "hash" },
    ],
  };
  cleanupRegistrationOtps(db, now);
  assert.deepEqual(db.registrationOtps.map((item) => item.id), ["expired", "active"]);
  assert.equal("code" in db.registrationOtps[0], false);
  assert.equal("password" in db.registrationOtps[0], false);
});

test("self-registration welcome message contains account summary without password", () => {
  const message = selfRegistrationWelcomeMessage({
    name: "Iky",
    username: "iky",
    email: "iky@vya.baby",
    whatsapp: "628123456789",
    password: "rahasia123",
    passwordHash: "scrypt$secret",
    deposit: 11000,
    isActive: true,
  });

  assert.match(message, /Welcome .* Iky!/);
  assert.match(message, /Username : iky/);
  assert.match(message, /Email    : iky@vya\.baby/);
  assert.match(message, /Status   : Aktif/);
  assert.match(message, /Saldo    : Rp 11\.000/);
  assert.doesNotMatch(message, /rahasia123|scrypt\$secret|628123456789/);
});
