import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Edit3, Eye, EyeOff, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type AccountAccessLookupType, type ApiDepositRequest, type ApiReseller } from "../../../lib/api";
import { formatDateTimeFull, formatRupiah } from "../../../lib/format";
import { Badge, DetailRow, Dialog, DialogActions, Field, MetricRow, Notice, Toast } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

type ResellerForm = { name: string; username: string; password: string; email: string; whatsapp: string; deposit: string; isActive: boolean; allowedAccessTools: AccountAccessLookupType[] };
type ResellerAction = { type: "delete"; reseller: ApiReseller } | { type: "approve" | "reject"; request: ApiDepositRequest } | null;
const tools: Array<{ value: AccountAccessLookupType; label: string }> = [{ value: "signin", label: "Sign-in code" }, { value: "verification", label: "Verification code" }, { value: "household", label: "Household" }, { value: "reset", label: "Reset password" }];
const emptyForm = (): ResellerForm => ({ name: "", username: "", password: "", email: "", whatsapp: "", deposit: "0", isActive: true, allowedAccessTools: ["signin", "verification", "household"] });

/*
 * Field validation.
 *
 * These run before the request, because the API does not reject a bad value --
 * it stores it. A reseller created with the name " " or a WhatsApp field
 * holding a customer's name is not a row anyone can use afterwards, and the
 * only place that surfaces is a failed WhatsApp send days later.
 *
 * `EMAIL` and `WHATSAPP` are shape checks, not full validation: they catch the
 * two mistakes that actually happen -- pasting a name into the phone field, and
 * a half-typed address -- without rejecting the international formats this
 * business legitimately uses.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits, spaces and the punctuation people write phone numbers with.
const WHATSAPP = /^[0-9+][0-9\s().-]{7,19}$/;

function validateForm(form: ResellerForm, isEditing: boolean): string[] {
  const problems: string[] = [];
  if (!form.name.trim()) problems.push("Nama wajib diisi.");
  if (!form.username.trim()) problems.push("Username wajib diisi.");
  if (!form.whatsapp.trim()) problems.push("Nomor WhatsApp wajib diisi.");
  else if (!WHATSAPP.test(form.whatsapp.trim())) {
    problems.push("Nomor WhatsApp belum benar. Gunakan 8-20 digit, boleh diawali +62.");
  }
  if (form.email.trim() && !EMAIL.test(form.email.trim())) {
    problems.push("Format email belum benar.");
  }
  // Only on create. On edit an empty password means "leave it alone", which is
  // what the field's own label says.
  if (!isEditing && !form.password.trim()) {
    problems.push("Password wajib diisi untuk akun baru.");
  }
  const deposit = Number(form.deposit);
  if (!Number.isFinite(deposit)) problems.push("Saldo harus berupa angka.");
  else if (deposit < 0) {
    // A negative balance is not a debt the system tracks; it is a typo that
    // becomes someone's real money the moment this row is summed into the
    // "Total saldo" tile above.
    problems.push("Saldo tidak boleh minus. Kurangi saldo lewat penyesuaian, bukan lewat angka negatif.");
  }
  return problems;
}

export default function OwnerConsoleResellersPage() {
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [requests, setRequests] = useState<ApiDepositRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestsError, setRequestsError] = useState("");
  const [databaseLoss, setDatabaseLoss] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ApiReseller | null | undefined>(undefined);
  const [form, setForm] = useState<ResellerForm>(emptyForm);
  const [action, setAction] = useState<ResellerAction>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /*
   * Form failures belong to the form.
   *
   * `save` and `executeAction` both used to report into the page-level
   * `error`, which is wired to *both* DataTables as their `error` prop. A typo
   * in a reseller's WhatsApp number therefore replaced the entire reseller
   * table with "Data reseller gagal dimuat" -- the owner lost the list they were
   * looking at because a field in a dialog did not validate, and the message
   * named a data problem that had not happened.
   *
   * These two are dialog-local for the same reason `Dialog` keeps its own
   * `busy`: the thing that failed is inside the overlay, and the reader has to
   * be looking at it.
   */
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const clearMessage = useCallback(() => setMessage(""), []);
  /*
   * Each fetch records its own failure.
   *
   * The deposit-requests fetch used to have no `else`, so a rejection left
   * `requests` at its initial `[]` -- which the second table renders as
   * "Tidak ada permintaan deposit yang perlu diproses." A green answer to a
   * question about money. The owner was told the queue was clear when it had
   * never been read.
   *
   * Two states, two messages, because they mean opposite things: an empty queue
   * is good news, and an unread queue is not.
   */
  /*
   * A lost database must not look like an empty one.
   *
   * `store.js` answers a missing `kavya-db.json` with `defaultData`, so a total
   * loss produces this exact page: products intact, login working, reseller
   * table empty, zero errors. Nothing below the table can tell that apart from
   * an owner who simply has no reseller yet, which is why the server decides
   * (see `services/data-loss-detector.js`) and this page only renders its
   * verdict. Deriving it here would mean guessing from `resellers.length === 0`,
   * which fires on every fresh install and trains the owner to ignore it.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setRequestsError("");
    const results = await Promise.allSettled([api.resellers(), api.depositRequests(), api.health()]);
    if (results[0].status === "fulfilled") setResellers(results[0].value);
    else setError("Data reseller gagal dimuat.");
    if (results[1].status === "fulfilled") { setRequests(results[1].value); setRequestsError(""); }
    else setRequestsError("Permintaan deposit gagal dimuat. Antrean di bawah belum bisa dipercaya.");
    if (results[2].status === "fulfilled") setDatabaseLoss(results[2].value.databaseLossMessage || "");
    setLoading(false);
  }, []);
  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);
  function openCreate() { setEditing(null); setForm(emptyForm()); setFormError(""); setShowPassword(false); }
  function openEdit(row: ApiReseller) { setEditing(row); setForm({ name: row.name, username: row.username, password: "", email: row.email || "", whatsapp: row.whatsapp, deposit: String(row.deposit || 0), isActive: row.isActive, allowedAccessTools: (row.allowedAccessTools || ["signin", "verification", "household"]) as AccountAccessLookupType[] }); setFormError(""); setShowPassword(false); }

  async function save() {
    // Trimmed once, here, so a stray space cannot reach the database as part of
    // a username that then has to be typed with that space forever.
    const clean: ResellerForm = {
      ...form,
      name: form.name.trim(),
      username: form.username.trim(),
      whatsapp: form.whatsapp.trim(),
      email: form.email.trim(),
      password: form.password,
    };
    const problems = validateForm(clean, Boolean(editing));
    if (problems.length) {
      setFormError(problems.join(" "));
      return;
    }
    // Warn, do not block. Somebody reconciling a spreadsheet genuinely needs to
    // set the balance by hand -- what must not happen is doing it by accident,
    // so the dialog says which field is about to be overwritten while it is
    // still open.
    const deposit = Number(clean.deposit || 0);
    const depositChanged = editing ? deposit !== Number(editing.deposit || 0) : false;
    setBusy(true);
    setFormError("");
    try {
      const payload: Partial<ApiReseller> = {
        name: clean.name,
        username: clean.username,
        email: clean.email,
        whatsapp: clean.whatsapp,
        deposit,
        isActive: clean.isActive,
        allowedAccessTools: clean.allowedAccessTools as ApiReseller["allowedAccessTools"],
      };
      if (clean.password) payload.password = clean.password;
      editing
        ? await api.updateReseller(editing.id, payload)
        : await api.createReseller(payload);
      setEditing(undefined);
      setShowPassword(false);
      setMessage(
        depositChanged
          ? `Data reseller disimpan, dan saldo diubah manual dari ${formatRupiah(Number(editing?.deposit || 0))} menjadi ${formatRupiah(deposit)}.`
          : "Data reseller berhasil disimpan.",
      );
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Reseller gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }
  async function executeAction() {
    if (!action) return;
    setBusy(true);
    setActionError("");
    try {
      let archived = true;
      if (action.type === "delete") await api.deleteReseller(action.reseller.id);
      if (action.type === "approve") { await api.approveDepositRequest(action.request.id, note.trim() ? { note: note.trim() } : undefined); try { await api.archiveDepositRequests([action.request.id]); } catch { archived = false; } }
      if (action.type === "reject") { await api.rejectDepositRequest(action.request.id, note.trim() ? { note: note.trim() } : undefined); try { await api.archiveDepositRequests([action.request.id]); } catch { archived = false; } }
      const actionType = action.type;
      setAction(null);
      setNote("");
      setActionError("");
      setMessage(actionType === "delete" ? "Data reseller berhasil dihapus." : archived ? "Permintaan deposit selesai diproses dan dipindahkan dari antrean aktif." : "Permintaan deposit selesai diproses. Riwayat tetap tersimpan, tetapi arsip otomatis perlu dicoba lagi.");
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Tindakan reseller gagal.");
    } finally {
      setBusy(false);
    }
  }
  function requestAction(next: NonNullable<ResellerAction>) {
    setAction(next);
    setActionError("");
    setNote("");
  }
  async function syncResellerSheets() { if (busy) return; setBusy(true); setError(""); setMessage(""); try { const result = await api.syncGoogleSheetsResellers(); setMessage(`${result.checked} reseller diperiksa: ${result.added} ditambahkan, ${result.updated} diperbarui, ${result.skippedCount} dilewati, ${result.conflicts} konflik.`); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Data reseller gagal disinkronkan ke Google Sheets."); } finally { setBusy(false); } }
  const columns = useMemo<Array<DataColumn<ApiReseller>>>(() => [
    { id: "reseller", header: "Reseller", value: (row) => `${row.name} ${row.username}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.name}</strong><small>@{row.username} / {row.whatsapp}</small></span> },
    { id: "status", header: "Status", value: (row) => row.isActive ? "Aktif" : "Nonaktif", sortable: true, cell: (row) => <Badge tone={row.isActive ? "success" : "danger"}>{row.isActive ? "Aktif" : "Nonaktif"}</Badge> },
    { id: "deposit", header: "Saldo", value: (row) => Number(row.deposit || 0), sortable: true, cell: (row) => formatRupiah(Number(row.deposit || 0)) },
    { id: "orders", header: "Order", value: (row) => row.orders || 0, sortable: true },
    { id: "access", header: "Akses", value: (row) => row.allowedAccessTools?.length || 0, hideOnMobile: true, cell: (row) => `${row.allowedAccessTools?.length || 0} tools` },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${row.username}`}><Edit3 size={14} /></button><button type="button" onClick={() => requestAction({ type: "delete", reseller: row })} aria-label={`Hapus ${row.username}`}><Trash2 size={14} /></button></div> },
  ], []);
  const filters = useMemo<Array<DataFilter<ApiReseller>>>(() => [{ id: "status", label: "Status", options: [{ label: "Aktif", value: "active" }, { label: "Nonaktif", value: "inactive" }], value: (row) => row.isActive ? "active" : "inactive" }], []);
  const requestColumns = useMemo<Array<DataColumn<ApiDepositRequest>>>(() => [
    { id: "reseller", header: "Reseller", value: (row) => row.resellerName, sortable: true },
    { id: "amount", header: "Nominal", value: (row) => row.amount, sortable: true, cell: (row) => formatRupiah(row.amount) },
    { id: "method", header: "Metode", value: (row) => row.method },
    { id: "status", header: "Status", value: (row) => row.status || "pending", cell: (row) => <Badge tone={row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "warning"}>{row.status || "pending"}</Badge> },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => row.status === "pending" || !row.status ? <div className="console-row-actions"><button type="button" onClick={() => requestAction({ type: "approve", request: row })} aria-label={`Setujui deposit ${row.resellerName}`}><Check size={14} /></button><button type="button" onClick={() => requestAction({ type: "reject", request: row })} aria-label={`Tolak deposit ${row.resellerName}`}><X size={14} /></button></div> : <span /> },
  ], []);
  const pending = requests.filter((row) => !row.status || row.status === "pending");
  const pendingCount = pending.length;
  /*
   * A detected database loss counts toward the attention badge, not just the
   * inline banner. The owner lands on this page first and the badge is what
   * they read on the way in -- a red banner they have to scroll to find would
   * lose the one signal that the data behind it is already gone.
   */
  const attentionCount = pendingCount + (databaseLoss ? 1 : 0);
  return <ConsoleShell title="Reseller" description="Kelola akses, saldo, status, dan permintaan deposit reseller." refreshing={loading} attentionCount={attentionCount} systemState={systemStateFor(attentionCount, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[{ label: "Reseller aktif", value: resellers.filter((row) => row.isActive).length, tone: "success" }, { label: "Nonaktif", value: resellers.filter((row) => !row.isActive).length }, { label: "Total saldo", value: formatRupiah(resellers.reduce((sum, row) => sum + Number(row.deposit || 0), 0)) }, { label: "Deposit pending", value: pending.length, tone: pending.length ? "warning" : "success", error: requestsError ? "Gagal dimuat" : undefined }]} />
    {databaseLoss ? <Notice tone="danger">{databaseLoss}</Notice> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}<Toast message={message} onClose={clearMessage} />
    <section className="console-panel"><div className="console-panel-header"><div><span>Pelanggan</span><h2>Data reseller</h2></div><div className="console-panel-toolbar-actions"><button type="button" disabled={busy} onClick={syncResellerSheets}><RefreshCw size={15} /> Sinkronkan Data Reseller</button><button type="button" onClick={openCreate}><Plus size={15} /> Tambah reseller</button></div></div><DataTable rows={resellers} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} initialPageSize={10} /></section>
    <section className="console-panel console-orders-panel"><div className="console-panel-header"><div><span>Wallet</span><h2>Permintaan deposit aktif</h2></div><ShieldCheck size={18} /></div><DataTable rows={pending} columns={requestColumns} rowKey={(row) => row.id} loading={loading} error={requestsError} emptyText="Tidak ada permintaan deposit yang perlu diproses." initialPageSize={5} /></section>
    {editing !== undefined ? <Dialog open title={editing ? "Edit reseller" : "Tambah reseller"} eyebrow="Pelanggan" onClose={() => setEditing(undefined)} wide busy={busy} footer={<DialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel={editing ? "Simpan perubahan" : "Simpan reseller"} busy={busy} />}><div className="console-resource-form-grid"><Field label="Nama"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label={editing ? "Username (kunci Sheets)" : "Username"}><input value={form.username} readOnly={Boolean(editing)} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field><Field label={editing ? "Password baru (opsional)" : "Password"} hint={editing ? "Kosongkan bila password tidak diubah." : "Minimal 8 karakter."}>
        <div className="console-secret-field">
          <input type={showPassword ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
        </div>
      </Field><Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="WhatsApp"><input type="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field><Field label="Saldo" hint={editing ? "Mengubah saldo di sini menulis langsung ke saldo reseller." : undefined}>
        <input type="number" min={0} value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} />
      </Field><Field label="Status"><select value={form.isActive ? "active" : "inactive"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></Field><Field label="Permission akses"><div className="ui-checkbox-stack">{tools.map((tool) => <label key={tool.value}><input type="checkbox" checked={form.allowedAccessTools.includes(tool.value)} onChange={(e) => setForm({ ...form, allowedAccessTools: e.target.checked ? [...form.allowedAccessTools, tool.value] : form.allowedAccessTools.filter((value) => value !== tool.value) })} /> {tool.label}</label>)}</div></Field></div>
      {editing && Number(form.deposit || 0) !== Number(editing.deposit || 0) ? (
        <Notice tone="warning">
          Saldo akan diubah dari {formatRupiah(Number(editing.deposit || 0))} menjadi {formatRupiah(Number(form.deposit || 0))} tanpa lewat permintaan deposit.
        </Notice>
      ) : null}
      {form.password ? <Notice tone="info">Simpan kredensial ini sekarang: setelah reseller masuk, password tidak pernah ditampilkan lagi di halaman ini.</Notice> : null}
      {formError ? <Notice tone="danger">{formError}</Notice> : null}</Dialog> : null}
    {action ? <Dialog open title={action.type === "delete" ? "Hapus reseller" : action.type === "approve" ? "Setujui deposit" : "Tolak deposit"} eyebrow="Konfirmasi" onClose={() => setAction(null)} busy={busy} footer={<DialogActions onCancel={() => setAction(null)} onConfirm={executeAction} confirmLabel={action.type === "delete" ? "Hapus reseller" : action.type === "approve" ? "Setujui deposit" : "Tolak deposit"} busy={busy} danger={action.type === "delete" || action.type === "reject"} />}>
      {action.type === "delete" ? (
        <>
          {/* Who, and how much money leaves with them.
              This used to say only that the reseller "akan dihapus melalui
              endpoint owner" -- an instruction to the reader, not a statement of
              what they are about to do, and jargon from the API layer besides. */}
          <dl className="ui-detail-list">
            <DetailRow label="Nama">{action.reseller.name}</DetailRow>
            <DetailRow label="Username">@{action.reseller.username}</DetailRow>
            <DetailRow label="WhatsApp">{action.reseller.whatsapp}</DetailRow>
            <DetailRow label="Saldo tersisa">{formatRupiah(Number(action.reseller.deposit || 0))}</DetailRow>
            <DetailRow label="Pesanan">{action.reseller.orders || 0}</DetailRow>
          </dl>
          <Notice tone="danger">
            Akun ini tidak bisa dipulihkan setelah dihapus. Saldo di atas akan hilang bersama dengannya, dan reseller tidak akan bisa masuk lagi.
          </Notice>
        </>
      ) : (
        <>
          {/* The whole transaction, not a comment box.
              Approving moves real money into a reseller's balance. The dialog
              used to offer a single note textarea with no statement of whose
              money, how much, or which request -- so the confirmation a reseller
              is waiting on could be given to the wrong row. */}
          <dl className="ui-detail-list">
            <DetailRow label="Reseller">{action.request.resellerName}</DetailRow>
            <DetailRow label="Nominal">{formatRupiah(Number(action.request.amount || 0))}</DetailRow>
            <DetailRow label="Metode pembayaran">{action.request.method || "-"}</DetailRow>
            <DetailRow label="Diminta pada">{formatDateTimeFull(action.request.createdAt)}</DetailRow>
            <DetailRow label="ID permintaan">{action.request.id}</DetailRow>
            {action.request.paymentRef ? <DetailRow label="Referensi pembayaran">{action.request.paymentRef}</DetailRow> : null}
          </dl>
          {action.type === "approve" ? (
            <Notice tone="info">
              Saldo {formatRupiah(Number(action.request.amount || 0))} akan ditambahkan ke akun {action.request.resellerName} setelah disimpan.
            </Notice>
          ) : (
            <Notice tone="warning">
              Permintaan ini akan ditolak. Dana {formatRupiah(Number(action.request.amount || 0))} tidak masuk ke saldo reseller.
            </Notice>
          )}
          <Field label="Catatan owner" hint="Tersimpan pada riwayat deposit.">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      )}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
    </Dialog> : null}
  </ConsoleShell>;
}
