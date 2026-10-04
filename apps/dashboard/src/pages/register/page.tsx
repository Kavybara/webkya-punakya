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
import { writeSession } from "../../lib/session";

type RegistrationStep = "details" | "otp" | "done";
type RegistrationField = keyof typeof emptyForm;
type RegistrationErrors = Partial<Record<RegistrationField, string>>;

const REGISTER_RESEND_SECONDS = 60;
const emptyForm = { name: "", username: "", email: "", whatsapp: "", password: "", confirmPassword: "" };

function normalizedWhatsapp(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function maskWhatsapp(value: string) {
  const digits = normalizedWhatsapp(value);
  if (digits.length < 8) return "Nomor WhatsApp terdaftar";
  return `${digits.slice(0, 3)}${"*".repeat(Math.max(4, digits.length - 6))}${digits.slice(-3)}`;
}

function validateRegistrationForm(form: typeof emptyForm): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const name = form.name.trim();
  const username = form.username.trim().toLowerCase();
  const whatsapp = normalizedWhatsapp(form.whatsapp);
  if (name.length < 2 || name.length > 80) errors.name = "Nama harus 2-80 karakter.";
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/.test(username)) errors.username = "Username harus 3-32 karakter dan hanya memakai huruf kecil, angka, titik, garis bawah, atau strip.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) || form.email.trim().length > 160) errors.email = "Email tidak valid.";
  if (!/^62\d{8,13}$/.test(whatsapp)) errors.whatsapp = "Nomor WhatsApp tidak valid.";
  if (form.password.length < 8 || form.password.length > 128) errors.password = "Password harus 8-128 karakter.";
  if (form.password !== form.confirmPassword) errors.confirmPassword = "Konfirmasi password tidak sama.";
  return errors;
}

function safeRegistrationError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("whatsapp") && message.includes("dipakai")) return "Nomor WhatsApp sudah digunakan oleh akun lain.";
  if (message.includes("username") && message.includes("dipakai")) return "Username sudah digunakan oleh akun lain.";
  if (message.includes("email") && message.includes("dipakai")) return "Email sudah digunakan oleh akun lain.";
  if (message.includes("tunggu") || message.includes("terlalu")) return "Permintaan terlalu sering. Tunggu beberapa saat lalu coba lagi.";
  if (message.includes("whatsapp") || message.includes("otp")) return "Kode WhatsApp belum dapat dikirim. Periksa nomor dan koneksi lalu coba lagi.";
  return "Pendaftaran belum dapat diproses. Coba kembali beberapa saat lagi.";
}

function safeRegistrationOtpError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("terlalu") || message.includes("terkunci")) return "Terlalu banyak percobaan. Kirim kode baru sebelum mencoba lagi.";
  if (message.includes("kadaluarsa") || message.includes("kedaluwarsa")) return "Kode salah atau sudah kedaluwarsa. Kirim kode baru.";
  return "Kode salah atau sudah kedaluwarsa. Periksa kode lalu coba lagi.";
}

export default function RegisterPage() {
  const [step, setStep] = useState<RegistrationStep>("details");
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState<Partial<Record<RegistrationField, boolean>>>({});
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [registrationId, setRegistrationId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [expiresInSeconds, setExpiresInSeconds] = useState(0);
  const [capsLock, setCapsLock] = useState(false);

  useEffect(() => {
    api.registrationConfig().then((result) => setEnabled(result.enabled)).catch(() => setEnabled(true));
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = window.setInterval(() => setResendCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCountdown]);

  useEffect(() => {
    const id = step === "details" ? "register-name" : step === "otp" ? "register-otp" : "register-success-link";
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }, [step]);

  function updateField(field: RegistrationField, value: string) {
    const nextValue = field === "username" ? value.toLowerCase().replace(/\s+/g, "") : value;
    const next = { ...form, [field]: nextValue };
    setForm(next);
    setError("");
    if (touched[field]) setErrors(validateRegistrationForm(next));
  }

  function touchField(field: RegistrationField) {
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors(validateRegistrationForm(form));
  }

  async function sendRegistrationCode(isResend = false) {
    setError("");
    setLoading(true);
    try {
      const result = await api.requestRegistration(form);
      setRegistrationId(result.registrationId);
      setExpiresInSeconds(result.expiresInSeconds || 0);
      setMessage(result.message || "Kode verifikasi sudah dikirim ke WhatsApp.");
      setResendCountdown(REGISTER_RESEND_SECONDS);
      setStep("otp");
      if (isResend) setCode("");
    } catch (requestError) {
      setError(safeRegistrationError(requestError));
    } finally { setLoading(false); }
  }

  async function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateRegistrationForm(form);
    setTouched(Object.fromEntries(Object.keys(emptyForm).map((field) => [field, true])) as Record<RegistrationField, boolean>);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    await sendRegistrationCode();
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (code.length !== 6) { setError("Masukkan enam digit kode verifikasi."); return; }
    setLoading(true);
    try {
      const session = await api.verifyRegistration({ registrationId, code });
      writeSession(session, true);
      setStep("done");
    } catch (verifyError) {
      setError(safeRegistrationOtpError(verifyError));
    } finally { setLoading(false); }
  }

  function changeNumber() {
    setStep("details");
    setRegistrationId("");
    setCode("");
    setMessage("");
    setError("");
    setResendCountdown(0);
  }

  const passwordsMatch = Boolean(form.confirmPassword) && form.password === form.confirmPassword;
  const visibleError = (field: RegistrationField) => touched[field] ? errors[field] : undefined;

  return (
    <AuthShell title="Daftar sebagai Reseller" description="Buat akun dan verifikasi nomor WhatsApp untuk mulai menggunakan Kavya.">
      {step !== "done" ? <AuthStepIndicator steps={["Data Akun", "Verifikasi WhatsApp"]} activeStep={step === "details" ? 0 : 1} /> : null}
      {!enabled ? <p className="auth-notice">Pendaftaran mandiri sedang ditutup. Silakan hubungi Owner.</p> : step === "details" ? (
        <form className="auth-form" onSubmit={requestOtp} noValidate>
          {error ? <div className="auth-general-error"><AuthError>{error}</AuthError></div> : null}
          <div className="auth-form-actions">
            <AuthInput id="register-name" label="Nama" value={form.name} onChange={(event) => updateField("name", event.target.value)} onBlur={() => touchField("name")} error={visibleError("name")} autoComplete="name" />
            <AuthInput id="register-username" label="Username" value={form.username} onChange={(event) => updateField("username", event.target.value)} onBlur={() => touchField("username")} error={visibleError("username")} autoComplete="username" />
          </div>
          <AuthInput id="register-email" label="Email" type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} onBlur={() => touchField("email")} error={visibleError("email")} autoComplete="email" />
          <AuthInput id="register-whatsapp" label="Nomor WhatsApp" value={form.whatsapp} onChange={(event) => updateField("whatsapp", event.target.value)} onBlur={() => touchField("whatsapp")} error={visibleError("whatsapp")} inputMode="tel" autoComplete="tel" placeholder="081234567890" />
          <div className="auth-form-actions">
            <PasswordInput id="register-password" label="Password" value={form.password} onChange={(event) => updateField("password", event.target.value)} onBlur={() => touchField("password")} error={visibleError("password")} autoComplete="new-password" onCapsLockChange={setCapsLock} />
            <PasswordInput id="register-confirm" label="Ulangi Password" value={form.confirmPassword} onChange={(event) => updateField("confirmPassword", event.target.value)} onBlur={() => touchField("confirmPassword")} error={visibleError("confirmPassword")} autoComplete="new-password" onCapsLockChange={setCapsLock} />
          </div>
          <div className="auth-requirements"><span className={form.password.length >= 8 && form.password.length <= 128 ? "is-valid" : ""}>Password harus 8-128 karakter</span><span className={passwordsMatch ? "is-valid" : ""}>Kedua password sama</span></div>
          {form.confirmPassword ? <p className={`auth-match ${passwordsMatch ? "is-match" : "is-mismatch"}`}>{passwordsMatch ? "Password cocok" : "Password belum cocok"}</p> : null}
          {capsLock ? <p className="auth-caps" role="status">Caps Lock sedang aktif.</p> : null}
          <AuthSubmitButton loading={loading} loadingLabel="Mengirim kode...">Kirim Kode WhatsApp</AuthSubmitButton>
        </form>
      ) : step === "otp" ? (
        <form className="auth-form" onSubmit={verifyOtp} noValidate>
          <div className="auth-destination"><span>Kode dikirim ke</span><strong>{maskWhatsapp(form.whatsapp)}</strong></div>
          {message ? <p className="auth-notice is-success">{message}</p> : null}
          <OtpInput id="register-otp" label="Kode verifikasi 6 digit" value={code} onChange={(value) => { setCode(value); setError(""); }} error={error} disabled={loading} aria-busy={loading || undefined} />
          <div className="auth-resend">
            <span>{expiresInSeconds ? `Kode berlaku sekitar ${Math.ceil(expiresInSeconds / 60)} menit.` : "Kode memiliki masa berlaku terbatas."}</span>
            <button type="button" disabled={loading || resendCountdown > 0} aria-busy={loading || undefined} onClick={() => void sendRegistrationCode(true)}>{resendCountdown > 0 ? `Kirim ulang (${resendCountdown}s)` : "Kirim Ulang"}</button>
          </div>
          <div className="auth-form-actions">
            <button type="button" className="auth-button is-secondary" onClick={changeNumber}>Ubah Nomor</button>
            <AuthSubmitButton loading={loading} loadingLabel="Memverifikasi..." disabled={code.length !== 6}>Verifikasi dan Daftar</AuthSubmitButton>
          </div>
        </form>
      ) : (
        <AuthSuccessState title="Akun berhasil dibuat" description="Kamu sekarang dapat masuk ke panel reseller Kavya." action={<Link id="register-success-link" to="/reseller" className="auth-button">Masuk ke Kavya</Link>} />
      )}
      {step !== "done" ? <p className="auth-footer-copy">Sudah punya akun? <Link to="/login">Masuk</Link></p> : null}
    </AuthShell>
  );
}
