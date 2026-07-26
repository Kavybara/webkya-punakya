import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import {
  api,
  subscribeRealtime,
  type AccountDeliveryDetail,
  type ApiOrder,
  type ApiPayment,
} from "../../../lib/api";
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
  orderStatusLabel,
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

function deliveryIsComplete(order: ApiOrder) {
  return order.deliveryStatus === "sent" || order.orderStatus === "completed";
}

export default function ResellerHistoryPage() {
  const navigate = useNavigate();
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
  const [requestState, setRequestState] = useState<"loading" | "success" | "error">("loading");
  const [ordersError, setOrdersError] = useState("");
  const [deliveryOrder, setDeliveryOrder] = useState<ApiOrder | null>(null);
  const [deliveryAccounts, setDeliveryAccounts] = useState<AccountDeliveryDetail[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  const [credentialsVisible, setCredentialsVisible] = useState(false);
  const [deliveryCopied, setDeliveryCopied] = useState("");

  const loadOrders = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setRequestState("loading");
    try {
      setOrders(await api.orders());
      setOrdersError("");
      setRequestState("success");
    } catch {
      if (!options.silent) {
        setOrdersError("Pesanan belum dapat dimuat. Periksa koneksi lalu coba lagi.");
        setRequestState("error");
      }
    }
  }, []);

  useEffect(() => {
    loadOrders().catch(() => undefined);
    return subscribeRealtime(() => {
      loadOrders({ silent: true }).catch(() => undefined);
    });
  }, [loadOrders]);

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
      await loadOrders({ silent: true });
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

  const closeDelivery = useCallback(() => {
    setDeliveryOrder(null);
    setDeliveryAccounts([]);
    setDeliveryError("");
    setCredentialsVisible(false);
  }, []);

  const openDelivery = useCallback(async (order: ApiOrder) => {
    setDeliveryOrder(order);
    setDeliveryAccounts([]);
    setDeliveryError("");
    setCredentialsVisible(false);
    setDeliveryLoading(true);
    try {
      const detail = await api.order(order.id);
      setDeliveryOrder(detail);
      const accountIds = (detail.deliveredAccounts || []).map((account) => account.id).filter(Boolean);
      const results = await Promise.all(accountIds.map((accountId) => api.accountDelivery(accountId)));
      setDeliveryAccounts(results);
      await Promise.all(accountIds.map((accountId) => api.markAccountDeliveryOpened(accountId).catch(() => undefined)));
    } catch (loadError) {
      setDeliveryError(loadError instanceof Error ? loadError.message : "Detail pengiriman belum dapat dimuat.");
    } finally {
      setDeliveryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!credentialsVisible) return undefined;
    const timer = window.setTimeout(() => setCredentialsVisible(false), 60_000);
    return () => window.clearTimeout(timer);
  }, [credentialsVisible]);

  useEffect(() => {
    if (!deliveryOrder) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDelivery();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDelivery, deliveryOrder]);

  async function copyDeliveryText(text: string, accountId = "") {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setDeliveryCopied(accountId || "template");
    if (accountId) await api.recordDeliveryTemplateCopied(accountId).catch(() => undefined);
    window.setTimeout(() => setDeliveryCopied(""), 1800);
  }

  function masked(value = "") {
    if (!value) return "-";
    return credentialsVisible ? value : "••••••••";
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
    <DashboardLayout role="reseller" title="Pesanan">
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
            label="Menunggu Pembayaran"
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

        <div className="sticky top-16 z-30 isolate -mx-4 border-b border-white/10 bg-[#070708] px-4 py-3 md:-mx-6 md:px-6">
          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#111216] p-4 lg:flex-row">
            <ResellerSearch value={query} onChange={setQuery} placeholder="Cari item pembelian..." className="flex-1" />
            <div className="flex gap-2">
              <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>Semua</FilterPill>
              <FilterPill active={filter === "success"} onClick={() => setFilter("success")}>Sukses</FilterPill>
            </div>
          </div>
        </div>

        <section className="overflow-hidden rounded-xl border border-white/10 bg-[#111216]">
          <div className="max-h-[calc(100vh-330px)] min-h-[360px] overflow-auto">
            <table className="w-full min-w-[1040px] text-left text-xs">
              <thead className="sticky top-0 z-20 bg-[#0c0c0f] text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">ID Transaksi</th>
                  <th className="px-4 py-3 font-semibold">Tanggal</th>
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 text-center font-semibold">Jumlah</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-right font-semibold">Status</th>
                  <th className="sticky right-0 z-30 bg-[#0c0c0f] px-4 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {requestState === "success" ? rows.map((order) => (
                  <tr key={order.id} className="border-t border-white/5 text-slate-300">
                    <td className="px-4 py-4 font-semibold text-slate-100">{order.id}</td>
                    <td className="px-4 py-4">{compactDate(order.createdAt)}</td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-100">{order.product} {order.duration}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{order.variant}</div>
                    </td>
                    <td className="px-4 py-4 text-center">{order.qty || 1}x</td>
                    <td className="bg-[#111216] px-4 py-4 text-right">
                      <div className="font-semibold text-slate-100">{money(Number(order.total || 0))}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{money(Number(order.total || 0) / Math.max(1, Number(order.qty || 1)))} / item</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <MiniBadge className={orderStatusClass(order)}>{orderStatusLabel(order)}</MiniBadge>
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
                      ) : deliveryIsComplete(order) ? (
                        <button
                          type="button"
                          onClick={() => openDelivery(order)}
                          className="min-h-8 rounded-md border border-white/10 px-3 text-[11px] font-semibold text-slate-100 hover:border-white/20"
                        >
                          {order.deliveryTemplateSnapshot?.status === "incomplete" ? "Detail akun belum lengkap" : "Lihat Detail Pengiriman"}
                        </button>
                      ) : orderPaid(order) ? (
                        <span className="text-[11px] text-amber-300">Sedang disiapkan</span>
                      ) : (
                        <span className="text-[11px] text-slate-500">-</span>
                      )}
                    </td>
                  </tr>
                )) : null}
                {requestState === "loading" ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                      <i className="ri-loader-4-line mr-2 animate-spin" /> Memuat pesanan...
                    </td>
                  </tr>
                ) : null}
                {requestState === "error" ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-red-300">
                      <p>{ordersError}</p>
                      <button type="button" onClick={() => loadOrders()} className="mt-3 h-10 rounded-lg border border-red-300/25 px-4 font-semibold">Coba Lagi</button>
                    </td>
                  </tr>
                ) : null}
                {requestState === "success" && !rows.length ? (
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
                  <h2 className="text-base font-semibold text-slate-950">Pembayaran Menunggu</h2>
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
                      <MiniBadge className="bg-amber-50 text-amber-700">Menunggu Pembayaran</MiniBadge>
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
                {!pendingOrders.length ? <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Tidak ada pembayaran yang menunggu.</div> : null}
              </div>
            </div>
          </div>
        ) : null}

        {deliveryOrder ? (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/70" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDelivery()}>
            <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#0c0c0f] text-slate-100" role="dialog" aria-modal="true" aria-labelledby="delivery-detail-title">
              <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#0c0c0f]/95 px-5 py-5 backdrop-blur">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-300">Detail pengiriman</p>
                  <h2 id="delivery-detail-title" className="mt-1 text-lg font-semibold">{deliveryOrder.id}</h2>
                  <p className="mt-1 text-sm text-slate-400">{deliveryOrder.product} · {deliveryOrder.variant}</p>
                </div>
                <button type="button" onClick={closeDelivery} className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 text-xl text-slate-300 hover:bg-white/5" aria-label="Tutup detail">×</button>
              </header>

              <div className="space-y-5 p-5">
                {deliveryLoading ? <div className="rounded-xl border border-white/10 bg-[#111216] p-8 text-center text-sm text-slate-400"><i className="ri-loader-4-line mr-2 animate-spin" /> Memuat detail pengiriman...</div> : null}
                {deliveryError ? <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">{deliveryError}</div> : null}

                {!deliveryLoading && !deliveryError ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#111216] p-4">
                      <div>
                        <strong className="block text-sm">Credential akun</strong>
                        <span className="text-xs text-slate-400">Otomatis disembunyikan kembali setelah 60 detik.</span>
                      </div>
                      <button type="button" onClick={() => setCredentialsVisible((value) => !value)} className="h-11 rounded-lg border border-white/10 px-4 text-sm font-semibold hover:bg-white/5">
                        {credentialsVisible ? "Sembunyikan" : "Tampilkan"}
                      </button>
                    </div>

                    {deliveryAccounts.map((detail, index) => {
                      const account = detail.account;
                      const snapshot = detail.deliveryTemplateSnapshot;
                      return (
                        <section key={account.id} className="overflow-hidden rounded-xl border border-white/10 bg-[#111216]">
                          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                            <div><strong className="text-sm">Akun {index + 1}</strong><p className="text-xs text-slate-500">{account.product} · {account.variant}</p></div>
                            <button type="button" onClick={() => navigate(`/reseller-v2/accounts?account=${encodeURIComponent(account.id)}&tab=template`)} className="h-10 rounded-lg border border-white/10 px-3 text-xs font-semibold hover:bg-white/5">Buka di Akun Saya</button>
                          </div>
                          <dl className="grid gap-px bg-white/5 sm:grid-cols-2">
                            {[
                              ["Email / login", masked(account.loginPhone || account.email || "")],
                              ["Password / link", masked(account.password || account.canvaLink || "")],
                              ["Profil", account.profile || "-"],
                              ["PIN", masked(account.pin || "")],
                              ["Masa aktif", account.duration || "-"],
                              ["Berakhir", account.expiresAt || "-"],
                            ].map(([label, value]) => <div key={label} className="bg-[#111216] p-4"><dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-100">{value}</dd></div>)}
                          </dl>

                          {snapshot?.status === "ready" && snapshot.renderedText ? (
                            <div className="border-t border-white/10 p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div><strong className="text-sm">Template Siap Kirim</strong><p className="text-xs text-slate-500">Versi {snapshot.templateVersion || 1}</p></div>
                                <button type="button" onClick={() => copyDeliveryText(snapshot.renderedText || "", account.id)} className="h-11 rounded-lg bg-white px-4 text-sm font-semibold text-black">
                                  {deliveryCopied === account.id ? "Tersalin" : "Salin Semua"}
                                </button>
                              </div>
                              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-[#080809] p-4 font-sans text-sm leading-6 text-slate-200">{snapshot.renderedText}</pre>
                            </div>
                          ) : snapshot?.status === "incomplete" ? (
                            <div className="border-t border-amber-300/15 bg-amber-300/5 p-4 text-sm text-amber-200">Detail akun belum lengkap: {(snapshot.missingFields || []).join(", ") || "perlu diperiksa Owner"}.</div>
                          ) : (
                            <div className="border-t border-white/10 p-4 text-sm text-slate-400">Template pengiriman belum dikonfigurasi untuk varian ini.</div>
                          )}
                        </section>
                      );
                    })}

                    {!deliveryAccounts.length ? <div className="rounded-xl border border-amber-300/15 bg-amber-300/5 p-4 text-sm text-amber-200">Akun sedang disiapkan atau detail akun belum tertaut ke pesanan.</div> : null}
                  </>
                ) : null}
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
