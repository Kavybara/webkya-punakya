import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Headphones } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthFormPanel, AuthInput, AuthSubmitButton } from "../../components/auth/AuthShell";
import { api, type PublicTrackingOrder } from "../../lib/api";
import "./order-tracking.css";

const genericError = "Pesanan tidak ditemukan atau data verifikasi tidak sesuai.";

function statusLabel(value = "") {
  const normalized = String(value || "").toLowerCase();
  const labels: Record<string, string> = {
    paid: "Dibayar",
    pending: "Menunggu Pembayaran",
    expired: "Kedaluwarsa",
    cancelled: "Dibatalkan",
    completed: "Selesai",
    processing: "Diproses",
    sent: "Terkirim",
    waiting_payment: "Menunggu Pembayaran",
    delivery_failed: "Pengiriman Bermasalah",
  };
  return labels[normalized] || value || "Belum tersedia";
}

function statusTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (["paid", "completed", "sent"].includes(normalized)) return "border-[color-mix(in_srgb,var(--status-success)_32%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-[var(--status-success)]";
  if (["expired", "cancelled", "delivery_failed"].includes(normalized)) return "border-[color-mix(in_srgb,var(--status-danger)_32%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] text-[var(--status-danger)]";
  return "border-[color-mix(in_srgb,var(--status-warning)_32%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] text-[var(--status-warning)]";
}

function dateText(value = "") {
  if (!value) return "-";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function OrderTrackingPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const initialOrderId = params.get("order") || "";
  const [orderId, setOrderId] = useState(initialOrderId);
  const [verification, setVerification] = useState("");
  const [result, setResult] = useState<PublicTrackingOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(
    () => Boolean(token || (orderId.trim() && verification.trim())),
    [orderId, token, verification],
  );

  async function track() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError("");
    try {
      const next = await api.trackOrder(token
        ? { trackingToken: token }
        : { orderId: orderId.trim(), verification: verification.trim() });
      setResult(next);
    } catch (trackError) {
      setResult(null);
      const message = trackError instanceof Error ? trackError.message : genericError;
      setError(/terlalu banyak/i.test(message) ? message : genericError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Lacak Pesanan | Kavya";
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !robots;
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.appendChild(robots);
    }
    const previousRobots = robots.content;
    robots.content = "noindex,nofollow";
    return () => {
      document.title = previousTitle;
      if (created) robots?.remove();
      else if (robots) robots.content = previousRobots;
    };
  }, []);

  useEffect(() => {
    if (token) track().catch(() => undefined);
    // Token is immutable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function submit(event: FormEvent) {
    event.preventDefault();
    track().catch(() => undefined);
  }

  return (
    <main className="auth-shell">
      <AuthFormPanel
        title={result ? "Status pesanan" : "Temukan pesanan"}
        description={
          token
            ? "Tautan tracking terverifikasi."
            : "Masukkan nomor pesanan dan kontak pemesan untuk melihat status."
        }
      >
        <div aria-live="polite" aria-busy={loading}>
          {!result ? (
            <form className="auth-form" onSubmit={submit} noValidate>
              {!token ? (
                <>
                  <AuthInput
                    id="tracking-order-id"
                    label="Nomor pesanan"
                    value={orderId}
                    onChange={(event) => setOrderId(event.target.value)}
                    placeholder="ORD-..."
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                  <AuthInput
                    id="tracking-verification"
                    label="WhatsApp atau email pemesan"
                    value={verification}
                    onChange={(event) => setVerification(event.target.value)}
                    placeholder="08... atau nama@email.com"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </>
              ) : (
                <p className="auth-notice">Memeriksa tautan tracking...</p>
              )}
              {error ? <p className="auth-error" role="alert">{error}</p> : null}
              <AuthSubmitButton
                loading={loading}
                loadingLabel="Memeriksa..."
                disabled={!canSubmit}
              >
                Lacak Pesanan
              </AuthSubmitButton>
            </form>
          ) : (
            <div className="auth-form">
              <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-mono text-xs text-[var(--text-muted)]">{result.orderId}</p>
                  <h2 className="mt-2 text-lg font-semibold">{result.product}</h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{result.variant || "Paket digital"}</p>
                </div>
                <span className={`inline-flex w-fit rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(result.orderStatus)}`}>
                  {statusLabel(result.orderStatus)}
                </span>
              </div>

              <dl className="grid gap-5 py-5 sm:grid-cols-2">
                <div><dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Pembayaran</dt><dd className="mt-2 text-sm font-medium text-[var(--text-secondary)]">{statusLabel(result.paymentStatus)}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Proses</dt><dd className="mt-2 text-sm font-medium text-[var(--text-secondary)]">{statusLabel(result.processStatus)}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Dibuat</dt><dd className="mt-2 text-sm text-[var(--text-secondary)]">{dateText(result.createdAt)}</dd></div>
                <div><dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Dibayar</dt><dd className="mt-2 text-sm text-[var(--text-secondary)]">{dateText(result.paidAt)}</dd></div>
                {result.customerContact ? <div><dt className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Kontak</dt><dd className="mt-2 text-sm text-[var(--text-secondary)]">{result.customerContact}</dd></div> : null}
              </dl>

              <div className="auth-form-actions">
                <AuthSubmitButton loading={loading} loadingLabel="Memperbarui...">
                  Perbarui Status
                </AuthSubmitButton>
              </div>
              <p className="auth-footer-copy">
                Sudah punya akun? <Link to="/login">Masuk ke dashboard</Link>
              </p>
            </div>
          )}
        </div>
        <p className="auth-form-note tracking-help">
          <Headphones size={15} aria-hidden="true" /> Butuh bantuan? Hubungi owner dan sertakan nomor pesanan.
        </p>
      </AuthFormPanel>
    </main>
  );
}
