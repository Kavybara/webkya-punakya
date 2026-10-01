import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, Copy, Edit3, ExternalLink, History, KeyRound, Link2, Plus, RefreshCw } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type WhatsappListHistory, type WhatsappRental, type WhatsappStatus } from "../../../lib/api";
import { formatCalendarDate, formatDateTime } from "../../../lib/format";
import { Badge, Dialog, DialogActions, Field, MetricRow, Notice } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

type RentalForm = {
  linkGrub: string;
  owner: string;
  contact: string;
  startedAt: string;
  durationMonths: string;
  status: WhatsappRental["status"];
  adjustmentDirection: "add" | "subtract";
  adjustmentUnit: "month" | "day";
  adjustmentAmount: string;
};

type AdjustmentForm = {
  direction: "add" | "subtract";
  unit: "month" | "day";
  amount: string;
};

const monthOptions = Array.from({ length: 12 }, (_, index) => String(index + 1));
const emptyForm = (): RentalForm => ({
  linkGrub: "",
  owner: "",
  contact: "",
  startedAt: new Date().toISOString().slice(0, 10),
  durationMonths: "1",
  status: "active",
  adjustmentDirection: "add",
  adjustmentUnit: "month",
  adjustmentAmount: "0",
});
const emptyAdjustment = (): AdjustmentForm => ({ direction: "add", unit: "month", amount: "1" });

function dateInputValue(value?: string) {
  if (!value) return "";
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function addDays(value: string | undefined, days: number) {
  const fallback = new Date().toISOString().slice(0, 10);
  const base = new Date(`${dateInputValue(value) || fallback}T00:00:00`);
  base.setDate(base.getDate() + Math.trunc(Number(days || 0)));
  return base.toISOString().slice(0, 10);
}

function adjustmentDays(form: Pick<RentalForm, "adjustmentDirection" | "adjustmentUnit" | "adjustmentAmount"> | AdjustmentForm) {
  const amount = Math.max(0, Math.trunc(Number("amount" in form ? form.amount : form.adjustmentAmount) || 0));
  const unit = "unit" in form ? form.unit : form.adjustmentUnit;
  const direction = "direction" in form ? form.direction : form.adjustmentDirection;
  const days = amount * (unit === "month" ? 30 : 1);
  return direction === "subtract" ? -days : days;
}

/*
 * The bot records why its group sync did not run in `group_sync.last_error`,
 * and those reason codes are the only trace a silent failure leaves. The panel
 * exists so that reason reaches the owner instead of sitting in a payload.
 *
 * `group_count` is deliberately kept separate from the rental metrics: it is
 * how many groups the bot is in, which is not how many the owner has sold.
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

export default function OwnerConsoleWhatsappPage() {
  const [groups, setGroups] = useState<WhatsappRental[]>([]);
  const [status, setStatus] = useState<WhatsappStatus | null>(null);
  const [loading, setLoading] = useState(true);
  // Same split as the other owner pages: only a failed load may blank the
  // rental table. A refused sync reports into `syncError` instead.
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<WhatsappRental | null | undefined>(undefined);
  const [form, setForm] = useState<RentalForm>(emptyForm);
  const [busy, setBusy] = useState("");
  const [copiedPairing, setCopiedPairing] = useState(false);
  const [adjusting, setAdjusting] = useState<WhatsappRental | null>(null);
  const [adjustForm, setAdjustForm] = useState<AdjustmentForm>(emptyAdjustment);
  const [selectedGroup, setSelectedGroup] = useState<WhatsappRental | null>(null);
  const [listHistory, setListHistory] = useState<WhatsappListHistory | null>(null);
  const [listHistoryLoading, setListHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rentals, connection] = await Promise.all([api.whatsappRentals(), api.whatsappStatus()]);
      setGroups(rentals);
      setStatus(connection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "WhatsApp gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);

  function openCreate() {
    setForm(emptyForm());
    setEditing(null);
  }

  function openEdit(row: WhatsappRental) {
    setForm({
      linkGrub: row.linkGrub || "",
      owner: row.owner || "",
      contact: row.contact || "",
      startedAt: dateInputValue(row.startedAt) || new Date().toISOString().slice(0, 10),
      durationMonths: "1",
      status: row.status,
      adjustmentDirection: "add",
      adjustmentUnit: "month",
      adjustmentAmount: "0",
    });
    setEditing(row);
  }

  async function save() {
    const createDays = Number(form.durationMonths || 1) * 30;
    const createEndsAt = addDays(form.startedAt, createDays);
    if (!form.linkGrub.trim() || !form.owner.trim() || !form.contact.trim()) {
      setError("Link grup, nama owner, dan nomor owner wajib diisi.");
      return;
    }
    if (!editing && (!form.startedAt || createDays <= 0)) {
      setError("Tanggal mulai dan durasi sewa wajib diisi.");
      return;
    }

    setBusy("save");
    try {
      if (editing) {
        await api.updateWhatsappRental(editing.id, {
          linkGrub: form.linkGrub,
          owner: form.owner,
          contact: form.contact,
          name: editing.name || "",
          groupJid: editing.groupJid || "",
          monthlyPrice: editing.monthlyPrice || 0,
          status: form.status,
        });
        const delta = adjustmentDays(form);
        if (delta !== 0) {
          await api.adjustWhatsappRental(editing.id, {
            direction: form.adjustmentDirection,
            unit: form.adjustmentUnit,
            amount: Math.abs(Number(form.adjustmentAmount || 0)),
          });
        }
      } else {
        await api.createWhatsappRental({
          linkGrub: form.linkGrub,
          owner: form.owner,
          contact: form.contact,
          startedAt: form.startedAt,
          endsAt: createEndsAt,
          durationMonths: Number(form.durationMonths || 1),
          daysLeft: createDays,
          status: form.status,
        } as Partial<WhatsappRental> & { durationMonths: number; daysLeft: number });
      }
      setEditing(undefined);
      setMessage("Data rental WhatsApp tersimpan.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rental gagal disimpan.");
    } finally {
      setBusy("");
    }
  }

  async function adjust() {
    if (!adjusting || !Number(adjustForm.amount)) return;
    setBusy("adjust");
    try {
      await api.adjustWhatsappRental(adjusting.id, {
        direction: adjustForm.direction,
        unit: adjustForm.unit,
        amount: Math.abs(Number(adjustForm.amount || 0)),
      });
      setAdjusting(null);
      setMessage("Durasi rental diperbarui.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Durasi gagal diperbarui.");
    } finally {
      setBusy("");
    }
  }

  async function openListHistory(row: WhatsappRental) {
    setBusy(row.id);
    setSelectedGroup(row);
    setListHistoryLoading(true);
    try {
      setListHistory(await api.whatsappListHistory(row.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Riwayat list gagal dimuat.");
    } finally {
      setBusy("");
      setListHistoryLoading(false);
    }
  }

  async function syncGroups() {
    if (busy) return;
    setSyncError("");
    setBusy("sync");
    try {
      const result = await api.whatsappSyncGroups();
      setMessage(result.message || "Sinkronisasi grup selesai.");
      await load();
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : "Sinkronisasi grup gagal.");
    } finally {
      setBusy("");
    }
  }

  async function copyPairingCode() {
    const code = status?.pairingCode?.trim();
    if (!code || !navigator.clipboard) return;
    await navigator.clipboard.writeText(code);
    setCopiedPairing(true);
    window.setTimeout(() => setCopiedPairing(false), 1800);
  }

  const columns = useMemo<Array<DataColumn<WhatsappRental>>>(() => [
    { id: "group", header: "Grup", value: (row) => `${row.name} ${row.linkGrub || ""}`, sortable: true, cell: (row) => <button type="button" className="console-link-cell-button" onClick={() => openListHistory(row).catch(() => undefined)}><span className="console-product-cell"><strong>{row.name}</strong><small>{row.linkGrub || "Link belum tersedia"}</small></span></button> },
    { id: "owner", header: "Owner", value: (row) => `${row.owner || ""} ${row.contact || ""}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.owner || "-"}</strong><small>{row.contact || "Nomor belum diisi"}</small></span> },
    { id: "period", header: "Periode", value: (row) => `${row.startedAt || ""} ${row.endsAt || ""}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{formatCalendarDate(row.startedAt)}</strong><small>sampai {formatCalendarDate(row.endsAt)}</small></span> },
    { id: "status", header: "Status", value: (row) => row.status, sortable: true, cell: (row) => <Badge tone={row.status === "active" ? "success" : row.status === "expired" ? "danger" : "warning"}>{row.status}</Badge> },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" disabled={busy === row.id} onClick={() => openListHistory(row).catch(() => undefined)} aria-label={`Riwayat list ${row.name}`}><History size={14} /></button><button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${row.name}`}><Edit3 size={14} /></button><button type="button" onClick={() => { setAdjusting(row); setAdjustForm(emptyAdjustment()); }} aria-label={`Tambah durasi ${row.name}`}><CalendarPlus size={14} /></button>{row.linkGrub ? <a href={row.linkGrub} target="_blank" rel="noreferrer" aria-label={`Buka grup ${row.name}`}><Link2 size={14} /></a> : null}</div> },
  ], [busy]);
  // The bot is either connected or it is not, so the count is 0 or 1 -- but
  // only once a response has arrived. Before that `status` is null and the
  // honest answer is "not measured", which `systemStateFor` renders as a
  // loading state rather than as one disconnection.
  const connectionIssues = status ? (status.connected ? 0 : 1) : 0;
  const filters = useMemo<Array<DataFilter<WhatsappRental>>>(() => [{ id: "status", label: "Status", options: ["active", "paused", "expired"].map((value) => ({ label: value, value })), value: (row) => row.status }], []);
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
  const createDays = Number(form.durationMonths || 1) * 30;
  const createEndsAt = addDays(form.startedAt, createDays);
  const editDelta = adjustmentDays(form);
  const editPreviewEndsAt = editing && editDelta ? addDays(editing.endsAt, editDelta) : "";
  const modalDelta = adjustmentDays(adjustForm);
  const modalPreviewEndsAt = adjusting && modalDelta ? addDays(adjusting.endsAt, modalDelta) : "";

  return <ConsoleShell title="WhatsApp" description="Kelola koneksi bot dan rental grup aktif." refreshing={loading} attentionCount={connectionIssues} systemState={systemStateFor(connectionIssues, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[{ label: "Koneksi", value: status?.connected ? "Connected" : "Periksa", tone: status?.connected ? "success" : "warning" }, { label: "Rental aktif", value: groups.filter((row) => row.status === "active").length }, { label: "Grup di bot", value: groupSyncCount, hint: groupSyncedAt ? `Sync ${formatDateTime(groupSyncedAt)}` : "Belum pernah sync", error: groupSyncState === "failed" ? "Sync terakhir gagal" : undefined }, { label: "Expired", value: groups.filter((row) => row.status === "expired").length, tone: "danger" }, { label: "Total list", value: groups.reduce((sum, row) => sum + Number(row.listCount || 0), 0) }]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}{syncError ? <Notice tone="danger">{syncError}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    {/*
      * The rental table only lists groups the owner has sold. The bot knows
      * every group it is in, including ones nobody has bought, and that gap is
      * the thing the owner cannot otherwise see -- a group the bot has left
      * never appears in the table at all. So the bot's own count is shown
      * here beside the rental count instead of being merged into one number.
      */}
    <section className="console-panel console-whatsapp-sync-panel"><div className="console-panel-header"><div><span>Direktori bot</span><h2>Sinkronisasi grup</h2></div><Badge tone={groupSyncState === "ok" ? "success" : groupSyncState === "failed" ? "danger" : "muted"}>{groupSyncState === "ok" ? "Terbaru" : groupSyncState === "failed" ? "Gagal" : "Belum sync"}</Badge></div><div className="console-whatsapp-sync-body"><div className="console-whatsapp-sync-facts"><span><small>Grup di bot</small><strong>{status ? groupSyncCount : "Memuat"}</strong></span><span><small>Sync terakhir</small><strong>{groupSyncedAt ? formatDateTime(groupSyncedAt) : "Belum pernah"}</strong></span><span><small>Grup disewa</small><strong>{groups.length}</strong></span></div><p>{groupSyncState === "failed" ? groupSyncFailureText(groupSyncError) : groupSyncState === "never" ? "Bot belum pernah mengirim daftar grup. Jalankan sinkronisasi untuk mengisi nama dan JID setiap grup yang diikuti bot." : "Nama dan JID di tabel rental berasal dari daftar yang dikirim bot, bukan dari link yang diisi owner."}</p><div className="console-whatsapp-sync-actions"><button type="button" onClick={() => syncGroups().catch(() => undefined)} disabled={busy === "sync"} aria-busy={busy === "sync"}><RefreshCw size={15} /> {busy === "sync" ? "Menyinkronkan..." : "Sinkron sekarang"}</button></div></div></section>
    {showConnectionPanel ? <section className="console-panel console-whatsapp-pairing-panel"><div className="console-panel-header"><div><span>Koneksi bot</span><h2>{pairingCode ? "Pairing code tersedia" : status?.qrAvailable ? "QR WhatsApp tersedia" : "Pairing code belum terbaca"}</h2></div><Badge tone="warning">{status?.state || "periksa"}</Badge></div><div className="console-whatsapp-pairing-body"><KeyRound size={20} /><div><p>{pairingCode ? "Masukkan kode ini di WhatsApp: Perangkat tertaut -> Tautkan dengan nomor telepon." : status?.qrAvailable ? "Buka halaman pairing WhatsApp untuk melihat QR terbaru dari bot." : `Status bot: ${connectionDetail}. Hapus folder bailey auth lalu restart untuk meminta kode baru.`}</p>{pairingCode ? <strong className="console-whatsapp-pairing-code">{pairingCode}</strong> : null}</div><div className="console-whatsapp-pairing-actions">{pairingCode ? <button type="button" onClick={() => copyPairingCode().catch(() => undefined)}><span>{copiedPairing ? <Check size={15} /> : <Copy size={15} />}</span>{copiedPairing ? "Tersalin" : "Salin kode"}</button> : null}{status?.publicQrUrl ? <a href={status.publicQrUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Buka pairing</a> : null}<button type="button" onClick={() => load().catch(() => undefined)}><RefreshCw size={15} /> Refresh</button></div></div></section> : null}
    <section className="console-panel"><div className="console-panel-header"><div><span>Operasional</span><h2>Rental grup</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={openCreate}><Plus size={15} /> Tambah rental</button></div></div><DataTable rows={groups} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} initialPageSize={10} /></section>
    {selectedGroup ? <section className="console-panel console-whatsapp-list-history"><div className="console-panel-header"><div><span>Riwayat perubahan list</span><h2>{selectedGroup.name}</h2></div><div className="console-panel-toolbar-actions"><button type="button" disabled={listHistoryLoading} onClick={() => openListHistory(selectedGroup).catch(() => undefined)}><RefreshCw size={15} /> Refresh riwayat</button></div></div>{listHistoryLoading ? <div className="ui-table-state">Memuat riwayat list...</div> : listHistory?.items.length ? <div className="console-list-history-grid">{listHistory.items.map((item) => <article key={item.id} className="console-list-history-card"><div><strong>{item.keyword}</strong><Badge tone={item.source === "audit" ? "success" : "muted"}>{item.action}</Badge></div><p>{item.textPreview || "Isi list tidak memiliki preview teks."}</p><small>{item.senderName || item.sender || (item.source === "snapshot" ? "Snapshot list terakhir" : "Admin tidak tercatat")} / {formatDateTime(item.updatedAt)}{item.media ? " / ada media" : ""}</small></article>)}</div> : <div className="ui-table-state">Belum ada riwayat perubahan list untuk grup ini.</div>}</section> : null}
    {editing !== undefined ? <Dialog open title={editing ? "Edit rental" : "Tambah rental"} eyebrow="WhatsApp" onClose={() => setEditing(undefined)} footer={<DialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel="Simpan rental" busy={busy === "save"} />}>
      <div className="console-resource-form-grid">
        <Field label="Link grup"><input type="url" value={form.linkGrub} onChange={(event) => setForm({ ...form, linkGrub: event.target.value })} placeholder="https://chat.whatsapp.com/..." /></Field>
        <Field label="Nama owner"><input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} /></Field>
        <Field label="Nomor owner"><input inputMode="tel" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} /></Field>
        {!editing ? <>
          <Field label="Mulai"><input type="date" value={form.startedAt} onChange={(event) => setForm({ ...form, startedAt: event.target.value })} /></Field>
          <Field label="Durasi"><select value={form.durationMonths} onChange={(event) => setForm({ ...form, durationMonths: event.target.value })}>{monthOptions.map((value) => <option key={value} value={value}>{value} bulan</option>)}</select></Field>
          <Field label="Berakhir"><div className="console-readonly-field">{formatCalendarDate(createEndsAt)} <small>{createDays} hari</small></div></Field>
        </> : <>
          <Field label="Mulai"><div className="console-readonly-field">{formatCalendarDate(editing.startedAt)}</div></Field>
          <Field label="Berakhir saat ini"><div className="console-readonly-field">{formatCalendarDate(editing.endsAt)}</div></Field>
          <Field label="Aksi durasi"><select value={form.adjustmentDirection} onChange={(event) => setForm({ ...form, adjustmentDirection: event.target.value as RentalForm["adjustmentDirection"] })}><option value="add">Tambah</option><option value="subtract">Kurangi</option></select></Field>
          <Field label="Satuan"><select value={form.adjustmentUnit} onChange={(event) => setForm({ ...form, adjustmentUnit: event.target.value as RentalForm["adjustmentUnit"] })}><option value="month">Bulan (30 hari)</option><option value="day">Hari</option></select></Field>
          <Field label="Jumlah"><input type="number" min="0" max={form.adjustmentUnit === "month" ? 12 : 30} value={form.adjustmentAmount} onChange={(event) => setForm({ ...form, adjustmentAmount: event.target.value })} /></Field>
          <Field label="Berakhir baru"><div className="console-readonly-field">{editPreviewEndsAt ? formatCalendarDate(editPreviewEndsAt) : formatCalendarDate(editing.endsAt)}</div></Field>
        </>}
        <Field label="Status"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as WhatsappRental["status"] })}><option value="active">Aktif</option><option value="paused">Dijeda</option><option value="expired">Berakhir</option></select></Field>
      </div>
      <Notice>Nama grup dan Group JID diambil otomatis setelah bot bergabung melalui link.</Notice>
    </Dialog> : null}
    {adjusting ? <Dialog open title="Atur durasi rental" eyebrow={adjusting.name} onClose={() => setAdjusting(null)} footer={<DialogActions onCancel={() => setAdjusting(null)} onConfirm={adjust} confirmLabel="Simpan durasi" busy={busy === "adjust"} />}>
      <div className="console-resource-form-grid">
        <Field label="Berakhir saat ini"><div className="console-readonly-field">{formatCalendarDate(adjusting.endsAt)}</div></Field>
        <Field label="Aksi"><select value={adjustForm.direction} onChange={(event) => setAdjustForm({ ...adjustForm, direction: event.target.value as AdjustmentForm["direction"] })}><option value="add">Tambah</option><option value="subtract">Kurangi</option></select></Field>
        <Field label="Satuan"><select value={adjustForm.unit} onChange={(event) => setAdjustForm({ ...adjustForm, unit: event.target.value as AdjustmentForm["unit"] })}><option value="month">Bulan (30 hari)</option><option value="day">Hari</option></select></Field>
        <Field label="Jumlah"><input type="number" min="1" max={adjustForm.unit === "month" ? 12 : 30} value={adjustForm.amount} onChange={(event) => setAdjustForm({ ...adjustForm, amount: event.target.value })} /></Field>
        <Field label="Berakhir baru"><div className="console-readonly-field">{modalPreviewEndsAt ? formatCalendarDate(modalPreviewEndsAt) : formatCalendarDate(adjusting.endsAt)}</div></Field>
      </div>
    </Dialog> : null}
  </ConsoleShell>;
}
