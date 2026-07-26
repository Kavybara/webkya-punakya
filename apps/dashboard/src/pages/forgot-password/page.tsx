import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AuthError,
  AuthInput,
  AuthShell,
  AuthStepIndicator,
  AuthSubmitButton,
  AuthSuccessState,
  OtpInput,
  PasswordInput,
} from "../../components/auth/AuthShell";
import { api } from "../../lib/api";

type ResetStep = "request" | "verify" | "confirm" | "done";
const RESEND_SECONDS = 60;
const SAFE_REQUEST_MESSAGE = "Jika data cocok dengan akun Kavya, kode verifikasi akan dikirim melalui WhatsApp.";

function maskResetDestination(identifier: string) {
  const digits = identifier.replace(/\D/g, "");
  if (digits.length < 8) return "Nomor WhatsApp terdaftar";
  return `${digits.slice(0, 3)}${"*".repeat(Math.max(4, digits.length - 6))}${digits.slice(-3)}`;
}

function safeOtpError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("terlalu") || message.includes("sering")) return "Terlalu banyak percobaan. Minta kode baru dan tunggu sebelum mencoba lagi.";
  if (message.includes("kadaluarsa") || message.includes("kedaluwarsa")) return "Kode salah atau sudah kedaluwarsa. Periksa kode atau kirim ulang.";
  return "Kode salah atau sudah kedaluwarsa. Periksa kode lalu coba lagi.";
}

function safeDeliveryError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("terlalu") || message.includes("limit") || message.includes("tunggu")) return "Permintaan terlalu sering. Tunggu beberapa saat sebelum mencoba lagi.";
  return "Kode belum dapat dikirim. Periksa koneksi WhatsApp lalu coba kembali.";
}

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<ResetStep>("request");
  const [identifier, setIdentifier] = useState("");
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [capsLock, setCapsLock] = useState(false);

  const activeStep = step === "request" ? 0 : step === "verify" ? 1 : 2;
  const identifierError = identifierTouched && !identifier.trim() ? "Email, username, atau nomor WhatsApp wajib diisi." : "";
  const passwordsMatch = Boolean(confirmPassword) && newPassword === confirmPassword;

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = window.setInterval(() => setResendCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCountdown]);

  useEffect(() => {
    const id = step === "request" ? "reset-identifier" : step === "verify" ? "reset-otp" : step === "confirm" ? "new-password" : "reset-login-link";
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }, [step]);

  async function requestCode(isResend = false) {
    setError("");
    setLoading(true);
    try {
      await api.requestPasswordReset({ identifier: identifier.trim() });
      setMessage(SAFE_REQUEST_MESSAGE);
      setResendCountdown(RESEND_SECONDS);
      setStep("verify");
      if (isResend) setCode("");
    } catch (requestError) {
      const raw = requestError instanceof Error ? requestError.message.toLowerCase() : "";
      if (raw.includes("tidak ditemukan") || raw.includes("akun")) {
        setMessage(SAFE_REQUEST_MESSAGE);
        setResendCountdown(RESEND_SECONDS);
        setStep("verify");
      } else {
        setError(safeDeliveryError(requestError));
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIdentifierTouched(true);
    if (!identifier.trim()) return;
    await requestCode();
  }

  async function submitVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (code.length !== 6) {
      setError("Masukkan enam digit kode verifikasi.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.verifyPasswordReset({ identifier: identifier.trim(), code });
      setResetToken(result.resetToken);
      setStep("confirm");
      setError("");
    } catch (verifyError) {
      setError(safeOtpError(verifyError));
    } finally {
      setLoading(false);
    }
  }

  async function submitConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Password baru minimal 8 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Password belum cocok. Periksa kembali kedua kolom password.");
      return;
    }
    setLoading(true);
    try {
      await api.confirmPasswordReset({ resetToken, newPassword, confirmPassword });
      setStep("done");
      setMessage("");
    } catch {
      setError("Password belum dapat diperbarui. Kode verifikasi mungkin sudah kedaluwarsa. Mulai ulang proses reset.");
    } finally {
      setLoading(false);
    }
  }

  function changeAccount() {
    setStep("request");
    setCode("");
    setResetToken("");
    setError("");
    setMessage("");
    setResendCountdown(0);
  }

  return (
    <AuthShell title="Atur ulang password" description="Verifikasi akunmu melalui WhatsApp untuk membuat password baru.">
      {step !== "done" ? <AuthStepIndicator steps={["Akun", "Verifikasi", "Password Baru"]} activeStep={activeStep} /> : null}

      {step === "request" ? (
        <form className="auth-form" onSubmit={submitRequest} noValidate>
          <AuthInput
            id="reset-identifier"
            label="Email, username, atau nomor WhatsApp"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            onBlur={() => setIdentifierTouched(true)}
            error={identifierError}
            placeholder="Masukkan data akun"
            autoComplete="username"
          />
          {error ? <AuthError>{error}</AuthError> : null}
          <p className="auth-notice">{SAFE_REQUEST_MESSAGE}</p>
          <AuthSubmitButton loading={loading} loadingLabel="Mengirim kode...">Kirim Kode WhatsApp</AuthSubmitButton>
        </form>
      ) : null}

      {step === "verify" ? (
        <form className="auth-form" onSubmit={submitVerify} noValidate>
          <div className="auth-destination"><span>Kode dikirim ke</span><strong>{maskResetDestination(identifier)}</strong></div>
          {message ? <p className="auth-notice is-success">{message}</p> : null}
          <OtpInput id="reset-otp" label="Kode verifikasi 6 digit" value={code} onChange={(value) => { setCode(value); setError(""); }} error={error} disabled={loading} />
          <div className="auth-resend">
            <span>Kode berlaku sesuai waktu yang ditentukan sistem.</span>
            <button type="button" disabled={loading || resendCountdown > 0} onClick={() => void requestCode(true)}>
              {resendCountdown > 0 ? `Kirim ulang (${resendCountdown}s)` : "Kirim Ulang"}
            </button>
          </div>
          <div className="auth-form-actions">
            <button type="button" className="auth-button is-secondary" onClick={changeAccount}>Ubah Akun</button>
            <AuthSubmitButton loading={loading} loadingLabel="Memverifikasi..." disabled={code.length !== 6}>Verifikasi Kode</AuthSubmitButton>
          </div>
        </form>
      ) : null}

      {step === "confirm" ? (
        <form className="auth-form" onSubmit={submitConfirm} noValidate>
          <PasswordInput id="new-password" label="Password baru" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError(""); }} autoComplete="new-password" placeholder="Minimal 8 karakter" onCapsLockChange={setCapsLock} />
          <PasswordInput id="confirm-password" label="Ulangi password baru" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(""); }} autoComplete="new-password" placeholder="Ketik ulang password" onCapsLockChange={setCapsLock} />
          <div className="auth-requirements"><span className={newPassword.length >= 8 ? "is-valid" : ""}>Minimal 8 karakter</span><span className={passwordsMatch ? "is-valid" : ""}>Kedua password sama</span></div>
          {confirmPassword ? <p className={`auth-match ${passwordsMatch ? "is-match" : "is-mismatch"}`}>{passwordsMatch ? "Password cocok" : "Password belum cocok"}</p> : null}
          {capsLock ? <p className="auth-caps" role="status">Caps Lock sedang aktif.</p> : null}
          {error ? <AuthError>{error}</AuthError> : null}
          <AuthSubmitButton loading={loading} loadingLabel="Menyimpan...">Simpan Password Baru</AuthSubmitButton>
        </form>
      ) : null}

      {step === "done" ? (
        <AuthSuccessState
          title="Password berhasil diperbarui"
          description="Kamu sekarang dapat masuk menggunakan password baru."
          action={<Link id="reset-login-link" to="/login" className="auth-button">Kembali ke Login</Link>}
        />
      ) : null}

      {step !== "done" ? <p className="auth-footer-copy"><Link to="/login">Kembali ke Login</Link></p> : null}
    </AuthShell>
  );
}
