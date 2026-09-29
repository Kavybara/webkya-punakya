import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The app had four copies of the rupiah formatter and ten of the Indonesian
 * date formatter. Three of the currency copies dropped the `IDR` -> `Rp`
 * replacement, so the same balance read "Rp25.000" in the owner console and
 * "IDR 25.000" in the reseller console.
 *
 * Consolidation is easy to undo by copy-paste, so this holds the line: money
 * and dates are formatted in `src/lib/format.ts` and nowhere else.
 */

const SRC = path.resolve("src");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
  });
}

const rel = (file) => path.relative(path.resolve(), file).replace(/\\/g, "/");
const FORMATTER = path.join(SRC, "lib", "format.ts");

test("rupiah is formatted in exactly one place", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => file !== FORMATTER)
    .filter((file) => /currency:\s*"IDR"/.test(fs.readFileSync(file, "utf8")))
    .map(rel);

  assert.deepEqual(offenders, [], `inline IDR formatter in ${offenders.join(", ")}`);
});

test("no page hand-rolls an Rp prefix", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => file !== FORMATTER)
    .filter((file) => /`Rp|\bRp\$\{/.test(fs.readFileSync(file, "utf8")))
    .map(rel);

  assert.deepEqual(offenders, [], `hand-rolled Rp prefix in ${offenders.join(", ")}`);
});

test("Indonesian date formatting is centralised too", () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => file !== FORMATTER)
    .filter((file) =>
      /toLocale(String|DateString)\("id-ID",\s*\{/.test(fs.readFileSync(file, "utf8")),
    )
    .map(rel);

  assert.deepEqual(offenders, [], `inline id-ID date formatting in ${offenders.join(", ")}`);
});
