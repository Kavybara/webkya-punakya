import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../index.js", import.meta.url);

test("owner login can be bootstrapped from explicit .env credentials after restore", async () => {
  const source = await fs.readFile(sourcePath, "utf8");

  assert.match(source, /envPassword,\s*\n\s*};/);
  assert.match(source, /verifyPassword\(password,\s*credentials\.envPassword/);
  assert.match(source, /process\.env\.OWNER_USERNAME,\s*process\.env\.OWNER_LOGIN_USERNAME/);
  assert.match(source, /settings\.ownerUsername\s*=\s*envOwnerUsername/);
  assert.match(source, /envOwnerPassword && !verifyPassword\(envOwnerPassword,\s*settings\.ownerPasswordHash/);
  assert.match(source, /settings\.ownerPasswordHash\s*=\s*hashPassword\(envOwnerPassword\)/);
  assert.match(source, /path\.join\(process\.cwd\(\), "\.env"\)/);
  assert.match(source, /path\.resolve\(__dirname, "\.\.", "\.\.", "\.\.", "\.env"\)/);
  assert.match(source, /firstConfigured\(process\.env\.OWNER_USERNAME,\s*process\.env\.OWNER_LOGIN_USERNAME,\s*db\.settings\?\.ownerUsername/);
  assert.match(source, /firstConfigured\(process\.env\.OWNER_EMAIL,\s*process\.env\.OWNER_LOGIN_EMAIL,\s*db\.settings\?\.ownerEmail/);
  assert.match(source, /function normalizeConfiguredUrl/);
  assert.match(source, /markdownLink \? markdownLink\[2\]/);
  assert.match(source, /setIfConfigured\("publicDomain", envPublicDomain \|\| defaultPublicDomain\)/);
  assert.match(source, /setIfConfigured\("baileyWebhookUrl"/);
});
