import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createHttpServer } from "../../../bot/handle/server.js";
import {
  configuredOrigins,
  corsOptions,
  hashPassword,
  sessionCookie,
  verifyPassword,
} from "../security.js";

test("password is stored as scrypt hash and verifies safely", () => {
  const hash = hashPassword("correct horse battery staple");
  assert.match(hash, /^scrypt\$/);
  assert.equal(hash.includes("correct horse"), false);
  assert.equal(verifyPassword("correct horse battery staple", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});

test("session cookie is HttpOnly and secure when requested", () => {
  const cookie = sessionCookie("secret-token", { secure: true, maxAgeSeconds: 3600 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=3600/);
});

test("CORS only accepts configured origins", async () => {
  const origins = configuredOrigins("https://www.vya.baby");
  assert.equal(origins.has("https://www.vya.baby"), true);
  assert.equal(origins.has("https://vya.baby"), true);
  const options = corsOptions(origins);
  await new Promise((resolve, reject) => options.origin("https://vya.baby", (error, allowed) => error ? reject(error) : resolve(allowed)));
  await assert.rejects(
    new Promise((resolve, reject) => options.origin("https://attacker.example", (error, allowed) => error ? reject(error) : resolve(allowed))),
    /Origin tidak diizinkan/,
  );
});

test("WhatsApp bot rejects query token and accepts Bearer token", async (t) => {
  const connection = {
    getHealthPayload: () => ({ ok: true }),
    getStatusPayload: () => ({ connected: true }),
  };
  const server = createHttpServer({ config: { token: "bot-secret" }, connection });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const queryResponse = await fetch(`http://127.0.0.1:${port}/session/status?token=bot-secret`);
  assert.equal(queryResponse.status, 401);
  const bearerResponse = await fetch(`http://127.0.0.1:${port}/session/status`, {
    headers: { Authorization: "Bearer bot-secret" },
  });
  assert.equal(bearerResponse.status, 200);
});
