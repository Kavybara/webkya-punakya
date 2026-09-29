import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, Headphones, Search, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type PublicTrackingOrder } from "../../lib/api";

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
  if (["paid", "completed", "sent"].includes(normalized)) return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  if (["expired", "cancelled", "delivery_failed"].includes(normalized)) return "border-rose-400/20 bg-rose-400/10 text-rose-300";
  return "border-amber-300/20 bg-amber-300/10 text-amber-200";
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
    
      <main className="kavya-public-dark min-h-screen bg-[var(--bg-canvas)] px-4 py-6 text-[var(--text-primary)] sm:px-6 sm:py-8">
        <header className="mx-auto flex max-w-5xl items-center justify-between">
          <Link to="/" className="inline-flex min-h-11 items-center gap-3 rounded-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] font-serif">K</span>
            Kavya
          </Link>
          <Link to="/products" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">
            <ArrowLeft size={16} /> Produk
          </Link>
        </header>

        <section className="mx-auto grid max-w-5xl gap-8 pb-16 pt-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-start lg:pt-20">
          <div className="max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Pelacakan aman</p>
            <h1 className="mt-4 text-4xl font-medium tracking-[-0.04em] sm:text-5xl">Lacak pesananmu.</h1>
            <p className="mt-4 text-base leading-7 text-zinc-400">
              Gunakan tautan tracking dari halaman pembayaran, atau verifikasi nomor pesanan dengan WhatsApp maupun email pemesan.
            </p>
            <div className="mt-8 space-y-4 text-sm text-zinc-400">
              <div className="flex gap-3"><ShieldCheck className="mt-0.5 text-cyan-300" size={18} /><span>Credential akun tidak pernah ditampilkan di halaman publik.</span></div>
              <div className="flex gap-3"><Clock3 className="mt-0.5 text-violet-300" size={18} /><span>Status pembayaran dan proses ditampilkan tanpa data internal.</span></div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]" aria-live="polite" aria-busy={loading}>
            <div className="border-b border-white/[0.09] px-5 py-5 sm:px-7">
              <h2 className="text-lg font-semibold">{result ? "Status pesanan" : "Temukan pesanan"}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {token ? "Tautan tracking terverifikasi." : "Nomor pesanan saja tidak cukup untuk membuka status."}
              </p>
            </div>

            {!result ? (
              <form onSubmit={submit} className="space-y-5 p-5 sm:p-7">
                {!token ? (
                  <>
                    <label className="block" htmlFor="tracking-order-id">
                      <span className="text-sm font-medium text-zinc-200">Nomor pesanan</span>
                      <input
                        id="tracking-order-id"
                        name="orderId"
                        value={orderId}
                        onChange={(event) => setOrderId(event.target.value)}
                        className="mt-2 h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-4 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-400/15"
                        placeholder="ORD-..."
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                      />
                    </label>
                    <label className="block" htmlFor="tracking-verification">
                      <span className="text-sm font-medium text-zinc-200">WhatsApp atau email pemesan</span>
                      <input
                        id="tracking-verification"
                        name="verification"
                        value={verification}
                        onChange={(event) => setVerification(event.target.value)}
                        className="mt-2 h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-4 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-400/15"
                        placeholder="08... atau nama@email.com"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                  </>
                ) : (
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-4 py-5 text-sm text-zinc-400">
                    Memeriksa tautan tracking...
                  </div>
                )}
                {error ? <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</p> : null}
                <button
                  type="submit"
                  disabled={!canSubmit || loading}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
                >
                  <Search size={17} /> {loading ? "Memeriksa..." : "Lacak Pesanan"}
                </button>
              </form>
            ) : (
              <div className="p-5 sm:p-7">
                <div className="flex flex-col gap-3 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-mono text-xs text-zinc-500">{result.orderId}</p>
                    <h3 className="mt-2 text-xl font-semibold">{result.product}</h3>
                    <p className="mt-1 text-sm text-zinc-400">{result.variant || "Paket digital"}</p>
                  </div>
                  <span className={`inline-flex w-fit rounded-full border px-3 py-1.5 text-xs font-semibold ${statusTone(result.orderStatus)}`}>
                    {statusLabel(result.orderStatus)}
                  </span>
                </div>

                <dl className="grid gap-5 py-6 sm:grid-cols-2">
                  <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Pembayaran</dt><dd className="mt-2 text-sm font-medium text-zinc-200">{statusLabel(result.paymentStatus)}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Proses</dt><dd className="mt-2 text-sm font-medium text-zinc-200">{statusLabel(result.processStatus)}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Dibuat</dt><dd className="mt-2 text-sm text-zinc-300">{dateText(result.createdAt)}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Dibayar</dt><dd className="mt-2 text-sm text-zinc-300">{dateText(result.paidAt)}</dd></div>
                  {result.customerContact ? <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Kontak</dt><dd className="mt-2 text-sm text-zinc-300">{result.customerContact}</dd></div> : null}
                </dl>

                <div className="flex flex-col gap-3 border-t border-white/[0.08] pt-5 sm:flex-row">
                  <button type="button" onClick={() => track()} disabled={loading} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50">
                    {loading ? "Memperbarui..." : "Perbarui Status"}
                  </button>
                  <Link to="/login" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/10 px-5 text-sm font-semibold text-zinc-200 hover:border-white/20 hover:bg-white/[0.04]">
                    Masuk Dashboard
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>

        <footer className="mx-auto flex max-w-5xl items-center gap-2 border-t border-white/[0.08] py-6 text-sm text-zinc-500">
          <Headphones size={16} /> Butuh bantuan? Hubungi owner dan sertakan nomor pesanan.
        </footer>
      </main>
    
  );
}
