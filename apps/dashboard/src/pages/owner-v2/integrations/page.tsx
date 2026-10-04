import { useCallback, useEffect, useState } from "react";
import { Cloud, ExternalLink, Mail, MessageCircle, RefreshCw, Sheet, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type SystemStatus } from "../../../lib/api";
import { Badge, MetricRow, Notice } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

export default function OwnerConsoleIntegrationsPage() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [updated, setUpdated] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setSystem(await api.systemStatus()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Status sistem gagal dimuat."); } finally { setUpdated(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })); setLoading(false); } }, []);
  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);
  async function run(key: string, action: () => Promise<unknown>, success: string) { setBusy(key); setError(""); try { await action(); setMessage(success); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Tindakan gagal."); } finally { setBusy(""); } }
  const integrationRows = [
    { key: "pakasir", label: "Pakasir", icon: WalletCards, state: system?.integrations?.pakasir.configured ? "connected" : "disconnected", detail: system?.integrations?.pakasir.merchantId ? "Merchant ID terpasang" : "Merchant ID belum diisi" },
    { key: "bailey", label: "WhatsApp", icon: MessageCircle, state: system?.integrations?.whatsapp.connected ? "connected" : "disconnected", detail: system?.integrations?.whatsapp.state || "Status bot belum tersedia" },
    { key: "gmail", label: "Gmail", icon: Mail, state: system?.integrations?.gmail.connected ? "connected" : system?.integrations?.gmail.needsOAuth ? "needs_oauth" : "disconnected", detail: system?.integrations?.gmail.error || system?.integrations?.gmail.inboxEmail || "Inbox belum diatur" },
    { key: "sheets", label: "Google Sheets", icon: Sheet, state: !system?.integrations?.googleSheets.configured ? "disconnected" : system.integrations.googleSheets.healthy ? "connected" : "degraded", detail: system?.integrations?.googleSheets.failedSections?.length ? `Gagal: ${system.integrations.googleSheets.failedSections.join(", ")}` : system?.integrations?.googleSheets.lastSyncAt ? `Sync terakhir ${system.integrations.googleSheets.lastSyncAt}` : "Belum ada sync berhasil" },
    { key: "cloudflare", label: "Cloudflare Tunnel", icon: Cloud, state: system?.integrations?.cloudflare.running ? "connected" : "disconnected", detail: system?.integrations?.cloudflare.publicDomain || "Domain belum terpasang" },
  ];
  const connected = integrationRows.filter((item) => item.state === "connected").length;
  // `system ? ... : 0` rather than the bare difference: before the first
  // response every row reads "disconnected", so the unguarded version
  // flashed "5 perlu perhatian" on every page load and then corrected
  // itself. `systemStateFor` already reports `loading` while this is null,
  // and a count of zero is the only value consistent with "not measured".
  const disconnected = system ? integrationRows.length - connected : 0;
  return <ConsoleShell title="Status Integrasi" description="Pantau koneksi layanan eksternal tanpa mengekspos secret." lastUpdated={updated} refreshing={loading} attentionCount={disconnected} systemState={systemStateFor(disconnected, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[{ label: "Terhubung", value: connected, tone: "success" }, { label: "Perlu diperiksa", value: disconnected, tone: connected === integrationRows.length ? "success" : "warning" }, { label: "WhatsApp", value: system?.whatsapp.connected ? "Aktif" : "Periksa" }, { label: "Sheets", value: system?.integrations?.googleSheets.healthy ? "Sehat" : system?.integrations?.googleSheets.configured ? "Gangguan" : "Belum" }]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    <section className="console-panel"><div className="console-panel-header"><div><span>Sistem</span><h2>Koneksi layanan</h2></div><div className="console-panel-toolbar-actions"><button type="button" disabled={Boolean(busy)} aria-busy={Boolean(busy) || undefined} onClick={() => run("sheets", () => api.syncGoogleSheets(), "Google Sheets berhasil disinkronkan.")}><RefreshCw size={15} className={busy === "sheets" ? "ui-spin" : ""} /> Sync Sheets</button><Link to="/owner-v2/integrations/configure">Konfigurasi <ExternalLink size={14} /></Link><Link to="/owner-v2/settings">Pengaturan owner</Link></div></div>
      <div className="console-integration-list">{integrationRows.map(({ key, label, icon: Icon, state, detail }) => <article key={key}><span className="console-system-icon"><Icon size={17} /></span><div><strong>{label}</strong><small>{detail}</small></div><Badge tone={state === "connected" ? "success" : state === "needs_oauth" || state === "degraded" ? "warning" : "danger"}>{state === "connected" ? "Terhubung" : state === "degraded" ? "Gangguan sync" : state === "needs_oauth" ? "Butuh OAuth" : "Terputus"}</Badge></article>)}</div>
      <div className="console-privacy-note"><Sheet size={16} /><span>API key, token, private key, password Gmail, dan credential pembayaran tidak pernah ditampilkan pada halaman status ini.</span></div>
    </section>
  </ConsoleShell>;
}
