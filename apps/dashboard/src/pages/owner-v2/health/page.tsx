import { useCallback, useEffect, useMemo, useState } from "react";
import { Cloud, Database, HardDrive, MessageCircle, RefreshCw, Server, Sheet, WalletCards } from "lucide-react";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type HealthResult, type SystemStatus } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";
import { Badge, MetricRow, Notice } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

function formatBytes(value = 0) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function statusTone(ok: boolean, warning = false) {
  if (ok) return "success";
  return warning ? "warning" : "danger";
}

export default function OwnerConsoleHealthPage() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [systemStatus, healthStatus] = await Promise.all([api.systemStatus(), api.health()]);
      setSystem(systemStatus);
      setHealth(healthStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Health Center gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);

  const checks = useMemo(() => {
    return [
      {
        key: "whatsapp",
        title: "WhatsApp",
        icon: <MessageCircle size={18} />,
        ok: Boolean(system?.integrations?.whatsapp?.connected || system?.whatsapp?.connected),
        detail: system?.whatsapp?.state || system?.whatsapp?.last_disconnect_reason || "Status bot belum terbaca.",
      },
      {
        key: "pakasir",
        title: "Pakasir",
        icon: <WalletCards size={18} />,
        ok: Boolean(health?.pakasirConfigured || system?.integrations?.pakasir?.configured),
        warning: Boolean(health?.maintenance?.enabled && health.maintenance.source === "pakasir"),
        detail: health?.maintenance?.source === "pakasir" && health.maintenance.reason ? health.maintenance.reason : "Merchant dan API key terbaca.",
      },
      {
        key: "sheets",
        title: "Google Sheets",
        icon: <Sheet size={18} />,
        ok: Boolean(health?.googleSheetsConfigured && health?.googleSheetsHealthy !== false),
        warning: Boolean(health?.googleSheetsConfigured && health?.googleSheetsHealthy === false),
        detail: health?.googleSheetsFailedSections?.length ? `Gagal: ${health.googleSheetsFailedSections.join(", ")}` : `Sync terakhir ${formatDateTime(health?.googleSheetsLastSyncAt || "")}`,
      },
      {
        key: "cloudflare",
        title: "Cloudflare",
        icon: <Cloud size={18} />,
        ok: Boolean(system?.integrations?.cloudflare?.running || system?.tunnel?.running),
        warning: Boolean(system?.integrations?.cloudflare?.configured || system?.tunnel?.configured),
        detail: system?.integrations?.cloudflare?.publicDomain || system?.tunnel?.publicDomain || "Tunnel belum terbaca.",
      },
      {
        key: "database",
        title: "Database",
        icon: <Database size={18} />,
        // Both of these read `system` only. `api.systemStatus()` is the
        // endpoint that serves file stats (`readDatabaseInfo` /
        // `readBackupInfo` in index.js); `/api/health` has never returned a
        // `database` or `backup` field. `HealthResult` used to declare them
        // anyway, so every `health?.backup?.x` below compiled and silently
        // evaluated to `undefined` -- which is how the backup card came to
        // claim no backup existed while its own badge read the real count.
        ok: Boolean(system?.database?.exists),
        detail: `${formatBytes(system?.database?.size || 0)} / update ${formatDateTime(system?.database?.modifiedAt || "")}`,
      },
      {
        key: "backup",
        title: "Backup",
        icon: <HardDrive size={18} />,
        // `backupHealth` answers "did it run and reach the owner"; the file
        // count only says what sits on this disk. A directory full of archives
        // is not a backup if the VPS hosting them is what dies, so the badge
        // follows the health verdict and the disk state becomes the detail.
        // Falling back to the file count keeps a pre-deploy database (which has
        // no recorded run at all) from reading as a failure when files exist.
        ok: system?.backupHealth ? system.backupHealth.ok : Boolean(system?.backup?.count),
        warning: true,
        detail: system?.backupHealth
          ? system.backupHealth.ok
            ? `Terkirim ${formatDateTime(system.backupHealth.sentAt || system.backupHealth.ranAt)}`
            : system.backupHealth.message
          : system?.backup?.latestName
            ? `${system.backup.latestName} / ${formatDateTime(system.backup.latestAt)}`
            : "Belum ada catatan backup otomatis.",
      },
    ];
  }, [health, system]);

  const attention = checks.filter((item) => !item.ok).length + (health?.maintenance?.enabled ? 1 : 0);

  return <ConsoleShell title="Health Center" description="Pantau kesehatan teknis web, bot, pembayaran, tunnel, Sheets, database, dan backup." refreshing={loading} attentionCount={attention} systemState={systemStateFor(attention, { error: Boolean(error), loading })} lastUpdated={formatDateTime(system?.checkedAt || "")} onRefresh={load}>
    <MetricRow items={[{ label: "WhatsApp", value: system?.whatsapp?.connected ? "Connected" : "Periksa", tone: statusTone(Boolean(system?.whatsapp?.connected), true) }, { label: "Pakasir", value: health?.pakasirConfigured ? "Configured" : "Kosong", tone: statusTone(Boolean(health?.pakasirConfigured), true) }, { label: "Cloudflare", value: system?.tunnel?.running || system?.integrations?.cloudflare?.running ? "Running" : "Offline", tone: statusTone(Boolean(system?.tunnel?.running || system?.integrations?.cloudflare?.running), true) }, { label: "Memory", value: `${system?.memory?.percent ?? 0}%`, tone: Number(system?.memory?.percent || 0) > 85 ? "warning" : "success" }]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {/* A stalled backup gets a banner, not just a card badge. The card sits
        below the fold and is one of six; this is the failure where the owner
        finds out only once they need the backup. Severity comes from the
        server so the tone cannot drift with the wording of the message. */}
    {system?.backupHealth && !system.backupHealth.ok && system.backupHealth.message ? <Notice tone={system.backupHealth.severity === "error" ? "danger" : "warning"}>{system.backupHealth.message}</Notice> : null}
    {health?.maintenance?.enabled ? <Notice tone="warning">{health.maintenance.reason || "Maintenance order sedang aktif."}</Notice> : null}
    <section className="console-panel"><div className="console-panel-header"><div><span>Status teknis</span><h2>Komponen utama</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={() => load().catch(() => undefined)} disabled={loading}><RefreshCw size={15} /> Perbarui</button></div></div><div className="console-health-grid">{checks.map((item) => <article key={item.key} className="console-health-card"><span>{item.icon}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><Badge tone={statusTone(item.ok, item.warning)}>{item.ok ? "sehat" : item.warning ? "cek" : "error"}</Badge></article>)}</div></section>
    <section className="console-panel"><div className="console-panel-header"><div><span>Server</span><h2>{system?.server?.hostname || "Server"}</h2></div><Badge tone={Number(system?.memory?.percent || 0) > 85 ? "warning" : "success"}>{system?.server?.platform || "-"}</Badge></div><div className="console-resource-form-grid"><div className="console-readonly-field"><Server size={15} /> CPU {system?.server?.cpus || 0}</div><div className="console-readonly-field">Memory {formatBytes(system?.memory?.used || 0)} / {formatBytes(system?.memory?.total || 0)}</div><div className="console-readonly-field">Disk {system?.disk?.percent ?? 0}% terpakai</div><div className="console-readonly-field">Backup {system?.backup?.count || 0} file</div></div></section>
  </ConsoleShell>;
}
