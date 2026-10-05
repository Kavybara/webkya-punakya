import assert from "node:assert/strict";
import test from "node:test";
import { redactLogValue, requestTelemetry, registerLogSecrets } from "../../../../packages/shared/observability.mjs";

test("logs redact nested secrets, URL tokens, Bearer values and registered opaque credentials", () => {
  registerLogSecrets({ arbitraryToken: "fixture-opaque-provider-value" });
  const redacted = redactLogValue({ password: "do-not-log", nested: { apiKey: "secret-key", ok: "visible" }, message: "https://example.test/?api_key=secret-value Bearer opaque-session-token fixture-opaque-provider-value" });
  const serialized = JSON.stringify(redacted);
  for (const secret of ["do-not-log", "secret-key", "secret-value", "opaque-session-token", "fixture-opaque-provider-value"]) assert.equal(serialized.includes(secret), false);
  assert.equal(redacted.nested.ok, "visible");
});

test("HTTP logs use generated IDs and route patterns, never request bodies, queries or raw personal paths", () => {
  const logs = [];
  const middleware = requestTelemetry((record) => logs.push(record));
  let finish;
  const headers = {};
  const req = { method: "POST", route: { path: "/api/accounts/:id" }, url: "/api/accounts/private@example.test?token=secret", body: { password: "secret" }, headers: { "x-request-id": "attacker-input" } };
  const res = { statusCode: 200, setHeader: (key, value) => { headers[key] = value; }, once: (event, fn) => { if (event === "finish") finish = fn; } };
  let continued = false;
  middleware(req, res, () => { continued = true; });
  finish();
  assert.equal(continued, true);
  assert.match(headers["X-Request-ID"], /^[a-f0-9-]{36}$/);
  assert.equal(logs[0].route, "/api/accounts/:id");
  assert.equal(logs[0].requestId, req.requestId);
  assert.equal(JSON.stringify(logs).includes("secret"), false);
  assert.equal(JSON.stringify(logs).includes("private@example.test"), false);
});
