import { useEffect, useMemo, useState, useCallback } from "react";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, subscribeRealtime, type ApiOrder, type ApiPayment } from "../../../lib/api";
import {
  FilterPill,
  MiniBadge,
  ResellerPageTitle,
  ResellerSearch,
  ResellerStatCard,
  compactDate,
  money,
  orderPaid,
  orderStatusClass,
} from "../resellerUi";

type FilterStatus = "all" | "success";

function qrImageSource(payment: ApiPayment | null) {
  if (!payment) return "";
  if (payment.qrImageUrl) return payment.qrImageUrl;
  const qrData = payment.qrString || payment.qrisText || payment.paymentUrl || "";
  if (!qrData) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(qrData)}`;
}

function canReopenQris(order: ApiOrder) {
  return order.qrisStatus === "pending" && Boolean(order.paymentRef);
}

export default function ResellerHistoryPage() {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [selectedOrder, setSelectedOrder] = useState<ApiOrder | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<ApiPayment | null>(null);
  const [paymentLoading, setPaymentLoading] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [copiedRef, setCopiedRef] = useState("");
  const [pendingDrawerOpen, setPendingDrawerOpen] = useState(false);
  const [focusedArea, setFocusedArea] = useState<"all" | "pending" | "spent">("all");

  const loadOrders = useCallback(async () => {
    setOrders(await api.orders());
  }, []);

  useEffect(() => {
    loadOrders().catch(console.error);
    return subscribeRealtime(() => {
      loadOrders().catch(console.error);
    });
  }, []);

  const paidOrders = orders.filter(orderPaid);
  const pendingOrders = useMemo(() => orders.filter((order) => canReopenQris(order)), [orders]);
  const rows = useMemo(
    () =>
      orders
        .filter((order) => (filter === "success" ? orderPaid(order) : true))
        .filter((order) =>
          [order.id, order.paymentRef, order.customer, order.product, order.variant, order.duration]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    [filter, orders, query],
  );

  const openQris = useCallback(async (order: ApiOrder) => {
    if (!order.paymentRef) return;
    setSelectedOrder(order);
    setSelectedPayment(null);
    setPaymentError("");
    setPaymentLoading(order.id);
    try {
      const nextPayment = await api.payment(order.paymentRef);
      setSelectedPayment(nextPayment);
      await loadOrders();
      if (String(nextPayment?.status || "").toLowerCase() === "paid") {
        const latest = await api.order(order.id);
        setSelectedOrder(latest);
      }
    } catch (paymentLoadError) {
      setPaymentError(paymentLoadError instanceof Error ? paymentLoadError.message : "QRIS belum bisa dibuka.");
    } finally {
      setPaymentLoading("");
    }
  }, [loadOrders]);

  async function copyRef(ref = "") {
    if (!ref) return;
    await navigator.clipboard.writeText(ref);
    setCopiedRef(ref);
    window.setTimeout(() => setCopiedRef(""), 1500);
  }

  function closeQris() {
    setSelectedOrder(null);
    setSelectedPayment(null);
    setPaymentError("");
  }

  useEffect(() => {
    if (!selectedOrder?.id || !selectedOrder.paymentRef || selectedOrder.qrisStatus !== "pending") return undefined;
    const timer = window.setInterval(() => {
      openQris(selectedOrder).catch(console.error);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [openQris, selectedOrder]);

  const selectedQrSrc = qrImageSource(selectedPayment);
  const selectedTotal = Number(selectedPayment?.totalPayment || selectedPayment?.amount || selectedOrder?.paymentDue || selectedOrder?.total || 0);

  return (
    <DashboardLayout role="reseller" title="History">
      <div className="space-y-5">
        <ResellerPageTitle title="Riwayat Pembelian" subtitle="Semua transaksi pembelian akun Anda" />

        <div className="grid gap-4 md:grid-cols-3">
          <ResellerStatCard
            label="Total Transaksi"
            value={orders.length}
            icon="ri-shopping-bag-3-line"
            tone="blue"
            hint="Tampilkan semua transaksi"
            active={focusedArea === "all"}
            onClick={() => {
              setFocusedArea("all");
              setFilter("all");
            }}
          />
          <ResellerStatCard
            label="Pending Payment"
            value={pendingOrders.length}
            icon="ri-qr-code-line"
            tone="amber"
            hint="Buka drawer pembayaran pending"
            active={focusedArea === "pending"}
            onClick={() => {
              setFocusedArea("pending");
              setPendingDrawerOpen(true);
            }}
          />
          <ResellerStatCard
            label="Total Pengeluaran"
            value={money(paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0))}
            icon="ri-wallet-3-line"
            tone="emerald"
            hint="Fokus ke transaksi sukses"
            active={focusedArea === "spent"}
            onClick={() => {
              setFocusedArea("spent");
              setFilter("success");
            }}
          />
        </div>

        <div className="sticky top-16 z-30 isolate -mx-4 border-b border-white/60 bg-[#f2ece2] px-4 py-3 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.45)] md:-mx-6 md:px-6">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm shadow-slate-950/5 lg:flex-row">
            <ResellerSearch value={query} onChange={setQuery} placeholder="Cari item pembelian..." className="flex-1" />
            <div className="flex gap-2">
              <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>Semua</FilterPill>
              <FilterPill active={filter === "success"} onClick={() => setFilter("success")}>Sukses</FilterPill>
            </div>
          </div>
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-100 bg-white">
          <div className="max-h-[calc(100vh-330px)] min-h-[360px] overflow-auto">
            <table className="w-full min-w-[1040px] text-left text-xs">
              <thead className="sticky top-0 z-20 bg-[#fbf8f2] text-[11px] uppercase tracking-wide text-slate-400 shadow-sm shadow-slate-950/5">
                <tr>
                  <th className="px-4 py-3 font-semibold">ID Transaksi</th>
                  <th className="px-4 py-3 font-semibold">Tanggal</th>
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 text-center font-semibold">Jumlah</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-right font-semibold">Status</th>
                  <th className="sticky right-0 z-30 bg-[#fbf8f2] px-4 py-3 text-right font-semibold shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id} className="border-t border-slate-50 text-slate-700">
                    <td className="px-4 py-4 font-semibold text-slate-800">{order.id}</td>
                    <td className="px-4 py-4">{compactDate(order.createdAt)}</td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-900">{order.product} {order.duration}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{order.variant}</div>
                    </td>
                    <td className="px-4 py-4 text-center">{order.qty || 1}x</td>
                    <td className="sticky right-0 bg-[#fbf8f2] px-4 py-4 text-right shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">
                      <div className="font-semibold text-slate-950">{money(Number(order.total || 0))}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{money(Number(order.total || 0) / Math.max(1, Number(order.qty || 1)))} / item</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <MiniBadge className={orderStatusClass(order)}>{orderPaid(order) ? "Sukses" : order.orderStatus}</MiniBadge>
                    </td>
                    <td className="px-4 py-4 text-right">
                      {canReopenQris(order) ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openQris(order)}
                            disabled={paymentLoading === order.id}
                            className="h-8 rounded-md bg-slate-950 px-3 text-[11px] font-semibold text-white disabled:cursor-wait disabled:opacity-60"
                          >
                            {paymentLoading === order.id ? "Membuka..." : "Lihat QRIS"}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyRef(order.paymentRef)}
                            className="h-8 rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700"
                          >
                            {copiedRef === order.paymentRef ? "Tersalin" : "Copy Ref"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">{orderPaid(order) ? "Selesai" : "-"}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                      Riwayat pembelian belum ada.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {selectedOrder ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-8">
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">QRIS Pembayaran</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{selectedOrder.id}</p>
                </div>
                <button type="button" onClick={closeQris} className="h-8 w-8 rounded-md text-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                  ×
                </button>
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <div className="font-semibold text-slate-900">{selectedOrder.product} {selectedOrder.duration}</div>
                  <div className="mt-0.5 text-sm text-slate-500">{selectedOrder.variant}</div>
                </div>

                {paymentError ? (
                  <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {paymentError}
                  </div>
                ) : null}

                {selectedQrSrc ? (
                  <div className="flex justify-center rounded-lg border border-slate-100 bg-slate-50 p-4">
                    <img src={selectedQrSrc} alt="QRIS pembayaran" className="h-60 w-60 rounded-lg bg-white p-2" />
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    QRIS belum tersedia. Pakai tombol Buka QRIS jika link dari provider tersedia.
                  </div>
                )}

                <div className="grid gap-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4">
                    <span>Ref</span>
                    <strong className="text-right text-slate-900">{selectedPayment?.ref || selectedOrder.paymentRef || "-"}</strong>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>Total</span>
                    <strong className="text-right text-slate-900">{money(selectedTotal)}</strong>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>Batas Bayar</span>
                    <strong className="text-right text-slate-900">{selectedPayment?.expiresAt || selectedOrder.paymentExpiresAt || "-"}</strong>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => copyRef(selectedPayment?.ref || selectedOrder.paymentRef)}
                    className="h-10 flex-1 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700"
                  >
                    {copiedRef === (selectedPayment?.ref || selectedOrder.paymentRef) ? "Ref Tersalin" : "Copy Ref"}
                  </button>
                  {selectedPayment?.paymentUrl ? (
                    <a
                      href={selectedPayment.paymentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white"
                    >
                      Buka QRIS
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {pendingDrawerOpen ? (
          <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
            <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Pending Payment Drawer</h2>
                  <p className="mt-0.5 text-xs text-slate-500">QRIS yang masih bisa dibuka ulang dan dibayar.</p>
                </div>
                <button type="button" onClick={() => setPendingDrawerOpen(false)} className="h-8 w-8 rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-700">x</button>
              </div>
              <div className="space-y-3 p-4">
                {pendingOrders.map((order) => (
                  <div key={`pending-${order.id}`} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{order.product} {order.duration}</div>
                        <div className="mt-1 text-xs text-slate-500">{order.id} • {order.variant}</div>
                        <div className="mt-1 text-[11px] text-slate-400">{compactDate(order.createdAt)} • {money(Number(order.total || 0))}</div>
                      </div>
                      <MiniBadge className="bg-amber-50 text-amber-700">Pending</MiniBadge>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => { setPendingDrawerOpen(false); openQris(order).catch(console.error); }} className="h-8 rounded-md bg-slate-950 px-3 text-[11px] font-semibold text-white">
                        Buka QRIS
                      </button>
                      <button type="button" onClick={() => copyRef(order.paymentRef)} className="h-8 rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700">
                        {copiedRef === order.paymentRef ? "Tersalin" : "Copy Ref"}
                      </button>
                    </div>
                  </div>
                ))}
                {!pendingOrders.length ? <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Tidak ada pembayaran pending.</div> : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

