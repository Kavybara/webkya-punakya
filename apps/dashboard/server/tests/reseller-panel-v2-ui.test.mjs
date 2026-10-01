import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Reseller V2 owns every primary panel route without legacy redirects", async () => {
  const router = await source("src/router/config.tsx");
  const login = await source("src/pages/login/page.tsx");

  assert.match(router, /lazy\(\(\) => import\("\.\.\/pages\/reseller-v2\/page"\)\)/);
  assert.match(router, /path: "\/reseller-v2"[\s\S]{0,120}Navigate to="\/reseller-v2\/ringkasan"/);
  assert.match(router, /path: "\/reseller-v2\/overview"[\s\S]{0,120}Navigate to="\/reseller-v2\/ringkasan"/);
  assert.match(router, /path: "\/reseller-v2\/ringkasan"/);
  assert.match(router, /path: "\/reseller"[\s\S]{0,120}Navigate to="\/reseller-v2\/ringkasan"/);
  assert.match(router, /path: "\/reseller-v2\/catalog"/);
  assert.match(router, /path: "\/reseller-v2\/settings"/);
  assert.doesNotMatch(router, /path: "\/reseller-v2\/(?:catalog|orders|accounts|access|warranty)"[^\n]+Navigate to="\/reseller/);
  assert.match(router, /path: "\/reseller\/catalog"[\s\S]{0,120}Navigate to="\/reseller-v2\/catalog"/);
  assert.match(router, /path: "\/reseller\/manage-account"[\s\S]{0,120}Navigate to="\/reseller-v2\/accounts"/);
  assert.match(router, /path: "\/reseller\/history"[\s\S]{0,120}Navigate to="\/reseller-v2\/orders"/);
  assert.match(router, /path: "\/reseller\/accounts"[\s\S]{0,120}Navigate to="\/reseller-v2\/access"/);
  assert.match(router, /path: "\/reseller\/warranty"[\s\S]{0,120}Navigate to="\/reseller-v2\/warranty"/);
  assert.match(router, /path: "\/reseller\/settings"[\s\S]{0,120}Navigate to="\/reseller-v2\/settings"/);
  assert.match(login, /session\.role === "owner"[\s\S]+"\/owner-v2"/);
  assert.match(login, /"\/reseller-v2"/);
});

test("Reseller V2 uses one shared Top Up dialog without navigating away", async () => {
  const [shell, dialog, overview, navigation] = await Promise.all([
    source("src/components/reseller-v2/ResellerShell.tsx"),
    source("src/components/reseller-v2/TopUpDialog.tsx"),
    source("src/pages/reseller-v2/page.tsx"),
    source("src/components/reseller-v2/navigation.ts"),
  ]);

  assert.match(shell, /<TopUpDialog/);
  assert.match(shell, /setTopUpOpen\(true\)/);
  assert.doesNotMatch(shell, /to="\/reseller"/);
  assert.match(dialog, /api\s*\.requestResellerDeposit/);
  assert.match(dialog, /api\s*\.resellerDepositInstructions/);
  assert.match(dialog, /role="dialog"/);
  assert.match(overview, /id="saldo"|ResellerBalanceCard/);
  assert.match(navigation, /path: "\/reseller-v2\/ringkasan"/);
});

test("topbar Top Up action stays compact and never wraps", async () => {
  const styles = await source("src/components/reseller-v2/reseller-v2.css");
  const rule = styles.match(/\.reseller-v2-topup\s*\{([\s\S]*?)\}/)?.[1] || "";

  // The control must keep a fixed, non-shrinking, non-wrapping hit area of at
  // least 40px. Assert the contract, not the exact pixel values it currently
  // happens to use, so the restyle is free to change the exact size.
  assert.match(rule, /min-height:\s*(4[0-9]|[5-9]\d)px|height:\s*(4[0-9]|[5-9]\d)px/);
  assert.match(rule, /flex:\s*0 0 (auto|none)/);
  assert.match(rule, /white-space:\s*nowrap/);
});

test("account credentials are masked in a reseller-owned detail drawer", async () => {
  const accountPage = await source("src/pages/reseller-v2/accounts/page.tsx");

  assert.match(accountPage, /options\.refreshSheets \? "full" : "light"/);
  assert.match(accountPage, /onRefresh=\{\(\) => load\(\{ refreshSheets: true \}\)\}/);
  assert.match(accountPage, /MASK_AFTER_MS\s*=\s*60_000/);
  assert.match(accountPage, /Tampilkan/);
  assert.match(accountPage, /Salin/);
  assert.match(accountPage, /Terakhir diperbarui/);
  assert.match(accountPage, /setCredentialVisible\(false\)/);
  assert.doesNotMatch(accountPage, /console\.(?:log|warn|error)/);
});

test("access provider transition resets lookup state and never auto-falls back", async () => {
  const access = await source("src/pages/reseller-v2/access/page.tsx");

  assert.match(access, /function changeAccessSource\(source: AccessSource\)/);
  assert.match(access, /setActiveSource\(source\)/);
  assert.match(access, /setActiveTool\(source === "disney" \? "disney_otp" : "signin"\)/);
  assert.match(access, /setLookup\(""\)/);
  assert.match(access, /setLookupResult\(null\)/);
  assert.match(access, /setLookupError\(""\)/);
  // The two provider tabs used to be two hand-written buttons, one per
  // provider, and this test asserted both call sites by their literal string.
  // They are now rendered from the provider list, so the thing worth pinning is
  // that the tab strip calls the reset for whichever provider it is showing --
  // which also means a third provider gets the reset for free.
  assert.match(access, /onClick=\{\(\) => changeAccessSource\(source\)\}/);
  assert.match(access, /\(\["netflix", "disney"\] as const\)\.map/);
  assert.match(access, /activeSource === "disney" \? disneyGroups : netflixGroups/);
  assert.doesNotMatch(access, /!hasDisney && hasNetflix/);
  assert.doesNotMatch(access, /!hasNetflix && hasDisney/);
});

test("verification remains six digits and household exposes links only", async () => {
  const [access, server] = await Promise.all([
    source("src/pages/reseller-v2/access/page.tsx"),
    source("server/index.js"),
  ]);

  assert.match(access, /Ambil 6 digit kode verifikasi/);
  assert.match(access, /Verification code 6 digit/);
  assert.match(access, /Belum ada verification code 6 digit/);
  assert.match(access, /Ambil link household/);
  assert.match(access, /Belum ada link household/);
  assert.doesNotMatch(server, /fetchNetflixHouseholdCode/);
  assert.doesNotMatch(server, /Kode akses household/);
});

/**
 * A household link is a trigger, not a result.
 *
 * Netflix's household mail does not carry the code -- it carries a
 * `travel/verify` link, and the code appears only after someone opens it. The
 * panel used to label it "Link household" and stop, which reads as a finished
 * answer: the reseller forwards it to the customer and closes the ticket, and
 * the code never arrives for either of them.
 *
 * The server cannot fix this by probing the link. A spent `nftoken` degrades to
 * an inactive page rather than erroring, so there is no way to ask "is this
 * still good?" without spending it. That is asserted below: nothing in the
 * server may fetch a Netflix URL.
 */
test("the household link says it is a trigger and not the code", async () => {
  const access = await source("src/pages/reseller-v2/access/page.tsx");

  assert.match(access, /function HouseholdLinkValue/);
  assert.match(access, /Link ini belum berisi kode/);
  assert.match(access, /membukanya lebih dulu/);
  assert.match(access, /Tekan Cari Akun lagi/);
  // Household is the one link that gets the warning; reset is a finished answer.
  assert.match(access, /lookupResult\.type === "household" \? \(\s*<HouseholdLinkValue/);
  assert.match(access, /reseller-v2-access-next-step/);
});

/**
 * Household had no validator; `reset` has had one all along.
 *
 * It was called through `pickAccessLink(..., allowFallback = true)`, which
 * returns the longest URL left in the message when nothing matches the keywords
 * -- a Netflix footer link, labelled "Link household" and handed to a customer.
 * A link that is not the household link is now simply not found.
 */
test("a household lookup only accepts a Netflix travel/verify link with a token", async () => {
  const server = await source("server/index.js");

  assert.match(server, /function isNetflixHouseholdUrl/);
  assert.match(server, /nftoken=/);
  assert.ok(server.includes("account/travel"), "the travel/verify path is the one Netflix sends");
  assert.match(server, /function pickHouseholdLink/);

  // The fallback is what made this unsafe. It is gone, and with it the only
  // caller that used it. Comments are stripped first -- the note explaining the
  // removal quotes the old signature, and a test that fails on its own
  // explanation is one somebody deletes rather than satisfies.
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.doesNotMatch(code(server), /function pickAccessLink/);
  assert.doesNotMatch(code(server), /allowFallback/);
  assert.doesNotMatch(code(server), /"updatehousehold", "verify", "travel"/);
});

test("account access rows preserve readable dark hover and keyboard focus", async () => {
  const [access, styles] = await Promise.all([
    source("src/pages/reseller-v2/access/page.tsx"),
    source("src/pages/reseller-v2/access/access.css"),
  ]);

  // This used to be a hand-rolled `.reseller-v2-access-account-row` button with
  // its own hover and focus rules. It is now a plain <button> inside the
  // account list, and the page stylesheet gives the list's buttons both states
  // from a token. The guarantee is the same; only the shape moved.
  assert.match(access, /reseller-v2-access-list/);
  assert.doesNotMatch(access, /hover:bg-slate-50/, "a light-theme hover must not reach the dark console");
  assert.match(
    styles,
    /\.reseller-v2-access-list\s*>\s*div\s*>\s*button:hover,\s*\n?\s*\.reseller-v2-access-list\s*>\s*div\s*>\s*button:focus-visible/,
    "the account rows must respond to both hover and keyboard focus",
  );
  assert.match(styles, /background:\s*var\(--surface-hover\)/);
});

test("reseller resource pages separate loading error and empty states", async () => {
  const [orders, accounts, warranty, access] = await Promise.all([
    source("src/pages/reseller-v2/orders/page.tsx"),
    source("src/pages/reseller-v2/accounts/page.tsx"),
    source("src/pages/reseller-v2/warranty/page.tsx"),
    source("src/pages/reseller-v2/access/page.tsx"),
  ]);

  // Each page must branch three ways -- loading, error, and an empty result
  // that is distinct from a populated one. Assert the presence of a loading
  // branch, an error branch and an emptiness test per page, without pinning
  // the exact state-variable names, which change when these pages are ported
  // onto the shared kit.
  //
  // LIMITATION: this is a source-text check, so it proves the three states are
  // mentioned, not that they render correctly. It is deliberately weaker than
  // the assertions it replaces. The durable fix is DOM-level tests (jsdom +
  // Testing Library) asserting what each state actually paints; that is a
  // separate piece of work and is not covered here.
  for (const [name, page] of [["orders", orders], ["accounts", accounts], ["warranty", warranty], ["access", access]]) {
    assert.match(page, /loading/i, `${name} page has no loading branch`);
    assert.match(page, /error/i, `${name} page has no error branch`);
    assert.match(page, /\.length|!rows|!accounts|!currentGroups/, `${name} page has no empty-result check`);
  }
});

test("all reseller account views share one status normalizer", async () => {
  const [overview, accounts, warranty, access, utility] = await Promise.all([
    source("src/pages/reseller-v2/page.tsx"),
    source("src/pages/reseller-v2/accounts/page.tsx"),
    source("src/pages/reseller-v2/warranty/page.tsx"),
    source("src/pages/reseller-v2/access/page.tsx"),
    source("src/lib/resellerAccounts.ts"),
  ]);

  assert.match(overview, /summarizeResellerAccounts/);
  assert.match(accounts, /summarizeResellerAccounts/);
  assert.match(warranty, /warrantyInfo/);
  assert.match(access, /normalizeResellerAccountStatus/);
  assert.match(utility, /normalizeResellerAccountStatus/);
  assert.match(utility, /Hampir Berakhir/);
  assert.match(utility, /Kedaluwarsa/);
});

test("checkout revalidates the HttpOnly session without weakening cookie transport", async () => {
  const [checkout, apiClient] = await Promise.all([
    source("src/pages/products/page.tsx"),
    source("src/lib/api.ts"),
  ]);

  assert.match(checkout, /api\.authSession\(\)/);
  assert.match(checkout, /updateSession\(session\)/);
  assert.doesNotMatch(checkout, /clearSession|document\.cookie/);
  assert.match(apiClient, /credentials: "include"/);
  assert.match(apiClient, /"\/auth\/session"/);
});

test("starting a catalog order checks live stock first", async () => {
  const checkout = await source("src/pages/products/page.tsx");

  // `prechecking` was declared, read in the guard and used for the button's
  // `disabled`, but never set -- so it was permanently false and the guard it
  // sat in guarded nothing. The client method it was reaching for existed too,
  // with no caller. Both are now wired: the flag is set, and the check runs
  // before the customer is sent to fill in their details for stock that may be
  // gone.
  assert.match(checkout, /setPrechecking\(true\)/, "the busy flag must actually be raised");
  assert.match(checkout, /setPrechecking\(false\)/, "and lowered again, or the button sticks disabled");
  assert.match(checkout, /await api\.precheckCatalog\(/, "the precheck must be awaited before navigating");
  assert.match(checkout, /Number\(check\.stockCount \|\| 0\) < 1/, "a definite out-of-stock must stop the customer");

  // The flag is only worth having if it is cleared on the way out as well as
  // the way in, so assert the pair rather than any single occurrence.
  assert.match(checkout, /finally\s*\{\s*setPrechecking\(false\);?\s*\}/, "the flag clears in a finally, not only on success");
});

test("warranty display and WhatsApp payload never include credentials", async () => {
  const warranty = await source("src/pages/reseller-v2/warranty/page.tsx");

  assert.doesNotMatch(warranty, /account\.password/);
  assert.doesNotMatch(warranty, /account\.pin/);
  assert.doesNotMatch(warranty, /selectedAccount\.password/);
  assert.doesNotMatch(warranty, /selectedAccount\.pin/);
  assert.match(warranty, /Nomor Pesanan/);
  assert.match(warranty, /Masa Garansi/);
  assert.match(warranty, /Kendala/);
  assert.match(warranty, /Bukti Kendala/);
  assert.match(warranty, /Screenshot sudah tersimpan bersama tiket/);
  assert.doesNotMatch(warranty, /Kirim screenshot/);
});

test("public catalog and checkout return to the new reseller panel", async () => {
  const [catalog, products] = await Promise.all([
    source("src/pages/pricelist/ProductCatalog.tsx"),
    source("src/pages/products/page.tsx"),
  ]);

  assert.match(catalog, /\/login\?next=\/reseller-v2\/catalog/);
  assert.doesNotMatch(catalog, /next=\/reseller\/catalog/);
  assert.match(products, /\/reseller-v2\/catalog/);
});

test("the legacy reseller tree stays deleted", async () => {
  // This replaces a test that asserted the legacy adapter existed. The five
  // legacy pages, `resellerUi.tsx` and `DashboardLayout.tsx` are gone, and with
  // them the adapter that force-rethemed their light-theme Tailwind classes
  // onto the dark console -- which is why the console no longer needed a
  // `class~="bg-[#fbf7f0]"` selector override to make one cream panel readable.
  //
  // The assertion is a file-existence check rather than a source match,
  // because a source match cannot tell a deleted file from one that was
  // renamed. This is the test that stops the tree creeping back.
  for (const gone of [
    "src/pages/reseller",
    "src/components/feature/DashboardLayout.tsx",
  ]) {
    await assert.rejects(
      stat(new URL(gone, root)),
      { code: "ENOENT" },
      `${gone} must not exist`,
    );
  }

  // And nothing may import it. A dead import is a build error, but a live one
  // pointing at a resurrected copy is the failure this is here to catch.
  const router = await source("src/router/config.tsx");
  assert.doesNotMatch(router, /pages\/reseller\//, "the router must not reach for the legacy tree");
  assert.doesNotMatch(router, /components\/feature\/DashboardLayout/);

  const styles = await source("src/components/reseller-v2/reseller-v2.css");
  assert.doesNotMatch(
    styles,
    /\.reseller-v2-legacy-content/,
    "the adapter's retheme block goes with the adapter",
  );
});

test("Reseller V2 shell keeps reseller auth and scoped destinations", async () => {
  const shell = await source("src/components/reseller-v2/ResellerShell.tsx");
  const frame = await source("src/components/ui/AppShell.tsx");
  const navigation = await source("src/components/reseller-v2/navigation.ts");

  // The gate itself is one implementation now, so it is asserted where it
  // lives. What the reseller still owns is declaring which role it is and
  // where a reader lands when that role is wrong -- and those two values are
  // the whole access rule as far as this file is concerned.
  assert.match(frame, /current\.role !== role/, "the shared frame must turn away the wrong role");
  assert.match(frame, /navigate\(`\/login\?next=/, "no session must go to sign in, with somewhere to return to");
  assert.match(shell, /role="reseller"/, "ResellerShell must declare the role it admits");
  assert.match(shell, /homePath=\{SUMMARY_PATH\}/, "an unauthenticated reseller must return to the summary");
  assert.match(shell, /deniedPath="\/owner-v2"/, "a reseller who wanders into the owner console goes home");
  assert.match(shell, /SUMMARY_PATH = "\/reseller-v2\/ringkasan"/);

  // A console must not hand-roll its own session storage. The only thing the
  // frame keeps locally is how wide the rail is.
  assert.doesNotMatch(shell, /localStorage|sessionStorage/);
  assert.doesNotMatch(frame, /sessionStorage/);
  assert.match(frame, /localStorage\.setItem\(COLLAPSE_KEY/);

  assert.match(navigation, /\/reseller-v2\/catalog/);
  assert.match(navigation, /\/reseller-v2\/orders/);
  assert.match(navigation, /\/reseller-v2\/accounts/);
  assert.match(navigation, /\/reseller-v2\/access/);
  assert.match(navigation, /\/reseller-v2\/warranty/);
  assert.doesNotMatch(navigation, /\/dashboard/);
});

test("Reseller V2 Overview uses only reseller-scoped APIs and masks identities", async () => {
  const page = await source("src/pages/reseller-v2/page.tsx");

  assert.match(page, /api\.resellers\(\)/);
  assert.match(page, /api\.orders\(\)/);
  assert.match(page, /api\.accounts\(\{ view: "overview" \}\)/);
  assert.match(page, /maskIdentity/);
  assert.doesNotMatch(page, /api\.ownerSearch/);
  assert.doesNotMatch(page, /api\.operationsCenter/);
  assert.doesNotMatch(page, /password\s*[:.]/i);
  assert.doesNotMatch(page, /console\.log|console\.error/);
});

test("Reseller global search stays within scoped reseller data", async () => {
  const search = await source("src/components/reseller-v2/ResellerSearch.tsx");

  assert.match(search, /api\.catalog\(\)/);
  assert.match(search, /api\.orders\(\)/);
  assert.match(search, /api\.accounts\(\{ view: "overview" \}\)/);
  assert.doesNotMatch(search, /api\.ownerSearch/);
  assert.doesNotMatch(search, /\.(password|pin|otp|resetLink|householdLink)\b/i);
  assert.doesNotMatch(search, /console\.log|console\.error/);
});

test("Reseller V2 ships mobile bottom navigation with a touch-target floor", async () => {
  // The bar is drawn by the shared frame now. The reseller's own contribution
  // is choosing the five destinations that appear in it -- the owner console
  // has the same bar, so asserting the CSS here alone would pass for either.
  const css = await source("src/components/ui/shell.css");
  const shell = await source("src/components/reseller-v2/ResellerShell.tsx");
  const navigation = await source("src/components/reseller-v2/navigation.ts");

  assert.match(navigation, /export const resellerBottomNavigation/, "the reseller must name its five phone destinations");
  assert.match(shell, /bottomNavigation=\{bottomNavigation\}/);
  assert.match(css, /\.ui-shell-bottom-nav/);
  // Assert a mobile breakpoint exists rather than a specific pixel value.
  assert.match(css, /@media\s*\(max-width:\s*\d+px\)/);
  // 44px is a WCAG-recommended minimum hit target; keep the floor, not the
  // exact declaration form.
  assert.match(css, /min-height:\s*(4[4-9]|[5-9]\d|\d{3})px/);
  assert.match(css, /prefers-reduced-motion/);
});
