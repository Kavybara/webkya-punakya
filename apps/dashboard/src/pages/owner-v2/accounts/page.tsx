import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Edit3, Eye, EyeOff, KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type AccountAuditResult, type AccountCredentials, type ApiAccount, type ApiReseller } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { accountStatus } from "../../../lib/labels";
import { Badge, Dialog, DialogActions, Field, MetricRow, Notice } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

type AccountForm = { stockId: string; product: string; variant: string; email: string; buyer: string; resellerId: string; reseller: string; whatsapp: string; profile: string; device: string; startedAt: string; expiresAt: string; duration: string; status: ApiAccount["status"] };
type AccountAction = { type: "delete"; account: ApiAccount } | null;

/**
 * Whether the delete endpoint can do anything for this row.
 *
 * The same test the server applies, so the button and the endpoint agree.
 * `isNetflixManagedAccount` on the server matches on the product name, and
 * Netflix falls through to the refusal at the end of that branch -- every
 * Netflix row, always. So for a Netflix account the button does not delete; it
 * raises a 400. Offering it, under a dialog that said "akun akan dihapus", was
 * the old behaviour.
 */
function isSheetOwned(row: ApiAccount) {
  return [row.product, row.variant].join(" ").toLowerCase().includes("netflix");
}

function canDelete(row: ApiAccount) {
  if (isSheetOwned(row)) return false;
  return ["expired", "replaced", "disabled"].includes(String(row.status || "").toLowerCase());
}

/**
 * The fields worth copying, and whether each one is worth hiding by default.
 *
 * `canvaLink` is in the same list as the password because it is the same kind of
 * thing: a pool link is the credential for every account in the pool.
 */
const CREDENTIAL_FIELDS: Array<{ key: keyof AccountCredentials; label: string; secret: boolean }> = [
  { key: "email", label: "Email / nomor login", secret: false },
  { key: "loginPhone", label: "Nomor login", secret: false },
  { key: "password", label: "Password", secret: true },
  { key: "pin", label: "PIN", secret: true },
  { key: "signInCode", label: "Sign-in code", secret: true },
  { key: "verificationCode", label: "Kode verifikasi", secret: true },
  { key: "resetLink", label: "Reset link", secret: true },
  { key: "householdLink", label: "Household link", secret: true },
  { key: "otpEmail", label: "Email OTP", secret: true },
  { key: "canvaLink", label: "Link pool Canva", secret: true },
];

const emptyForm = (): AccountForm => ({ stockId: "", product: "", variant: "", email: "", buyer: "", resellerId: "", reseller: "", whatsapp: "", profile: "", device: "", startedAt: "", expiresAt: "", duration: "", status: "active" });

/**
 * Move a stored timestamp into a `datetime-local` input, and back.
 *
 * Every writer in the server formats these as local wall-clock text with a
 * SPACE separator -- `store.js` `nowText`, `index.js` `dateTimeText`,
 * `google-sheets.js` `formatDateTime` all build `${y}-${m}-${d} ${HH}:${mm}`.
 * A `datetime-local` input accepts only `YYYY-MM-DDTHH:mm`, so a value holding
 * a space is rejected by the browser and the field renders EMPTY.
 *
 * That is worse than a cosmetic blank: the owner opens Edit on an account whose
 * expiry is perfectly valid, sees no date, and has no way to tell an empty
 * field from one the system failed to read. `slice(0, 16)` did not cause this,
 * but it hid it -- it produced a string that looked right and was not a valid
 * input value.
 *
 * The reverse matters too. Typing into the field yields a `T`, and saving that
 * verbatim writes a second date format into the same column, which is how a
 * store ends up with `2026-06-21 00:00` and `2026-06-21T00:00` side by side for
 * the same account. `fromDateTimeInput` puts the store back on one format.
 */
function toDateTimeInput(value?: string) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const [datePart = "", timePart = ""] = text.split(/[T ]/);
  return timePart ? `${datePart}T${timePart.slice(0, 5)}` : datePart;
}

function fromDateTimeInput(value: string) {
  // The store's own format is space-separated; keep it that way on the way out.
  return String(value || "").trim().replace("T", " ");
}

/**
 * `email` carries the account's login identity, which for some products is a
 * phone number rather than an address -- hence `row.email || row.loginPhone`.
 *
 * Worth knowing before anyone "fixes" that into two separate fields: the
 * PUT handler (`routes/account-routes.js`) has no `loginPhone` key in its
 * `Object.assign` at all, and rejects an empty `email` with a 400. So `email` is
 * not a mislabelled column here, it is the only writable identity field the
 * endpoint exposes. Splitting the form would need a backend change, and until
 * that exists this fallback is the contract, not a bug.
 */
function toForm(row: ApiAccount): AccountForm { return { stockId: row.stockId || "", product: row.product || "", variant: row.variant || "", email: row.email || row.loginPhone || "", buyer: row.buyer || "", resellerId: row.resellerId || "", reseller: row.reseller || "", whatsapp: row.whatsapp || "", profile: row.profile || "", device: row.device || "", startedAt: toDateTimeInput(row.startedAt), expiresAt: toDateTimeInput(row.expiresAt), duration: row.duration || "", status: row.status } }
export default function OwnerConsoleAccountsPage() {
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [loading, setLoading] = useState(true);
  // `error` is the load failure only. The form's validation and save results
  // used to land here too, which meant a rejected save replaced the reason the
  // account list was empty and DataTable blanked out every row underneath.
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  // The delete dialog had its own failure rendering through `formError`, the
  // same state the edit form uses. `openEdit` clears it, but the row's trash
  // button did not -- so a save that had just been rejected greeted the owner
  // inside the delete dialog, describing an edit they had already abandoned.
  // One error, two dialogs, no way to tell whose it was.
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ApiAccount | null | undefined>(undefined);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [action, setAction] = useState<AccountAction>(null);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<{ account: ApiAccount; data?: AccountAuditResult; loading: boolean; error: string } | null>(null);
  const auditRequestRef = useRef(0);
  const [credentials, setCredentials] = useState<{ account: ApiAccount; data?: AccountCredentials; loading: boolean; error: string } | null>(null);
  // Secrets were revealed by a single "Tampilkan semua" flag, so looking at one
  // password exposed every password, PIN, reset link and household link on the
  // account at once. The owner only ever needed one of them, and the act of
  // reading a PIN should not be the act of publishing a pool link.
  //
  // Each field now reveals on its own, and every reveal expires on its own
  // timer. The timeout is not decoration: a credentials dialog that stays open
  // on a second monitor is still a credentials dialog, and these values are
  // already in React state long after the click that fetched them.
  const [revealedFields, setRevealedFields] = useState<string[]>([]);
  const revealTimerRef = useRef<number | null>(null);
  const credentialRequestRef = useRef(0);

  /** How long a revealed secret stays readable before it masks itself again. */
  const REVEAL_TIMEOUT_MS = 60_000;

  /**
   * Mask every revealed field and stop the pending timer.
   *
   * Called on open, on close, and on unmount. The unmount case is the one that
   * was previously impossible to reach: there was no per-field state to leave
   * behind, only one boolean that a closed dialog reset by hand.
   */
  function clearReveals() {
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setRevealedFields([]);
  }

  function toggleReveal(key: string) {
    setRevealedFields((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
    // Any reveal restarts the clock, so the last one the owner asked for is the
    // one that decides when they are locked out again.
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = window.setTimeout(clearReveals, REVEAL_TIMEOUT_MS);
  }

  useEffect(() => clearReveals, []);

  /**
   * Open one account's credentials, and only that account's.
   *
   * The sequence guard matches `openAudit`: the owner can close one drawer and
   * open another before the first request lands, and without the guard a slow
   * response would overwrite the account they are now looking at with the one
   * they closed.
   */
  async function openCredentials(row: ApiAccount) {
    const requestId = credentialRequestRef.current + 1;
    credentialRequestRef.current = requestId;
    setRevealedFields([]);
    setCredentials({ account: row, loading: true, error: "" });
    try {
      const data = await api.accountCredentials(row.id);
      if (credentialRequestRef.current !== requestId) return;
      setCredentials({ account: row, data, loading: false, error: "" });
    } catch (cause) {
      if (credentialRequestRef.current !== requestId) return;
      const reason = cause instanceof Error ? cause.message : "Kredensial gagal dimuat.";
      setCredentials({ account: row, loading: false, error: reason });
    }
  }

  /**
   * Closing is the moment the credentials are dropped.
   *
   * Not a nicety. The reason the listing does not carry them is that a set of
   * passwords sitting in React state outlives the click that fetched it: it is
   * still in the DevTools history, still in whatever took a screenshot, still
   * in a heap dump. Closing the drawer is when the owner said they were done.
   */
  function closeCredentials() {
    credentialRequestRef.current += 1;
    setCredentials(null);
    clearReveals();
  }
  const load = useCallback(async () => { setLoading(true); setError(""); const results = await Promise.allSettled([api.accounts({ view: "overview" }), api.resellers()]); if (results[0].status === "fulfilled") setAccounts(results[0].value); else setError("Manajemen akun gagal dimuat."); if (results[1].status === "fulfilled") setResellers(results[1].value); setLoading(false); }, []);
  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);
  function openCreate() { setEditing(null); setFormError(""); setForm(emptyForm()); }
  function openEdit(row: ApiAccount) { setEditing(row); setFormError(""); setForm(toForm(row)); }
  async function save() { if (!form.stockId || !form.product || !form.email || !form.startedAt || !form.expiresAt) { setFormError("Stock ID, produk, identitas, tanggal mulai, dan expiry wajib diisi."); return; } setFormError(""); setBusy(true); try { const payload = { ...form, startedAt: fromDateTimeInput(form.startedAt), expiresAt: fromDateTimeInput(form.expiresAt) }; editing ? await api.updateAccount(editing.id, payload) : await api.createAccount({ ...payload, source: "manual_input" }); setEditing(undefined); setMessage("Managed account berhasil disimpan."); await load(); } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Akun gagal disimpan."); } finally { setBusy(false); } }
  /*
   * The dialog had three ways to say something and showed the wrong one twice.
   *
   * On failure this set `error`, which renders behind the dialog, and left
   * `audit.data` undefined -- which the timeline renders as "Belum ada timeline
   * audit." So a fetch that never succeeded was reported as an account with no
   * history, and the dialog itself, the thing the owner is looking at, showed
   * no error at all. The reason now lives with the reason.
   *
   * The same shape guards against a slow response for an account the owner has
   * already closed and reopened: the request id is checked before it lands.
   */
  async function openAudit(row: ApiAccount) {
    const requestId = auditRequestRef.current + 1;
    auditRequestRef.current = requestId;
    setAudit({ account: row, loading: true, error: "" });
    try {
      const data = await api.accountAudit(row.id);
      if (auditRequestRef.current !== requestId) return;
      setAudit({ account: row, data, loading: false, error: "" });
    } catch (cause) {
      if (auditRequestRef.current !== requestId) return;
      const reason = cause instanceof Error ? cause.message : "Audit akun gagal dimuat.";
      setAudit({ account: row, loading: false, error: reason });
    }
  }
  /*
   * Two facts the old success message did not carry: that the row is archived
   * rather than erased, and that clearing it in Google Sheets is a second step
   * which can fail on its own. The endpoint answers with both, so the message
   * says what actually happened instead of "dihapus melalui flow aman".
   */
  async function executeAction() {
    if (!action) return;
    const target = action.account;
    setFormError("");
    setActionError("");
    setBusy(true);
    try {
      const result = await api.deleteAccount(target.id);
      setAction(null);
      setMessage(
        result?.sheets?.ok
          ? `${target.email || target.loginPhone || target.id} diarsipkan dan row-nya dikosongkan di Google Sheets.`
          : `${target.email || target.loginPhone || target.id} diarsipkan, tapi row-nya di Google Sheets belum berhasil dikosongkan. Periksa sinkronisasi.`,
      );
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Tindakan akun gagal.");
    } finally {
      setBusy(false);
    }
  }
  const columns = useMemo<Array<DataColumn<ApiAccount>>>(() => [
    { id: "identity", header: "Identitas", value: (row) => row.email || row.loginPhone || "-", sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.email || row.loginPhone || "-"}</strong><small>{row.profile || "Tanpa profil"}</small></span> },
    { id: "owner", header: "Reseller", value: (row) => row.reseller || row.resellerId || "-", sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.reseller || "-"}</strong><small>{row.buyer || "Tanpa buyer"}</small></span> },
    { id: "product", header: "Produk", value: (row) => `${row.product} ${row.variant || ""}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.product}</strong><small>{row.variant || "-"}</small></span> },
    { id: "status", header: "Status", value: (row) => row.status, sortable: true, cell: (row) => <Badge tone={accountStatus(row.status).tone}>{accountStatus(row.status).label}</Badge> },
    { id: "expiry", header: "Expiry", value: (row) => row.expiresAt, sortable: true, cell: (row) => formatDate(row.expiresAt) },
    { id: "source", header: "Source", value: (row) => row.source || "-", hideOnMobile: true },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" onClick={() => openCredentials(row)} aria-label={`Kredensial ${row.id}`} title="Kredensial"><KeyRound size={14} /></button><button type="button" onClick={() => openAudit(row)} aria-label={`Audit ${row.id}`}><ClipboardList size={14} /></button><button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${row.id}`}><Edit3 size={14} /></button><button type="button" onClick={() => { setFormError(""); setAction({ type: "delete", account: row }); }} aria-label={`Hapus ${row.id}`}><Trash2 size={14} /></button></div> },
  ], []);
  // Both filters label their options from the shared vocabulary now. They used to
  // render the raw token -- the Status column read "expiring" in English while
  // the dialog two rows below offered "expiring" in a <select>, and neither
  // matched "Segera berakhir" anywhere else in the product.
  const filters = useMemo<Array<DataFilter<ApiAccount>>>(() => [{ id: "status", label: "Status", options: ["active", "expiring", "expired", "replaced", "disabled"].map((value) => ({ label: accountStatus(value).label, value })), value: (row) => row.status }, { id: "source", label: "Source", options: ["web_order", "manual_input", "assign_daily"].map((value) => ({ label: value, value })), value: (row) => row.source || "" }], []);
  // One number, used for both the count and the colour. The two used to be
  // written out separately -- the count as a filter, the colour as a
  // `.some()` -- which is the shape that let the two disagree on the two
  // pages where they did.
  const expiredCount = accounts.filter((row) => row.status === "expired").length;
  return <ConsoleShell title="Manajemen Akun" description="Pantau ownership, durasi, expiry, dan riwayat akun pelanggan." refreshing={loading} attentionCount={expiredCount} systemState={systemStateFor(expiredCount, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[{ label: "Aktif", value: accounts.filter((row) => row.status === "active").length, tone: "success" }, { label: "Segera berakhir", value: accounts.filter((row) => row.status === "expiring").length, tone: "warning" }, { label: "Berakhir", value: accounts.filter((row) => row.status === "expired").length, tone: "danger" }, { label: "Tanpa reseller", value: accounts.filter((row) => !row.resellerId && !row.reseller).length, tone: "warning" }]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    <section className="console-panel"><div className="console-panel-header"><div><span>Pelanggan</span><h2>Managed accounts</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={openCreate}><Plus size={15} /> Tambah manual</button></div></div><DataTable rows={accounts} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} initialPageSize={10} /></section>
    {editing !== undefined ? <Dialog open title={editing ? "Edit managed account" : "Tambah managed account"} eyebrow="Ownership" onClose={() => setEditing(undefined)} wide footer={<DialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel="Simpan akun" busy={busy} />}>{formError ? <Notice tone="danger">{formError}</Notice> : null}<div className="console-resource-form-grid"><Field label="Stock ID"><input value={form.stockId} onChange={(e) => setForm({ ...form, stockId: e.target.value })} /></Field><Field label="Produk"><input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /></Field><Field label="Variant"><input value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} /></Field><Field label="Email / nomor login"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="Reseller"><select value={form.resellerId} onChange={(e) => { const reseller = resellers.find((row) => row.id === e.target.value); setForm({ ...form, resellerId: e.target.value, reseller: reseller?.username || reseller?.name || "", whatsapp: reseller?.whatsapp || form.whatsapp }); }}><option value="">Tanpa reseller</option>{resellers.map((row) => <option key={row.id} value={row.id}>{row.username || row.name}</option>)}</select></Field><Field label="Buyer"><input value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} /></Field><Field label="WhatsApp"><input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field><Field label="Profil"><input value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })} /></Field><Field label="Mulai"><input type="datetime-local" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.target.value })} /></Field><Field label="Expiry"><input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field><Field label="Durasi"><input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></Field><Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ApiAccount["status"] })}>{["active", "expiring", "expired", "replaced", "disabled"].map((value) => <option key={value} value={value}>{accountStatus(value).label}</option>)}</select></Field></div><div className="console-privacy-note"><ShieldAlert size={16} /><span>Password, PIN, OTP, reset link, dan household link tidak ikut pada daftar ini. Buka kredensial satu akun dari tombolnya -- setiap opening tercatat di log aktivitas.</span></div></Dialog> : null}
    {credentials ? <Dialog open title="Kredensial akun" eyebrow={credentials.account.id} onClose={closeCredentials} wide
      footer={<DialogActions onCancel={closeCredentials} onConfirm={closeCredentials} confirmLabel="Selesai" busy={false} />}
    >
      <Notice>Kredensial ini diambil khusus untuk satu akun dan tercatat di log aktivitas. Yang tidak ada di daftar utama tidak ikut dimuat di sini.</Notice>
      {credentials.loading ? <p className="mt-4 text-sm text-[var(--text-muted)]">Memuat kredensial...</p> : null}
      {credentials.error ? <div className="mt-4"><Notice tone="danger">{credentials.error}</Notice></div> : null}
      {credentials.data ? <>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-muted)]">{credentials.data.product} {credentials.data.variant || ""}{credentials.data.reseller ? ` · ${credentials.data.reseller}` : ""}</p>
          <p className="text-xs text-[var(--text-muted)]">Klik ikon mata pada satu kolom untuk menampilkannya. Otomatis disembunyikan setelah 60 detik.</p>
        </div>
        <div className="console-resource-form-grid mt-4">
          {CREDENTIAL_FIELDS.map((field) => {
            const value = String(credentials.data?.[field.key] || "");
            if (!value) return null;
            const shown = !field.secret || revealedFields.includes(field.key);
            return <Field key={field.key} label={field.label}>
              <div className={field.secret ? "console-secret-field" : undefined}>
                <input readOnly type={field.secret && !shown ? "password" : "text"} value={shown ? value : "•".repeat(Math.min(value.length, 18))} />
                {field.secret ? <button type="button" onClick={() => toggleReveal(field.key)} aria-label={shown ? `Sembunyikan ${field.label}` : `Tampilkan ${field.label}`} aria-pressed={shown}>{shown ? <EyeOff size={15} /> : <Eye size={15} />}</button> : null}
              </div>
            </Field>;
          })}
        </div>
      </> : null}
    </Dialog> : null}
    {audit ? <Dialog open title="Audit akun" eyebrow={audit.account.id} onClose={() => { auditRequestRef.current += 1; setAudit(null); }} wide><div className="console-audit-timeline">{audit.loading ? <p>Memuat timeline...</p> : audit.error ? <Notice tone="danger">Timeline audit gagal dimuat: {audit.error}</Notice> : audit.data?.timeline.length ? audit.data.timeline.map((row) => <article key={row.id}><span /><div><strong>{row.title}</strong><p>{row.detail}</p><small>{formatDate(row.createdAt)} / {row.source}</small></div></article>) : <p>Belum ada timeline audit.</p>}</div></Dialog> : null}
    {action ? <Dialog open title="Hapus managed account" eyebrow={action.account.email || action.account.loginPhone || action.account.id} onClose={() => setAction(null)} footer={<DialogActions onCancel={() => setAction(null)} onConfirm={executeAction} confirmLabel={canDelete(action.account) ? "Arsipkan akun" : "Coba hapus"} busy={busy} danger />}>
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      <Notice tone="danger">{isSheetOwned(action.account)
        ? "Baris produk ini dimiliki Google Sheets, jadi tidak bisa dilepas dari web. Kosongkan atau ubah row-nya di Sheets, lalu tunggu sinkron. Tombol di bawah akan ditolak."
        : `Akun berstatus ${accountStatus(action.account.status).label.toLowerCase()} akan diarsipkan: hilang dari daftar, dicatat di log aktivitas, dan row-nya dikosongkan di Google Sheets. Stok sumber tidak diubah, dan akun tidak kembali ke stok.`}</Notice>
    </Dialog> : null}
  </ConsoleShell>;
}
