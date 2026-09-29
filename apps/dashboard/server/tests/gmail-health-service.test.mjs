import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyGmailConnectionError,
  createGmailHealthService,
} from "../services/gmail-health-service.js";

const config = {
  host: "imap.gmail.test",
  port: 993,
  secure: true,
  auth: { user: "owner@example.test", pass: "app-password" },
};

test("Gmail health performs a real connection check and caches the safe result", async () => {
  let connects = 0;
  let logouts = 0;
  const service = createGmailHealthService({
    createClient: () => ({
      async connect() { connects += 1; },
      async logout() { logouts += 1; },
    }),
    now: () => 1_000,
  });

  assert.equal((await service.check(config)).connected, true);
  assert.equal((await service.check(config)).connected, true);
  assert.equal(connects, 1);
  assert.equal(logouts, 1);
});

test("Gmail health reports invalid IMAP credentials without exposing server details", async () => {
  const service = createGmailHealthService({
    createClient: () => ({
      async connect() {
        const error = new Error("Command failed");
        error.responseText = "Invalid credentials (Failure)";
        throw error;
      },
      async logout() {},
    }),
  });

  const result = await service.check(config);
  assert.equal(result.connected, false);
  assert.equal(result.errorCode, "invalid_credentials");
  assert.match(result.error, /Kredensial Gmail ditolak/);
  assert.doesNotMatch(result.error, /Command failed|owner@example|app-password/);
});

test("Gmail lookup errors use a safe owner-facing classification", () => {
  assert.deepEqual(
    classifyGmailConnectionError({ responseText: "Invalid credentials (Failure)" }),
    {
      code: "invalid_credentials",
      message: "Kredensial Gmail ditolak. Perbarui koneksi Gmail melalui panel Owner.",
    },
  );
});
