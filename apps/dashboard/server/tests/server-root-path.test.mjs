import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("legacy paths start at the repository root, not its apps directory", async () => {
  const source = await fs.readFile(new URL("../index.js", import.meta.url), "utf8");
  const declaration = source.match(/const legacyRootDir = ([^;]+);/);
  assert.ok(declaration);
  const serverDir = fileURLToPath(new URL("../", import.meta.url));
  const actual = Function("path", "__dirname", "process", `return ${declaration[1]}`)(path, serverDir, { env: {} });
  assert.equal(actual, fileURLToPath(new URL("../../../../", import.meta.url)).replace(/[\\/]$/, ""));
});
