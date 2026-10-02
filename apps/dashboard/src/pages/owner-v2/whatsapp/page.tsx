import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type WhatsappRental, type WhatsappStatus } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";
import { Badge, MetricRow, Notice } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

/*
 * The bot records why its group sync did not run in `group_sync.last_error`,
 * and those reason codes are the only trace a silent failure leaves. The panel
 * exists so that reason reaches the owner instead of sitting in a payload.
 */
function groupSyncFailureText(code: string) {
  const known: Record<string, string> = {
    group_sync_webhook_unconfigured: "URL webhook sinkronisasi grup belum diatur di bot, jadi hasil sync tidak bisa dikirim ke dashboard.",
    heavy_work_paused: "Sync dilewati karena bot sedang menjalankan pekerjaan berat.",
    connection_not_stable: "Koneksi WhatsApp belum stabil saat sync.",
    group_sync_on_connect_disabled: "Sync otomatis saat connect dimatikan di konfigurasi bot.",
    group_sync_failed: "Sinkronisasi grup gagal di bot.",
  };
  return known[code] || `Sinkronisasi grup bermasalah (${code}).`;
}

/**
 * The bot's own health: is it connected, and which groups is it in.
 *
 * The rental table used to live here too, on the reasoning that they share an
 * endpoint. They share an endpoint and nothing else. The owner comes here to
 * answer "is the bot alive and did it see the group it was invited to", and
 * nothing on the page answered that -- the rentals table sat between the sync
 * panel and the connection panel, five metrics wide, and none of them were
 * about the bot. Rentals moved to `/owner-v2/rental`.
 */
export default function OwnerConsoleWhatsappPage() {
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [rentals, setRentals] = useState<WhatsappRental[]>([]);
  const [loading, setLoading] = useState(true);
  // Same split as the other owner pages: only a failed load may raise the
  // panel-level error. A refused sync reports into `syncError` instead.
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedPairing, setCopiedPairing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // The rental count is only here to be compared against the bot's own
      // count, so a failure to fetch it must not blank the connection panel.
      const [connection, rentalRows] = await Promise.allSettled([
        api.whatsappStatus(),
        api.whatsappRentals(),
      ]);
      if (connection.status === "fulfilled") setStatus(connection.value);
      else setError(connection.reason instanceof Error ? connection.reason.message : "Status WhatsApp gagal dimuat.");
      if (rentalRows.status === "fulfilled") setRentals(rentalRows.value);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);

  async function syncGroups() {
    if (busy) return;
    setSyncError("");
    setBusy(true);
    try {
      const result = await api.whatsappSyncGroups();
      setMessage(result.message || "Sinkronisasi grup selesai.");
      await load();
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : "Sinkronisasi grup gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPairingCode() {
    const code = status?.pairingCode?.trim();
    if (!code || !navigator.clipboard) return;
    await navigator.clipboard.writeText(code);
    setCopiedPairing(true);
    window.setTimeout(() => setCopiedPairing(false), 1800);
  }

  // The bot is either connected or it is not, so the count is 0 or 1 -- but
  // only once a response has arrived. Before that `status` is null and the
  // honest answer is "not measured", which `systemStateFor` renders as a
  // loading state rather than as one disconnection.
  const connectionIssues = status ? (status.connected ? 0 : 1) : 0;
  const pairingCode = status?.pairingCode?.trim() || "";
  const groupSync = status?.group_sync;
  const groupSyncError = String(groupSync?.last_error || "");
  const groupSyncCount = Number(groupSync?.group_count || 0);
  const groupSyncedAt = groupSync?.last_synced_at || "";
  // "Never synced" and "last sync failed" are different states and only one of
  // them is the owner's fault, so the panel says which rather than showing a
  // bare warning for both.
  const groupSyncState: "ok" | "never" | "failed" = groupSyncError
    ? "failed"
    : groupSyncedAt
      ? "ok"
      : "never";
  const showConnectionPanel = !status?.connected && !loading;
  const connectionDetail = status?.error || status?.lastError || status?.state || "Menunggu pairing code dari bot.";

  return <ConsoleShell title="WhatsApp Bot" description="Koneksi bot dan daftar grup yang diikuti bot." refreshing={loading} attentionCount={connectionIssues} systemState={systemStateFor(connectionIssues, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[
      { label: "Koneksi", value: status?.connected ? "Connected" : "Periksa", tone: status?.connected ? "success" : "warning" },
      { label: "Grup di bot", value: status ? groupSyncCount : "Memuat", hint: groupSyncedAt ? `Sync ${formatDateTime(groupSyncedAt)}` : "Belum pernah sync", error: groupSyncState === "failed" ? "Sync terakhir gagal" : undefined },
      { label: "Grup disewa", value: rentals.length, hint: "Dijual ke pelanggan" },
    ]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}{syncError ? <Notice tone="danger">{syncError}</Notice> : null}{message ? <Notice>{message}</Notice> : null}

    {/*
      * The rental table lists only groups that were sold. The bot knows every
      * group it is in, including ones nobody bought, and that gap is the thing
      * the owner cannot otherwise see -- a group the bot has left never appears
      * in the rental table at all. So the bot's own count is shown beside the
      * rental count instead of being merged into one number.
     */}
    <section className="console-panel console-whatsapp-sync-panel"><div className="console-panel-header"><div><span>Direktori bot</span><h2>Sinkronisasi grup</h2></div><Badge tone={groupSyncState === "ok" ? "success" : groupSyncState === "failed" ? "danger" : "muted"}>{groupSyncState === "ok" ? "Terbaru" : groupSyncState === "failed" ? "Gagal" : "Belum sync"}</Badge></div><div className="console-whatsapp-sync-body"><div className="console-whatsapp-sync-facts"><span><small>Grup di bot</small><strong>{status ? groupSyncCount : "Memuat"}</strong></span><span><small>Sync terakhir</small><strong>{groupSyncedAt ? formatDateTime(groupSyncedAt) : "Belum pernah"}</strong></span><span><small>Grup disewa</small><strong>{rentals.length}</strong></span></div><p>{groupSyncState === "failed" ? groupSyncFailureText(groupSyncError) : groupSyncState === "never" ? "Bot belum pernah mengirim daftar grup. Jalankan sinkronisasi untuk mengisi nama dan JID setiap grup yang diikuti bot." : "Nama grup di halaman Rental berasal dari daftar yang dikirim bot, bukan dari link yang diisi owner."}</p><div className="console-whatsapp-sync-actions"><button type="button" onClick={() => syncGroups().catch(() => undefined)} disabled={busy} aria-busy={busy}><RefreshCw size={15} /> {busy ? "Menyinkronkan..." : "Sinkron sekarang"}</button></div></div></section>

    {showConnectionPanel ? <section className="console-panel console-whatsapp-pairing-panel"><div className="console-panel-header"><div><span>Koneksi bot</span><h2>{pairingCode ? "Pairing code tersedia" : status?.qrAvailable ? "QR WhatsApp tersedia" : "Pairing code belum terbaca"}</h2></div><Badge tone="warning">{status?.state || "periksa"}</Badge></div><div className="console-whatsapp-pairing-body"><div><p>{pairingCode ? "Masukkan kode ini di WhatsApp: Perangkat tertaut -> Tautkan dengan nomor telepon." : status?.qrAvailable ? "Buka halaman pairing WhatsApp untuk melihat QR terbaru dari bot." : `Status bot: ${connectionDetail}. Hapus folder bailey auth lalu restart untuk meminta kode baru.`}</p>{pairingCode ? <strong className="console-whatsapp-pairing-code">{pairingCode}</strong> : null}</div><div className="console-whatsapp-pairing-actions">{pairingCode ? <button type="button" onClick={() => copyPairingCode().catch(() => undefined)}><span>{copiedPairing ? <Check size={15} /> : <Copy size={15} />}</span>{copiedPairing ? "Tersalin" : "Salin kode"}</button> : null}{status?.publicQrUrl ? <a href={status.publicQrUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Buka pairing</a> : null}<button type="button" onClick={() => load().catch(() => undefined)}><RefreshCw size={15} /> Refresh</button></div></div></section> : null}
  </ConsoleShell>;
}