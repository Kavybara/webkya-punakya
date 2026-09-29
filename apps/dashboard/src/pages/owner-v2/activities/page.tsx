import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, subscribeRealtime, type ApiActivity } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";
import { Badge, MetricRow } from "../../../components/ui";

export default function OwnerConsoleActivitiesPage() {
  const [rows, setRows] = useState<ApiActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setRows(await api.activities()); setUpdated(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })); } catch (cause) { setError(cause instanceof Error ? cause.message : "Activity log gagal dimuat."); } finally { setLoading(false); } }, []);
  useEffect(() => { load().catch(() => undefined); return subscribeRealtime(() => load().catch(() => undefined)); }, [load]);
  const columns = useMemo<Array<DataColumn<ApiActivity>>>(() => [
    { id: "activity", header: "Aktivitas", value: (row) => `${row.title} ${row.description}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.title}</strong><small>{row.description}</small></span> },
    { id: "type", header: "Kategori", value: (row) => row.type, sortable: true, cell: (row) => <Badge tone={row.type === "security" ? "warning" : "muted"}>{row.type}</Badge> },
    { id: "actor", header: "Aktor", value: (row) => row.actorName || row.actorRole || "Sistem", sortable: true },
    { id: "reference", header: "Referensi", value: (row) => row.orderId || row.accountId || row.resellerId || "-", hideOnMobile: true },
    { id: "time", header: "Waktu", value: (row) => row.createdAt, sortable: true, cell: (row) => formatDateTime(row.createdAt) },
    { id: "action", header: "Aksi", value: () => "", cell: (row) => row.orderId ? <Link className="console-row-action" to={`/owner-v2/orders?order=${encodeURIComponent(row.orderId)}`} aria-label={`Buka order ${row.orderId}`}><ArrowUpRight size={15} /></Link> : <span /> },
  ], []);
  const filters = useMemo<Array<DataFilter<ApiActivity>>>(() => [{ id: "type", label: "Kategori", options: ["order", "stock", "reseller", "whatsapp", "account", "security"].map((value) => ({ label: value, value })), value: (row) => row.type }], []);
  return <ConsoleShell title="Activity Log" description="Telusuri perubahan operasional dan aktivitas owner." lastUpdated={updated} refreshing={loading} systemState={error ? "unknown" : "healthy"} onRefresh={load}>
    <MetricRow items={[{ label: "Total aktivitas", value: rows.length }, { label: "Order", value: rows.filter((row) => row.type === "order").length }, { label: "Akun", value: rows.filter((row) => row.type === "account").length }, { label: "Security", value: rows.filter((row) => row.type === "security").length, tone: "warning" }]} />
    <section className="console-panel"><div className="console-panel-header"><div><span>Sistem</span><h2>Riwayat aktivitas</h2></div><Activity size={18} /></div><DataTable rows={rows} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} initialPageSize={10} /></section>
  </ConsoleShell>;
}
