import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Edit3, History, Link2, Plus } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type WhatsappListHistory, type WhatsappRental } from "../../../lib/api";
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
};

/*
 * Adding and changing time are two different jobs, and the page used to ask
 * for both in the same form. The edit dialog carried direction, unit and amount
 * next to the name and phone number, and then there was a second dialog doing
 * the same three fields again from the row. So duration could be changed in two
 * places, and the edit form changed it as a side effect of saving something
 * else -- adjust 30 days, retype the owner's number, save, and the two went out
 * as a single update.
 *
 * One place now. The edit form edits what the form is named after; the row's
 * calendar button is the only way duration moves.
 */
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

/**
 * A month is 30 days here, because that is what the plugin's own message says
 * ("*30* artinya 30 hari"). A calendar month would make the number the owner
 * reads disagree with the expiry the customer is told.
 */
function adjustmentDays(form: AdjustmentForm) {
  const amount = Math.max(0, Math.trunc(Number(form.amount || 0)));
  const days = amount * (form.unit === "month" ? 30 : 1);
  return form.direction === "subtract" ? -days : days;
}

/**
 * Rentals: the WhatsApp groups this business has sold the bot into.
 *
 * Split out of `/owner-v2/whatsapp`, which is about the bot's own connection.
 * They were one page because they share an endpoint, not because they share a
 * job -- the owner checks the bot is alive on one, and checks who has paid until
 * when on the other, and neither answer was visible on the page named for it.
 */
export default function OwnerConsoleRentalPage() {
  const [rentals, setRentals] = useState<WhatsappRental[]>([]);
  const [loading, setLoading] = useState(true);
  // Same split as the other owner pages: only a failed load may blank the
  // table. A refused save reports into `formError` instead.
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<WhatsappRental | null | undefined>(undefined);
  const [form, setForm] = useState<RentalForm>(emptyForm);
  const [busy, setBusy] = useState("");
  const [adjusting, setAdjusting] = useState<WhatsappRental | null>(null);
  const [adjustForm, setAdjustForm] = useState<AdjustmentForm>(emptyAdjustment);
  const [selectedGroup, setSelectedGroup] = useState<WhatsappRental | null>(null);
  const [listHistory, setListHistory] = useState<WhatsappListHistory | null>(null);
  const [listHistoryLoading, setListHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRentals(await api.whatsappRentals());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rental gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);

  function openCreate() {
    setFormError("");
    setForm(emptyForm());
    setEditing(null);
  }

  function openEdit(row: WhatsappRental) {
    setFormError("");
    setForm({
      linkGrub: row.linkGrub || "",
      owner: row.owner || "",
      contact: row.contact || "",
      startedAt: dateInputValue(row.startedAt) || new Date().toISOString().slice(0, 10),
      durationMonths: "1",
      status: row.status,
    });
    setEditing(row);
  }

  async function save() {
    const createDays = Number(form.durationMonths || 1) * 30;
    const createEndsAt = addDays(form.startedAt, createDays);
    if (!form.linkGrub.trim() || !form.owner.trim() || !form.contact.trim()) {
      setFormError("Link grup, nama owner, dan nomor owner wajib diisi.");
      return;
    }
    if (!editing && (!form.startedAt || createDays <= 0)) {
      setFormError("Tanggal mulai dan durasi sewa wajib diisi.");
      return;
    }

    setBusy("save");
    setFormError("");
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
      setMessage("Data rental tersimpan.");
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Rental gagal disimpan.");
    } finally {
      setBusy("");
    }
  }

  async function adjust() {
    if (!adjusting || !Number(adjustForm.amount)) return;
    setBusy("adjust");
    setError("");
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

  const columns = useMemo<Array<DataColumn<WhatsappRental>>>(() => [
    { id: "group", header: "Grup", value: (row) => `${row.name} ${row.linkGrub || ""}`, sortable: true, cell: (row) => <button type="button" className="console-link-cell-button" onClick={() => openListHistory(row).catch(() => undefined)}><span className="console-product-cell"><strong>{row.name}</strong><small>{row.linkGrub || "Link belum tersedia"}</small></span></button> },
    { id: "owner", header: "Owner", value: (row) => `${row.owner || ""} ${row.contact || ""}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.owner || "-"}</strong><small>{row.contact || "Nomor belum diisi"}</small></span> },
    { id: "period", header: "Periode", value: (row) => `${row.startedAt || ""} ${row.endsAt || ""}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{formatCalendarDate(row.startedAt)}</strong><small>sampai {formatCalendarDate(row.endsAt)}</small></span> },
    { id: "remaining", header: "Sisa", value: (row) => Number(row.daysLeft || 0), sortable: true, cell: (row) => { const days = Number(row.daysLeft || 0); return days > 0 ? <Badge tone={days <= 5 ? "warning" : "muted"}>{days} hari</Badge> : <Badge tone="danger">Habis</Badge>; } },
    { id: "status", header: "Status", value: (row) => row.status, sortable: true, cell: (row) => <Badge tone={row.status === "active" ? "success" : row.status === "expired" ? "danger" : "warning"}>{row.status}</Badge> },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" disabled={busy === row.id} onClick={() => openListHistory(row).catch(() => undefined)} aria-label={`Riwayat list ${row.name}`} title="Riwayat list"><History size={14} /></button><button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${row.name}`} title="Edit"><Edit3 size={14} /></button><button type="button" onClick={() => { setAdjusting(row); setAdjustForm(emptyAdjustment()); }} aria-label={`Atur durasi ${row.name}`} title="Atur durasi"><CalendarPlus size={14} /></button>{row.linkGrub ? <a href={row.linkGrub} target="_blank" rel="noreferrer" aria-label={`Buka grup ${row.name}`} title="Buka di WhatsApp"><Link2 size={14} /></a> : null}</div> },
  ], [busy]);

  const filters = useMemo<Array<DataFilter<WhatsappRental>>>(() => [{ id: "status", label: "Status", options: ["active", "paused", "expired"].map((value) => ({ label: value, value })), value: (row) => row.status }], []);

  /*
   * Two numbers off one list, and the second is the one that used to be dead.
   * `GET /api/whatsapp/rentals` now returns ended rentals too -- it did not,
   * which is why Expired could only ever read zero.
   */
  const activeCount = rentals.filter((row) => row.status === "active").length;
  const expiredCount = rentals.filter((row) => row.status === "expired" || Number(row.daysLeft || 0) <= 0).length;
  const endingSoonCount = rentals.filter((row) => {
    const days = Number(row.daysLeft || 0);
    return days > 0 && days <= 5 && row.status === "active";
  }).length;

  const createDays = Number(form.durationMonths || 1) * 30;
  const createEndsAt = addDays(form.startedAt, createDays);
  const modalDelta = adjustmentDays(adjustForm);
  const modalPreviewEndsAt = adjusting && modalDelta ? addDays(adjusting.endsAt, modalDelta) : "";

  return <ConsoleShell title="Rental" description="Grup WhatsApp yang disewa, sampai kapan, dan siapa pemiliknya." refreshing={loading} attentionCount={expiredCount} systemState={systemStateFor(expiredCount, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[
      { label: "Aktif", value: activeCount, tone: "success" },
      { label: "Habis ≤ 5 hari", value: endingSoonCount, tone: endingSoonCount ? "warning" : "muted" },
      { label: "Expired", value: expiredCount, tone: expiredCount ? "danger" : "muted" },
      { label: "Total list", value: rentals.reduce((sum, row) => sum + Number(row.listCount || 0), 0), hint: "Jumlah anggota di semua grup yang disewa" },
    ]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}

    <section className="console-panel">
      <div className="console-panel-header"><div><span>Operasional</span><h2>Daftar rental</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={openCreate}><Plus size={15} /> Tambah rental</button></div></div>
      <DataTable rows={rentals} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} emptyText="Belum ada grup yang disewa." initialPageSize={10} />
    </section>

    {selectedGroup ? <section className="console-panel console-whatsapp-list-history"><div className="console-panel-header"><div><span>Riwayat perubahan list</span><h2>{selectedGroup.name}</h2></div><div className="console-panel-toolbar-actions"><button type="button" disabled={listHistoryLoading} onClick={() => openListHistory(selectedGroup).catch(() => undefined)}>Muat ulang riwayat</button></div></div>{listHistoryLoading ? <div className="ui-table-state">Memuat riwayat list...</div> : listHistory?.items.length ? <div className="console-list-history-grid">{listHistory.items.map((item) => <article key={item.id} className="console-list-history-card"><div><strong>{item.keyword}</strong><Badge tone={item.source === "audit" ? "success" : "muted"}>{item.action}</Badge></div><p>{item.textPreview || "Isi list tidak memiliki preview teks."}</p><small>{item.senderName || item.sender || (item.source === "snapshot" ? "Snapshot list terakhir" : "Admin tidak tercatat")} / {formatDateTime(item.updatedAt)}{item.media ? " / ada media" : ""}</small></article>)}</div> : <div className="ui-table-state">Belum ada riwayat perubahan list untuk grup ini.</div>}</section> : null}

    {editing !== undefined ? <Dialog open title={editing ? "Edit rental" : "Tambah rental"} eyebrow="Rental bot WhatsApp" onClose={() => setEditing(undefined)} footer={<DialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel="Simpan rental" busy={busy === "save"} />}>
      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      <div className="console-resource-form-grid">
        <Field label="Link grup"><input type="url" value={form.linkGrub} onChange={(event) => setForm({ ...form, linkGrub: event.target.value })} placeholder="https://chat.whatsapp.com/..." /></Field>
        <Field label="Nama owner"><input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} /></Field>
        <Field label="Nomor owner"><input inputMode="tel" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} /></Field>
        {editing ? <>
          <Field label="Mulai"><div className="console-readonly-field">{formatCalendarDate(editing.startedAt)}</div></Field>
          <Field label="Berakhir"><div className="console-readonly-field">{formatCalendarDate(editing.endsAt)}</div></Field>
        </> : <>
          <Field label="Mulai"><input type="date" value={form.startedAt} onChange={(event) => setForm({ ...form, startedAt: event.target.value })} /></Field>
          <Field label="Durasi"><select value={form.durationMonths} onChange={(event) => setForm({ ...form, durationMonths: event.target.value })}>{monthOptions.map((value) => <option key={value} value={value}>{value} bulan</option>)}</select></Field>
          <Field label="Berakhir"><div className="console-readonly-field">{formatCalendarDate(createEndsAt)} <small>{createDays} hari</small></div></Field>
        </>}
        <Field label="Status"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as WhatsappRental["status"] })}><option value="active">Aktif</option><option value="paused">Dijeda</option><option value="expired">Berakhir</option></select></Field>
      </div>
      {editing ? <Notice>Durasi tidak diubah dari sini. Pakai tombol kalender di baris rental untuk menambah atau mengurangi waktu sewa.</Notice> : <Notice>Nama grup dan Group JID diambil otomatis setelah bot bergabung melalui link.</Notice>}
    </Dialog> : null}

    {adjusting ? <Dialog open title="Atur durasi rental" eyebrow={adjusting.name} onClose={() => setAdjusting(null)} footer={<DialogActions onCancel={() => setAdjusting(null)} onConfirm={adjust} confirmLabel="Simpan durasi" busy={busy === "adjust"} />}>
      <div className="console-resource-form-grid">
        <Field label="Berakhir saat ini"><div className="console-readonly-field">{formatCalendarDate(adjusting.endsAt)}</div></Field>
        <Field label="Aksi"><select value={adjustForm.direction} onChange={(event) => setAdjustForm({ ...adjustForm, direction: event.target.value as AdjustmentForm["direction"] })}><option value="add">Tambah</option><option value="subtract">Kurangi</option></select></Field>
        <Field label="Satuan"><select value={adjustForm.unit} onChange={(event) => setAdjustForm({ ...adjustForm, unit: event.target.value as AdjustmentForm["unit"] })}><option value="month">Bulan (30 hari)</option><option value="day">Hari</option></select></Field>
        <Field label="Jumlah"><input type="number" min="1" max={adjustForm.unit === "month" ? 12 : 30} value={adjustForm.amount} onChange={(event) => setAdjustForm({ ...adjustForm, amount: event.target.value })} /></Field>
        <Field label="Berakhir baru"><div className="console-readonly-field">{modalPreviewEndsAt ? formatCalendarDate(modalPreviewEndsAt) : formatCalendarDate(adjusting.endsAt)}</div></Field>
      </div>
      {modalDelta < 0 ? <Notice tone="danger">Mengurangi waktu bisa membuat masa sewa habis hari ini juga. Bot akan keluar dari grup begitu waktunya habis.</Notice> : null}
    </Dialog> : null}
  </ConsoleShell>;
}