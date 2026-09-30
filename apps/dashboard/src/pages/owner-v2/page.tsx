import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Cloud,
  ExternalLink,
  PackageCheck,
  Server,
  Sheet,
  ShoppingCart,
  Users,
  WalletCards,
  Wifi,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { Badge, Bento, BentoCell, BentoStat, DetailRow, Drawer, ErrorState, LoadingState, Toast } from "../../components/ui";
import { DataTable, type DataColumn, type DataFilter } from "../../components/ui/DataTable";
import { ConsoleShell } from "../../components/console/ConsoleShell";
import { api, type ApiOrder, type ApiReseller, type ApiStockItem, type OperationsCenterResult, type SystemStatus } from "../../lib/api";
import { formatRupiah, formatRupiahCompact } from "../../lib/format";
import { formatDateTime } from "../../lib/format";

type OverviewData = {
  orders: ApiOrder[];
  stock: ApiStockItem[];
  resellers: ApiReseller[];
  operations: OperationsCenterResult | null;
  system: SystemStatus | null;
};

const emptyData: OverviewData = { orders: [], stock: [], resellers: [], operations: null, system: null };

function parseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isSmokeTest(order: ApiOrder) {
  return Boolean(order.excludeFromSalesMetrics || order.isSmokeTest || String(order.source || "").toLowerCase() === "owner_smoke_test");
}

function isPaid(order: ApiOrder) {
  return ["paid", "manual"].includes(String(order.qrisStatus || "").toLowerCase());
}

function paymentLabel(order: ApiOrder) {
  if (isPaid(order)) return "Dibayar";
  if (order.qrisStatus === "expired") return "Expired";
  return "Menunggu";
}

function fulfillmentLabel(order: ApiOrder) {
  if (order.deliveryStatus === "failed") return "Gagal";
  if (order.orderStatus === "completed" || order.deliveryStatus === "sent") return "Selesai";
  if (order.orderStatus === "processing" || isPaid(order)) return "Diproses";
  if (order.orderStatus === "cancelled") return "Dibatalkan";
  return "Menunggu";
}


function SystemRow({ icon: Icon, label, detail, ok, warning = false }: { icon: typeof Server; label: string; detail: string; ok: boolean; warning?: boolean }) {
  return (
    <div className="console-system-row">
      <span className="console-system-icon"><Icon size={17} /></span>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <Badge tone={ok ? "success" : warning ? "warning" : "danger"}>{ok ? "Aktif" : warning ? "Periksa" : "Offline"}</Badge>
    </div>
  );
}

export default function OwnerConsoleOverviewPage() {
  const [data, setData] = useState<OverviewData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastUpdated, setLastUpdated] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<ApiOrder | null>(null);
  const [toast, setToast] = useState("");

  const loadData = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    const results = await Promise.allSettled([
      api.orders(),
      api.stock(),
      api.resellers(),
      api.operationsCenter(),
      api.systemStatus(),
    ]);
    const keys = ["orders", "stock", "resellers", "operations", "system"] as const;
    const nextErrors: Record<string, string> = {};
    setData((current) => {
      const next = { ...current };
      results.forEach((result, index) => {
        const key = keys[index];
        if (result.status === "fulfilled") {
          (next as Record<string, unknown>)[key] = result.value;
        } else {
          nextErrors[key] = result.reason instanceof Error ? result.reason.message : "Data gagal dimuat.";
        }
      });
      return next;
    });
    setErrors(nextErrors);
    const now = new Date();
    setLastUpdated(now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    setLoading(false);
    setRefreshing(false);
    if (manual) {
      setToast(Object.keys(nextErrors).length ? "Refresh selesai dengan sebagian data gagal dimuat." : "Ringkasan berhasil diperbarui.");
    }
  }, []);

  useEffect(() => {
    loadData().catch(() => {
      setLoading(false);
      setRefreshing(false);
    });
  }, [loadData]);

  const today = dateKey(new Date());
  const liveOrders = useMemo(() => data.orders.filter((order) => !isSmokeTest(order)), [data.orders]);
  const metrics = useMemo(() => ({
    revenueToday: liveOrders.filter((order) => isPaid(order) && String(order.createdAt || "").startsWith(today)).reduce((sum, order) => sum + Number(order.total || 0), 0),
    ordersToday: liveOrders.filter((order) => String(order.createdAt || "").startsWith(today)).length,
    ready: data.stock.filter((item) => item.status === "available").reduce((sum, item) => sum + Math.max(1, Number(item.availableCount || 1)), 0),
    reserved: data.stock.filter((item) => item.status === "reserved").length,
    sold: data.stock.filter((item) => item.status === "sold").length,
    activeResellers: data.resellers.filter((item) => item.isActive !== false).length,
  }), [data.resellers, data.stock, liveOrders, today]);

  const revenueSeries = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("id-ID", { weekday: "short" });
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (6 - index));
      const key = dateKey(day);
      const matching = liveOrders.filter((order) => isPaid(order) && String(order.createdAt || "").startsWith(key));
      return { label: formatter.format(day), revenue: matching.reduce((sum, order) => sum + Number(order.total || 0), 0), orders: matching.length };
    });
  }, [liveOrders]);

  const attention = useMemo(() => {
    const now = Date.now();
    const deliveryFailed = liveOrders.filter((order) => order.deliveryStatus === "failed").length;
    const paidNotSent = liveOrders.filter((order) => isPaid(order) && order.orderStatus !== "completed" && order.deliveryStatus !== "sent").length;
    const pendingOverdue = liveOrders.filter((order) => order.qrisStatus === "pending" && Boolean(order.paymentExpiresAt) && (parseDate(order.paymentExpiresAt)?.getTime() || Infinity) < now).length;
    const stockAnomaly = Number(data.operations?.reconcile?.summary?.high || 0);
    const sheetSummary = data.operations?.sheetsAudit?.summary;
    const syncWarning = Number(sheetSummary?.invalid || 0) + Number(sheetSummary?.mismatch || 0) + Number(sheetSummary?.duplicateStock || 0);
    return [
      { label: "Delivery gagal", count: deliveryFailed, hint: "Order yang gagal mengirim fulfillment.", path: "/owner-v2/orders?status=delivery-failed", tone: "danger" },
      { label: "Paid belum terkirim", count: paidNotSent, hint: "Pembayaran diterima tetapi order belum final.", path: "/owner-v2/operations", tone: "warning" },
      { label: "Pending overdue", count: pendingOverdue, hint: "QRIS pending melewati batas pembayaran.", path: "/owner-v2/orders?status=pending", tone: "warning" },
      { label: "Anomali stok", count: stockAnomaly, hint: "Temuan high pada stock reconcile.", path: "/owner-v2/operations", tone: "danger" },
      { label: "Peringatan sync", count: syncWarning, hint: "Baris invalid, mismatch, atau duplikat.", path: "/owner-v2/operations", tone: "warning" },
    ];
  }, [data.operations, liveOrders]);

  const attentionCount = attention.reduce((sum, item) => sum + item.count, 0);
  const recentOrders = useMemo(() => [...liveOrders].sort((left, right) => (parseDate(right.createdAt)?.getTime() || 0) - (parseDate(left.createdAt)?.getTime() || 0)).slice(0, 10), [liveOrders]);

  const orderColumns = useMemo<Array<DataColumn<ApiOrder>>>(() => [
    { id: "id", header: "Order ID", value: (order) => order.id, sortable: true, cell: (order) => <button type="button" className="console-order-link" onClick={() => setSelectedOrder(order)}>{order.id}</button> },
    { id: "customer", header: "Customer", value: (order) => order.customer || order.resellerName || order.reseller || "-", sortable: true },
    { id: "product", header: "Produk", value: (order) => `${order.product} ${order.variant}`, sortable: true, cell: (order) => <span className="console-product-cell"><strong>{order.product}</strong><small>{order.variant}</small></span> },
    { id: "payment", header: "Pembayaran", value: paymentLabel, sortable: true, cell: (order) => <Badge tone={isPaid(order) ? "success" : order.qrisStatus === "expired" ? "danger" : "warning"}>{paymentLabel(order)}</Badge> },
    { id: "fulfillment", header: "Fulfillment", value: fulfillmentLabel, sortable: true, cell: (order) => {
      const label = fulfillmentLabel(order);
      return <Badge tone={label === "Selesai" ? "success" : label === "Gagal" || label === "Dibatalkan" ? "danger" : label === "Diproses" ? "warning" : "muted"}>{label}</Badge>;
    } },
    { id: "time", header: "Waktu", value: (order) => parseDate(order.createdAt)?.getTime() || 0, sortable: true, hideOnMobile: true, cell: (order) => formatDateTime(order.createdAt) },
    { id: "action", header: "Aksi", value: () => "Detail", cell: (order) => <button type="button" className="console-row-action" onClick={() => setSelectedOrder(order)} aria-label={`Lihat detail ${order.id}`}><ArrowUpRight size={15} /></button> },
  ], []);
  const orderFilters = useMemo<Array<DataFilter<ApiOrder>>>(() => [
    { id: "payment", label: "Pembayaran", options: [{ label: "Dibayar", value: "Dibayar" }, { label: "Menunggu", value: "Menunggu" }, { label: "Expired", value: "Expired" }], value: paymentLabel },
    { id: "fulfillment", label: "Fulfillment", options: [{ label: "Selesai", value: "Selesai" }, { label: "Diproses", value: "Diproses" }, { label: "Gagal", value: "Gagal" }], value: fulfillmentLabel },
  ], []);

  const system = data.system;
  const sheets = system?.integrations?.googleSheets;
  const lastSync = sheets?.lastSyncAt || "";

  return (
    <ConsoleShell
      title="Ringkasan"
      description="Pantau penjualan, stok, pesanan, dan kondisi sistem Kavya."
      lastUpdated={lastUpdated}
      refreshing={refreshing}
      attentionCount={attentionCount}
      systemState={loading ? "loading" : errors.operations || errors.system ? "unknown" : attentionCount ? "warning" : "healthy"}
      onRefresh={() => loadData(true)}
    >
      {/* One grid.

          This was a metric row, then a 2x2 panel grid, then a full-width
          table -- three sections with three different column systems, stacked.

          The change that matters is not that the panels are now in a grid; it
          is that the four KPIs are *in* the grid. They were a strip above
          everything, which is the one place on the page where a number cannot
          be related to anything -- four tiles the same size, the same weight,
          the same distance from the thing they describe. As row one of the
          field they are the ticker: today's revenue, today's orders, stock on
          hand, resellers live, at a glance before anything else. And because
          the revenue figure is one of them, the chart that plots it no longer
          has to repeat the number in its own header to be connected to it.

          The chart and the attention queue take two rows together -- eight and
          four -- because they are the two panels an owner actually opens the
          console to read, and they are opposites: one is the trend, the other
          is the list of things that are wrong. */}
      <Bento className="console-bento" rows={7} rowHeight="132px" label="Ringkasan operasional">
        <BentoStat
          span={{ col: 3 }}
          label="Pendapatan hari ini"
          value={formatRupiah(metrics.revenueToday)}
          hint="Order paid hari ini"
          icon={<WalletCards size={17} />}
          tone="success"
          loading={loading}
          error={errors.orders}
        />
        <BentoStat
          span={{ col: 3 }}
          label="Pesanan hari ini"
          value={metrics.ordersToday}
          hint="Pesanan live hari ini"
          icon={<ShoppingCart size={17} />}
          loading={loading}
          error={errors.orders}
        />
        <BentoStat
          span={{ col: 3 }}
          label="Stok siap"
          value={metrics.ready}
          hint={`${metrics.reserved} reserved / ${metrics.sold} sold`}
          icon={<PackageCheck size={17} />}
          loading={loading}
          error={errors.stock}
        />
        <BentoStat
          span={{ col: 3 }}
          label="Reseller aktif"
          value={metrics.activeResellers}
          hint={`${data.resellers.length} terdaftar`}
          icon={<Users size={17} />}
          loading={loading}
          error={errors.resellers}
        />

        <BentoCell span={{ col: 8, row: 2 }} emphasis as="section" className="console-cell" aria-labelledby="owner-revenue-title">
          <div className="console-panel-header">
            <div><span>Pendapatan &amp; pesanan</span><h2 id="owner-revenue-title">7 hari terakhir</h2></div>
            <strong>{formatRupiah(revenueSeries.reduce((sum, item) => sum + item.revenue, 0))}</strong>
          </div>
          {loading ? <LoadingState label="Memuat grafik pendapatan" /> : errors.orders ? <ErrorState message={errors.orders} onRetry={() => void loadData(true)} /> : (
            <div className="console-chart-wrap" aria-label="Grafik pendapatan tujuh hari">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueSeries} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
                  {/* Every colour here is a token, including the two that used to be hex. Recharts hands these straight to SVG `stroke`/`stopColor`, which browsers parse as CSS values -- so `var()` resolves, and the chart follows the palette instead of pinning itself to the violet and the zinc it was written against. The tick fill was `#71717a`, which was never any of the app's greys. */}
                  <defs><linearGradient id="consoleRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent-violet)" stopOpacity={0.34} /><stop offset="100%" stopColor="var(--accent-violet)" stopOpacity={0.01} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickFormatter={(value) => formatRupiahCompact(Number(value))} width={58} />
                  <Tooltip formatter={(value) => formatRupiah(Number(value))} contentStyle={{ background: "var(--surface-glass-strong)", border: "1px solid var(--border-strong)", borderRadius: 10, color: "var(--text-primary)" }} labelStyle={{ color: "var(--text-secondary)" }} />
                  <Area type="monotone" dataKey="revenue" stroke="var(--accent-violet)" strokeWidth={2.2} fill="url(#consoleRevenueFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="console-revenue-summary">
            <span><strong>{revenueSeries.reduce((sum, item) => sum + item.orders, 0)}</strong> pesanan paid</span>
            <span><strong>{liveOrders.filter((order) => order.qrisStatus === "pending").length}</strong> menunggu pembayaran</span>
          </div>
        </BentoCell>

        <BentoCell span={{ col: 4, row: 2 }} as="section" className="console-cell" aria-labelledby="owner-attention-title">
          <div className="console-panel-header"><div><span>Prioritas operasional</span><h2 id="owner-attention-title">Attention queue</h2></div><AlertTriangle size={19} /></div>
          {loading ? <LoadingState label="Memuat antrean prioritas" /> : (
            <div className="console-attention-list">
              {attention.map((item) => (
                <Link key={item.label} to={item.path} className={item.count ? "has-issue" : ""}>
                  <span className={`console-attention-dot is-${item.tone}`}>{item.count ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}</span>
                  <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                  <b>{item.count}</b>
                </Link>
              ))}
            </div>
          )}
        </BentoCell>

        <BentoCell span={{ col: 6 }} as="section" className="console-cell" aria-labelledby="owner-system-title">
          <div className="console-panel-header"><div><span>Kondisi layanan</span><h2 id="owner-system-title">Status sistem</h2></div><Server size={19} /></div>
          {loading ? <LoadingState label="Memuat status sistem" /> : errors.system ? <ErrorState message={errors.system} onRetry={() => void loadData(true)} /> : system ? (
            <div className="console-system-list">
              <SystemRow icon={Wifi} label="WhatsApp" detail={system.whatsapp.state || "Status koneksi"} ok={system.whatsapp.connected} />
              <SystemRow icon={Sheet} label="Google Sheets" detail={lastSync ? `Sync ${formatDateTime(lastSync)}` : "Belum ada waktu sync"} ok={Boolean(sheets?.configured && lastSync)} warning={Boolean(sheets?.configured)} />
              <SystemRow icon={Server} label="VPS" detail={`${system.server.platform} / uptime ${Math.floor(system.server.uptime / 3600)} jam`} ok={system.ok} />
              <SystemRow icon={Cloud} label="Tunnel" detail={system.tunnel.publicDomain || "Domain belum terpasang"} ok={system.tunnel.running} warning={system.tunnel.configured} />
            </div>
          ) : <ErrorState message="Status sistem belum tersedia." onRetry={() => void loadData(true)} />}
          <Link to="/owner-v2/integrations" className="console-panel-link">Buka status integrasi <ExternalLink size={14} /></Link>
        </BentoCell>

        <BentoCell span={{ col: 6 }} as="section" className="console-cell" aria-labelledby="owner-stock-title">
          <div className="console-panel-header"><div><span>Ketersediaan</span><h2 id="owner-stock-title">Status stok</h2></div><Boxes size={19} /></div>
          {loading ? <LoadingState label="Memuat status stok" /> : errors.stock ? <ErrorState message={errors.stock} onRetry={() => void loadData(true)} /> : (
            <div className="console-stock-stats">
              <div><span>Ready</span><strong>{metrics.ready}</strong><i style={{ width: `${Math.min(100, metrics.ready ? 100 : 0)}%` }} /></div>
              <div><span>Reserved</span><strong>{metrics.reserved}</strong><i style={{ width: `${Math.min(100, metrics.ready + metrics.reserved ? metrics.reserved / (metrics.ready + metrics.reserved) * 100 : 0)}%` }} /></div>
              <div><span>Sold</span><strong>{metrics.sold}</strong><i style={{ width: `${Math.min(100, data.stock.length ? metrics.sold / data.stock.length * 100 : 0)}%` }} /></div>
            </div>
          )}
          <Link to="/owner-v2/stock" className="console-panel-link">Kelola stok akun <ExternalLink size={14} /></Link>
        </BentoCell>

        <BentoCell span={{ col: 12, row: 3 }} as="section" className="console-cell" aria-labelledby="recent-orders-title">
          <div className="console-panel-header console-orders-heading">
            <div><span>Aktivitas penjualan</span><h2 id="recent-orders-title">Pesanan terbaru</h2></div>
            <Link to="/owner-v2/orders">Lihat semua pesanan <ArrowUpRight size={15} /></Link>
          </div>
          <DataTable
            rows={recentOrders}
            columns={orderColumns}
            filters={orderFilters}
            rowKey={(order) => order.id}
            loading={loading}
            error={errors.orders}
            emptyText="Belum ada pesanan live."
            initialPageSize={5}
          />
        </BentoCell>
      </Bento>

      <Drawer
        open={Boolean(selectedOrder)}
        title={selectedOrder?.id ?? ""}
        eyebrow="Detail pesanan"
        onClose={() => setSelectedOrder(null)}
      >
        {selectedOrder ? (
          <>
            <div className="console-drawer-statuses">
              <Badge tone={isPaid(selectedOrder) ? "success" : selectedOrder.qrisStatus === "expired" ? "danger" : "warning"}>{paymentLabel(selectedOrder)}</Badge>
              <Badge tone={fulfillmentLabel(selectedOrder) === "Selesai" ? "success" : fulfillmentLabel(selectedOrder) === "Gagal" ? "danger" : "warning"}>{fulfillmentLabel(selectedOrder)}</Badge>
            </div>
            <dl className="ui-detail-list">
              <DetailRow label="Customer">{selectedOrder.customer || "-"}</DetailRow>
              <DetailRow label="Produk">{selectedOrder.product} / {selectedOrder.variant}</DetailRow>
              <DetailRow label="Durasi">{selectedOrder.duration || "-"}</DetailRow>
              <DetailRow label="Total">{formatRupiah(Number(selectedOrder.total || 0))}</DetailRow>
              <DetailRow label="Waktu">{formatDateTime(selectedOrder.createdAt)}</DetailRow>
              <DetailRow label="Channel">{selectedOrder.channel || "-"}</DetailRow>
            </dl>
            <div className="console-privacy-note"><PackageCheck size={16} /><span>Password, OTP, PIN, token, dan kredensial akun tidak ditampilkan pada Overview.</span></div>
            <Link to={`/owner-v2/orders?order=${encodeURIComponent(selectedOrder.id)}`} className="console-drawer-footer">Buka audit lengkap <ArrowUpRight size={15} /></Link>
          </>
        ) : null}
      </Drawer>

      <Toast
        message={toast}
        tone={errors.stock || errors.orders ? "warning" : "success"}
        onClose={() => setToast("")}
      />
    </ConsoleShell>
  );
}
