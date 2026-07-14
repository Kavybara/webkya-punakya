import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/base/Button";
import { PageTransition } from "../../components/feature/PageTransition";
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

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionMessage = searchParams.get("reason") === "session" ? "Sesi login berakhir. Silakan masuk ulang." : "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(sessionMessage);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [ownerWhatsapp, setOwnerWhatsapp] = useState(fallbackOwnerWhatsapp);

  useEffect(() => {
    let alive = true;
    api.health()
      .then((health) => {
        const nextNumber = normalizeWhatsapp(health.ownerWhatsAppNumber || "");
        if (alive && nextNumber) setOwnerWhatsapp(nextNumber);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const ownerWhatsappUrl = useMemo(() => {
    const number = normalizeWhatsapp(ownerWhatsapp) || fallbackOwnerWhatsapp;
    const text = encodeURIComponent("Halo Kak, saya mau daftar reseller Kavya.");
    return `https://wa.me/${number}?text=${text}`;
  }, [ownerWhatsapp]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await api.login({ email, password, remember });
      writeSession(session, remember);
      const next = searchParams.get("next") || "";
      if (session.role === "owner") {
        navigate(next.startsWith("/dashboard") ? next : "/dashboard");
        return;
      }
      navigate(next.startsWith("/reseller") ? next : "/reseller");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageTransition>
      <main className="flex min-h-screen items-center justify-center bg-[#f5efe6] px-4 py-10">
        <div className="w-full max-w-[390px]">
          <div className="mb-7 text-center">
            <Link to="/" className="font-serif text-2xl font-semibold text-slate-950">
              Kavya
            </Link>
            <p className="mt-2 text-sm text-slate-500">Netflix Digital Account Management</p>
          </div>

          <section className="rounded-xl border border-gray-100 bg-white px-6 py-7">
            <h1 className="text-center text-base font-semibold text-slate-950">Masuk ke Dashboard</h1>
            <p className="mt-2 text-center text-xs leading-5 text-slate-500">Masukkan username/email owner atau reseller. Sistem akan membuka panel yang sesuai.</p>

            <form
              className="mt-5 space-y-4"
              onSubmit={submitLogin}
            >
              <label className="block">
                <span className="text-sm font-medium text-slate-800">Username / Email</span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 h-9 w-full rounded-md border border-gray-200 px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-red-200"
                  placeholder="owner atau owner@kavya.id"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-800">Password</span>
                <span className="relative mt-2 block">
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    className="h-9 w-full rounded-md border border-gray-200 px-3 pr-10 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-red-200"
                    placeholder="********"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                    aria-label={showPassword ? "Sembunyikan password" : "Lihat password"}
                    title={showPassword ? "Sembunyikan password" : "Lihat password"}
                  >
                    <i className={showPassword ? "ri-eye-off-line" : "ri-eye-line"} />
                  </button>
                </span>
              </label>
              {error ? (
                <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {error}
                </div>
              ) : null}
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 text-slate-500">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-red-600" />
                  Ingat saya
                </label>
                <Link to="/forgot-password" className="font-medium text-red-600">
                  Lupa password?
                </Link>
              </div>
              <Button className="w-full bg-red-400 hover:bg-red-600" disabled={loading}>
                <span className="flex h-4 w-4 items-center justify-center">
                  <i className="ri-login-box-line" />
                </span>
                {loading ? "Memeriksa..." : "Masuk"}
              </Button>
            </form>

            <p className="mt-4 text-center text-xs text-slate-500">
              Belum punya akun reseller?{" "}
              <a href={ownerWhatsappUrl} target="_blank" rel="noreferrer" className="font-medium text-red-600">
                Hubungi Owner
              </a>
            </p>
          </section>
        </div>
      </main>
    </PageTransition>
  );
}
