import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("checkout uses three payment stages, a real countdown, and a locked status refresh", () => {
  const source = read("src/pages/products/page.tsx");
  assert.match(source, /label: "Pesanan"/);
  assert.match(source, /label: "Pembayaran"/);
  assert.match(source, /label: "Selesai"/);
  assert.match(source, /paymentCountdown/);
  assert.match(source, /paymentRefreshLockRef/);
  assert.match(source, /refreshCurrentOrder\(\{ manual: true \}\)/);
  assert.match(source, /searchParams\.get\("order"\)/);
  assert.match(source, /api\.order\(orderId\)/);
  assert.match(source, /resumeParams\.set\("order", order\.id\)/);
  assert.match(source, /isTerminalCheckoutState/);
  assert.match(source, /step !== "payment" && step !== "process"/);
  assert.match(source, /latest\.paymentRef && String\(latest\.qrisStatus \|\| ""\)\.toLowerCase\(\) !== "paid"/);
  assert.match(source, /Status pembayaran akan diperbarui secara otomatis/);
  assert.doesNotMatch(source, /createOrder\([^)]*Cek Status/s);
});

test("payment success prioritizes Reseller V2 orders and preserves the authenticated session", () => {
  const source = read("src/pages/products/page.tsx");
  assert.match(source, /\/reseller-v2\/accounts\?account=/);
  assert.match(source, /to="\/reseller-v2\/orders"/);
  assert.match(source, /to=\{isAuthenticatedResellerCheckout \? "\/reseller-v2\/ringkasan" : "\/"\}/);
  assert.match(source, /api\.authSession\(\)/);
  assert.match(source, /updateSession\(session\)/);
  assert.match(source, /Lihat Akun yang Dibeli/);
  assert.match(source, /Lihat Pesanan/);
  assert.match(source, /Kembali ke Ringkasan/);
  assert.match(source, /Kembali ke Beranda/);
});

test("checkout provides responsive summary, inline validation, and a locked submit state", () => {
  const source = read("src/pages/products/page.tsx");
  assert.match(source, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(320px,0\.72fr\)\]/);
  assert.match(source, /lg:sticky lg:top-6/);
  assert.match(source, /Terisi dari akun reseller/);
  assert.match(source, /fieldErrors/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /Memproses pesanan/);
  assert.match(source, /submitLockRef/);
  assert.match(source, /theme-dark min-h-screen/);
  assert.doesNotMatch(source, /import \{ Button \}/);
});

test("successful checkout masks fulfillment credentials by default", () => {
  const source = read("src/pages/products/page.tsx");
  assert.match(source, /credentialsVisible/);
  assert.match(source, /setCredentialsVisible\(false\)/);
  assert.match(source, /60_000/);
  assert.match(source, /isAuthenticatedResellerCheckout/);
  assert.match(source, /Credential disembunyikan/);
  assert.doesNotMatch(source, /SCROLL JIKA PANJANG/);
});

test("public tracking requires token or order plus verification and sets noindex", () => {
  const page = read("src/pages/order-tracking/page.tsx");
  const api = read("src/lib/api.ts");
  assert.match(page, /orderId\.trim\(\) && verification\.trim\(\)/);
  assert.match(page, /noindex,nofollow/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /genericError/);
  // The page is the sign-in box and nothing else. The marketing column that
  // used to sit beside the form carried two claims about what this page will
  // not show, which is a reassurance nobody reads while holding a receipt.
  assert.match(page, /AuthFormPanel/);
  assert.doesNotMatch(page, /Pelacakan aman/);
  assert.doesNotMatch(page, /Credential akun tidak pernah ditampilkan/);
  assert.match(api, /method: "POST"/);
  assert.match(api, /\/public\/order-tracking/);
  assert.doesNotMatch(api, /\/public\/orders\//);
  assert.doesNotMatch(api, /\/public\/payments\//);
});
