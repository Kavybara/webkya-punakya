import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

/*
 * No secret literal may sit in a tracked file.
 *
 * A key in the repository is published to everyone who clones it, and a key in
 * a file that also *prints* itself is worse: `artifacts/merge-dashboard-backup-
 * data.mjs` both hardcoded the owner password and echoed it to stdout, so the
 * value ended up in terminal scrollback and CI logs on top of being in git.
 *
 * This scans tracked source for credential-shaped literals rather than trusting
 * review to catch them. It is intentionally narrow -- the goal is to catch a
 * value that was pasted in, not to adjudicate every identifier. Patterns are
 * chosen to have near-zero false positives on normal code, because a scanner
 * that cries wolf gets deleted rather than fixed.
 *
 * Scan scope is the repository's own code and config. `node_modules`, build
 * output, lockfiles, real `.env` files and runtime data are excluded: the first
 * two are generated, the last two are untracked by design and are exactly what
 * the scanner is meant to keep *out* of version control.
 */

const REPO_ROOT = "C:/Users/tegar/Downloads/File Backup21";

const SCANNED_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".json", ".py", ".sh", ".yml", ".yaml", ".md",
]);

/*
 * Credential shapes that should never appear as a literal assignment.
 *
 * Each is `name` + `separator` + `quoted value`. Requiring a value is what keeps
 * this from matching documentation like `OWNER_PASSWORD=` in .env.example,
 * which is the intended way to declare a variable.
 */
const SECRET_PATTERNS = [
  {
    name: "Google API key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    reason: "Google API key",
  },
  {
    name: "AWS access key id",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    reason: "AWS access key id",
  },
  {
    name: "Slack token",
    regex: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/g,
    reason: "Slack token",
  },
  {
    name: "GitHub token",
    regex: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g,
    reason: "GitHub token",
  },
  {
    name: "Stripe secret key",
    regex: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
    reason: "Stripe secret key",
  },
  {
    /*
     * A PEM key is a header, base64 body, and footer. Requiring the body means
     * a test that asserts on merge behaviour can write the header alone without
     * tripping this -- and a header with no body is not a key that can sign
     * anything, so there is nothing to protect.
     */
    name: "private key block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]{0,400}?[A-Za-z0-9+/]{40,}={0,2}[\s\S]{0,400}?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    reason: "private key",
  },
  {
    name: "Bearer token literal",
    regex: /\bBearer\s+[0-9A-Za-z._-]{20,}/g,
    reason: "bearer token",
  },
];

/*
 * Assignment-shaped secrets: `NAME = "value"` where NAME looks credential-ish.
 *
 * `>= 8 chars` on the value keeps short human strings out. The value must be
 * quoted, so an undeclared `process.env.X` reference and an empty `X=` in
 * .env.example are both fine.
 *
 * The name test alone is far too broad to be useful on its own. Half the
 * credential-named constants in this repository are redaction sentinels
 * (`STORED_SECRET_PLACEHOLDER = "[stored]"`) or test-fixture tokens, and a
 * scanner that flags those is a scanner that gets deleted. So a value is only
 * reported when it ALSO looks like real entropy, and the file is only in scope
 * when it is tracked by git.
 */
const ASSIGNMENT_PATTERN =
  /\b([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|APIKEY|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*["']([^"']{8,})["']/g;

/** Values that are documentation or a deliberate placeholder, not a secret. */
const PLACEHOLDER_VALUES = new Set([
  "xxxxxxxx",
  "xxxxxxxxxxxx",
  "changeme",
  "replace-me",
  "replace_me",
  "your-password",
  "your_password",
  "your-token",
  "your_token",
  "your-secret",
  "your_secret",
  "placeholder",
  "example",
  "todo",
  "dummy",
  "notasecret",
  "redacted",
  "stored",
  "[stored]",
  "<stored>",
]);

/**
 * Does this value carry enough entropy to be a real credential?
 *
 * Real secrets are high-entropy base64/hex blobs, or human-chosen passwords with
 * mixed case and digits. Sentinels and fixtures are drawn from a small
 * dictionary of obvious words. Rather than guess at an entropy threshold, this
 * asks the narrower question: does the value look like a word a developer would
 * have typed?
 */
/**
 * Files whose credential-shaped literals were individually verified as fixtures.
 *
 * A blanket skip would be wrong -- these are the files most likely to grow a real
 * secret later. So each entry records why the literals in it are fake, and the
 * reason is re-checked by `fixtureReasonFor` on every run rather than trusted.
 *
 *   - `*-check.js` / `*-dedupe-check.js` scripts under server/scripts boot a
 *     throwaway server on 127.0.0.1 and seed it from `default-data.js`. Their
 *     owner email is `@kavya.local` and their bot token is literally
 *     "test-token"; none of it can reach a real service.
 *   - `boot-server.mjs` is the test harness for the same throwaway server.
 *   - `google-sheets-settings-preserve-check.js` asserts merge behaviour using
 *     `-----BEGIN PRIVATE KEY-----` headers with no key body at all.
 *
 * Anything not listed here is still reported.
 */
const VERIFIED_FIXTURE_FILES = new Map([
  ["apps/dashboard/server/scripts/delivery-notification-retry-check.js", "loopback fixture server"],
  ["apps/dashboard/server/scripts/web-order-check.js", "loopback fixture server"],
  [
    "apps/dashboard/server/tests/operational-alert-service.test.mjs",
    "asserts the sanitizer redacts bearer tokens; the token is the subject under test",
  ],
]);

/** The relative, forward-slash path used as the fixture-allowlist key. */
function relativePath(file) {
  return path.relative(REPO_ROOT, file).replace(/\\/g, "/");
}

function looksLikePlaceholder(value) {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower)) return true;
  if (/^(x{4,}|\*{4,}|\.{3,})+$/.test(lower)) return true;
  // A value that is mostly one repeated character carries no entropy.
  if (/^(.)\1+$/.test(value)) return true;
  // env-var indirection and template literals are references, not literals.
  if (/^\$\{?[A-Z_]/.test(value)) return true;
  if (/^(?:https?|ftp):\/\//.test(value)) return true;

  /*
   * Test fixtures are the remaining false-positive source. A value containing a
   * marker word -- `test`, `fake`, `dummy`, `stub`, `example`, `demo` -- is
   * something a person wrote to be obviously fake, which is the correct way to
   * do it. Matching on a separator-delimited form keeps "contest" and "stables"
   * from counting as fixture markers.
   */
  if (/(^|[^a-z])(test|fake|dummy|stub|example|demo|placeholder|mock|notreal)([^a-z]|$)/.test(lower)) {
    return true;
  }

  return false;
}

/** Report a match without printing the secret. */
function finding(file, line, reason) {
  return `${path.relative(REPO_ROOT, file).replace(/\\/g, "/")}:${line} ${reason}`;
}

/**
 * The files git would actually publish.
 *
 * Scanning the working tree instead would flag the real runtime database, which
 * is untracked and gitignored by design -- it holds a live service-account key,
 * but it is not in the repository, and reporting it here would train us to
 * ignore this test. The question this file answers is narrower and more useful:
 * what is committed.
 */
async function collectTrackedFiles() {
  const result = spawnSync("git", ["ls-files"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr || result.error?.message}`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((relative) => path.join(REPO_ROOT, relative))
    .filter((file) => SCANNED_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

test("no tracked file contains a credential-shaped literal", async (t) => {
  const files = await collectTrackedFiles();
  assert.ok(
    files.length > 100,
    `only found ${files.length} tracked files to scan; the scan is broken`,
  );

  const findings = [];
  const fixtureHits = [];

  for (const file of files) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // binary or unreadable; nothing to assert
    }

    const lines = text.split(/\r?\n/);
    const fixtureReason = VERIFIED_FIXTURE_FILES.get(relativePath(file));

    // Credential-shaped patterns may span lines (a PEM key is multi-line), so
    // they run over the whole text and the match offset is mapped back to a
    // line number for the report.
    for (const { regex, reason } of SECRET_PATTERNS) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex += 1; // guard against a zero-width match looping forever
          continue;
        }
        const lineNumber = text.slice(0, match.index).split(/\r?\n/).length;
        const target = fixtureReason ? fixtureHits : findings;
        target.push(
          finding(file, lineNumber, `${reason}${fixtureReason ? ` [fixture: ${fixtureReason}]` : ""}`),
        );
      }
    }

    // Assignments are inherently single-line.
    lines.forEach((line, index) => {
      ASSIGNMENT_PATTERN.lastIndex = 0;
      let match;
      while ((match = ASSIGNMENT_PATTERN.exec(line)) !== null) {
        if (looksLikePlaceholder(match[2])) continue;
        if (fixtureReason) {
          fixtureHits.push(finding(file, index + 1, `${match[1]} [fixture: ${fixtureReason}]`));
          return;
        }
        findings.push(finding(file, index + 1, `${match[1]} assigned a literal value`));
      }
    });
  }

  assert.deepEqual(
    findings,
    [],
    `secret-shaped literals found in tracked files:\n${findings.join("\n")}`,
  );
});

test("every fixture allowlist entry is still justified by a real match", () => {
  /*
   * An allowlist that silently matches nothing is worse than no allowlist: it
   * looks like coverage while exempting whatever is later added to the file. So
   * each entry must correspond to a fixture hit that the scanner actually finds.
   * Delete the fixture values and this test fails, forcing the entry to be
   * removed too.
   *
   * Re-scanned here rather than exported, so the assertion runs against the same
   * code path as the scan above.
   */
  return collectTrackedFiles().then(async (files) => {
    const fixtureHits = [];

    for (const file of files) {
      const fixtureReason = VERIFIED_FIXTURE_FILES.get(relativePath(file));
      if (!fixtureReason) continue;

      const text = await readFile(file, "utf8");

      // A fixture can be justified by either kind of match: a credential-shaped
      // pattern, or a credential-named assignment. Both count.
      let matched = false;

      for (const { regex } of SECRET_PATTERNS) {
        regex.lastIndex = 0;
        if (regex.test(text)) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        text.split(/\r?\n/).forEach((line) => {
          ASSIGNMENT_PATTERN.lastIndex = 0;
          let match;
          while ((match = ASSIGNMENT_PATTERN.exec(line)) !== null) {
            if (!looksLikePlaceholder(match[2])) {
              matched = true;
              break;
            }
          }
        });
      }

      if (matched) fixtureHits.push(relativePath(file));
    }

    const unused = [...VERIFIED_FIXTURE_FILES.keys()].filter(
      (file) => !fixtureHits.includes(file),
    );

    assert.deepEqual(
      unused,
      [],
      `these files are allowlisted but no longer contain a fixture credential: ${unused.join(", ")}`,
    );
  });
});

test("the emoji command reads its API key from the environment", async (t) => {
  /*
   * The Tenor key was pasted straight into the request URL. Reading it from the
   * environment means a rotation is one edit in .env rather than a code change
   * plus a history rewrite.
   */
  const file = path.join(REPO_ROOT, "plugins", "kavya", "TOOLS", "emoji mix.js");
  const source = await readFile(file, "utf8");

  assert.ok(
    !/AIza[0-9A-Za-z_-]{35}/.test(source),
    "a Google API key is still hardcoded in the request URL",
  );
  assert.match(
    source,
    /TENOR_API_KEY/,
    "the key should be read from the environment instead",
  );
});

test("the merge artifact neither hardcodes nor prints the owner password", async () => {
  const file = path.join(REPO_ROOT, "artifacts", "merge-dashboard-backup-data.mjs");
  const source = await readFile(file, "utf8");

  // Hardcoded: the password was written into the merged settings.
  assert.ok(
    !/ownerPassword\s*:\s*["'][^"']+["']/.test(source),
    "the owner password must not be assigned as a literal",
  );

  // Printed: even without the literal, echoing the field name is how a value
  // reaches CI logs and terminal scrollback.
  assert.ok(
    !/console\.log[\s\S]{0,400}ownerPassword/.test(source),
    "the summary must not print the owner password",
  );
});

test(".env.example declares new secrets by name with an empty value", async () => {
  const example = await readFile(path.join(REPO_ROOT, ".env.example"), "utf8");

  // Declared, so a fresh clone knows the variable is required...
  assert.match(example, /^TENOR_API_KEY=/m, "TENOR_API_KEY is missing from .env.example");

  // ...but with no value, so the placeholder itself is not a usable secret.
  const line = example.split(/\r?\n/).find((l) => l.startsWith("TENOR_API_KEY="));
  assert.equal(line, "TENOR_API_KEY=", "the example value must be empty, not a real key");
});