import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await fs.readFile(new URL("../../package-lock.json", import.meta.url), "utf8"));

test("dashboard declares the statically imported IMAP client as a runtime dependency", () => {
  assert.equal(manifest.dependencies.imapflow, "^1.3.5");
});

test("dashboard lockfile installs IMAP directly without root dependency hoisting", () => {
  assert.equal(lock.packages[""].dependencies.imapflow, manifest.dependencies.imapflow);
  assert.ok(lock.packages["node_modules/imapflow"], "the dashboard lockfile must contain an installable IMAP client");
  assert.notEqual(lock.packages["node_modules/imapflow"].dev, true);
});
