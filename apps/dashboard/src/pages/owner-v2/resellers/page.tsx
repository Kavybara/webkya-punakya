import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Edit3, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type AccountAccessLookupType, type ApiDepositRequest, type ApiReseller } from "../../../lib/api";
import { formatRupiah } from "../../../lib/format";
import { Badge, Dialog, DialogActions, Field, MetricRow, Notice, Toast } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";

type ResellerForm = { name: string; username: string; password: string; email: string; whatsapp: string; deposit: string; isActive: boolean; allowedAccessTools: AccountAccessLookupType[] };
type ResellerAction = { type: "delete"; reseller: ApiReseller } | { type: "approve" | "reject"; request: ApiDepositRequest } | null;
const tools: Array<{ value: AccountAccessLookupType; label: string }> = [{ value: "signin", label: "Sign-in code" }, { value: "verification", label: "Verification code" }, { value: "household", label: "Household" }, { value: "reset", label: "Reset password" }];
const emptyForm = (): ResellerForm => ({ name: "", username: "", password: "", email: "", whatsapp: "", deposit: "0", isActive: true, allowedAccessTools: ["signin", "verification", "household"] });

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
  function openCreate() { setEditing(null); setForm(emptyForm()); }
  function openEdit(row: ApiReseller) { setEditing(row); setForm({ name: row.name, username: row.username, password: "", email: row.email || "", whatsapp: row.whatsapp, deposit: String(row.deposit || 0), isActive: row.isActive, allowedAccessTools: (row.allowedAccessTools || ["signin", "verification", "household"]) as AccountAccessLookupType[] }); }
  async function save() { if (!form.name || !form.username || !form.whatsapp || (!editing && !form.password)) { setError("Nama, username, WhatsApp, dan password untuk akun baru wajib diisi."); return; } setBusy(true); try { const payload: Partial<ApiReseller> = { name: form.name, username: form.username, email: form.email, whatsapp: form.whatsapp, deposit: Number(form.deposit || 0), isActive: form.isActive, allowedAccessTools: form.allowedAccessTools as ApiReseller["allowedAccessTools"] }; if (form.password) payload.password = form.password; editing ? await api.updateReseller(editing.id, payload) : await api.createReseller(payload); setEditing(undefined); setMessage("Data reseller berhasil disimpan."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Reseller gagal disimpan."); } finally { setBusy(false); } }
  async function executeAction() { if (!action) return; setBusy(true); try { let archived = true; if (action.type === "delete") await api.deleteReseller(action.reseller.id); if (action.type === "approve") { await api.approveDepositRequest(action.request.id, note ? { note } : undefined); try { await api.archiveDepositRequests([action.request.id]); } catch { archived = false; } } if (action.type === "reject") { await api.rejectDepositRequest(action.request.id, note ? { note } : undefined); try { await api.archiveDepositRequests([action.request.id]); } catch { archived = false; } } const actionType = action.type; setAction(null); setNote(""); setMessage(actionType === "delete" ? "Data reseller berhasil dihapus." : archived ? "Permintaan deposit selesai diproses dan dipindahkan dari antrean aktif." : "Permintaan deposit selesai diproses. Riwayat tetap tersimpan, tetapi arsip otomatis perlu dicoba lagi."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Tindakan reseller gagal."); } finally { setBusy(false); } }
  async function syncResellerSheets() { if (busy) return; setBusy(true); setError(""); setMessage(""); try { const result = await api.syncGoogleSheetsResellers(); setMessage(`${result.checked} reseller diperiksa: ${result.added} ditambahkan, ${result.updated} diperbarui, ${result.skippedCount} dilewati, ${result.conflicts} konflik.`); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Data reseller gagal disinkronkan ke Google Sheets."); } finally { setBusy(false); } }
  const columns = useMemo<Array<DataColumn<ApiReseller>>>(() => [
    { id: "reseller", header: "Reseller", value: (row) => `${row.name} ${row.username}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.name}</strong><small>@{row.username} / {row.whatsapp}</small></span> },
    { id: "status", header: "Status", value: (row) => row.isActive ? "Aktif" : "Nonaktif", sortable: true, cell: (row) => <Badge tone={row.isActive ? "success" : "danger"}>{row.isActive ? "Aktif" : "Nonaktif"}</Badge> },
    { id: "deposit", header: "Saldo", value: (row) => Number(row.deposit || 0), sortable: true, cell: (row) => formatRupiah(Number(row.deposit || 0)) },
    { id: "orders", header: "Order", value: (row) => row.orders || 0, sortable: true },
    { id: "access", header: "Akses", value: (row) => row.allowedAccessTools?.length || 0, hideOnMobile: true, cell: (row) => `${row.allowedAccessTools?.length || 0} tools` },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${row.username}`}><Edit3 size={14} /></button><button type="button" onClick={() => setAction({ type: "delete", reseller: row })} aria-label={`Hapus ${row.username}`}><Trash2 size={14} /></button></div> },
  ], []);
  const filters = useMemo<Array<DataFilter<ApiReseller>>>(() => [{ id: "status", label: "Status", options: [{ label: "Aktif", value: "active" }, { label: "Nonaktif", value: "inactive" }], value: (row) => row.isActive ? "active" : "inactive" }], []);
  const requestColumns = useMemo<Array<DataColumn<ApiDepositRequest>>>(() => [
    { id: "reseller", header: "Reseller", value: (row) => row.resellerName, sortable: true },
    { id: "amount", header: "Nominal", value: (row) => row.amount, sortable: true, cell: (row) => formatRupiah(row.amount) },
    { id: "method", header: "Metode", value: (row) => row.method },
    { id: "status", header: "Status", value: (row) => row.status || "pending", cell: (row) => <Badge tone={row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "warning"}>{row.status || "pending"}</Badge> },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => row.status === "pending" || !row.status ? <div className="console-row-actions"><button type="button" onClick={() => setAction({ type: "approve", request: row })} aria-label={`Approve ${row.id}`}><Check size={14} /></button><button type="button" onClick={() => setAction({ type: "reject", request: row })} aria-label={`Reject ${row.id}`}><X size={14} /></button></div> : <span /> },
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
    {editing !== undefined ? <Dialog open title={editing ? "Edit reseller" : "Tambah reseller"} eyebrow="Pelanggan" onClose={() => setEditing(undefined)} wide footer={<DialogActions onCancel={() => setEditing(undefined)} onConfirm={save} confirmLabel="Simpan reseller" busy={busy} />}><div className="console-resource-form-grid"><Field label="Nama"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label={editing ? "Username (kunci Sheets)" : "Username"}><input value={form.username} readOnly={Boolean(editing)} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field><Field label={editing ? "Password baru (opsional)" : "Password"}><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field><Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="WhatsApp"><input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field><Field label="Saldo"><input type="number" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} /></Field><Field label="Status"><select value={form.isActive ? "active" : "inactive"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></Field><Field label="Permission akses"><div className="ui-checkbox-stack">{tools.map((tool) => <label key={tool.value}><input type="checkbox" checked={form.allowedAccessTools.includes(tool.value)} onChange={(e) => setForm({ ...form, allowedAccessTools: e.target.checked ? [...form.allowedAccessTools, tool.value] : form.allowedAccessTools.filter((value) => value !== tool.value) })} /> {tool.label}</label>)}</div></Field></div></Dialog> : null}
    {action ? <Dialog open title={action.type === "delete" ? "Hapus reseller" : action.type === "approve" ? "Approve deposit" : "Tolak deposit"} eyebrow="Konfirmasi tindakan" onClose={() => setAction(null)} footer={<DialogActions onCancel={() => setAction(null)} onConfirm={executeAction} confirmLabel="Konfirmasi" busy={busy} danger={action.type === "delete" || action.type === "reject"} />}>{action.type === "delete" ? <Notice tone="danger">Reseller akan dihapus melalui endpoint owner. Pastikan tidak ada ownership aktif yang masih bergantung pada akun ini.</Notice> : <Field label="Catatan owner"><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>}</Dialog> : null}
  </ConsoleShell>;
}
