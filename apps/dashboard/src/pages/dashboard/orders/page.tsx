import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel, OwnerStat, PageToolbar, SearchBox } from "../../../components/feature/OwnerUi";
import { api, subscribeRealtime, type ApiOrder } from "../../../lib/api";
import { formatRupiah } from "../../../mocks/data";

const filters = ["Semua", "Menunggu", "Dibayar", "Diproses", "Selesai", "Expired"];

function orderLabel(status: string) {
  if (status === "completed") return "Selesai";
  if (status === "cancelled") return "Dibatalkan";
  if (status === "processing") return "Diproses";
  return "Menunggu";
}

function qrisLabel(status: string) {
  if (status === "manual") return "Approve Manual";
  if (status === "paid") return "QRIS Paid";
  if (status === "expired") return "QRIS Expired";
  return "QRIS Pending";
}

function qrisTone(status: string) {
  if (status === "manual") return "info";
  if (status === "paid") return "emerald";
  if (status === "expired") return "red";
  return "amber";
}

function traceTone(tone = "") {
  if (tone === "red") return "red";
  if (tone === "amber") return "amber";
  if (tone === "emerald") return "emerald";
  if (tone === "violet") return "info";
  return "slate";
}

function parseTime(value = "") {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function deadlineLabel(value?: string) {
  const deadline = parseTime(value || "");
  if (!deadline) return "-";
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const minutes = Math.ceil(diff / 60000);
  return `${minutes} menit`;
}

function matchesFilter(order: ApiOrder, filter: string) {
  if (filter === "Semua") return true;
  if (filter === "Menunggu") return order.qrisStatus === "pending";
  if (filter === "Dibayar") return ["paid", "manual"].includes(String(order.qrisStatus || "").toLowerCase());
  if (filter === "Diproses") return order.orderStatus === "processing";
  if (filter === "Selesai") return order.orderStatus === "completed";
  return order.qrisStatus === "expired" || order.orderStatus === "cancelled";
}

function scrollToElement(id = "") {
  if (!id || typeof document === "undefined") return;
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

function compactDate(value?: string) {
  if (!value) return "-";
  const date = parseTime(value);
  if (!date) return value;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSmokeTestOrder(order: ApiOrder) {
  return Boolean(order.isSmokeTest || String(order.source || "").toLowerCase() === "owner_smoke_test");
}

function paymentModeLabel(order: ApiOrder) {
  if (isSmokeTestOrder(order)) return "Smoke Test Owner";
  const depositUsed = Number(order.depositUsed || 0);
  const paymentDue = Number(order.paymentDue ?? order.total ?? 0);
  if (depositUsed > 0 && paymentDue > 0) return "Deposit + QRIS";
  if (depositUsed > 0) return "Deposit";
  return "QRIS";
}

function timelineSeverity(order: ApiOrder): "emerald" | "amber" | "red" | "slate" | "info" {
  if (String(order.deliveryStatus || "").toLowerCase() === "needs_redelivery") return "red";
  if (String(order.deliveryStatus || "").toLowerCase() === "failed") return "red";
  if (String(order.deliveryStatus || "").toLowerCase() === "sent" || order.orderStatus === "completed") return "emerald";
  if (String(order.qrisStatus || "").toLowerCase() === "manual") return "info";
  if (String(order.qrisStatus || "").toLowerCase() === "paid") return "amber";
  if (String(order.qrisStatus || "").toLowerCase() === "expired") return "red";
  return "slate";
}

function timelineLabel(order: ApiOrder) {
  if (String(order.deliveryStatus || "").toLowerCase() === "needs_redelivery") return "Perlu redelivery";
  if (String(order.deliveryStatus || "").toLowerCase() === "failed") return "Delivery gagal";
  if (String(order.deliveryStatus || "").toLowerCase() === "sent" || order.orderStatus === "completed") return "Drop selesai";
  if (String(order.qrisStatus || "").toLowerCase() === "manual") return "Approve manual";
  if (String(order.qrisStatus || "").toLowerCase() === "paid") return "Paid belum final";
  if (String(order.qrisStatus || "").toLowerCase() === "expired") return "QRIS expired";
  return "Menunggu bayar";
}

function accountLabel(account: NonNullable<ApiOrder["deliveredAccounts"]>[number]) {
  const identity = [account.email, account.password].filter(Boolean).join(" / ");
  const extras = [account.profile, account.pin].filter(Boolean).join(" / ");
  return extras ? `${identity} (${extras})` : identity || "-";
}

function orderTimeline(order: ApiOrder) {
  const rows = [
    { label: "Order dibuat", value: order.createdAt, tone: "slate" },
    Number(order.depositUsed || 0) > 0
      ? { label: `Deposit dipakai ${formatRupiah(Number(order.depositUsed || 0))}`, value: order.createdAt, tone: "amber" }
      : null,
    order.depositRefunded
      ? { label: `Deposit dikembalikan ${formatRupiah(Number(order.depositUsed || 0))}`, value: order.depositRefundedAt || "", tone: "emerald" }
      : null,
    order.latePaidDepositCredited
      ? { label: `Pembayaran telat masuk deposit ${formatRupiah(Number(order.latePaidDepositAmount || 0))}`, value: order.latePaidDepositCreditedAt || "", tone: "emerald" }
      : null,
    order.stockRaceDepositCreditedAt
      ? { label: `Fulfillment gagal, deposit dikreditkan ${formatRupiah(Number(order.stockRaceDepositAmount || 0))}`, value: order.stockRaceDepositCreditedAt, tone: "red" }
      : null,
    order.fulfillmentSentAt ? { label: "Akun/SNK terkirim", value: order.fulfillmentSentAt, tone: "emerald" } : null,
    order.whatsappNotificationSentAt ? { label: "Notif reseller terkirim", value: order.whatsappNotificationSentAt, tone: "emerald" } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; tone: string }>;
  return rows;
}

export default function OrdersPage() {
  const [params] = useSearchParams();
  const orderParam = params.get("order")?.trim() || "";
  const [query, setQuery] = useState(orderParam);
  const [statusFilter, setStatusFilter] = useState("Semua");
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ApiOrder | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState("");
  const [detailError, setDetailError] = useState("");
  const [autoOpenedOrderId, setAutoOpenedOrderId] = useState("");

  function focusOrderFilter(nextFilter: string) {
    setStatusFilter(nextFilter);
    scrollToElement("orders-filter-toolbar");
  }

  async function loadOrders() {
    setOrders(await api.orders());
  }

  useEffect(() => {
    loadOrders().catch(console.error);
    return subscribeRealtime(() => {
      loadOrders().catch(console.error);
    });
  }, []);

  const liveOrders = useMemo(() => orders.filter((order) => !isSmokeTestOrder(order) && !order.excludeFromSalesMetrics), [orders]);

  useEffect(() => {
    setQuery(orderParam);
    if (orderParam) {
      setStatusFilter("Semua");
      return;
    }
    setAutoOpenedOrderId("");
  }, [orderParam]);

  const rows = useMemo(
    () =>
      orders.filter((order) => {
        const matchQuery = [order.id, order.customer, order.product, order.paymentRef, order.whatsapp].join(" ").toLowerCase().includes(query.toLowerCase());
        return matchQuery && matchesFilter(order, statusFilter);
      }),
    [orders, query, statusFilter],
  );
  const auditStats = useMemo(() => ({
    failed: orders.filter((order) => String(order.deliveryStatus || "").toLowerCase() === "failed").length,
    paidPending: orders.filter((order) => ["paid", "manual"].includes(String(order.qrisStatus || "").toLowerCase()) && String(order.deliveryStatus || "").toLowerCase() !== "sent").length,
    missingTrace: orders.filter((order) => order.orderStatus === "completed" && !Number(order.traceEvents?.length || 0)).length,
  }), [orders]);
  const auditRows = useMemo(
    () => rows.filter((order) => {
      if (String(order.deliveryStatus || "").toLowerCase() === "failed") return true;
      if (["paid", "manual"].includes(String(order.qrisStatus || "").toLowerCase()) && String(order.deliveryStatus || "").toLowerCase() !== "sent") return true;
      if (order.orderStatus === "completed" && !Number(order.traceEvents?.length || 0)) return true;
      return false;
    }).slice(0, 6),
    [rows],
  );

  async function markPaid(id: string) {
    await api.markOrderPaid(id);
    await loadOrders();
  }

  async function approveManual(order: ApiOrder) {
    const reason = window.prompt("Alasan approve manual untuk order ini?", String(order.manualApprovalReason || "order test / comp owner"));
    if (reason == null) return;
    const trimmed = reason.trim();
    if (!trimmed) return;
    await api.approveOrderManual(order.id, { reason: trimmed });
    await loadOrders();
    if (selectedOrder?.id === order.id) {
      await openOrderDetail(order);
    }
  }

  async function retryDelivery(id: string) {
    await api.retryDelivery(id);
    await loadOrders();
  }

  async function openOrderDetail(order: ApiOrder) {
    setSelectedOrder(order);
    setDetailError("");
    setDetailLoadingId(order.id);
    try {
      setSelectedOrder(await api.order(order.id));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Gagal memuat detail order.");
    } finally {
      setDetailLoadingId("");
    }
  }

  useEffect(() => {
    if (!orderParam || !orders.length || autoOpenedOrderId === orderParam) return;
    const matched = orders.find((order) => order.id === orderParam);
    if (!matched) return;
    setAutoOpenedOrderId(orderParam);
    scrollToElement(`order-row-${orderParam}`);
    openOrderDetail(matched).catch(console.error);
  }, [autoOpenedOrderId, orderParam, orders]);

  return (
    <DashboardLayout role="owner" title="Manajemen Order & QRIS">
      <div className="grid gap-3 md:grid-cols-6">
        <OwnerStat label="Semua" value={liveOrders.length} active={statusFilter === "Semua"} onClick={() => focusOrderFilter("Semua")} />
        <OwnerStat label="Menunggu" value={liveOrders.filter((item) => item.qrisStatus === "pending").length} active={statusFilter === "Menunggu"} onClick={() => focusOrderFilter("Menunggu")} />
        <OwnerStat label="Dibayar" value={liveOrders.filter((item) => ["paid", "manual"].includes(String(item.qrisStatus || "").toLowerCase())).length} active={statusFilter === "Dibayar"} onClick={() => focusOrderFilter("Dibayar")} />
        <OwnerStat label="Diproses" value={liveOrders.filter((item) => item.orderStatus === "processing").length} active={statusFilter === "Diproses"} onClick={() => focusOrderFilter("Diproses")} />
        <OwnerStat label="Selesai" value={liveOrders.filter((item) => item.orderStatus === "completed").length} active={statusFilter === "Selesai"} onClick={() => focusOrderFilter("Selesai")} />
        <OwnerStat label="Expired" value={liveOrders.filter((item) => item.qrisStatus === "expired").length} active={statusFilter === "Expired"} onClick={() => focusOrderFilter("Expired")} />
      </div>

      <div className="sticky top-16 z-30 -mx-4 mt-4 bg-[#f2ece2] px-4 py-3 md:-mx-6 md:px-6">
        <div id="orders-filter-toolbar">
          <PageToolbar className="shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-sm flex-1">
              <SearchBox value={query} onChange={setQuery} placeholder="Cari order, customer, produk..." />
            </div>
            <div className="flex flex-wrap gap-2">
              {filters.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatusFilter(item)}
                  className={`h-9 rounded-md px-4 text-xs font-medium transition-colors ${
                    statusFilter === item ? "bg-[#2b2b2b] text-white" : "bg-[#f7f1e8] text-slate-700 hover:bg-white"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          {orderParam ? (
            <div className="mt-3 rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700">
              Fokus ke order <span className="font-semibold">{orderParam}</span>. Detail akan terbuka otomatis kalau order ditemukan.
            </div>
          ) : null}
          </PageToolbar>
        </div>
      </div>

      <DataPanel className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-950">Order Timeline Audit</p>
            <p className="mt-1 text-xs text-slate-500">Spotlight order yang jejaknya belum rapi atau masih butuh tindak lanjut.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700"><strong>{auditStats.failed}</strong> gagal</span>
            <span className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-amber-800"><strong>{auditStats.paidPending}</strong> paid belum final</span>
            <span className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-slate-700"><strong>{auditStats.missingTrace}</strong> trace tipis</span>
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {auditRows.map((order) => (
            <div key={`audit-${order.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{order.id}</span>
                  <Badge variant={timelineSeverity(order)}>{timelineLabel(order)}</Badge>
                  <span className="rounded-full bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">{order.traceEvents?.length || 0} trace</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{[order.product, order.variant, order.customer || "-", order.resellerName || order.reseller || "-"].join(" • ")}</div>
              </div>
              <button className="h-8 rounded-md border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 hover:bg-slate-50" onClick={() => openOrderDetail(order)}>
                Audit Detail
              </button>
            </div>
          ))}
          {!auditRows.length ? <div className="px-4 py-8 text-center text-sm text-slate-500">Tidak ada order yang sedang butuh audit cepat.</div> : null}
        </div>
      </DataPanel>

      <DataPanel className="mt-4 overflow-hidden p-0">
        <div className="max-h-[calc(100vh-300px)] min-h-[360px] overflow-auto">
          <table className="w-full min-w-[920px] text-left text-xs">
            <thead className="sticky top-0 z-20 bg-slate-50 text-slate-400 shadow-sm shadow-slate-950/5">
              <tr>
                <th className="px-4 py-3 font-medium">Produk</th>
                <th className="px-4 py-3 font-medium">Pesanan</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Pengiriman</th>
                <th className="sticky right-0 z-30 bg-slate-50 px-4 py-3 text-right font-medium shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr
                  key={order.id}
                  id={`order-row-${order.id}`}
                  className={`border-t border-gray-100 text-slate-700 transition-colors ${order.id === orderParam ? "bg-sky-50/70" : ""}`}
                >
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-800">{order.product}</div>
                    <div className="text-[11px] text-slate-400">{order.variant} {order.duration}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-900">{order.id}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{order.customer}</div>
                    <div className="text-[11px] text-slate-400">{order.resellerName || order.reseller || "-"}</div>
                    {isSmokeTestOrder(order) ? <div className="mt-1"><Badge variant="red">Smoke Test</Badge></div> : null}
                    <div className="text-[11px] text-slate-400">{order.createdAt}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-slate-900">{formatRupiah(order.total)}</div>
                    {isSmokeTestOrder(order) && Number(order.smokeTestCatalogTotal || order.quotedTotal || 0) > 0 ? (
                      <div className="mt-1 text-[11px] text-slate-400">Harga katalog {formatRupiah(Number(order.smokeTestCatalogTotal || order.quotedTotal || 0))}</div>
                    ) : null}
                    <Badge variant={order.orderStatus === "completed" ? "emerald" : order.orderStatus === "cancelled" ? "red" : order.orderStatus === "processing" ? "info" : "amber"}>
                      {orderLabel(order.orderStatus)}
                    </Badge>
                    <div className="mt-1">
                      <Badge variant={timelineSeverity(order)}>{timelineLabel(order)}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <Badge variant={order.deliveryStatus === "sent" ? "emerald" : order.deliveryStatus === "failed" ? "red" : "slate"}>
                      {order.deliveryStatus || "waiting"}
                    </Badge>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {Number(order.deliveredAccountCount || order.deliveredAccounts?.length || 0)} akun
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {order.traceEvents?.length || 0} trace event
                    </div>
                  </td>
                  <td className="sticky right-0 z-10 bg-white px-4 py-4 text-right shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">
                    <div className="flex justify-end gap-2">
                      <button className="h-7 rounded-md border border-[#ded6ca] px-2 text-xs font-medium text-slate-700" onClick={() => openOrderDetail(order)}>
                        Detail
                      </button>
                      {!["paid", "manual", "expired"].includes(String(order.qrisStatus || "").toLowerCase()) ? (
                        <button className="h-7 rounded-md bg-emerald-50 px-2 text-xs font-medium text-emerald-700" onClick={() => markPaid(order.id)}>
                          Mark Paid
                        </button>
                      ) : null}
                      {order.orderStatus !== "completed" && String(order.qrisStatus || "").toLowerCase() !== "manual" ? (
                        <button className="h-7 rounded-md bg-sky-50 px-2 text-xs font-medium text-sky-700" onClick={() => approveManual(order)}>
                          Approve Manual
                        </button>
                      ) : null}
                      {order.deliveryStatus === "failed" ? (
                        <button className="h-7 rounded-md bg-red-50 px-2 text-xs font-medium text-red-700" onClick={() => retryDelivery(order.id)}>
                          Retry
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    Belum ada order untuk filter ini.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DataPanel>

      {selectedOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">Detail Order</h2>
              <button className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setSelectedOrder(null)}>
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
              <div><p className="text-xs text-slate-500">Order ID</p><p className="font-semibold">{selectedOrder.id}</p></div>
              <div><p className="text-xs text-slate-500">Payment Ref</p><p className="font-semibold">{selectedOrder.paymentRef || "-"}</p></div>
              <div><p className="text-xs text-slate-500">Customer</p><p className="font-semibold">{selectedOrder.customer}</p></div>
              <div><p className="text-xs text-slate-500">Reseller</p><p className="font-semibold">{selectedOrder.resellerName || selectedOrder.reseller || "-"}</p></div>
              <div><p className="text-xs text-slate-500">WhatsApp</p><p className="font-semibold">{selectedOrder.whatsapp || "-"}</p></div>
              <div><p className="text-xs text-slate-500">Produk</p><p className="font-semibold">{selectedOrder.product}</p></div>
              <div><p className="text-xs text-slate-500">Variant</p><p className="font-semibold">{selectedOrder.variant} {selectedOrder.duration}</p></div>
              <div><p className="text-xs text-slate-500">Total</p><p className="font-semibold">{formatRupiah(selectedOrder.total)}</p></div>
              {isSmokeTestOrder(selectedOrder) ? <div><p className="text-xs text-slate-500">Harga Katalog</p><p className="font-semibold">{formatRupiah(Number(selectedOrder.smokeTestCatalogTotal || selectedOrder.quotedTotal || 0))}</p></div> : null}
              <div><p className="text-xs text-slate-500">Metode</p><p className="font-semibold">{paymentModeLabel(selectedOrder)}</p></div>
              <div><p className="text-xs text-slate-500">Deposit Dipakai</p><p className="font-semibold">{formatRupiah(Number(selectedOrder.depositUsed || 0))}</p></div>
              <div><p className="text-xs text-slate-500">Sisa QRIS</p><p className="font-semibold">{formatRupiah(Number(selectedOrder.paymentDue ?? selectedOrder.total ?? 0))}</p></div>
              <div><p className="text-xs text-slate-500">Saldo Sebelum</p><p className="font-semibold">{selectedOrder.depositBefore != null ? formatRupiah(Number(selectedOrder.depositBefore || 0)) : "-"}</p></div>
              <div><p className="text-xs text-slate-500">Saldo Sesudah</p><p className="font-semibold">{selectedOrder.depositAfter != null ? formatRupiah(Number(selectedOrder.depositAfter || 0)) : "-"}</p></div>
              <div>
                <p className="text-xs text-slate-500">QRIS</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={qrisTone(selectedOrder.qrisStatus)}>{qrisLabel(selectedOrder.qrisStatus)}</Badge>
                  <span className="text-xs text-slate-500">{deadlineLabel(selectedOrder.paymentExpiresAt)}</span>
                </div>
              </div>
              <div><p className="text-xs text-slate-500">Batas Bayar</p><p className="font-semibold">{selectedOrder.paymentExpiresAt || "-"}</p></div>
              <div><p className="text-xs text-slate-500">Approval Manual</p><p className="font-semibold">{selectedOrder.manualApprovedAt ? `${selectedOrder.manualApprovedBy || "owner"} - ${selectedOrder.manualApprovedAt}` : "-"}</p></div>
              <div className="md:col-span-2"><p className="text-xs text-slate-500">Alasan Approval</p><p className="font-semibold">{selectedOrder.manualApprovalReason || "-"}</p></div>
              {isSmokeTestOrder(selectedOrder) ? <div className="md:col-span-2"><p className="text-xs text-slate-500">Mode</p><p className="font-semibold text-red-700">Owner smoke test. Stok asli dipakai, Sheets diberi marker, dan metrik live tidak dihitung.</p></div> : null}
              {selectedOrder.qrisUrl ? (
                <div className="md:col-span-2">
                  <p className="text-xs text-slate-500">Link QRIS</p>
                  <a href={selectedOrder.qrisUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs font-medium text-red-600 hover:text-red-700">
                    {selectedOrder.qrisUrl}
                  </a>
                </div>
              ) : null}
            </div>
            {detailLoadingId === selectedOrder.id ? (
              <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                Memuat detail akun dan jejak pengiriman...
              </div>
            ) : null}
            {detailError ? <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-700">{detailError}</div> : null}
            <div className="mt-5 rounded-lg border border-gray-100 bg-[#fbf7f0] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Timeline</p>
                  <p className="mt-1 text-xs text-slate-500">Jejak pembayaran, refund, dan pengiriman.</p>
                </div>
                {selectedOrder.depositRefunded ? <Badge variant="emerald">Deposit refunded</Badge> : null}
              </div>
              <div className="mt-3 grid gap-2">
                {orderTimeline(selectedOrder).map((item) => (
                  <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm">
                    <span className="font-medium text-slate-800">{item.label}</span>
                    <span className="text-xs text-slate-400">{compactDate(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-gray-100 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Order Trace</p>
                  <p className="mt-1 text-xs text-slate-500">Jejak event lintas order, payment, account, dan WhatsApp untuk order ini.</p>
                </div>
                <Badge variant={selectedOrder.traceEvents?.length ? "emerald" : "slate"}>
                  {selectedOrder.traceEvents?.length || 0} event
                </Badge>
              </div>
              {selectedOrder.traceEvents?.length ? (
                <div className="mt-3 space-y-2">
                  {selectedOrder.traceEvents.map((event) => (
                    <div key={event.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={traceTone(event.tone)}>{event.type}</Badge>
                          <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                        </div>
                        <span className="text-[11px] text-slate-400">{compactDate(event.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{event.detail}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  Belum ada jejak event detail untuk order ini.
                </div>
              )}
            </div>
            <div className="mt-5 rounded-lg border border-gray-100 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Akun Terkirim</p>
                  <p className="mt-1 text-xs text-slate-500">Jejak akun yang benar-benar dikirim untuk order ini.</p>
                </div>
                <Badge variant={selectedOrder.deliveredAccounts?.length ? "emerald" : "slate"}>
                  {selectedOrder.deliveredAccounts?.length || 0} akun
                </Badge>
              </div>
              {selectedOrder.deliveredAccounts?.length ? (
                <div className="mt-3 space-y-3">
                  {selectedOrder.deliveredAccounts.map((account) => (
                    <div key={`${account.id}-${account.stockId}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{accountLabel(account)}</p>
                        <Badge variant={account.status === "active" ? "emerald" : account.status === "expired" ? "red" : "slate"}>
                          {account.status || "-"}
                        </Badge>
                      </div>
                      <div className="mt-2 grid gap-2 text-[11px] text-slate-500 md:grid-cols-2">
                        <span>Mulai: {compactDate(account.startedAt)}</span>
                        <span>Expired: {compactDate(account.expiresAt)}</span>
                        <span>Sheet: {account.sheetName || "-"}</span>
                        <span>Row: {account.sheetRow || "-"}</span>
                        <span>Stock: {account.stockId || "-"}</span>
                        <span>Source: {account.source || "-"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  Belum ada jejak akun terkirim yang bisa ditautkan ke order ini.
                </div>
              )}
            </div>
            {selectedOrder.deliveryError ? <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{selectedOrder.deliveryError}</div> : null}
            {selectedOrder.whatsappNotificationError ? <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-700">{selectedOrder.whatsappNotificationError}</div> : null}
            {selectedOrder.orderStatus !== "completed" && String(selectedOrder.qrisStatus || "").toLowerCase() !== "manual" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="h-9 rounded-md bg-sky-50 px-4 text-xs font-semibold text-sky-700" onClick={() => approveManual(selectedOrder)}>
                  Approve Manual
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}

