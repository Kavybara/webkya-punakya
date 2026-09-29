import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTENT_SECURITY_POLICY,
  securityHeaders,
} from "../services/security-headers-service.js";

function runMiddleware({ secure = false } = {}) {
  const headers = new Map();
  let nextCalled = false;
  const middleware = securityHeaders({ isSecureRequest: () => secure });

  middleware(
    {},
    { setHeader: (name, value) => headers.set(name, value) },
    () => { nextCalled = true; },
  );

  return { headers, nextCalled };
}

test("security headers protect browser responses", () => {
  const { headers, nextCalled } = runMiddleware();

  assert.equal(nextCalled, true);
  assert.equal(headers.get("Content-Security-Policy"), CONTENT_SECURITY_POLICY);
  assert.match(headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=(), payment=(self)");
  assert.equal(headers.has("Strict-Transport-Security"), false);
});

test("HSTS is only sent for HTTPS requests", () => {
  const { headers } = runMiddleware({ secure: true });

  assert.equal(headers.get("Strict-Transport-Security"), "max-age=31536000");
});
