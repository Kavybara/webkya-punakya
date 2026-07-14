import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/base/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/base/Card";
import { PageTransition } from "../../components/feature/PageTransition";
import { api } from "../../lib/api";

type ResetStep = "request" | "verify" | "confirm" | "done";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<ResetStep>("request");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!identifier.trim()) {
      setError("Email atau username wajib diisi.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.requestPasswordReset({ identifier: identifier.trim() });
      setMessage(result.message || "Kalau akun terdaftar, OTP dikirim ke WhatsApp terdaftar.");
      setStep("verify");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Gagal mengirim OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function submitVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.verifyPasswordReset({ identifier: identifier.trim(), code });
      setResetToken(result.resetToken);
      setStep("confirm");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Kode OTP tidak valid.");
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
      setError("Konfirmasi password tidak sama.");
      return;
    }
    setLoading(true);
    try {
      await api.confirmPasswordReset({ resetToken, newPassword, confirmPassword });
      setStep("done");
      setMessage("Password berhasil direset. Silakan login dengan password baru.");
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Password gagal direset.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageTransition>
      <main className="flex min-h-screen items-center justify-center bg-[#f5efe6] px-4 py-8">
        <Card className="w-full max-w-md border-gray-100 bg-white">
          <CardHeader>
            <CardTitle>Reset Password</CardTitle>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              Kode OTP dikirim ke nomor WhatsApp yang terdaftar di akun owner atau reseller.
            </p>
          </CardHeader>
          <CardBody>
            <div className="mb-5 grid grid-cols-3 gap-2 text-center text-xs">
              {["Akun", "OTP", "Password"].map((label, index) => {
                const activeIndex = step === "request" ? 0 : step === "verify" ? 1 : 2;
                return (
                  <div key={label} className={`rounded-md px-2 py-2 font-medium ${index <= activeIndex ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-400"}`}>
                    {label}
                  </div>
                );
              })}
            </div>

            {message ? <div className="mb-4 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-medium leading-5 text-emerald-700">{message}</div> : null}
            {error ? <div className="mb-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium leading-5 text-red-700">{error}</div> : null}

            {step === "request" ? (
              <form className="space-y-4" onSubmit={submitRequest}>
                <label className="block">
                <span className="text-sm font-medium text-slate-700">Email, Username, atau WhatsApp</span>
                  <input
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none transition-colors focus:border-red-200"
                    placeholder="owner@kavya.id / reseller.username / 628..."
                  />
                </label>
                <Button className="w-full bg-red-500 hover:bg-red-600" disabled={loading}>
                  {loading ? "Mengirim..." : "Kirim OTP WhatsApp"}
                </Button>
              </form>
            ) : null}

            {step === "verify" ? (
              <form className="space-y-4" onSubmit={submitVerify}>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Kode OTP 6 Digit</span>
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                    className="mt-2 h-11 w-full rounded-md border border-gray-200 px-3 text-center font-mono text-lg tracking-[0.3em] outline-none transition-colors focus:border-red-200"
                    placeholder="000000"
                    inputMode="numeric"
                  />
                </label>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("request")}>
                    Ubah Akun
                  </Button>
                  <Button className="flex-1 bg-red-500 hover:bg-red-600" disabled={loading || code.length !== 6}>
                    Verifikasi
                  </Button>
                </div>
              </form>
            ) : null}

            {step === "confirm" ? (
              <form className="space-y-4" onSubmit={submitConfirm}>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Password Baru</span>
                  <input
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    type="password"
                    className="mt-2 h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none transition-colors focus:border-red-200"
                    placeholder="Minimal 8 karakter"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Konfirmasi Password</span>
                  <input
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type="password"
                    className="mt-2 h-10 w-full rounded-md border border-gray-200 px-3 text-sm outline-none transition-colors focus:border-red-200"
                    placeholder="Ulangi password baru"
                  />
                </label>
                <Button className="w-full bg-red-500 hover:bg-red-600" disabled={loading}>
                  {loading ? "Menyimpan..." : "Simpan Password Baru"}
                </Button>
              </form>
            ) : null}

            {step === "done" ? (
              <div className="rounded-md border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
                Password berhasil direset.
              </div>
            ) : null}

            <Link to="/login" className="mt-5 block text-center text-sm font-medium text-red-600">
              Kembali login
            </Link>
          </CardBody>
        </Card>
      </main>
    </PageTransition>
  );
}
