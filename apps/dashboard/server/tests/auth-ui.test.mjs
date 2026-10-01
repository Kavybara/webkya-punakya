import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../src/", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("login, register, and reset share the same AuthShell foundation", async () => {
  const [login, register, reset] = await Promise.all([
    source("pages/login/page.tsx"),
    source("pages/register/page.tsx"),
    source("pages/forgot-password/page.tsx"),
  ]);

  for (const page of [login, register, reset]) assert.match(page, /<AuthShell/);
  const components = await source("components/auth/AuthShell.tsx");
  for (const name of ["AuthShell", "AuthFormPanel", "AuthInput", "PasswordInput", "OtpInput", "AuthStepIndicator", "AuthError", "AuthSuccessState", "AuthSubmitButton"]) {
    assert.match(components, new RegExp(`export function ${name}`));
  }
});

test("the sign-in screens are one centred box, with no marketing copy beside it", async () => {
  // There used to be a half-viewport masthead carrying a lede and three
  // tick-marked claims -- Sheets sync, sold-account locking, QRIS. All true,
  // all worth saying on a page about selling, and none of them doing any work
  // for a person who has come here to type a password. They were the last
  // thing between the reader and the field, and they came back the moment
  // somebody thought the screen looked empty.
  //
  // So the copy is asserted absent rather than merely unimported. An unused
  // `BRAND_FACTS` array is not neutral: it is one uncommented away from
  // returning, and it still reads as the live description of the product.
  const [components, styles] = await Promise.all([
    source("components/auth/AuthShell.tsx"),
    source("components/auth/auth.css"),
  ]);

  // Comments are stripped before either is checked. Both files explain the
  // removal in place -- the doc block above quotes the lede it deleted, and the
  // stylesheet's header lists the five blurs it once had, two of them named
  // after the masthead. A test that fails on its own explanation is a test
  // somebody deletes rather than satisfies, and deleting the explanation is the
  // worse outcome: the next person re-adds the column and nobody knows why it
  // went.
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.doesNotMatch(code(components), /BRAND_FACTS|AuthBrandPanel/);
  assert.doesNotMatch(code(components), /auth-brand|Stokmu ada di satu tempat|terbaca langsung dari Google Sheets/);
  assert.doesNotMatch(code(styles), /\.auth-brand(?![\w-])/, "The masthead's rules went with the masthead.");

  // What does survive: the wordmark, so the reader can tell they are in the
  // right place, and the way home. Both were on the removed column.
  assert.match(components, /className="auth-wordmark"/);
  assert.match(components, /Kembali ke Beranda/);

  // And it is centred, not merely present. A one-column grid with no `columns`
  // is what replaced the 0.78fr/1.22fr split.
  assert.match(styles, /\.auth-shell\s*\{[^}]*place-items:\s*center/);
  assert.doesNotMatch(styles, /\.auth-shell\s*\{[^}]*grid-template-columns/);
});

test("login uses the requested copy, inline validation, safe errors, and existing role redirects", async () => {
  const login = await source("pages/login/page.tsx");

  assert.match(login, /Selamat datang kembali/);
  assert.match(login, /Masuk untuk melanjutkan ke Kavya/);
  assert.match(login, /Masuk ke Kavya/);
  assert.match(login, /identifierTouched/);
  assert.match(login, /passwordTouched/);
  assert.match(login, /Akun sedang tidak aktif/);
  assert.match(login, /Terlalu banyak percobaan login/);
  assert.match(login, /Kavya belum dapat dihubungi/);
  assert.match(login, /"\/owner-v2"/);
  assert.match(login, /"\/reseller-v2"/);
  assert.doesNotMatch(login, /Netflix Digital Account Management|console\.log|console\.error/);
});

test("register validates backend fields and supports OTP resend and success state", async () => {
  const register = await source("pages/register/page.tsx");

  assert.match(register, /Daftar sebagai Reseller/);
  assert.match(register, /validateRegistrationForm/);
  assert.match(register, /Password harus 8-128 karakter/);
  assert.match(register, /Nomor WhatsApp tidak valid/);
  assert.match(register, /REGISTER_RESEND_SECONDS/);
  assert.match(register, /Kirim Ulang/);
  assert.match(register, /Ubah Nomor/);
  assert.match(register, /maskWhatsapp/);
  assert.match(register, /Akun berhasil dibuat/);
  assert.match(register, /Verifikasi dan Daftar/);
  assert.doesNotMatch(register, /localStorage|sessionStorage|console\.log|console\.error/);
});

test("reset validates empty identity only after submit and preserves reset API contract", async () => {
  const reset = await source("pages/forgot-password/page.tsx");

  assert.match(reset, /identifierTouched/);
  assert.match(reset, /Email, username, atau nomor WhatsApp wajib diisi/);
  assert.match(reset, /api\.requestPasswordReset\(\{ identifier:/);
  assert.match(reset, /api\.verifyPasswordReset\(\{ identifier:.*code/);
  assert.match(reset, /api\.confirmPasswordReset\(\{ resetToken, newPassword, confirmPassword \}\)/);
  assert.doesNotMatch(reset, /localStorage|sessionStorage|console\.log|console\.error/);
});

test("reset handles OTP errors, expiry, resend countdown, and account changes", async () => {
  const reset = await source("pages/forgot-password/page.tsx");

  assert.match(reset, /RESEND_SECONDS/);
  assert.match(reset, /resendCountdown/);
  assert.match(reset, /Kirim Ulang/);
  assert.match(reset, /Ubah Akun/);
  assert.match(reset, /Kode salah atau sudah kedaluwarsa/);
  assert.match(reset, /Terlalu banyak percobaan/);
  assert.match(reset, /Jika data cocok dengan akun Kavya/);
});

test("reset validates password match and exposes a successful login route", async () => {
  const reset = await source("pages/forgot-password/page.tsx");
  const components = await source("components/auth/AuthShell.tsx");

  assert.match(reset, /Password baru minimal 8 karakter/);
  assert.match(reset, /Password belum cocok/);
  assert.match(reset, /Password berhasil diperbarui/);
  assert.match(reset, /Kembali ke Login/);
  assert.match(reset, /to="\/login"/);
  assert.match(components, /to="\/"/);
});

test("auth styles use the shared dark tokens, plus mobile layout, focus, and reduced motion", async () => {
  const styles = await source("components/auth/auth.css");

  // The palette lives in `styles/tokens.css` now. What this sheet owns is
  // the layout, and the contract is that it consumes the shared names
  // rather than carrying a private copy of the dark.
  for (const token of ["--bg-canvas", "--bg-raised", "--surface", "--surface-hover", "--text-primary", "--text-secondary", "--text-muted", "--border", "--border-strong", "--accent-violet", "--accent-cyan", "--status-success", "--status-warning", "--status-danger"]) {
    assert.match(styles, new RegExp(token));
  }
  assert.doesNotMatch(styles, /^\s*--auth-/m, "auth.css declares its own colours again");
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.doesNotMatch(styles, /overflow-x:\s*visible/);
});
