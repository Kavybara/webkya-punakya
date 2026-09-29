import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

/**
 * `outline-none` without a replacement is the worst outcome for keyboard
 * focus: the control looks unfocused because it is. Three inputs in this
 * app had it -- the quantity stepper, the product sort select, and the
 * read-only warranty fields -- and a keyboard user tabbing the checkout
 * had no idea where they were.
 *
 * This scans for the pattern rather than the instances, because the classes
 * are copy-pasted and the copy is what keeps drifting.
 */

const SRC = path.resolve("src");

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every string literal in the file, with its line number. */
function classNameLiterals(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const ast = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push({ text: node.text, line: source.slice(0, node.pos).split("\n").length });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

/** The rule the scan enforces, kept as a function so it can be tested too. */
function dropsFocusRing(className) {
  return /\boutline-none\b/.test(className) && !/\bfocus(-visible)?:/.test(className);
}

test("the scan actually rejects what it claims to reject", () => {
  // A guard that cannot fail guards nothing. These are the exact three
  // classes that shipped with the defect.
  assert.equal(dropsFocusRing("h-11 w-12 outline-none"), true);
  assert.equal(dropsFocusRing("h-9 rounded-md outline-none"), true);
  assert.equal(dropsFocusRing("rounded-xl outline-none"), true);

  // The same controls once they were fixed.
  assert.equal(dropsFocusRing("outline-none focus:border-red-200"), false);
  assert.equal(dropsFocusRing("outline-none focus-visible:ring-2"), false);
  // Controls that never had an outline in the first place are not our business.
  assert.equal(dropsFocusRing("h-11 focus:border-emerald-300"), false);
});

test("no control drops its focus ring without putting one back", () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    for (const { text, line } of classNameLiterals(file)) {
      if (dropsFocusRing(text)) offenders.push(`${path.relative(path.resolve(), file)}:${line}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `outline-none with no focus: replacement at ${offenders.join(", ")}`,
  );
});
