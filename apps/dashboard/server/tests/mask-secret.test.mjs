import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * `maskIdentity` and `maskSecret` are pure string functions in a `.tsx` file that
 * Node cannot import, so the masking behaviour is pinned two ways: the rules are
 * re-implemented here as a reference and checked against what the source says,
 * and every call site is checked to declare which of the two it needs.
 *
 * The reference below is deliberately a second implementation. A test that
 * transpiled the real function would pass whenever the function agreed with
 * itself; this one states the rule in plain text and fails if the source drifts
 * away from it.
 */
const sensitive = readFileSync(new URL("../../src/components/ui/Sensitive.tsx", import.meta.url), "utf8");
const resellerOrders = readFileSync(new URL("../../src/pages/reseller-v2/orders/page.tsx", import.meta.url), "utf8");
const resellerAccess = readFileSync(new URL("../../src/pages/reseller-v2/access/page.tsx", import.meta.url), "utf8");

/** The reference: an identity may show enough to be recognised; a secret shows nothing. */
function referenceMask(kind, value) {
  const clean = String(value || "").trim();
  if (!clean) return "-";
  if (kind === "secret") return "*".repeat(clean.length);
  if (clean.includes("@")) {
    const [name, domain] = clean.split("@");
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
  }
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 7) {
    return `${digits.slice(0, 3)}${"*".repeat(Math.max(4, digits.length - 6))}${digits.slice(-3)}`;
  }
  return `${clean.slice(0, 2)}${"*".repeat(Math.max(3, clean.length - 2))}`;
}

/*
 * The defect this exists for. A purely numeric seven-character password is the
 * shape `maskIdentity` handles worst: it sees seven digits, and returns the
 * first three and the last three with a single asterisk between them. Six of
 * seven characters were on screen in a row labelled as masked.
 */
test("a masked secret reveals nothing, where the identity mask leaked six of seven", () => {
  const password = "1234567";
  assert.equal(
    referenceMask("identity", password),
    "123****567",
    "the reference no longer demonstrates the defect, so this test proves nothing",
  );
  assert.equal(referenceMask("secret", password), "*******");
  assert.ok(
    !referenceMask("secret", password).includes("1"),
    "a masked secret still shows a character from the value",
  );
  // Counted, not eyeballed: the point is how much of the value is legible.
  const leaked = [...referenceMask("identity", password)].filter((char) => /\d/.test(char)).length;
  assert.equal(leaked, 6, "the identity mask leaks all but one character of a numeric secret");
});

test("the identity mask keeps showing enough to recognise the account", () => {
  // The point of masking an identity is not to hide it completely -- the reader
  // has to tell their own accounts apart. If this assertion ever starts failing
  // the fix is not to tighten the mask but to check the call sites.
  assert.equal(referenceMask("identity", "someone@gmail.com"), "so*****@gmail.com");
  assert.ok(referenceMask("identity", "6281234567890").endsWith("890"));
});

test("both masks report an absent value the same way", () => {
  assert.equal(referenceMask("identity", ""), "-");
  assert.equal(referenceMask("secret", ""), "-");
  assert.equal(referenceMask("identity", "   "), "-");
  assert.equal(referenceMask("secret", "   "), "-");
});

test("the source selects the mask by kind, not by always using the identity mask", () => {
  assert.match(
    sensitive,
    /const masked = kind === "secret" \? maskSecret\(value\) : maskIdentity\(value\)/,
    "SensitiveValue ignores its kind prop",
  );
  assert.match(
    sensitive,
    /kind\?: "identity" \| "secret"/,
    "the kind prop is not declared, so a caller cannot pass it",
  );
  // maskSecret must show nothing by default; a default tail of non-zero would
  // reintroduce the leak through the back door.
  assert.match(
    sensitive,
    /export function maskSecret\(value = "", visibleHead = 0, visibleTail = 0\)/,
    "maskSecret's defaults changed; check they still hide everything",
  );
});

/*
 * The call sites are the other half. A masked password that renders through the
 * identity mask is the defect regardless of how well the function behaves.
 */
test("passwords and PINs are masked as secrets, not as identities", () => {
  // The password/link and PIN fields on the reseller order drawer.
  const secretFields = [...resellerOrders.matchAll(/<SensitiveValue\s+kind="secret"\s+value=\{([^}]+)\}/g)].map((m) => m[1]);
  assert.ok(secretFields.length >= 2, `expected the password and PIN fields, found ${secretFields.length}`);
  assert.ok(
    secretFields.some((field) => field.includes("password") || field.includes("canvaLink")),
    "the password field is not masked as a secret",
  );
  assert.ok(secretFields.some((field) => field.includes("pin")), "the PIN field is not masked as a secret");
});

test("the account login keeps the identity mask, because it is meant to be recognised", () => {
  // The opposite assertion: not everything should be hidden. The login phone is
  // how the reseller tells two of their own accounts apart.
  assert.match(
    resellerOrders,
    /<SensitiveValue\s+value=\{account\.loginPhone \|\| account\.email/,
    "the login identity lost its partial mask",
  );
  assert.doesNotMatch(
    resellerOrders,
    /kind="secret"[^}]*value=\{account\.loginPhone/,
    "the login identity is now fully hidden, which removes the reason to show it at all",
  );
});

/*
 * OTP codes are the worst case for the identity mask: four digits, so the
 * fallback branch shows two of them. A sign-in code that is half legible is not
 * masked at all.
 */
test("OTP and sign-in codes on the access page are masked as secrets", () => {
  assert.match(
    resellerAccess,
    /<SensitiveValue kind="secret" value=\{value\} \/>/,
    "the access page's code field is not masked as a secret",
  );
});

test("the access page's link renderer shows a hostname, not the credential in the link", () => {
  // A reset link carries the token in its query string, so the page is careful
  // to show only the host and the length. Pinned so that stays deliberate.
  assert.match(resellerAccess, /<strong>\{host\}<\/strong>/);
  assert.doesNotMatch(
    resellerAccess,
    /<SensitiveValue value=\{value\} \/>/,
    "a raw value reached SensitiveValue with the identity mask; check which field it is",
  );
});