import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "../../components/base/Badge";
import { Button } from "../../components/base/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/base/Card";
import { PageTransition } from "../../components/feature/PageTransition";
import { api, subscribeRealtime, type ApiOrder, type ApiPayment } from "../../lib/api";
import { readSession } from "../../lib/session";

function money(value = 0) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0)).replace("IDR", "Rp").trim();
}

function qrImageSource(payment: ApiPayment | null) {
  if (!payment) return "";
  if (payment.qrImageUrl) return payment.qrImageUrl;
  const qrData = payment.qrString || payment.qrisText || payment.paymentUrl || "";
  if (!qrData) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(qrData)}`;
}

function splitFulfillmentText(text = "") {
  const lines = text.split("\n");
  const snkIndex = lines.findIndex((line) => /^S&K:/i.test(line.trim()));
  const accountLines = snkIndex === -1 ? lines : lines.slice(0, snkIndex);
  const detailIndex = accountLines.findIndex((line) =>
    /^(?:〔\s*ACCOUNT DETAIL\s*〕|ACCOUNT DETAIL|DETAIL (?:AKUN|CANVA|LINK))$/i.test(line.trim()),
  );
  return {
    account: accountLines.slice(detailIndex >= 0 ? detailIndex : 0).join("\n").trim(),
    snk: snkIndex === -1 ? "" : lines.slice(snkIndex).join("\n").trim(),
  };
}

function paymentStateLabel(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "manual") return "Approve manual owner";
  if (normalized === "paid") return "QRIS paid";
  if (normalized === "expired") return "QRIS expired";
  return status || "pending";
}

export default function OrderTrackingPage() {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<ApiOrder | null>(null);
  const [payment, setPayment] = useState<ApiPayment | null>(null);
  const [error, setError] = useState("");
  const [params] = useSearchParams();
  const [authenticatedTracking, setAuthenticatedTracking] = useState(() => Boolean(readSession()?.token));

  async function fetchOrder(id: string) {
    return authenticatedTracking ? api.order(id) : api.trackOrder(id);
  }

  async function fetchPayment(ref: string) {
    return authenticatedTracking ? api.payment(ref) : api.trackPayment(ref);
  }

  const trackOrder = useCallback(async (rawId?: string) => {
    const orderId = String(rawId ?? query).trim();
    if (!orderId) return;
    setError("");
    try {
      let nextOrder = await fetchOrder(orderId);
      if (nextOrder.paymentRef && nextOrder.qrisStatus === "pending") {
        const nextPayment = await fetchPayment(nextOrder.paymentRef);
        setPayment(nextPayment);
        // Opening the payment endpoint can reconcile Pakasir -> order delivery.
        if (String(nextPayment?.status || "").toLowerCase() === "paid") {
          nextOrder = await fetchOrder(orderId);
        }
      } else {
        setPayment(null);
      }
      setOrder(nextOrder);
    } catch (trackError) {
      setOrder(null);
      setPayment(null);
      setError(trackError instanceof Error ? trackError.message : "Order tidak ditemukan.");
    }
  }, [authenticatedTracking, query]);

  useEffect(() => {
    const syncSession = () => setAuthenticatedTracking(Boolean(readSession()?.token));
    window.addEventListener("kavya-session:update", syncSession);
    return () => window.removeEventListener("kavya-session:update", syncSession);
  }, []);

  useEffect(() => {
    return subscribeRealtime(() => {
      if (query.trim()) trackOrder().catch(console.error);
    });
  }, [query, trackOrder]);

  useEffect(() => {
    const initial = params.get("order") || "";
    if (!initial) return;
    setQuery(initial);
    trackOrder(initial).catch((trackError) => {
      setError(trackError instanceof Error ? trackError.message : "Order tidak ditemukan.");
    });
  }, [params, trackOrder]);

  useEffect(() => {
    if (!query.trim() || !order?.paymentRef || order.qrisStatus !== "pending") return undefined;
    const refresh = window.setInterval(() => {
      trackOrder().catch(console.error);
    }, 7000);
    return () => window.clearInterval(refresh);
  }, [order?.paymentRef, order?.qrisStatus, query, trackOrder]);

  const qrSrc = qrImageSource(payment);
  const fulfillment = splitFulfillmentText(order?.fulfillmentText || "");
  const snkText = order?.snkText || fulfillment.snk;

  return (
    <PageTransition>
      <main className="min-h-screen bg-cream px-4 py-8">
        <div className="mx-auto mb-4 flex max-w-xl items-center justify-between text-sm">
          <Link to="/" className="font-semibold text-slate-900">Kavya</Link>
          <div className="flex gap-3">
            <Link to="/products" className="text-slate-600 hover:text-red-600">Produk</Link>
            <Link to="/login" className="text-slate-600 hover:text-red-600">Login</Link>
          </div>
        </div>
        <Card className="mx-auto max-w-xl">
          <CardHeader>
            <CardTitle>Track order</CardTitle>
            <p className="mt-1 text-sm text-slate-500">Masukkan ID order atau PAY ref untuk cek status realtime.</p>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-100 px-3 py-2 text-sm" placeholder="ORD-... atau PAY-..." />
              <Button onClick={() => { trackOrder().catch(console.error); }}>Track</Button>
            </div>
            {order ? (
              <div className="mt-5 rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-slate-900">{order.id}</strong>
                  <Badge variant={order.orderStatus === "completed" ? "emerald" : order.orderStatus === "cancelled" ? "red" : "amber"}>
                    {order.orderStatus}
                  </Badge>
                </div>
                <div className="mt-3 text-sm text-slate-600">{order.product} - {order.variant}</div>
                <div className="mt-1 text-sm text-slate-500">Pembayaran: {paymentStateLabel(order.qrisStatus)}</div>
                <div className="mt-1 text-sm text-slate-500">Batas bayar: {order.paymentExpiresAt || "-"}</div>
                {order.qrisStatus === "pending" && payment ? (
                  <div className="mt-5 rounded-lg border border-amber-100 bg-amber-50/50 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      {qrSrc ? <img src={qrSrc} alt="QRIS pembayaran" className="h-40 w-40 rounded-lg border border-white bg-white p-2" /> : null}
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="font-semibold text-slate-900">QRIS masih aktif</div>
                        <div className="mt-2 text-slate-600">Ref: {payment.ref}</div>
                        <div className="text-slate-600">Total: {money(payment.totalPayment || payment.amount || order.paymentDue || order.total)}</div>
                        <div className="text-slate-600">Expired: {payment.expiresAt || order.paymentExpiresAt || "-"}</div>
                        {payment.paymentUrl ? (
                          <a href={payment.paymentUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-4 text-xs font-semibold text-white">
                            Buka QRIS
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
                {authenticatedTracking && order.fulfillmentText ? (
                  <div className="mt-5 grid gap-3">
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-4">
                      <div className="text-sm font-semibold text-emerald-900">Detail Akun</div>
                      <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 font-mono text-xs leading-5 text-slate-700">
                        {fulfillment.account}
                      </pre>
                    </div>
                    {snkText ? (
                      <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-4">
                        <div className="text-sm font-semibold text-amber-900">S&K Produk</div>
                        <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-white p-3 font-mono text-xs leading-5 text-slate-700">
                          {snkText}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {!authenticatedTracking && order.orderStatus === "completed" ? (
                  <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    Order sudah selesai. Detail akun disembunyikan di halaman tracking umum. Lihat dari dashboard reseller setelah login.
                  </div>
                ) : null}
              </div>
            ) : error ? (
              <div className="mt-5 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </main>
    </PageTransition>
  );
}
