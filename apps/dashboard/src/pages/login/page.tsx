import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthError, AuthInput, AuthShell, AuthSubmitButton, PasswordInput } from "../../components/auth/AuthShell";
import { api } from "../../lib/api";
import { writeSession } from "../../lib/session";

const fallbackOwnerWhatsapp = "6287777655549";

function normalizeWhatsapp(number = "") {
  const digits = String(number || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

function safeLoginError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("nonaktif")) return "Akun sedang tidak aktif. Hubungi Owner untuk bantuan.";
  if (message.includes("terlalu") || message.includes("limit") || message.includes("coba lagi")) return "Terlalu banyak percobaan login. Tunggu beberapa saat lalu coba kembali.";
  if (message.includes("fetch") || message.includes("network") || message.includes("server")) return "Kavya belum dapat dihubungi. Periksa koneksi lalu coba kembali.";
  return "Username/email atau password tidak sesuai.";
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionMessage = searchParams.get("reason") === "session" ? "Sesi login berakhir. Silakan masuk ulang." : "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(sessionMessage);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(fallbackOwnerWhatsapp);
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const identifierError = identifierTouched && !email.trim() ? "Username atau email wajib diisi." : "";
  const passwordError = passwordTouched && !password ? "Password wajib diisi." : "";

  useEffect(() => {
    let alive = true;
    api.health().then((health) => {
      const nextNumber = normalizeWhatsapp(health.ownerWhatsAppNumber || "");
      if (alive && nextNumber) setOwnerWhatsapp(nextNumber);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const ownerWhatsappUrl = useMemo(() => {
    const number = normalizeWhatsapp(ownerWhatsapp) || fallbackOwnerWhatsapp;
    return `https://wa.me/${number}?text=${encodeURIComponent("Halo Kak, saya mau daftar reseller Kavya.")}`;
  }, [ownerWhatsapp]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIdentifierTouched(true);
    setPasswordTouched(true);
    if (!email.trim() || !password) return;
    setError("");
    setLoading(true);
    try {
      const session = await api.login({ email, password, remember });
      writeSession(session, remember);
      const next = searchParams.get("next") || "";
      if (session.role === "owner") {
        const destination = next.startsWith("/owner-v2") ? next : "/owner-v2";
        navigate(destination);
        return;
      }
      navigate(next.startsWith("/reseller-v2") ? next : "/reseller-v2/ringkasan");
    } catch (loginError) {
      setError(safeLoginError(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Selamat datang kembali" description="Masuk untuk melanjutkan ke Kavya.">
      {error ? <div className="auth-general-error"><AuthError>{error}</AuthError></div> : null}
      <form className="auth-form" onSubmit={submitLogin} noValidate>
        <AuthInput id="login-identifier" label="Username atau email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} onBlur={() => setIdentifierTouched(true)} error={identifierError} placeholder="Masukkan username atau email" autoComplete="username" />
        <PasswordInput id="login-password" label="Password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} onBlur={() => setPasswordTouched(true)} error={passwordError} placeholder="Masukkan password" autoComplete="current-password" onCapsLockChange={setCapsLock} />
        {capsLock ? <p className="auth-caps" role="status">Caps Lock sedang aktif.</p> : null}
        <div className="auth-inline-row">
          <label className="auth-checkbox"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Ingat saya</label>
          <Link to="/forgot-password">Lupa password?</Link>
        </div>
        <AuthSubmitButton loading={loading} loadingLabel="Memeriksa...">Masuk ke Kavya</AuthSubmitButton>
      </form>
      <p className="auth-form-note">Kamu akan diarahkan ke panel sesuai akses akunmu.</p>
      <p className="auth-footer-copy">Belum punya akun reseller? <Link to="/register">Daftar sekarang</Link></p>
      <p className="auth-footer-copy">Butuh bantuan? <a href={ownerWhatsappUrl} target="_blank" rel="noreferrer">Hubungi Owner</a></p>
    </AuthShell>
  );
}
