import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, subscribeRealtime, type ApiOrder } from "../../../lib/api";
import { formatRupiah } from "../../../lib/format";
import { formatDateTimeFull } from "../../../lib/format";

type ActionKind = "mark-paid" | "approve-manual" | "retry-delivery" | "repair-sheets" | "rerender-template";
type PendingAction = { kind: ActionKind; order: ApiOrder } | null;
type Tone = "success" | "warning" | "danger" | "muted";

const statusOptions = [
  { value: "all", label: "Semua" },
  { value: "pending", label: "Menunggu" },
  { value: "paid", label: "Dibayar" },
  { value: "processing", label: "Diproses" },
  { value: "completed", label: "Selesai" },
  { value: "expired", label: "Expired" },
  { value: "delivery-failed", label: "Delivery gagal" },
] as const;

function parseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPaid(order: ApiOrder) {
  return ["paid", "manual"].includes(String(order.qrisStatus || "").toLowerCase());
}

function isSmokeTest(order: ApiOrder) {
  return Boolean(order.isSmokeTest || order.excludeFromSalesMetrics || String(order.source || "").toLowerCase() === "owner_smoke_test");
}

function paymentLabel(order: ApiOrder) {
  if (String(order.qrisStatus) === "manual") return "Manual";
  if (order.qrisStatus === "paid") return "Dibayar";
  if (order.qrisStatus === "expired") return "Expired";
  return "Menunggu";
}

function fulfillmentLabel(order: ApiOrder) {
  if (["failed", "needs_redelivery"].includes(String(order.deliveryStatus || ""))) return "Gagal";
  if (order.deliveryStatus === "sent" || order.orderStatus === "completed") return "Selesai";
  if (order.orderStatus === "processing" || isPaid(order)) return "Diproses";
  if (order.orderStatus === "cancelled") return "Dibatalkan";
  return "Menunggu";
}

function matchesStatus(order: ApiOrder, status: string) {
  if (status === "pending") return order.qrisStatus === "pending";
  if (status === "paid") return isPaid(order);
  if (status === "processing") return order.orderStatus === "processing";
  if (status === "completed") return order.orderStatus === "completed";
  if (status === "expired") return order.qrisStatus === "expired" || order.orderStatus === "cancelled";
  if (status === "delivery-failed") return ["failed", "needs_redelivery"].includes(String(order.deliveryStatus || ""));
  return true;
}

function badgeTone(label: string): Tone {
  if (["Dibayar", "Selesai"].includes(label)) return "success";
  if (["Expired", "Gagal", "Dibatalkan"].includes(label)) return "danger";
  if (["Manual", "Diproses", "Menunggu"].includes(label)) return "warning";
  return "muted";
}

function StatusBadge({ label }: { label: string }) {
  return <span className={`console-status-badge is-${badgeTone(label)}`}><span />{label}</span>;
}

function actionText(kind: ActionKind) {
  if (kind === "mark-paid") return { title: "Tandai pembayaran diterima", detail: "Order akan diproses sebagai pembayaran berhasil. Gunakan hanya setelah pembayaran benar-benar terverifikasi.", button: "Tandai dibayar" };
  if (kind === "approve-manual") return { title: "Approve pembayaran manual", detail: "Approval dapat memulai fulfillment tanpa konfirmasi otomatis payment gateway.", button: "Approve manual" };
  if (kind === "retry-delivery") return { title: "Ulangi pengiriman", detail: "Sistem akan mencoba mengirim kembali fulfillment untuk order ini.", button: "Retry delivery" };
  if (kind === "rerender-template") return { title: "Render ulang template pengiriman", detail: "Snapshot template order ini akan diganti memakai konfigurasi varian terbaru. Credential akun tidak dicatat ke Activity Log.", button: "Render ulang template" };
  return { title: "Pulihkan assignment Sheets", detail: "Assignment akun akan ditulis ulang ke Google Sheets tanpa mengirim ulang kredensial ke reseller.", button: "Pulihkan Sheets" };
}

export default function OwnerConsoleOrdersPage() {
  const [params, setParams] = useSearchParams();
  const requestedStatus = params.get("status") || "all";
  const activeStatus = statusOptions.some((item) => item.value === requestedStatus) ? requestedStatus : "all";
  const requestedOrder = params.get("order") || "";
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<ApiOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const detailRequestRef = useRef(0);

  const closeOrderDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setSelectedOrder(null);
    setDetailLoading(false);
    setDetailError("");
    if (requestedOrder) {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("order");
        return next;
      }, { replace: true });
    }
  }, [requestedOrder, setParams]);

  const loadOrders = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const result = await api.orders();
      setOrders(result);
      setLastUpdated(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Pesanan gagal dimuat.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOrders().catch(() => undefined);
    return subscribeRealtime(() => loadOrders(true).catch(() => undefined));
  }, [loadOrders]);

  const openOrderDetail = useCallback(async (order: ApiOrder) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setSelectedOrder(order);
    setDetailError("");
    setDetailLoading(true);
    try {
      const detail = await api.order(order.id);
      if (detailRequestRef.current === requestId) setSelectedOrder(detail);
    } catch (loadError) {
      if (detailRequestRef.current === requestId) setDetailError(loadError instanceof Error ? loadError.message : "Detail order gagal dimuat.");
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!requestedOrder || !orders.length || selectedOrder?.id === requestedOrder) return;
    const matched = orders.find((order) => order.id === requestedOrder);
    if (matched) openOrderDetail(matched).catch(() => undefined);
  }, [openOrderDetail, orders, requestedOrder, selectedOrder?.id]);

  useEffect(() => {
    if (!selectedOrder && !pendingAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingAction) setPendingAction(null);
      else closeOrderDetail();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOrderDetail, pendingAction, selectedOrder]);

  const liveOrders = useMemo(() => orders.filter((order) => !isSmokeTest(order)), [orders]);
  const attentionCount = useMemo(() => liveOrders.filter((order) => fulfillmentLabel(order) === "Gagal" || (isPaid(order) && fulfillmentLabel(order) !== "Selesai")).length, [liveOrders]);
  const filteredOrders = useMemo(() => orders.filter((order) => matchesStatus(order, activeStatus)).sort((left, right) => (parseDate(right.createdAt)?.getTime() || 0) - (parseDate(left.createdAt)?.getTime() || 0)), [activeStatus, orders]);

  const counts = useMemo(() => Object.fromEntries(statusOptions.map((item) => [item.value, liveOrders.filter((order) => matchesStatus(order, item.value)).length])), [liveOrders]);

  const columns = useMemo<Array<DataColumn<ApiOrder>>>(() => [
    { id: "id", header: "Order ID", value: (order) => order.id, sortable: true, cell: (order) => <button type="button" className="console-order-link" onClick={() => openOrderDetail(order)}>{order.id}</button> },
    { id: "customer", header: "Customer", value: (order) => order.customer || order.resellerName || order.reseller || "-", sortable: true, cell: (order) => <span className="console-product-cell"><strong>{order.customer || "-"}</strong><small>{order.resellerName || order.reseller || "Direct"}</small></span> },
    { id: "product", header: "Produk", value: (order) => `${order.product} ${order.variant}`, sortable: true, cell: (order) => <span className="console-product-cell"><strong>{order.product}</strong><small>{order.variant} / {order.duration}</small></span> },
    { id: "total", header: "Total", value: (order) => Number(order.total || 0), sortable: true, cell: (order) => formatRupiah(Number(order.total || 0)) },
    { id: "payment", header: "Pembayaran", value: paymentLabel, sortable: true, cell: (order) => <StatusBadge label={paymentLabel(order)} /> },
    { id: "fulfillment", header: "Fulfillment", value: fulfillmentLabel, sortable: true, cell: (order) => <StatusBadge label={fulfillmentLabel(order)} /> },
    { id: "time", header: "Waktu", value: (order) => parseDate(order.createdAt)?.getTime() || 0, sortable: true, hideOnMobile: true, cell: (order) => formatDateTimeFull(order.createdAt) },
    { id: "action", header: "Aksi", value: () => "Detail", cell: (order) => <button type="button" className="console-row-action" onClick={() => openOrderDetail(order)} aria-label={`Buka detail ${order.id}`}><ArrowUpRight size={15} /></button> },
  ], [openOrderDetail]);

  const filters = useMemo<Array<DataFilter<ApiOrder>>>(() => [
    { id: "payment", label: "Pembayaran", options: [{ label: "Dibayar", value: "Dibayar" }, { label: "Manual", value: "Manual" }, { label: "Menunggu", value: "Menunggu" }, { label: "Expired", value: "Expired" }], value: paymentLabel },
    { id: "fulfillment", label: "Fulfillment", options: [{ label: "Selesai", value: "Selesai" }, { label: "Diproses", value: "Diproses" }, { label: "Gagal", value: "Gagal" }], value: fulfillmentLabel },
  ], []);

  function selectStatus(status: string) {
    const next = new URLSearchParams(params);
    status === "all" ? next.delete("status") : next.set("status", status);
    setParams(next, { replace: true });
  }

  function requestAction(kind: ActionKind, order: ApiOrder) {
    setActionError("");
    setActionReason(kind === "approve-manual" ? String(order.manualApprovalReason || "") : "");
    setPendingAction({ kind, order });
  }

  async function executeAction() {
    if (!pendingAction || actionBusy) return;
    const { kind, order } = pendingAction;
    if (kind === "approve-manual" && !actionReason.trim()) {
      setActionError("Alasan approval wajib diisi.");
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      if (kind === "mark-paid") await api.markOrderPaid(order.id);
      if (kind === "approve-manual") await api.approveOrderManual(order.id, { reason: actionReason.trim() });
      if (kind === "retry-delivery") await api.retryDelivery(order.id);
      if (kind === "repair-sheets") await api.repairOrderSheets(order.id);
      if (kind === "rerender-template") await api.rerenderDeliveryTemplate(order.id);
      await loadOrders(true);
      await openOrderDetail(order);
      setPendingAction(null);
      setToast(`${actionText(kind).button} berhasil dijalankan.`);
      window.setTimeout(() => setToast(""), 2800);
    } catch (executeError) {
      setActionError(executeError instanceof Error ? executeError.message : "Tindakan gagal dijalankan.");
    } finally {
      setActionBusy(false);
    }
  }

  const deliveredCount = Number(selectedOrder?.deliveredAccountCount || selectedOrder?.deliveredAccounts?.length || 0);

  return (
    <ConsoleShell
      title="Pesanan & QRIS"
      description="Pantau pembayaran, fulfillment, dan order yang memerlukan tindakan."
      lastUpdated={lastUpdated}
      refreshing={refreshing}
      attentionCount={attentionCount}
      systemState={loading ? "loading" : error ? "unknown" : attentionCount ? "warning" : "healthy"}
      onRefresh={() => loadOrders(true)}
    >
      <section className="console-order-summary" aria-label="Ringkasan status pesanan">
        {statusOptions.slice(0, 6).map((item) => (
          <button key={item.value} type="button" className={activeStatus === item.value ? "is-active" : ""} onClick={() => selectStatus(item.value)}>
            <span>{item.label}</span><strong>{counts[item.value] || 0}</strong>
          </button>
        ))}
      </section>

      <section className="console-panel console-orders-page-panel" aria-labelledby="orders-table-title">
        <div className="console-panel-header console-orders-heading">
          <div><span>Penjualan</span><h2 id="orders-table-title">Daftar pesanan</h2></div>
        </div>
        <DataTable
          rows={filteredOrders}
          columns={columns}
          filters={filters}
          rowKey={(order) => order.id}
          loading={loading}
          error={error}
          emptyText="Belum ada order untuk filter ini."
          initialPageSize={10}
        />
      </section>

      {selectedOrder ? (
        <div className="console-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeOrderDetail()}>
          <aside className="console-detail-drawer console-order-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="console-order-detail-title">
            <div className="console-drawer-header">
              <div><span>Audit pesanan</span><h2 id="console-order-detail-title">{selectedOrder.id}</h2></div>
              <button type="button" className="console-icon-button" onClick={closeOrderDetail} aria-label="Tutup detail"><X size={18} /></button>
            </div>
            <div className="console-drawer-body">
              <div className="console-drawer-statuses"><StatusBadge label={paymentLabel(selectedOrder)} /><StatusBadge label={fulfillmentLabel(selectedOrder)} />{isSmokeTest(selectedOrder) ? <StatusBadge label="Smoke test" /> : null}</div>
              {detailLoading ? <div className="console-order-detail-loading"><RefreshCw size={17} className="console-spin" /> Memuat detail order...</div> : null}
              {detailError ? <div className="console-inline-error">{detailError}</div> : null}
              <dl>
                <div><dt>Customer</dt><dd>{selectedOrder.customer || "-"}</dd></div>
                <div><dt>Reseller</dt><dd>{selectedOrder.resellerName || selectedOrder.reseller || "Direct"}</dd></div>
                <div><dt>Produk</dt><dd>{selectedOrder.product} / {selectedOrder.variant}</dd></div>
                <div><dt>Durasi</dt><dd>{selectedOrder.duration || "-"}</dd></div>
                <div><dt>Total</dt><dd>{formatRupiah(Number(selectedOrder.total || 0))}</dd></div>
                <div><dt>Payment ref</dt><dd>{selectedOrder.paymentRef || "-"}</dd></div>
                <div><dt>Metode</dt><dd>{selectedOrder.paymentMethod || (Number(selectedOrder.depositUsed || 0) ? "Deposit" : "QRIS")}</dd></div>
                <div><dt>Akun terkirim</dt><dd>{deliveredCount}</dd></div>
                <div><dt>Template pengiriman</dt><dd>{selectedOrder.deliveryTemplateSnapshot?.status === "ready" ? `Siap · versi ${selectedOrder.deliveryTemplateSnapshot.templateVersion || 1}` : selectedOrder.deliveryTemplateSnapshot?.status === "incomplete" ? "Detail akun belum lengkap" : selectedOrder.deliveryTemplateSnapshot?.status === "invalid" ? "Template tidak valid" : "Belum dikonfigurasi"}</dd></div>
                <div><dt>Dibuat</dt><dd>{formatDateTimeFull(selectedOrder.createdAt)}</dd></div>
              </dl>
              <div className="console-privacy-note"><ShieldAlert size={16} /><span>Kredensial akun disembunyikan. Password, OTP, PIN, token, dan link privat tidak dirender di Console.</span></div>

              {selectedOrder.deliveryTemplateSnapshot?.status === "incomplete" ? (
                <div className="console-inline-error">
                  <AlertTriangle size={15} />
                  Field yang masih kurang: {(selectedOrder.deliveryTemplateSnapshot.missingFields || []).join(", ") || "periksa detail akun"}.
                </div>
              ) : null}
              {selectedOrder.deliveryTemplateSnapshot?.status === "invalid" ? (
                <div className="console-inline-error">
                  <AlertTriangle size={15} />
                  Template varian tidak valid. Perbaiki melalui Produk, lalu jalankan render ulang.
                </div>
              ) : null}

              {selectedOrder.traceEvents?.length ? (
                <section className="console-order-trace" aria-labelledby="console-trace-title">
                  <h3 id="console-trace-title">Timeline audit</h3>
                  {selectedOrder.traceEvents.slice(-8).reverse().map((event) => (
                    <div key={event.id}><span /><p><strong>{event.title}</strong><small>{event.detail}</small><time>{formatDateTimeFull(event.createdAt)}</time></p></div>
                  ))}
                </section>
              ) : null}

              {selectedOrder.deliveryError ? <div className="console-inline-error"><AlertTriangle size={15} />{selectedOrder.deliveryError}</div> : null}
              <div className="console-order-actions">
                {!isPaid(selectedOrder) && selectedOrder.qrisStatus !== "expired" ? <button type="button" onClick={() => requestAction("mark-paid", selectedOrder)}><CircleDollarSign size={16} /> Mark paid</button> : null}
                {selectedOrder.orderStatus !== "completed" && String(selectedOrder.qrisStatus) !== "manual" ? <button type="button" onClick={() => requestAction("approve-manual", selectedOrder)}><CheckCircle2 size={16} /> Approve manual</button> : null}
                {fulfillmentLabel(selectedOrder) === "Gagal" ? <button type="button" onClick={() => requestAction("retry-delivery", selectedOrder)}><RefreshCw size={16} /> Retry delivery</button> : null}
                {selectedOrder.orderStatus === "completed" && deliveredCount === 0 ? <button type="button" onClick={() => requestAction("repair-sheets", selectedOrder)}><PackageCheck size={16} /> Pulihkan Sheets</button> : null}
                {selectedOrder.orderStatus === "completed" && deliveredCount > 0 ? <button type="button" onClick={() => requestAction("rerender-template", selectedOrder)}><RefreshCw size={16} /> Render ulang template</button> : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {pendingAction ? (
        <div className="console-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPendingAction(null)}>
          <section className="console-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="console-confirm-title">
            <div className="console-confirm-icon"><AlertTriangle size={20} /></div>
            <div><span>Tindakan sensitif</span><h2 id="console-confirm-title">Konfirmasi tindakan</h2><h3>{actionText(pendingAction.kind).title}</h3><p>{actionText(pendingAction.kind).detail}</p></div>
            {pendingAction.kind === "approve-manual" ? <label className="console-reason-field"><span>Alasan approval</span><textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Tulis alasan yang dapat diaudit..." autoFocus /></label> : null}
            {actionError ? <div className="console-inline-error">{actionError}</div> : null}
            <div className="console-confirm-actions"><button type="button" className="console-secondary-button" onClick={() => setPendingAction(null)} disabled={actionBusy}>Batal</button><button type="button" className="console-primary-button" onClick={executeAction} disabled={actionBusy}>{actionBusy ? "Memproses..." : actionText(pendingAction.kind).button}</button></div>
          </section>
        </div>
      ) : null}

      {toast ? <div className="console-toast" role="status"><CheckCircle2 size={16} />{toast}</div> : null}
    </ConsoleShell>
  );
}
