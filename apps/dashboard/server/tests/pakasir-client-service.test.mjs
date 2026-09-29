import assert from "node:assert/strict";
import test from "node:test";

import { requestPakasirJsonWithRetry, shouldEnablePakasirMaintenance } from "../services/pakasir-client-service.js";

test("Pakasir request retries once after a timeout and returns JSON", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, payment: { order_id: "PAY-TEST" } }),
    };
  };

  const result = await requestPakasirJsonWithRetry("https://app.pakasir.com/api/test", {
    fetcher,
    timeoutMs: 10,
    retryDelayMs: 0,
    retries: 1,
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, { ok: true, payment: { order_id: "PAY-TEST" } });
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
});

test("Pakasir request keeps the last timeout error after retries are exhausted", async () => {
  const fetcher = async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  };

  await assert.rejects(
    requestPakasirJsonWithRetry("https://app.pakasir.com/api/test", {
      fetcher,
      timeoutMs: 10,
      retryDelayMs: 0,
      retries: 1,
    }),
    /Pakasir request timeout after 2 attempts/,
  );
});

test("Pakasir timeout is treated as transient and does not enable sticky maintenance", () => {
  assert.equal(shouldEnablePakasirMaintenance("Pakasir QRIS gagal: Pakasir timeout."), false);
  assert.equal(shouldEnablePakasirMaintenance("Pakasir QRIS gagal: fetch failed"), false);
  assert.equal(shouldEnablePakasirMaintenance("Pakasir QRIS gagal: PAKASIR_PROJECT atau PAKASIR_API_KEY belum tersedia."), true);
});
