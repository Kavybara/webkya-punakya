import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Edit3, Eye, EyeOff, KeyRound, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type AccountAuditResult, type AccountCredentials, type ApiAccount, type ApiReseller } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { Badge, Button, Dialog, DialogActions, Field, MetricRow, Notice } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

type AccountForm = { stockId: string; product: string; variant: string; email: string; buyer: string; resellerId: string; reseller: string; whatsapp: string; profile: string; device: string; startedAt: string; expiresAt: string; duration: string; status: ApiAccount["status"] };
type AccountAction = { type: "delete"; account: ApiAccount } | null;

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

/**
 * Clear the credentials as soon as the drawer closes.
 *
 * Not a nicety. The reason the listing does not carry these is that a set of
 * passwords that is sitting in a React state object survives the click that
 * fetched it: it is still in the DevTools history, still in whatever took a
 * screenshot, still in a heap dump. Closing the drawer is the moment the owner
 * said they were finished, so that is when they go.
 */
const emptyCredentials = (): AccountCredentials => ({
  accountId: "", email: "", loginPhone: "", password: "", pin: "", signInCode: "",
  verificationCode: "", resetLink: "", householdLink: "", otpEmail: "", canvaLink: "",
  profile: "", product: "", variant: "", reseller: "", status: "", expiresAt: "",
});

const emptyForm = (): AccountForm => ({ stockId: "", product: "", variant: "", email: "", buyer: "", resellerId: "", reseller: "", whatsapp: "", profile: "", device: "", startedAt: "", expiresAt: "", duration: "", status: "active" });
function toForm(row: ApiAccount): AccountForm { return { stockId: row.stockId || "", product: row.product || "", variant: row.variant || "", email: row.email || row.loginPhone || "", buyer: row.buyer || "", resellerId: row.resellerId || "", reseller: row.reseller || "", whatsapp: row.whatsapp || "", profile: row.profile || "", device: row.device || "", startedAt: row.startedAt?.slice(0, 16) || "", expiresAt: row.expiresAt?.slice(0, 16) || "", duration: row.duration || "", status: row.status } }
export default function OwnerConsoleAccountsPage() {
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [loading, setLoading] = useState(true);
  // `error` is the load failure only. The form's validation and save results
  // used to land here too, which meant a rejected save replaced the reason the
  // account list was empty and DataTable blanked out every row underneath.
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ApiAccount | null | undefined>(undefined);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [action, setAction] = useState<AccountAction>(null);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<{ account: ApiAccount; data?: AccountAuditResult; loading: boolean; error: string } | null>(null);
  const auditRequestRef = useRef(0);
  const [credentials, setCredentials] = useState<{ account: ApiAccount; data?: AccountCredentials; loading: boolean; error: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const credentialRequestRef = useRef(0);

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
    setRevealed(false);
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
    setRevealed(false);
  }
  const load = useCallback(async () => { setLoading(true); setError(""); const results = await Promise.allSettled([api.accounts({ view: "overview" }), api.resellers()]); if (results[0].status === "fulfilled") setAccounts(results[0].value); else setError("Manajemen akun gagal dimuat."); if (results[1].status === "fulfilled") setResellers(results[1].value); setLoading(false); }, []);
  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);
  function openCreate() { setEditing(null); setFormError(""); setForm(emptyForm()); }
  function openEdit(row: ApiAccount) { setEditing(row); setFormError(""); setForm(toForm(row)); }
  async function save() { if (!form.stockId || !form.product || !form.email || !form.startedAt || !form.expiresAt) { setFormError("Stock ID, produk, identitas, tanggal mulai, dan expiry wajib diisi."); return; } setFormError(""); setBusy(true); try { editing ? await api.updateAccount(editing.id, form) : await api.createAccount({ ...form, source: "manual_input" }); setEditing(undefined); setMessage("Managed account berhasil disimpan."); await load(); } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Akun gagal disimpan."); } finally { setBusy(false); } }
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
  async function executeAction() { if (!action) return; setFormError(""); setBusy(true); try { await api.deleteAccount(action.account.id); setAction(null); setMessage("Akun dihapus melalui flow aman."); await load(); } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Tindakan akun gagal."); } finally { setBusy(false); } }
  const columns = useMemo<Array<DataColumn<ApiAccount>>>(() => [
    { id: "identity", header: "Identitas", value: (row) => row.email || row.loginPhone || "-", sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.email || row.loginPhone || "-"}</strong><small>{row.profile || "Tanpa profil"}</small></span> },
    { id: "owner", header: "Reseller", value: (row) => row.reseller || row.resellerId || "-", sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.reseller || "-"}</strong><small>{row.buyer || "Tanpa buyer"}</small></span> },
    { id: "product", header: "Produk", value: (row) => `${row.product} ${row.variant || ""}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.product}</strong><small>{row.variant || "-"}</small></span> },
    { id: "status", header: "Status", value: (row) => row.status, sortable: true, cell: (row) => <Badge tone={row.status === "active" ? "success" : row.status === "expiring" ? "warning" : row.status === "expired" ? "danger" : "muted"}>{row.status}</Badge> },
    { id: "expiry", header: "Expiry", value: (row) => row.expiresAt, sortable: true, cell: (row) => formatDate(row.expiresAt) },
    { id: "source", header: "Source", value: (row) => row.source || "-", hideOnMobile: true },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" onClick={() => openCredentials(row)} aria-label={`Kredensial ${row.id}`} title="Kredensial"><KeyRound size={14} /></button><button type="button" onClick={() => openAudit(row)} aria-label={`Audit ${row.id}`}><ClipboardList size={14} /></button><button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${row.id}`}><Edit3 size={14} /></button><button type="button" onClick={() => setAction({ type: "delete", account: row })} aria-label={`Hapus ${row.id}`}><Trash2 size={14} /></button></div> },
  ], []);
  const filters = useMemo<Array<DataFilter<ApiAccount>>>(() => [{ id: "status", label: "Status", options: ["active", "expiring", "expired", "replaced", "disabled"].map((value) => ({ label: value, value })), value: (row) => row.status }, { id: "source", label: "Source", options: ["web_order", "manual_input", "assign_daily"].map((value) => ({ label: value, value })), value: (row) => row.source || "" }], []);
  // One number, used for both the count and the colour. The two used to be
  // written out separately -- the count as a filter, the colour as a
  // `.some()` -- which is the shape that let the two disagree on the two
  // pages where they did.
  const expiredCount = accounts.filter((row) => row.status === "expired").length;
  return <ConsoleShell title="Manajemen Akun" description="Pantau ownership, durasi, expiry, dan riwayat akun pelanggan." refreshing={loading} attentionCount={expiredCount} systemState={systemStateFor(expiredCount, { error: Boolean(error), loading })} onRefresh={load}>
    <MetricRow items={[{ label: "Aktif", value: accounts.filter((row) => row.status === "active").length, tone: "success" }, { label: "Expiring", value: accounts.filter((row) => row.status === "expiring").length, tone: "warning" }, { label: "Expired", value: accounts.filter((row) => row.status === "expired").length, tone: "danger" }, { label: "Tanpa reseller", value: accounts.filter((row) => !row.resellerId && !row.reseller).length, tone: "warning" }]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    <section className="console-panel"><div className="console-panel-header"><div><span>Pelanggan</span><h2>Managed accounts</h2></div><div className="console-panel-toolbar-actions"><button type="button" onClick={openCreate}><Plus size={15} /> Tambah manual</button></div></div><DataTable rows={accounts} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} initialPageSize={10} /></section>
    {editing !== undefined ? <Dialog open title={editing ? "Edit managed account" : "Tambah managed account"} eyebrow="Ownership" onClose={() => setEditing(undefined)} wide footer={<DialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel="Simpan akun" busy={busy} />}>{formError ? <Notice tone="danger">{formError}</Notice> : null}<div className="console-resource-form-grid"><Field label="Stock ID"><input value={form.stockId} onChange={(e) => setForm({ ...form, stockId: e.target.value })} /></Field><Field label="Produk"><input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} /></Field><Field label="Variant"><input value={form.variant} onChange={(e) => setForm({ ...form, variant: e.target.value })} /></Field><Field label="Email / nomor login"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="Reseller"><select value={form.resellerId} onChange={(e) => { const reseller = resellers.find((row) => row.id === e.target.value); setForm({ ...form, resellerId: e.target.value, reseller: reseller?.username || reseller?.name || "", whatsapp: reseller?.whatsapp || form.whatsapp }); }}><option value="">Tanpa reseller</option>{resellers.map((row) => <option key={row.id} value={row.id}>{row.username || row.name}</option>)}</select></Field><Field label="Buyer"><input value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} /></Field><Field label="WhatsApp"><input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field><Field label="Profil"><input value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })} /></Field><Field label="Mulai"><input type="datetime-local" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.target.value })} /></Field><Field label="Expiry"><input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></Field><Field label="Durasi"><input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></Field><Field label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ApiAccount["status"] })}>{["active", "expiring", "expired", "replaced", "disabled"].map((value) => <option key={value} value={value}>{value}</option>)}</select></Field></div><div className="console-privacy-note"><ShieldAlert size={16} /><span>Password, PIN, OTP, reset link, dan household link tidak ikut pada daftar ini. Buka kredensial satu akun dari tombolnya -- setiap opening tercatat di log aktivitas.</span></div></Dialog> : null}
    {credentials ? <Dialog open title="Kredensial akun" eyebrow={credentials.account.id} onClose={closeCredentials} wide
      footer={<DialogActions onCancel={closeCredentials} onConfirm={closeCredentials} confirmLabel="Selesai" busy={false} />}
    >
      <Notice>Kredensial ini diambil khusus untuk satu akun dan tercatat di log aktivitas. Yang tidak ada di daftar utama tidak ikut dimuat di sini.</Notice>
      {credentials.loading ? <p className="mt-4 text-sm text-[var(--text-muted)]">Memuat kredensial...</p> : null}
      {credentials.error ? <div className="mt-4"><Notice tone="danger">{credentials.error}</Notice></div> : null}
      {credentials.data ? <>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--text-muted)]">{credentials.data.product} {credentials.data.variant || ""}{credentials.data.reseller ? ` · ${credentials.data.reseller}` : ""}</p>
          <Button type="button" weight="secondary" onClick={() => setRevealed((current) => !current)}>{revealed ? <><EyeOff size={15} /> Sembunyikan</> : <><Eye size={15} /> Tampilkan semua</>}</Button>
        </div>
        <div className="console-resource-form-grid mt-4">
          {CREDENTIAL_FIELDS.map((field) => {
            const value = String(credentials.data?.[field.key] || "");
            if (!value) return null;
            return <Field key={field.key} label={field.label}><input readOnly type={field.secret && !revealed ? "password" : "text"} value={revealed ? value : "•".repeat(Math.min(value.length, 18))} /></Field>;
          })}
        </div>
      </> : null}
    </Dialog> : null}
    {audit ? <Dialog open title="Audit akun" eyebrow={audit.account.id} onClose={() => { auditRequestRef.current += 1; setAudit(null); }} wide><div className="console-audit-timeline">{audit.loading ? <p>Memuat timeline...</p> : audit.error ? <Notice tone="danger">Timeline audit gagal dimuat: {audit.error}</Notice> : audit.data?.timeline.length ? audit.data.timeline.map((row) => <article key={row.id}><span /><div><strong>{row.title}</strong><p>{row.detail}</p><small>{formatDate(row.createdAt)} / {row.source}</small></div></article>) : <p>Belum ada timeline audit.</p>}</div></Dialog> : null}
    {action ? <Dialog open title="Hapus managed account" eyebrow={action.account.id} onClose={() => setAction(null)} footer={<DialogActions onCancel={() => setAction(null)} onConfirm={executeAction} confirmLabel="Hapus akun" busy={busy} danger />}>{formError ? <Notice tone="danger">{formError}</Notice> : null}<Notice tone="danger">Akun akan dihapus melalui endpoint owner. Data historis dan sinkronisasi mengikuti aturan backend yang sekarang.</Notice></Dialog> : null}
  </ConsoleShell>;
}
