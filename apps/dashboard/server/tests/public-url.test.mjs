import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import { joinPublicUrl, publicWebsiteUrl } from "../lib/public-url.js";

const previousPublicDomain = process.env.PUBLIC_DOMAIN;

test("the legacy botPublicUrl still resolves, for databases not yet migrated", () => {
  const previous = process.env.PUBLIC_DOMAIN;
  delete process.env.PUBLIC_DOMAIN;
  try {
    assert.equal(publicWebsiteUrl({ settings: { botPublicUrl: "https://legacy.example" } }), "https://legacy.example");
  } finally {
    if (previous !== undefined) process.env.PUBLIC_DOMAIN = previous;
  }
});

test("the saved settings outrank PUBLIC_DOMAIN, and the fallback is last", () => {
  process.env.PUBLIC_DOMAIN = "https://env.example";
  try {
    assert.equal(publicWebsiteUrl({ settings: { publicDomain: "https://settings.example" } }), "https://settings.example");
    assert.equal(publicWebsiteUrl({ settings: {} }), "https://env.example");
  } finally {
    if (previousPublicDomain === undefined) delete process.env.PUBLIC_DOMAIN;
    else process.env.PUBLIC_DOMAIN = previousPublicDomain;
  }
  try {
    delete process.env.PUBLIC_DOMAIN;
    assert.equal(publicWebsiteUrl({}, { fallback: "http://127.0.0.1:4174" }), "http://127.0.0.1:4174");
  } finally {
    if (previousPublicDomain !== undefined) process.env.PUBLIC_DOMAIN = previousPublicDomain;
  }
});

test("an unconfigured instance never falls back to the production domain", () => {
  const previous = process.env.PUBLIC_DOMAIN;
  delete process.env.PUBLIC_DOMAIN;
  try {
    // The failure this guards: an instance nobody configured used to hand
    // customers links to the live site, because four copies of this
    // resolution each carried the production address as a default.
    assert.notEqual(publicWebsiteUrl({ settings: {} }, { fallback: "http://127.0.0.1:4174" }), "https://vya.baby");
    assert.notEqual(publicWebsiteUrl({ settings: {} }, { fallback: "http://127.0.0.1:4174" }), "https://www.vya.baby");
    assert.equal(publicWebsiteUrl({ settings: {} }, { fallback: "http://127.0.0.1:4174" }), "http://127.0.0.1:4174");
  } finally {
    if (previous !== undefined) process.env.PUBLIC_DOMAIN = previous;
  }
});

test("trailing slashes and surrounding whitespace never double up", () => {
  process.env.PUBLIC_DOMAIN = "  https://vya.baby///  ";
  try {
    assert.equal(publicWebsiteUrl({ settings: {} }), "https://vya.baby");
    assert.equal(joinPublicUrl({ settings: {} }, "/owner-v2/warranty"), "https://vya.baby/owner-v2/warranty");
    assert.equal(joinPublicUrl({ settings: {} }, "owner-v2/warranty"), "https://vya.baby/owner-v2/warranty");
    assert.equal(joinPublicUrl({ settings: {} }, "/"), "https://vya.baby");
  } finally {
    if (previousPublicDomain === undefined) delete process.env.PUBLIC_DOMAIN;
    else process.env.PUBLIC_DOMAIN = previousPublicDomain;
  }
});

test("joinPublicUrl degrades to the path when there is no base at all", () => {
  const previous = process.env.PUBLIC_DOMAIN;
  delete process.env.PUBLIC_DOMAIN;
  try {
    assert.equal(joinPublicUrl({ settings: {} }, "/owner-v2/warranty"), "/owner-v2/warranty");
  } finally {
    if (previous !== undefined) process.env.PUBLIC_DOMAIN = previous;
  }
});

test("no server file resolves the public domain its own way any more", () => {
  // The four copies disagreed about precedence and defaulted to three
  // different production addresses. They now all go through lib/public-url.js.
  const files = [
    "server/index.js",
    "server/routes/warranty-routes.js",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    // Ignore the Netflix household link map, which is product data rather
    // than configuration: it maps household domain aliases to a real site.
    const withoutHouseholdMap = source
      .split("\n")
      .filter((line) => !/vya\.baby|wesaveearth|storeify/.test(line) || /household/i.test(line))
      .join("\n");

    assert.doesNotMatch(
      withoutHouseholdMap,
      /https?:\/\/(?:www\.)?vya\.baby/,
      `${file} still hardcodes the production domain outside the household link map`,
    );
  }
});

test("the production domain survives only as data, never as a URL default", () => {
  // The Netflix household map legitimately names the live site: it routes a
  // customer's own account email to the page describing where to sign in.
  // That is product data. Every *other* mention of the address as a URL
  // default is a fork of the configuration that has no business existing.
  const dataOnlyScopes = new Set(["householdTargetForEmail"]);
  const filePath = path.resolve("server/index.js");
  const ast = ts.createSourceFile(filePath, fs.readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const offenders = [];
  function visit(node, scope) {
    const nextScope = node.name && ts.isFunctionLike(node) ? node.name.getText(ast) : scope;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (/^https?:\/\/(?:www\.)?vya\.baby/.test(node.text) && !dataOnlyScopes.has(scope)) {
        offenders.push(`${scope}: ${node.text}`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, nextScope));
  }
  visit(ast, "<top level>");
  assert.deepEqual(offenders, [], "the production domain must not appear as a default URL");
});
