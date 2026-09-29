import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge, DetailRow, Dialog, DialogActions, Drawer, Field, LoadingState, MetricRow, Notice, Toast } from "../../../components/ui";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, subscribeRealtime, type ApiOrder } from "../../../lib/api";
import { formatRupiah } from "../../../lib/format";
import { formatDateTimeFull } from "../../../lib/format";
import type { Tone } from "../../../components/ui";

type ActionKind = "mark-paid" | "approve-manual" | "retry-delivery" | "repair-sheets" | "rerender-template";
type PendingAction = { kind: ActionKind; order: ApiOrder } | null;

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

  const liveOrders = useMemo(() => orders.filter((order) => !isSmokeTest(order)), [orders]);
  const attentionCount = useMemo(() => liveOrders.filter((order) => fulfillmentLabel(order) === "Gagal" || (isPaid(order) && fulfillmentLabel(order) !== "Selesai")).length, [liveOrders]);
  const filteredOrders = useMemo(() => orders.filter((order) => matchesStatus(order, activeStatus)).sort((left, right) => (parseDate(right.createdAt)?.getTime() || 0) - (parseDate(left.createdAt)?.getTime() || 0)), [activeStatus, orders]);

  const counts = useMemo(() => Object.fromEntries(statusOptions.map((item) => [item.value, liveOrders.filter((order) => matchesStatus(order, item.value)).length])), [liveOrders]);

  const columns = useMemo<Array<DataColumn<ApiOrder>>>(() => [
    { id: "id", header: "Order ID", value: (order) => order.id, sortable: true, cell: (order) => <button type="button" className="console-order-link" onClick={() => openOrderDetail(order)}>{order.id}</button> },
    { id: "customer", header: "Customer", value: (order) => order.customer || order.resellerName || order.reseller || "-", sortable: true, cell: (order) => <span className="console-product-cell"><strong>{order.customer || "-"}</strong><small>{order.resellerName || order.reseller || "Direct"}</small></span> },
    { id: "product", header: "Produk", value: (order) => `${order.product} ${order.variant}`, sortable: true, cell: (order) => <span className="console-product-cell"><strong>{order.product}</strong><small>{order.variant} / {order.duration}</small></span> },
    { id: "total", header: "Total", value: (order) => Number(order.total || 0), sortable: true, cell: (order) => formatRupiah(Number(order.total || 0)) },
    { id: "payment", header: "Pembayaran", value: paymentLabel, sortable: true, cell: (order) => <Badge tone={badgeTone(paymentLabel(order))}>{paymentLabel(order)}</Badge> },
    { id: "fulfillment", header: "Fulfillment", value: fulfillmentLabel, sortable: true, cell: (order) => <Badge tone={badgeTone(fulfillmentLabel(order))}>{fulfillmentLabel(order)}</Badge> },
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
      <MetricRow
        label="Ringkasan status pesanan"
        items={statusOptions.slice(0, 6).map((item) => ({
          label: item.label,
          value: counts[item.value] || 0,
          active: activeStatus === item.value,
          loading,
          error: error || undefined,
          onClick: () => selectStatus(item.value),
        }))}
      />

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

      <Drawer
        open={Boolean(selectedOrder)}
        title={selectedOrder?.id ?? ""}
        eyebrow="Audit pesanan"
        onClose={closeOrderDetail}
      >
        {selectedOrder ? (
          <>
            <div className="console-drawer-statuses"><Badge tone={badgeTone(paymentLabel(selectedOrder))}>{paymentLabel(selectedOrder)}</Badge><Badge tone={badgeTone(fulfillmentLabel(selectedOrder))}>{fulfillmentLabel(selectedOrder)}</Badge>{isSmokeTest(selectedOrder) ? <Badge tone="info">Smoke test</Badge> : null}</div>
            {detailLoading ? <LoadingState label="Memuat detail order" /> : null}
            {detailError ? <Notice tone="danger">{detailError}</Notice> : null}
            <dl className="ui-detail-list">
              <DetailRow label="Customer">{selectedOrder.customer || "-"}</DetailRow>
              <DetailRow label="Reseller">{selectedOrder.resellerName || selectedOrder.reseller || "Direct"}</DetailRow>
              <DetailRow label="Produk">{selectedOrder.product} / {selectedOrder.variant}</DetailRow>
              <DetailRow label="Durasi">{selectedOrder.duration || "-"}</DetailRow>
              <DetailRow label="Total">{formatRupiah(Number(selectedOrder.total || 0))}</DetailRow>
              <DetailRow label="Payment ref">{selectedOrder.paymentRef || "-"}</DetailRow>
              <DetailRow label="Metode">{selectedOrder.paymentMethod || (Number(selectedOrder.depositUsed || 0) ? "Deposit" : "QRIS")}</DetailRow>
              <DetailRow label="Akun terkirim">{deliveredCount}</DetailRow>
              <DetailRow label="Template pengiriman">{selectedOrder.deliveryTemplateSnapshot?.status === "ready" ? `Siap · versi ${selectedOrder.deliveryTemplateSnapshot.templateVersion || 1}` : selectedOrder.deliveryTemplateSnapshot?.status === "incomplete" ? "Detail akun belum lengkap" : selectedOrder.deliveryTemplateSnapshot?.status === "invalid" ? "Template tidak valid" : "Belum dikonfigurasi"}</DetailRow>
              <DetailRow label="Dibuat">{formatDateTimeFull(selectedOrder.createdAt)}</DetailRow>
            </dl>
            <div className="console-privacy-note"><ShieldAlert size={16} /><span>Kredensial akun disembunyikan. Password, OTP, PIN, token, dan link privat tidak dirender di Console.</span></div>

            {selectedOrder.deliveryTemplateSnapshot?.status === "incomplete" ? (
              <Notice tone="danger">
                Field yang masih kurang: {(selectedOrder.deliveryTemplateSnapshot.missingFields || []).join(", ") || "periksa detail akun"}.
              </Notice>
            ) : null}
            {selectedOrder.deliveryTemplateSnapshot?.status === "invalid" ? (
              <Notice tone="danger">Template varian tidak valid. Perbaiki melalui Produk, lalu jalankan render ulang.</Notice>
            ) : null}

            {selectedOrder.traceEvents?.length ? (
              <section className="console-order-trace" aria-labelledby="console-trace-title">
                <h3 id="console-trace-title">Timeline audit</h3>
                {selectedOrder.traceEvents.slice(-8).reverse().map((event) => (
                  <div key={event.id}><span /><p><strong>{event.title}</strong><small>{event.detail}</small><time>{formatDateTimeFull(event.createdAt)}</time></p></div>
                ))}
              </section>
            ) : null}

            {selectedOrder.deliveryError ? <Notice tone="danger">{selectedOrder.deliveryError}</Notice> : null}
            <div className="console-order-actions">
              {!isPaid(selectedOrder) && selectedOrder.qrisStatus !== "expired" ? <button type="button" onClick={() => requestAction("mark-paid", selectedOrder)}><CircleDollarSign size={16} /> Mark paid</button> : null}
              {selectedOrder.orderStatus !== "completed" && String(selectedOrder.qrisStatus) !== "manual" ? <button type="button" onClick={() => requestAction("approve-manual", selectedOrder)}><CheckCircle2 size={16} /> Approve manual</button> : null}
              {fulfillmentLabel(selectedOrder) === "Gagal" ? <button type="button" onClick={() => requestAction("retry-delivery", selectedOrder)}><RefreshCw size={16} /> Retry delivery</button> : null}
              {selectedOrder.orderStatus === "completed" && deliveredCount === 0 ? <button type="button" onClick={() => requestAction("repair-sheets", selectedOrder)}><PackageCheck size={16} /> Pulihkan Sheets</button> : null}
              {selectedOrder.orderStatus === "completed" && deliveredCount > 0 ? <button type="button" onClick={() => requestAction("rerender-template", selectedOrder)}><RefreshCw size={16} /> Render ulang template</button> : null}
            </div>
          </>
        ) : null}
      </Drawer>

      <Dialog
        open={Boolean(pendingAction)}
        title="Konfirmasi tindakan"
        eyebrow="Tindakan sensitif"
        onClose={() => setPendingAction(null)}
      >
        {pendingAction ? (
          <>
            <p className="ui-dialog-lead">{actionText(pendingAction.kind).title}</p>
            <p className="ui-dialog-note">{actionText(pendingAction.kind).detail}</p>
            {pendingAction.kind === "approve-manual" ? (
              <Field label="Alasan approval" hint="Tersimpan pada audit log order." required>
                <textarea
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                  placeholder="Tulis alasan yang dapat diaudit..."
                  autoFocus
                />
              </Field>
            ) : null}
            {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
            <DialogActions
              onCancel={() => setPendingAction(null)}
              onConfirm={() => void executeAction()}
              confirmLabel={actionText(pendingAction.kind).button}
              busy={actionBusy}
              danger
            />
          </>
        ) : null}
      </Dialog>

      <Toast message={toast} tone="success" onClose={() => setToast("")} />
    </ConsoleShell>
  );
}
