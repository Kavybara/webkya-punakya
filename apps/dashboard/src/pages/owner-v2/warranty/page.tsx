import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareWarning, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { DataTable, type DataColumn, type DataFilter } from "../../../components/ui/DataTable";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import {
  api,
  type WarrantyClaim,
  type WarrantyClaimStatus,
  type WarrantyManualClaimOption,
  type WarrantyReplacementCandidate,
} from "../../../lib/api";
import { formatDateTimeFull } from "../../../lib/format";
import { Badge, Dialog, DialogActions, Field, MetricRow, Notice, Toast } from "../../../components/ui";

const editableStatuses: WarrantyClaimStatus[] = ["reviewing", "resolved", "rejected"];
const terminalStatuses = new Set<WarrantyClaimStatus>(["resolved", "rejected"]);
const activeStatuses = new Set<WarrantyClaimStatus>(["submitted", "reviewing", "waiting_evidence"]);

const emptyManualReplacement = {
  login: "",
  password: "",
  profile: "",
  pin: "",
  expiresAt: "",
  otpEmail: "",
  note: "",
};

function statusLabel(status: WarrantyClaimStatus | string) {
  return ({
    submitted: "Diajukan",
    reviewing: "Sedang diperiksa",
    waiting_evidence: "Sedang diperiksa",
    replaced: "Diganti",
    resolved: "Selesai",
    rejected: "Ditolak",
  } as Record<string, string>)[status] || status;
}

function statusTone(status: WarrantyClaimStatus | string) {
  if (["replaced", "resolved"].includes(status)) return "success" as const;
  if (status === "rejected") return "danger" as const;
  if (status === "submitted") return "warning" as const;
  return "info" as const;
}

function formatReviewDuration(minutes = 0) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  const mins = safeMinutes % 60;
  return [days ? `${days} hari` : "", hours ? `${hours} jam` : "", !days && mins ? `${mins} menit` : ""]
    .filter(Boolean)
    .join(" ") || "kurang dari 1 menit";
}

type PreparedEvidence = { name: string; mimeType: string; dataUrl: string; size: number };

function fileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Bukti tidak dapat dibaca."));
    reader.readAsDataURL(file);
  });
}

async function prepareEvidence(file: File): Promise<PreparedEvidence> {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(file.type)) throw new Error("Bukti harus berupa PNG, JPEG, atau WebP.");
  const maxBytes = 650_000;
  if (file.size <= maxBytes) {
    return { name: file.name, mimeType: file.type, dataUrl: await fileAsDataUrl(file), size: file.size };
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= maxBytes) {
        return {
          name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
          mimeType: "image/jpeg",
          dataUrl: await fileAsDataUrl(blob),
          size: blob.size,
        };
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("Screenshot masih terlalu besar. Potong gambar lalu pilih kembali.");
}

export default function OwnerConsoleWarrantyPage() {
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [claimView, setClaimView] = useState<"active" | "history">("active");
  const [selected, setSelected] = useState<WarrantyClaim | null>(null);
  const [candidates, setCandidates] = useState<WarrantyReplacementCandidate[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [ownerNote, setOwnerNote] = useState("");
  const [status, setStatus] = useState<WarrantyClaimStatus>("reviewing");
  const [busy, setBusy] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualOptions, setManualOptions] = useState<WarrantyManualClaimOption[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResellerId, setManualResellerId] = useState("");
  const [manualAccountId, setManualAccountId] = useState("");
  const [manualIssue, setManualIssue] = useState("");
  const [manualError, setManualError] = useState("");
  const [manualEvidence, setManualEvidence] = useState<PreparedEvidence | null>(null);
  const [manualEvidenceBusy, setManualEvidenceBusy] = useState(false);
  const [manualReplaceOpen, setManualReplaceOpen] = useState(false);
  const [manualReplaceForm, setManualReplaceForm] = useState(emptyManualReplacement);
  const manualEvidenceInputRef = useRef<HTMLInputElement>(null);
  const actionLockRef = useRef(false);
  const clearMessage = useCallback(() => setMessage(""), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.warrantyClaims();
      setClaims(rows);
      return rows;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Antrean garansi gagal dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);

  async function openClaim(claim: WarrantyClaim) {
    setSelected(claim);
    setOwnerNote(claim.ownerNote || "");
    setStatus(["submitted", "replaced", "waiting_evidence"].includes(claim.status) ? "reviewing" : claim.status);
    setCandidateId("");
    setCandidates([]);
    setConfirmReplace(false);
    setManualReplaceOpen(false);
    setManualReplaceForm(emptyManualReplacement);
    if (["replaced", "resolved", "rejected"].includes(claim.status)) return;
    setCandidateLoading(true);
    try {
      const rows = await api.warrantyReplacementCandidates(claim.id);
      setCandidates(rows);
      setCandidateId(rows[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kandidat stok pengganti gagal dimuat.");
    } finally {
      setCandidateLoading(false);
    }
  }

  async function openManualClaim() {
    setManualOpen(true);
    setManualLoading(true);
    setManualError("");
    setManualResellerId("");
    setManualAccountId("");
    setManualIssue("");
    setManualEvidence(null);
    if (manualEvidenceInputRef.current) manualEvidenceInputRef.current.value = "";
    try {
      const rows = await api.warrantyManualClaimOptions();
      setManualOptions(rows);
    } catch (cause) {
      setManualError(cause instanceof Error ? cause.message : "Daftar akun garansi gagal dimuat.");
    } finally {
      setManualLoading(false);
    }
  }

  function closeManualClaim() {
    if (busy || manualEvidenceBusy) return;
    setManualOpen(false);
    setManualError("");
    setManualEvidence(null);
    if (manualEvidenceInputRef.current) manualEvidenceInputRef.current.value = "";
  }

  async function submitManualClaim() {
    if (!manualResellerId) {
      setManualError("Pilih reseller yang mengajukan klaim.");
      return;
    }
    if (!manualAccountId) {
      setManualError("Pilih akun yang dilaporkan reseller.");
      return;
    }
    if (!manualIssue.trim()) {
      setManualError("Kendala dari WhatsApp wajib ditulis.");
      return;
    }
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusy(true);
    setManualError("");
    try {
      const created = await api.createWarrantyClaim({
        accountId: manualAccountId,
        issue: manualIssue.trim(),
        evidence: manualEvidence
          ? { name: manualEvidence.name, mimeType: manualEvidence.mimeType, dataUrl: manualEvidence.dataUrl }
          : undefined,
      });
      setManualOpen(false);
      setManualEvidence(null);
      setMessage(`Aksi tersimpan. Klaim ${created.id} dari WhatsApp berhasil dibuat.`);
      await load();
    } catch (cause) {
      setManualError(cause instanceof Error ? cause.message : "Klaim manual gagal dibuat.");
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  }

  const manualResellers = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const option of manualOptions) {
      if (!option.resellerId || byId.has(option.resellerId)) continue;
      byId.set(option.resellerId, {
        id: option.resellerId,
        name: option.resellerName || "Tanpa nama",
      });
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "id"));
  }, [manualOptions]);

  const manualAccounts = useMemo(
    () => manualOptions.filter((option) => option.resellerId === manualResellerId),
    [manualOptions, manualResellerId],
  );

  const selectedManualOption = useMemo(
    () => manualOptions.find((option) => option.accountId === manualAccountId) || null,
    [manualAccountId, manualOptions],
  );

  async function saveClaim() {
    if (!selected || selected.status === "replaced") return;
    if (terminalStatuses.has(status) && !ownerNote.trim()) {
      setError(`Catatan Owner wajib diisi untuk status ${statusLabel(status)}.`);
      return;
    }
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await api.updateWarrantyClaim(selected.id, { status, ownerNote });
      setSelected(null);
      setMessage(updated.statusNotificationStatus === "failed"
        ? `Status klaim ${updated.id} tersimpan, tetapi WhatsApp gagal dikirim. Periksa koneksi bot lalu simpan ulang perubahan berikutnya.`
        : `Aksi tersimpan. Klaim ${updated.id} berhasil diperbarui dan WhatsApp terkirim.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Status klaim gagal disimpan.");
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  }

  async function executeReplacement() {
    if (!selected || !candidateId) return;
    if (!ownerNote.trim()) {
      setConfirmReplace(false);
      setError("Catatan Owner wajib diisi sebelum akun diganti.");
      return;
    }
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.replaceWarrantyAccount(selected.id, { stockId: candidateId, reason: ownerNote.trim() });
      setMessage(result.notifications.recipient.status === "sent"
        ? `Akun ${result.account.product} berhasil diganti, tersinkron, dan WhatsApp terkirim ke nomor akun yang digaransi.`
        : `Akun ${result.account.product} berhasil diganti dan tersinkron, tetapi WhatsApp penerima gagal. Buka riwayat klaim lalu pilih Kirim ulang WhatsApp.`);
      setSelected(null);
      setConfirmReplace(false);
      await load();
    } catch (cause) {
      setConfirmReplace(false);
      setError(cause instanceof Error ? cause.message : "Penggantian akun gagal.");
      const rows = await load();
      const current = rows?.find((claim) => claim.id === selected.id);
      if (current) setSelected(current);
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  }

  async function executeManualReplacement() {
    if (!selected) return;
    const reason = manualReplaceForm.note.trim() || ownerNote.trim();
    if (!reason) {
      setError("Catatan Owner wajib diisi sebelum akun diganti manual.");
      return;
    }
    if (!manualReplaceForm.login.trim()) {
      setError("Login atau email akun pengganti wajib diisi.");
      return;
    }
    if (!manualReplaceForm.password.trim()) {
      setError("Password akun pengganti wajib diisi.");
      return;
    }
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.replaceWarrantyAccountManual(selected.id, {
        reason,
        account: {
          login: manualReplaceForm.login.trim(),
          password: manualReplaceForm.password.trim(),
          profile: manualReplaceForm.profile.trim(),
          pin: manualReplaceForm.pin.trim(),
          expiresAt: manualReplaceForm.expiresAt.trim(),
          otpEmail: manualReplaceForm.otpEmail.trim(),
        },
      });
      setMessage(result.notifications.recipient.status === "sent"
        ? `Akun manual ${result.account.product} berhasil masuk ke Akun Saya dan WhatsApp penerima terkirim.`
        : `Akun manual ${result.account.product} berhasil disimpan, tetapi WhatsApp penerima gagal. Buka riwayat klaim lalu kirim ulang.`);
      setSelected(null);
      setManualReplaceOpen(false);
      setManualReplaceForm(emptyManualReplacement);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Penggantian manual gagal.");
      const rows = await load();
      const current = rows?.find((claim) => claim.id === selected.id);
      if (current) setSelected(current);
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  }

  async function retryReplacementSync() {
    const stockId = selected?.replacement?.newStockId;
    if (!selected || !stockId || !selected.ownerNote?.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.replaceWarrantyAccount(selected.id, { stockId, reason: selected.ownerNote.trim() });
      setSelected(result.claim);
      setMessage(`Sinkronisasi penggantian ${selected.id} berhasil.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sinkronisasi penggantian belum berhasil.");
      const rows = await load();
      const current = rows?.find((claim) => claim.id === selected.id);
      if (current) setSelected(current);
    } finally {
      setBusy(false);
    }
  }

  async function retryStockReviewSync() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.retryWarrantyStockReviewSync(selected.id);
      setSelected(updated);
      setMessage(`Kondisi DIPERIKSA untuk ${selected.id} berhasil disinkronkan.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sinkronisasi kondisi stok belum berhasil.");
      const rows = await load();
      const current = rows?.find((claim) => claim.id === selected.id);
      if (current) setSelected(current);
    } finally {
      setBusy(false);
    }
  }

  async function retryReplacementNotification() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.retryWarrantyNotification(selected.id);
      setSelected(result.claim);
      setMessage(result.notifications.recipient.status === "sent"
        ? `WhatsApp penggantian ${selected.id} berhasil dikirim ke nomor akun yang digaransi.`
        : `WhatsApp penggantian ${selected.id} masih gagal: ${result.notifications.recipient.reason || "koneksi bot bermasalah"}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "WhatsApp penggantian gagal dikirim ulang.");
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<Array<DataColumn<WarrantyClaim>>>(() => [
    { id: "claim", header: "Klaim", value: (row) => row.id, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.id}</strong><small>{formatDateTimeFull(row.createdAt)}</small></span> },
    { id: "reseller", header: "Reseller", value: (row) => row.resellerName || row.resellerId || "-", sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.resellerName || row.resellerId || "-"}</strong><small>{row.accountIdentity || "Identitas dimasking"}</small></span> },
    { id: "product", header: "Produk", value: (row) => `${row.product} ${row.variant}`, sortable: true, cell: (row) => <span className="console-product-cell"><strong>{row.product || "-"}</strong><small>{row.variant || "-"}</small></span> },
    { id: "order", header: "Order", value: (row) => row.orderId || "-", hideOnMobile: true },
    { id: "status", header: "Status", value: (row) => row.status, sortable: true, cell: (row) => <div className="flex flex-wrap gap-2"><Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>{row.reviewOverdue && !["replaced", "resolved", "rejected"].includes(row.status) ? <Badge tone="danger">Lewat 3 hari</Badge> : null}</div> },
    { id: "notification", header: "Sumber", value: (row) => row.submissionSource || row.ownerNotificationStatus || "pending", hideOnMobile: true, cell: (row) => row.submissionSource === "owner_manual_whatsapp" ? <Badge tone="info">WhatsApp manual</Badge> : <Badge tone={row.ownerNotificationStatus === "sent" ? "success" : row.ownerNotificationStatus === "failed" ? "danger" : "warning"}>{row.ownerNotificationStatus === "sent" ? "WA terkirim" : row.ownerNotificationStatus === "failed" ? "WA gagal" : "Dashboard"}</Badge> },
    { id: "actions", header: "Aksi", value: () => "", cell: (row) => <div className="console-row-actions"><button type="button" onClick={() => openClaim(row)} aria-label={`Kelola ${row.id}`}><ShieldCheck size={15} /></button></div> },
  ], []);
  const filters = useMemo<Array<DataFilter<WarrantyClaim>>>(() => [{ id: "status", label: "Status", options: ["submitted", "reviewing", "replaced", "resolved", "rejected"].map((value) => ({ label: statusLabel(value), value })), value: (row) => row.status === "waiting_evidence" ? "reviewing" : row.status }], []);

  const activeClaims = useMemo(() => claims.filter((claim) => activeStatuses.has(claim.status)), [claims]);
  const historyClaims = useMemo(() => claims.filter((claim) => !activeStatuses.has(claim.status)), [claims]);
  const visibleClaims = claimView === "active" ? activeClaims : historyClaims;
  const activeFailures = useMemo(() => activeClaims.filter((claim) => (
    claim.reviewOverdue
    || claim.ownerNotificationStatus === "failed"
    || claim.replacementNotificationStatus === "failed"
    || claim.replacementSyncStatus === "failed"
    || claim.stockReviewSyncStatus === "failed"
  )), [activeClaims]);

  return <ConsoleShell title="Garansi" description="Periksa klaim, pilih stok satu pool, dan simpan riwayat penggantian akun." refreshing={loading} attentionCount={activeClaims.length} systemState={error ? "unknown" : activeFailures.length ? "warning" : "healthy"} onRefresh={load}>
    <MetricRow items={[
      { label: "Klaim baru", value: claims.filter((row) => row.status === "submitted").length, tone: "warning" },
      { label: "Sedang diperiksa", value: claims.filter((row) => ["reviewing", "waiting_evidence"].includes(row.status)).length, tone: "info" },
      { label: "Perlu tindakan", value: activeClaims.length, tone: activeClaims.length ? "warning" : "success" },
      { label: "Kendala aktif", value: activeFailures.length, tone: activeFailures.length ? "danger" : "success" },
    ]} />
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <Toast message={message} onClose={clearMessage} />
    <section className="console-panel">
      <div className="console-panel-header"><div><span>Warranty Center</span><h2>{claimView === "active" ? "Antrean klaim aktif" : "Riwayat klaim"}</h2></div><div className="console-panel-toolbar-actions"><button type="button" aria-pressed={claimView === "active"} onClick={() => setClaimView("active")}>Antrean Aktif ({activeClaims.length})</button><button type="button" aria-pressed={claimView === "history"} onClick={() => setClaimView("history")}>Riwayat ({historyClaims.length})</button><button type="button" onClick={() => openManualClaim().catch(() => undefined)}><Plus size={15} /> Tambah klaim manual</button><button type="button" onClick={load}><RefreshCw size={15} /> Perbarui</button></div></div>
      <DataTable rows={visibleClaims} columns={columns} filters={filters} rowKey={(row) => row.id} loading={loading} error={error} emptyText={claimView === "active" ? "Tidak ada klaim yang perlu ditangani." : "Belum ada riwayat klaim selesai."} initialPageSize={10} />
    </section>

    {manualOpen ? <Dialog open title="Tambah klaim manual" eyebrow="Dari WhatsApp reseller" onClose={closeManualClaim} wide footer={<DialogActions onCancel={closeManualClaim} onConfirm={() => submitManualClaim().catch(() => undefined)} confirmLabel="Buat klaim" busy={busy || manualLoading || manualEvidenceBusy} />}>
      <p className="text-sm leading-6 text-[var(--text-muted)]">Pilih reseller terlebih dahulu, lalu pilih akun miliknya yang dilaporkan melalui WhatsApp. Akun pengganti dipilih setelah klaim dibuat.</p>
      {manualError ? <div className="mt-4"><Notice tone="danger">{manualError}</Notice></div> : null}
      <div className="mt-5">
        <Field label="Reseller" hint="Hanya reseller yang masih mempunyai akun dalam masa garansi yang ditampilkan.">
          <select value={manualResellerId} onChange={(event) => {
            setManualResellerId(event.target.value);
            setManualAccountId("");
          }} disabled={manualLoading || !manualResellers.length}>
            <option value="">{manualLoading ? "Memuat reseller..." : manualResellers.length ? "Pilih reseller" : "Tidak ada reseller yang dapat dipilih"}</option>
            {manualResellers.map((reseller) => <option key={reseller.id} value={reseller.id}>{reseller.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Akun yang dilaporkan" hint={manualResellerId ? "Daftar ini hanya berisi akun milik reseller yang dipilih." : "Pilih reseller terlebih dahulu."}>
          <select value={manualAccountId} onChange={(event) => setManualAccountId(event.target.value)} disabled={manualLoading || !manualResellerId || !manualAccounts.length}>
            <option value="">{manualLoading ? "Memuat akun..." : !manualResellerId ? "Pilih reseller terlebih dahulu" : manualAccounts.length ? "Pilih akun" : "Tidak ada akun yang dapat diklaim"}</option>
            {manualAccounts.map((option) => <option key={option.accountId} value={option.accountId}>{option.product} {option.variant} / {option.profile || "Tanpa profil"} / {option.orderId || "Tanpa Order ID"}</option>)}
          </select>
        </Field>
      </div>
      {selectedManualOption ? <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Reseller</span><p className="mt-2 font-semibold text-[var(--text-primary)]">{selectedManualOption.resellerName || "-"}</p><p className="mt-1 text-sm text-[var(--text-muted)]">{selectedManualOption.orderId || "Tanpa Order ID"}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Akun</span><p className="mt-2 font-semibold text-[var(--text-primary)]">{selectedManualOption.accountIdentity || "Dimasking"}</p><p className="mt-1 text-sm text-[var(--text-muted)]">Profil {selectedManualOption.profile || "-"}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Garansi</span><p className="mt-2 font-semibold text-[var(--text-primary)]">Sisa {selectedManualOption.remainingDays} hari</p><p className="mt-1 text-sm text-[var(--text-muted)]">Sampai {formatDateTimeFull(selectedManualOption.warrantyEndsAt)}</p></div>
      </div> : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Kendala dari WhatsApp" hint="Tuliskan keluhan reseller secara ringkas dan jelas.">
          <textarea rows={6} value={manualIssue} onChange={(event) => setManualIssue(event.target.value.slice(0, 1000))} placeholder="Contoh: akun tidak dapat login sejak pagi..." />
        </Field>
        <Field label="Screenshot WhatsApp (opsional)" hint={manualEvidenceBusy ? "Memproses gambar..." : manualEvidence ? `${manualEvidence.name} (${Math.ceil(manualEvidence.size / 1024)} KB) siap disimpan.` : "PNG, JPEG, atau WebP. Maksimal hasil kompresi 650 KB."}>
          <input ref={manualEvidenceInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            setManualEvidenceBusy(true);
            setManualError("");
            try {
              setManualEvidence(await prepareEvidence(file));
            } catch (cause) {
              setManualEvidence(null);
              setManualError(cause instanceof Error ? cause.message : "Bukti gagal diproses.");
              input.value = "";
            } finally {
              setManualEvidenceBusy(false);
            }
          }} />
        </Field>
      </div>
    </Dialog> : null}

    {selected && !confirmReplace && !manualReplaceOpen ? <Dialog open title={`Klaim ${selected.id}`} eyebrow="Garansi" onClose={() => setSelected(null)} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Produk</span><p className="mt-2 font-semibold text-[var(--text-primary)]">{selected.product} {selected.variant}</p><p className="mt-1 text-sm text-[var(--text-muted)]">Order {selected.orderId || "-"}</p></div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Akun</span><p className="mt-2 font-semibold text-[var(--text-primary)]">{selected.accountIdentity || "Dimasking"}</p><p className="mt-1 text-sm text-[var(--text-muted)]">Profil {selected.profile || "-"}</p></div>
      </div>
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><MessageSquareWarning size={16} /> Kendala reseller</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{selected.issue}</p></div>
      {selected.status !== "replaced" && !["resolved", "rejected"].includes(selected.status) ? <div className="mt-4"><Notice tone={selected.reviewOverdue ? "danger" : "warning"}>{selected.reviewOverdue ? `Pemeriksaan sudah melewati batas 3 hari (${formatReviewDuration(selected.reviewElapsedMinutes)}). Selesaikan klaim segera.` : `Masa aktif sedang di-hold. Durasi pemeriksaan berjalan ${formatReviewDuration(selected.reviewElapsedMinutes)} dan maksimal 3 hari akan ditambahkan saat akun diganti.`}</Notice></div> : null}
      {selected.stockReviewTriggered ? <div className="mt-4"><Notice tone={selected.stockReviewSyncStatus === "failed" ? "danger" : "warning"}>Akun login ini memiliki klaim pada {selected.stockReviewProfileCount || 0} profil berbeda ({selected.stockReviewProfiles?.join(", ") || "profil tidak tersedia"}). Seluruh profil otomatis ditandai DIPERIKSA dan tidak dapat dipilih untuk order baru. Sinkronisasi Sheets: {selected.stockReviewSyncStatus === "synced" ? "selesai" : selected.stockReviewSyncStatus === "failed" ? "gagal" : "diproses"}.{selected.stockReviewSyncStatus === "failed" ? <button type="button" className="ml-3 h-10 rounded-lg border border-[var(--border)] px-3 font-semibold text-[var(--text-primary)]" onClick={() => retryStockReviewSync().catch(() => undefined)} disabled={busy}>{busy ? "Mencoba..." : "Coba Sync Ulang"}</button> : null}</Notice></div> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Masa garansi</span>
          <p className="mt-2 font-semibold text-[var(--text-primary)]">{selected.warrantyDays || "-"} hari</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{formatDateTimeFull(selected.warrantyStartedAt || "")} – {formatDateTimeFull(selected.warrantyEndsAt || "")}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Bukti reseller</span>
          {selected.evidence?.length ? <div className="mt-3 flex flex-wrap gap-2">{selected.evidence.map((item, index) => <a key={item.id} href={api.warrantyEvidenceUrl(selected.id, item.id)} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]">Buka bukti {index + 1}</a>)}</div> : <p className="mt-2 text-sm text-[var(--text-muted)]">Tidak ada bukti tersimpan.</p>}
        </div>
      </div>
      {selected.ownerNote ? <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Catatan Owner untuk reseller</span><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{selected.ownerNote}</p></div> : null}
      {selected.status !== "replaced" ? <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Status klaim"><select value={status} onChange={(event) => setStatus(event.target.value as WarrantyClaimStatus)}>{editableStatuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></Field>
        <Field label={`Catatan Owner${terminalStatuses.has(status) ? " (wajib)" : ""}`}><textarea value={ownerNote} onChange={(event) => setOwnerNote(event.target.value.slice(0, 500))} placeholder="Hasil pemeriksaan, alasan penolakan, atau alasan penggantian" rows={4} /></Field>
        <div className="md:col-span-2 flex flex-wrap justify-end gap-3"><button type="button" className="h-11 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text-secondary)]" onClick={saveClaim} disabled={busy}>Simpan status</button></div>
      </div> : <div className="mt-4 space-y-3"><Notice>Akun sudah diganti dengan Stock ID {selected.replacement?.newStockId || "-"}. Masa aktif ditambah {formatReviewDuration(selected.holdAppliedMinutes)} sesuai waktu pemeriksaan.</Notice>{selected.replacementSyncStatus === "failed" || selected.replacementSyncStatus === "pending" ? <Notice tone="danger">Sinkronisasi Google Sheets {selected.replacementSyncStatus === "failed" ? "gagal" : "belum selesai"}. Penggantian sudah dikunci di database dan tidak boleh memilih stok baru.<button type="button" className="ml-3 h-10 rounded-lg border border-[var(--border)] px-3 font-semibold text-[var(--text-primary)]" onClick={() => retryReplacementSync().catch(() => undefined)} disabled={busy}>{busy ? "Mencoba..." : "Coba Sync Ulang"}</button></Notice> : <Notice>Sinkronisasi penggantian: selesai.</Notice>}{selected.replacementNotificationStatus === "sent" ? <Notice>WhatsApp penerima: terkirim ke nomor akun yang digaransi.</Notice> : <Notice tone="danger">WhatsApp penerima belum terkirim{selected.replacementNotificationError ? ` (${selected.replacementNotificationError})` : ""}.<button type="button" className="ml-3 h-10 rounded-lg border border-[var(--border)] px-3 font-semibold text-[var(--text-primary)]" onClick={() => retryReplacementNotification().catch(() => undefined)} disabled={busy}>{busy ? "Mengirim..." : "Kirim ulang WhatsApp"}</button></Notice>}</div>}
      {!(["replaced", "resolved", "rejected"].includes(selected.status)) ? <div className="mt-5 border-t border-[var(--border)] pt-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Penggantian akun</h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Hanya stok tersedia dari pool yang sama yang dapat dipilih. Credential tidak ditampilkan di daftar ini.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <select className="h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text-primary)]" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={candidateLoading || !candidates.length}>
            <option value="">{candidateLoading ? "Memuat kandidat..." : candidates.length ? "Pilih stok pengganti" : "Tidak ada stok satu pool"}</option>
            {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.identity} · {candidate.profile || "Tanpa profil"} · {candidate.sheetName || "DB"} row {candidate.sheetRow || "-"}</option>)}
          </select>
          <button type="button" className="h-11 rounded-lg bg-[var(--text-primary)] px-5 text-sm font-semibold text-[var(--text-on-inverse)] disabled:cursor-not-allowed disabled:opacity-40" disabled={!candidateId || busy || !ownerNote.trim()} onClick={() => setConfirmReplace(true)}>Ganti akun</button>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" className="h-11 rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40" disabled={busy} onClick={() => {
            setManualReplaceForm((current) => ({ ...current, note: ownerNote.trim() }));
            setManualReplaceOpen(true);
          }}>Ganti manual / By Order</button>
        </div>
        {!ownerNote.trim() ? <p className="mt-2 text-xs text-[var(--status-warning)]">Isi Catatan Owner terlebih dahulu. Catatan ini akan terlihat oleh reseller.</p> : null}
      </div> : null}
    </Dialog> : null}

    {selected && manualReplaceOpen ? <Dialog open title="Ganti manual / By Order" eyebrow={selected.id} onClose={() => setManualReplaceOpen(false)} wide footer={<DialogActions onCancel={() => setManualReplaceOpen(false)} onConfirm={() => executeManualReplacement().catch(() => undefined)} confirmLabel="Simpan pengganti" busy={busy} />}>
      <Notice>Dipakai saat akun pengganti diambil satuan dari maker dan belum ada di stok website. Akun baru tetap masuk ke Akun Saya reseller, sedangkan password dan PIN tidak dikirim lewat WhatsApp.</Notice>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Login atau email akun baru"><input value={manualReplaceForm.login} onChange={(event) => setManualReplaceForm((current) => ({ ...current, login: event.target.value }))} placeholder="email/login dari maker" /></Field>
        <Field label="Password akun baru"><input value={manualReplaceForm.password} onChange={(event) => setManualReplaceForm((current) => ({ ...current, password: event.target.value }))} placeholder="password dari maker" /></Field>
        <Field label="Profil"><input value={manualReplaceForm.profile} onChange={(event) => setManualReplaceForm((current) => ({ ...current, profile: event.target.value }))} placeholder={selected.profile || "Nama profil"} /></Field>
        <Field label="PIN"><input value={manualReplaceForm.pin} onChange={(event) => setManualReplaceForm((current) => ({ ...current, pin: event.target.value }))} placeholder="opsional" /></Field>
        <Field label="Email OTP / recovery"><input value={manualReplaceForm.otpEmail} onChange={(event) => setManualReplaceForm((current) => ({ ...current, otpEmail: event.target.value }))} placeholder="opsional" /></Field>
        <Field label="Tanggal berakhir"><input value={manualReplaceForm.expiresAt} onChange={(event) => setManualReplaceForm((current) => ({ ...current, expiresAt: event.target.value }))} placeholder={selected.replacement?.adjustedExpiresAt || selected.warrantyEndsAt || "YYYY-MM-DD HH:mm"} /></Field>
        <div className="md:col-span-2">
          <Field label="Catatan Owner"><textarea rows={4} value={manualReplaceForm.note} onChange={(event) => setManualReplaceForm((current) => ({ ...current, note: event.target.value.slice(0, 500) }))} placeholder="Alasan penggantian, akan terlihat oleh reseller" /></Field>
        </div>
      </div>
    </Dialog> : null}

    {selected && confirmReplace ? <Dialog open title="Konfirmasi penggantian" eyebrow={selected.id} onClose={() => setConfirmReplace(false)} footer={<DialogActions onCancel={() => setConfirmReplace(false)} onConfirm={executeReplacement} confirmLabel="Ya, ganti akun" busy={busy} danger />}>
      <Notice tone="danger">Akun lama akan ditandai REPLACED dan tidak dikembalikan ke stok. Akun baru memakai order, reseller, serta tanggal berakhir yang sama. Tindakan ini tercatat dan tidak dapat memilih stok kedua setelah selesai.</Notice>
    </Dialog> : null}
  </ConsoleShell>;
}
