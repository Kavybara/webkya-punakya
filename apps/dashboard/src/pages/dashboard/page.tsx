import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardLayout } from "../../components/feature/DashboardLayout";
import { DataPanel } from "../../components/feature/OwnerUi";
import { api, subscribeRealtime, type ApiOrder, type ApiReseller, type ApiStockItem, type SystemStatus } from "../../lib/api";
import { formatRupiah, type Activity } from "../../mocks/data";

const activityTone: Record<Activity["type"], { icon: string; className: string; actor: string }> = {
  order: { icon: "ri-shopping-cart-2-line", className: "bg-red-50 text-red-600", actor: "Sistem" },
  stock: { icon: "ri-database-2-line", className: "bg-emerald-50 text-emerald-600", actor: "Owner" },
  reseller: { icon: "ri-user-shared-line", className: "bg-blue-50 text-blue-600", actor: "Owner" },
  whatsapp: { icon: "ri-whatsapp-line", className: "bg-green-50 text-green-600", actor: "WhatsApp" },
  account: { icon: "ri-shield-keyhole-line", className: "bg-amber-50 text-amber-600", actor: "Owner" },
  security: { icon: "ri-key-2-line", className: "bg-violet-50 text-violet-600", actor: "Reseller" },
};

function dateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeText(value: string) {
  return value?.includes(" ") ? value.slice(11) : value || "-";
}

function shortRupiah(value: number) {
  if (!value) return "Rp0";
  if (value >= 1000000) return `Rp${Number(value / 1000000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}jt`;
  if (value >= 1000) return `Rp${Number(value / 1000).toLocaleString("id-ID", { maximumFractionDigits: 0 })}rb`;
  return `Rp${value}`;
}

function isSmokeTestOrder(order: ApiOrder) {
  return Boolean(order.excludeFromSalesMetrics || order.isSmokeTest || String(order.source || "").toLowerCase() === "owner_smoke_test");
}

type RevenuePoint = {
  label: string;
  revenue: number;
};

function RevenuePanel({
  title,
  subtitle,
  total,
  data,
  gradientId,
}: {
  title: string;
  subtitle: string;
  total: number;
  data: RevenuePoint[];
  gradientId: string;
}) {
  const chartMax = Math.max(...data.map((item) => item.revenue), 100000);

  return (
    <DataPanel className="overflow-hidden rounded-lg shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
        </div>
        <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          {formatRupiah(total)} total
        </div>
      </div>
      <div className="h-[300px] px-4 py-5">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 10, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.24} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#edf2f7" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis
              domain={[0, chartMax]}
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => shortRupiah(Number(value))}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: "#10b981", strokeWidth: 1 }}
              formatter={(value) => formatRupiah(Number(value))}
              labelStyle={{ color: "#0f172a", fontWeight: 600 }}
              contentStyle={{ border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 12px 30px rgba(15,23,42,0.08)" }}
            />
            <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill={`url(#${gradientId})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </DataPanel>
  );
}

function OverviewStat({
  icon,
  iconClassName,
  label,
  value,
  delta,
  deltaClassName = "text-emerald-600",
}: {
  icon: string;
  iconClassName: string;
  label: string;
  value: string | number;
  delta: string;
  deltaClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-md ${iconClassName}`}>
          <i className={`${icon} text-lg`} />
        </span>
        <span className={`text-xs font-semibold ${deltaClassName}`}>{delta}</span>
      </div>
      <div className="mt-4 text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{value}</div>
    </div>
  );
}

function formatBytes(value = 0) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDurationSeconds(value = 0) {
  const seconds = Math.max(0, Number(value || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days} hari ${hours} jam`;
  if (hours) return `${hours} jam ${minutes} menit`;
  return `${minutes} menit`;
}

function formatDurationMs(value = 0) {
  return formatDurationSeconds(Number(value || 0) / 1000);
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("id-ID");
}

function formatRelativeFromNow(value?: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds} dtk lalu`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} mnt lalu`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} jam lalu`;
  return `${Math.floor(diffSeconds / 86400)} hari lalu`;
}

function statusClass(active: boolean) {
  return active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700";
}

function MetricRow({ label, value, percent }: { label: string; value: string; percent: number }) {
  const safePercent = Math.max(0, Math.min(100, Number(percent || 0)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-500">{label}</span>
        <span className="font-semibold text-slate-800">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#f2ece2]">
        <div className={`h-full rounded-full ${safePercent >= 80 ? "bg-red-500" : safePercent >= 65 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
}

function ServicePill({ label, active }: { label: string; active: boolean }) {
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(active)}`}>{label}</span>;
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-[#fbf7f0] px-3 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-slate-900">{value || "-"}</span>
    </div>
  );
}

function ConnectionSnapshot({ label, value, hint, active }: { label: string; value: string; hint: string; active: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${active ? "border-emerald-100 bg-emerald-50/60" : "border-red-100 bg-red-50/60"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(active)}`}>{active ? "Stabil" : "Perlu cek"}</span>
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

function VpsMonitorCard({
  status,
  loading,
  restarting,
  onOpen,
  onRefresh,
  onRestart,
}: {
  status: SystemStatus | null;
  loading: boolean;
  restarting: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onRestart: () => void;
}) {
  const online = Boolean(status?.pm2.status === "online");
  const whatsappConnected = Boolean(status?.whatsapp.connected);
  const tunnelRunning = Boolean(status?.tunnel.running);
  const statusHealthy = online && whatsappConnected && tunnelRunning;
  const ramText = status ? `${formatBytes(status.memory.used)} / ${formatBytes(status.memory.total)}` : "-";
  const diskText = status ? `${formatBytes(status.disk.used)} / ${formatBytes(status.disk.total)}` : "-";

  return (
    <DataPanel className="rounded-lg p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">VPS Monitor</p>
          <p className="mt-1 text-xl font-bold text-slate-950">{statusHealthy ? "Stabil" : online ? "Perlu Cek" : status ? "Offline" : loading ? "Memuat" : "Tidak terbaca"}</p>
          <p className="mt-1 text-xs text-slate-500">Terakhir dicek {status ? formatRelativeFromNow(status.checkedAt) : "-"}</p>
        </div>
        <button type="button" onClick={onOpen} className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100" aria-label="Detail VPS Monitor">
          <i className="ri-server-line text-lg" />
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <MetricRow label="RAM" value={ramText} percent={status?.memory.percent || 0} />
        <MetricRow label="Disk" value={diskText} percent={status?.disk.percent || 0} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ServicePill label={`PM2 ${status?.pm2.status || "-"}`} active={online} />
        <ServicePill label={`WA ${status?.whatsapp.connected ? "Connected" : status?.whatsapp.state || "-"}`} active={whatsappConnected} />
        <ServicePill label={`Tunnel ${status?.tunnel.running ? "Running" : "Off"}`} active={tunnelRunning} />
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <ConnectionSnapshot
          label="WhatsApp"
          value={status?.whatsapp.state || "-"}
          hint={
            whatsappConnected
              ? `Aktif sejak ${formatDurationMs(status?.pm2.uptime || 0)}`
              : status?.whatsapp.next_reconnect_delay_ms
                ? `Retry lagi ${formatDurationMs(status.whatsapp.next_reconnect_delay_ms)}`
                : status?.whatsapp.error || "Bot belum tersambung"
          }
          active={whatsappConnected}
        />
        <ConnectionSnapshot
          label="Tunnel"
          value={tunnelRunning ? "Running" : "Disconnected"}
          hint={tunnelRunning ? (status?.tunnel.publicDomain || "Domain terpasang") : "Akses publik lagi putus"}
          active={tunnelRunning}
        />
        <ConnectionSnapshot
          label="Restart"
          value={status ? `${status.pm2.restartCount}x` : "-"}
          hint={status ? `PM2 uptime ${formatDurationMs(status.pm2.uptime)}` : "-"}
          active={Boolean(status && status.pm2.restartCount === 0 && online)}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={onRefresh} disabled={loading} className="h-8 rounded-md border border-[#ded6ca] bg-white text-xs font-medium text-slate-700 hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-60">
          {loading ? "Refresh..." : "Refresh"}
        </button>
        <button type="button" onClick={onRestart} disabled={restarting} className="h-8 rounded-md bg-[#2b2b2b] text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-60">
          {restarting ? "Restart..." : "Restart Kavya"}
        </button>
      </div>
    </DataPanel>
  );
}

function SystemMonitorModal({ status, onClose }: { status: SystemStatus | null; onClose: () => void }) {
  if (!status) return null;
  const swapPercent = status.swap.total ? Math.round((status.swap.used / status.swap.total) * 100) : 0;
  const whatsappConnected = Boolean(status.whatsapp.connected);
  const tunnelRunning = Boolean(status.tunnel.running);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">System Monitor</h2>
            <p className="mt-1 text-xs text-slate-500">{status.server.hostname} · {status.server.os} · {status.server.cpus} CPU</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Tutup System Monitor">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <MetricRow label="RAM" value={`${formatBytes(status.memory.used)} / ${formatBytes(status.memory.total)}`} percent={status.memory.percent} />
            <MetricRow label="Disk" value={`${formatBytes(status.disk.used)} / ${formatBytes(status.disk.total)}`} percent={status.disk.percent} />
            <MetricRow label="Swap" value={status.swap.enabled ? `${formatBytes(status.swap.used)} / ${formatBytes(status.swap.total)}` : "Off"} percent={swapPercent} />
          </div>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2">
              <span className="text-slate-500">Uptime VPS</span>
              <span className="font-semibold text-slate-900">{formatDurationSeconds(status.server.uptime)}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2">
              <span className="text-slate-500">PM2 Uptime</span>
              <span className="font-semibold text-slate-900">{formatDurationMs(status.pm2.uptime)}</span>
            </div>
            <div className="flex items-center justify-between rounded-md bg-[#fbf7f0] px-3 py-2">
              <span className="text-slate-500">Restart PM2</span>
              <span className="font-semibold text-slate-900">{status.pm2.restartCount}</span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <ServicePill label={`PM2 ${status.pm2.status}`} active={status.pm2.status === "online"} />
          <ServicePill label={`WhatsApp ${status.whatsapp.state}`} active={whatsappConnected} />
          <ServicePill label={`Tunnel ${tunnelRunning ? "Running" : "Off"}`} active={tunnelRunning} />
          <ServicePill label={`Pakasir ${status.integrations?.pakasir.configured ? "OK" : "Off"}`} active={Boolean(status.integrations?.pakasir.configured)} />
          <ServicePill label={`Gmail ${status.integrations?.gmail.connected ? "OK" : "Off"}`} active={Boolean(status.integrations?.gmail.connected)} />
          <ServicePill label={`Sheets ${status.integrations?.googleSheets.configured ? "OK" : "Off"}`} active={Boolean(status.integrations?.googleSheets.configured)} />
          <ServicePill label={`WA Inbound ${status.integrations?.whatsapp.inboundConfigured ? "OK" : "Off"}`} active={Boolean(status.integrations?.whatsapp.inboundConfigured)} />
        </div>

        <div className="mt-5 grid gap-2 md:grid-cols-3">
          <ConnectionSnapshot
            label="WhatsApp"
            value={status.whatsapp.state}
            hint={
              whatsappConnected
                ? `Aktif sejak ${formatDurationMs(status.pm2.uptime)}`
                : status.whatsapp.next_reconnect_delay_ms
                  ? `Retry lagi ${formatDurationMs(status.whatsapp.next_reconnect_delay_ms)}`
                  : status.whatsapp.error || "Belum connect ke sesi WhatsApp"
            }
            active={whatsappConnected}
          />
          <ConnectionSnapshot
            label="Tunnel"
            value={tunnelRunning ? "Running" : "Disconnected"}
            hint={tunnelRunning ? (status.tunnel.publicDomain || "Domain aktif") : "Tunnel tidak sedang running"}
            active={tunnelRunning}
          />
          <ConnectionSnapshot
            label="Pemeriksaan"
            value={formatDateTime(status.checkedAt)}
            hint={`Dicek ${formatRelativeFromNow(status.checkedAt)}`}
            active={status.ok}
          />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Database</p>
            <div className="grid gap-2">
              <InfoRow label="Status" value={status.database?.exists ? "Ada" : "Tidak terbaca"} />
              <InfoRow label="Ukuran" value={formatBytes(status.database?.size || 0)} />
              <InfoRow label="Versi" value={status.database?.version || 0} />
              <InfoRow label="Modified" value={status.database?.modifiedAt ? new Date(status.database.modifiedAt).toLocaleString("id-ID") : "-"} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Backup</p>
            <div className="grid gap-2">
              <InfoRow label="Folder" value={status.backup?.exists ? "Ada" : "Tidak terbaca"} />
              <InfoRow label="File" value={status.backup?.count || 0} />
              <InfoRow label="Terbaru" value={status.backup?.latestAt ? new Date(status.backup.latestAt).toLocaleString("id-ID") : "-"} />
              <InfoRow label="Ukuran" value={formatBytes(status.backup?.latestSize || 0)} />
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-gray-100 bg-white p-3 text-xs text-slate-500">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">Public domain:</span>{" "}
              <span className="break-all">{status.integrations?.cloudflare.publicDomain || status.tunnel.publicDomain || "-"}</span>
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">Sheets sync:</span>{" "}
              <span>{status.integrations?.googleSheets.lastSyncAt || "-"}</span>
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">Owner WA:</span>{" "}
              <span>{status.integrations?.whatsapp.ownerWhatsAppNumber || "-"}</span>
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">Gmail inbox:</span>{" "}
              <span className="break-all">{status.integrations?.gmail.inboxEmail || "-"}</span>
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">Last reconnect WA:</span>{" "}
              <span>{formatDateTime(status.whatsapp.last_reconnect_at)}</span>
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">Last disconnect WA:</span>{" "}
              <span>{formatDateTime(status.whatsapp.last_disconnect_at)}</span>
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">Alasan putus WA:</span>{" "}
              <span className="break-all">{status.whatsapp.last_disconnect_reason || status.whatsapp.error || "-"}</span>
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-slate-700">Percobaan reconnect:</span>{" "}
              <span>{status.whatsapp.reconnect_attempts ?? 0}</span>
            </div>
          </div>
        </div>

        {status.warnings.length ? (
          <div className="mt-5 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {status.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function OwnerOverviewPage() {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [stock, setStock] = useState<ApiStockItem[]>([]);
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);

  async function loadData() {
    const [orderRows, stockRows, resellerRows, activityRows, systemRows] = await Promise.all([
      api.orders(),
      api.stock(),
      api.resellers(),
      api.activities(),
      api.systemStatus().catch(() => null),
    ]);
    setOrders(orderRows);
    setStock(stockRows);
    setResellers(resellerRows);
    setActivities(activityRows as Activity[]);
    if (systemRows) setSystemStatus(systemRows);
  }

  async function refreshSystemStatus() {
    setSystemLoading(true);
    try {
      setSystemStatus(await api.systemStatus());
    } finally {
      setSystemLoading(false);
    }
  }

  async function restartKavya() {
    setRestarting(true);
    try {
      await api.restartSystem();
      setRestartConfirmOpen(false);
      window.setTimeout(() => {
        refreshSystemStatus().catch(console.error);
      }, 5000);
    } finally {
      window.setTimeout(() => setRestarting(false), 1500);
    }
  }

  useEffect(() => {
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  const todayKey = dateKey(new Date());
  const stats = useMemo(
    () => ({
      revenue: orders.filter((order) => !isSmokeTestOrder(order) && order.qrisStatus === "paid").reduce((sum, order) => sum + Number(order.total || 0), 0),
      availableStock: stock.filter((item) => item.status === "available").length,
      reservedStock: stock.filter((item) => item.status === "reserved").length,
      soldStock: stock.filter((item) => item.status === "sold").length,
      todayOrders: orders.filter((order) => !isSmokeTestOrder(order) && String(order.createdAt || "").startsWith(todayKey)).length,
      pendingOrders: orders.filter((order) => !isSmokeTestOrder(order) && order.orderStatus === "pending").length,
      paidOrders: orders.filter((order) => !isSmokeTestOrder(order) && order.qrisStatus === "paid").length,
      activeResellers: resellers.filter((item) => item.isActive !== false).length,
    }),
    [orders, resellers, stock, todayKey],
  );

  const revenueChart = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("id-ID", { weekday: "short" });
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const key = dateKey(date);
      return {
        day: formatter.format(date),
        revenue: orders
          .filter((order) => !isSmokeTestOrder(order) && order.qrisStatus === "paid" && String(order.createdAt || "").startsWith(key))
          .reduce((sum, order) => sum + Number(order.total || 0), 0),
      };
    });
  }, [orders]);

  const weeklyRevenue = revenueChart.reduce((sum, item) => sum + item.revenue, 0);
  const monthlyRevenueChart = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const bucketCount = Math.ceil(daysInMonth / 7);
    return Array.from({ length: bucketCount }, (_, index) => {
      const startDay = index * 7 + 1;
      const endDay = Math.min(startDay + 6, daysInMonth);
      const revenue = orders
        .filter((order) => {
          if (isSmokeTestOrder(order) || order.qrisStatus !== "paid") return false;
          const created = new Date(String(order.createdAt || "").replace(" ", "T"));
          if (Number.isNaN(created.getTime())) return false;
          return created.getFullYear() === year && created.getMonth() === month && created.getDate() >= startDay && created.getDate() <= endDay;
        })
        .reduce((sum, order) => sum + Number(order.total || 0), 0);
      return {
        label: `${startDay}-${endDay}`,
        revenue,
      };
    });
  }, [orders]);

  const monthlyRevenue = monthlyRevenueChart.reduce((sum, item) => sum + item.revenue, 0);

  return (
    <DashboardLayout role="owner" title="Overview">
      <div className="space-y-5">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewStat
            icon="ri-wallet-3-line"
            iconClassName="bg-emerald-50 text-emerald-600"
            label="Total Pendapatan"
            value={formatRupiah(stats.revenue)}
            delta="+ live"
          />
          <OverviewStat
            icon="ri-box-3-line"
            iconClassName="bg-blue-50 text-blue-600"
            label="Stok Tersedia"
            value={stats.availableStock}
            delta={`${stats.reservedStock} reserved`}
            deltaClassName="text-blue-600"
          />
          <OverviewStat
            icon="ri-shopping-cart-2-line"
            iconClassName="bg-amber-50 text-amber-600"
            label="Order Hari Ini"
            value={stats.todayOrders}
            delta={`${stats.pendingOrders} pending`}
            deltaClassName="text-amber-600"
          />
          <OverviewStat
            icon="ri-user-shared-line"
            iconClassName="bg-red-50 text-red-600"
            label="Total Reseller"
            value={stats.activeResellers}
            delta="+ aktif"
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <RevenuePanel
            title="Pendapatan Minggu Ini"
            subtitle="Mengikuti order QRIS paid dari live data."
            total={weeklyRevenue}
            data={revenueChart.map((item) => ({ label: item.day, revenue: item.revenue }))}
            gradientId="overviewRevenueWeek"
          />
          <RevenuePanel
            title="Pendapatan Bulan Ini"
            subtitle="Dibagi per rentang tanggal dalam bulan berjalan."
            total={monthlyRevenue}
            data={monthlyRevenueChart}
            gradientId="overviewRevenueMonth"
          />
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <DataPanel className="rounded-lg p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Status Stok</p>
                <p className="mt-1 text-xl font-bold text-slate-950">{stats.availableStock} ready</p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                <i className="ri-archive-line text-lg" />
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-[#fbf7f0] px-3 py-2">
                <span className="block text-slate-400">Reserved</span>
                <span className="font-semibold text-slate-800">{stats.reservedStock}</span>
              </div>
              <div className="rounded-md bg-[#fbf7f0] px-3 py-2">
                <span className="block text-slate-400">Sold</span>
                <span className="font-semibold text-slate-800">{stats.soldStock}</span>
              </div>
            </div>
          </DataPanel>

          <DataPanel className="rounded-lg p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">Status Order</p>
                <p className="mt-1 text-xl font-bold text-slate-950">{orders.length} total</p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                <i className="ri-receipt-line text-lg" />
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-[#fbf7f0] px-3 py-2">
                <span className="block text-slate-400">Paid</span>
                <span className="font-semibold text-slate-800">{stats.paidOrders}</span>
              </div>
              <div className="rounded-md bg-[#fbf7f0] px-3 py-2">
                <span className="block text-slate-400">Pending</span>
                <span className="font-semibold text-slate-800">{stats.pendingOrders}</span>
              </div>
            </div>
          </DataPanel>

          <VpsMonitorCard
            status={systemStatus}
            loading={systemLoading}
            restarting={restarting}
            onOpen={() => setSystemModalOpen(true)}
            onRefresh={() => refreshSystemStatus().catch(console.error)}
            onRestart={() => setRestartConfirmOpen(true)}
          />
        </section>

        <DataPanel className="overflow-hidden rounded-lg shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Activity Log</h2>
              <p className="mt-1 text-xs text-slate-400">Aktivitas terbaru dari dashboard, order flow, stok, reseller, dan WhatsApp.</p>
            </div>
            <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
              {activities.length} aktivitas
            </div>
          </div>
          <div className="max-h-[440px] overflow-y-auto">
            {activities.length ? (
              <div className="divide-y divide-gray-50">
                {activities.slice(0, 24).map((activity) => {
                  const tone = activityTone[activity.type] || activityTone.order;
                  return (
                    <div key={activity.id} className="grid gap-3 px-5 py-4 md:grid-cols-[44px_minmax(0,1fr)_140px] md:items-center">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-md ${tone.className}`}>
                        <i className={`${tone.icon} text-base`} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-5 text-slate-800">{activity.title}</p>
                        {activity.description ? <p className="mt-1 text-xs leading-5 text-slate-500">{activity.description}</p> : null}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 md:justify-end">
                        <span>{tone.actor}</span>
                        <span>-</span>
                        <span>{timeText(activity.createdAt)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-md border border-dashed border-gray-200 bg-[#fbf7f0] px-6 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-slate-400">
                  <i className="ri-history-line text-lg" />
                </span>
                <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada aktivitas</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Aktivitas order, stok, reseller, dan WhatsApp akan muncul di sini.</p>
              </div>
            )}
          </div>
        </DataPanel>
      </div>

      {systemModalOpen ? <SystemMonitorModal status={systemStatus} onClose={() => setSystemModalOpen(false)} /> : null}

      {restartConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-950">Restart Kavya?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Dashboard dan bot WhatsApp akan terputus sekitar 5-15 detik. Proses akan dijalankan ulang lewat PM2.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setRestartConfirmOpen(false)} className="h-10 rounded-md border border-gray-300 text-sm font-medium text-slate-700">
                Batal
              </button>
              <button type="button" onClick={() => restartKavya().catch(console.error)} disabled={restarting} className="h-10 rounded-md bg-[#2b2b2b] text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60">
                {restarting ? "Restart..." : "Restart"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
