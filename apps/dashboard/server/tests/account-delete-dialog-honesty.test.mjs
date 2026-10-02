import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routesUrl = new URL("../routes/account-routes.js", import.meta.url);
const pageUrl = new URL("../../src/pages/owner-v2/accounts/page.tsx", import.meta.url);

/**
 * The delete dialog said what it did not know.
 *
 *     "Akun akan dihapus melalui endpoint owner. Data historis dan sinkronisasi
 * *     mengikuti aturan backend yang sekarang."
 *
 * That is a deferral dressed as a warning. What the endpoint actually does
 * splits three ways, and the owner cannot tell which one they are about to hit:
 *
 *   - A Netflix account throws 400. Always. `isNetflixManagedAccount` matches on
 *     the product name, and the branch below it is the only path that can
 *     actually archive anything -- so every Netflix account falls to the final
 *     throw: "Akun Google Sheets tidak bisa di-release dari web." The button is
 *     inert for the main product and the dialog never said so.
 *   - A non-Netflix account that is still active throws 400 too, for a different
 *     reason.
 *   - Only a non-Netflix account that is already expired, replaced or disabled
 *     gets archived -- hidden, given `archivedAt`, its row cleared in Sheets.
 *     Its stock row is left alone.
 *
 * So the dialog's real content is "this will probably fail", and the one case it
 * does work in is the one it describes least.
 */
test("the endpoint has three outcomes, and only one of them deletes", async () => {
  const routes = await readFile(routesUrl, "utf8");
  const start = routes.indexOf('app.delete("/api/accounts/:id"');
  assert.ok(start > 0, "the account delete route is missing");
  const handler = routes.slice(start, start + 2600);

  // Netflix falls through to the refusal at the end of the branch.
  assert.match(handler, /!isNetflixManagedAccount\(account\)/, "the Netflix branch is gone; re-read the endpoint before trusting these assertions");
  assert.match(handler, /Akun Google Sheets tidak bisa di-release dari web/, "the Netflix refusal is gone");
  // Active non-Netflix is refused separately.
  assert.match(handler, /Akun non-Netflix yang masih aktif tidak bisa dihapus/);
  // And the only path that archives anything.
  assert.match(handler, /account\.hidden = true;/, "the archiving branch is gone");
  assert.match(handler, /clearAccountsInGoogleSheets/);
});

test("the dialog names the account, and says which of the three things will happen", async () => {
  const page = await readFile(pageUrl, "utf8");
  const start = page.indexOf('<Dialog open title="Hapus managed account"');
  assert.ok(start > 0, "the delete confirmation dialog is missing");
  const dialog = page.slice(start, start + 1600);

  assert.doesNotMatch(
    dialog,
    /mengikuti aturan backend/,
    "the dialog defers to the backend instead of telling the owner what will happen",
  );
  // It has to say the sheet is master, because that is why the Netflix case
  // cannot work from here at all.
  assert.match(
    dialog,
    /Google Sheets/,
    "the dialog does not mention that Sheets owns the Netflix rows",
  );
  // And it has to name the account, so the owner can see which one they are
  // about to act on rather than trusting the row they think they clicked.
  assert.match(
    dialog,
    /action\.account\.(email|loginPhone|id)/,
    "the dialog does not name the account it is about to act on",
  );
});

test("the owner is not offered a delete that cannot succeed", async () => {
  const page = await readFile(pageUrl, "utf8");

  // A button that always answers 400 is not a button. `product` is on every
  // row, so the same test the server applies can be applied here.
  assert.match(
    page,
    /isNetflixManagedAccount|netflix/i,
    "the page does not recognise Netflix rows, so it offers a delete the server will refuse",
  );
});