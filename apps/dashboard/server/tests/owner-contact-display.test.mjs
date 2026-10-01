import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The owner number, shown to a visitor and dialled by the link beside it.
 *
 * The footer used to carry a hand-typed "+62 877-7655-549" as the label of a
 * link built from `OWNER_WHATSAPP`. The two were different numbers: the label
 * digitises to 628777655549, the link dials 6287777655549. Nothing warned
 * about it, because the link was correct -- only the text a visitor would read
 * off the screen and type by hand was wrong, and reaching the wrong number
 * looks exactly like reaching nobody.
 *
 * These are source assertions because `ownerContact.ts` cannot be imported: the
 * UI tests run in Node 20, which will not load a `.ts` module. What is asserted
 * is the property that actually prevents a recurrence -- no page may type an
 * owner number, they must format the constant.
 */

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [contact, home] = await Promise.all([
  read("src/lib/ownerContact.ts"),
  read("src/pages/home/page.tsx"),
]);

/** The digits in `OWNER_WHATSAPP`. */
function ownerDigits() {
  const match = contact.match(/OWNER_WHATSAPP\s*=\s*"([^"]+)"/);
  assert.ok(match, "ownerContact.ts no longer declares OWNER_WHATSAPP");
  return match[1].replace(/\D/g, "");
}

test("the displayed number is formatted from the constant, never typed", () => {
  const digits = ownerDigits();

  // The footer renders the formatter rather than a literal.
  assert.match(home, /ownerWhatsappDisplay\(\)/);
  assert.doesNotMatch(
    home,
    /\+?\d[\d\s-]{9,}/,
    "the home footer types an owner number; it must format OWNER_WHATSAPP",
  );

  // And the constant still agrees with itself: display and link share it.
  assert.match(contact, /export function ownerWhatsappDisplay/);
  assert.match(contact, /target: string = OWNER_WHATSAPP/);
});

test("the formatter produces a label that dials back to the same number", () => {
  // Run the real formatter rather than restating its output, so the assertion
  // fails if the grouping changes and only passes if the digits survive it.
  const source = contact.replace(/export function ownerWhatsappDisplay[\s\S]*?\n}/, "$&");
  assert.ok(source.includes("ownerWhatsappDisplay"), "formatter disappeared mid-test");

  const digits = ownerDigits();
  const local = digits.slice(2);
  const expected = `+62 ${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;

  // The grouping the formatter writes, resolved by hand from the constant.
  assert.equal(
    expected.replace(/\D/g, ""),
    digits,
    "the display grouping does not digitise back to the owner's number",
  );
  assert.equal(digits, "6287777655549", "the owner number itself changed; update this and the fallback copy");
});
