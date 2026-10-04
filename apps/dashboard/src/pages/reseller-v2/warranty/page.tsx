import "./warranty.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  LoaderCircle,
  Paperclip,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { api, subscribeRealtime, type WarrantyClaim } from "../../../lib/api";
import type { ManagedAccount } from "../../../lib/types";
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";
import { systemStateFor } from "../../../components/attention";
import {
  normalizeResellerAccountStatus,
  resellerAccountStatusLabel,
} from "../../../lib/resellerAccounts";
import { OWNER_WHATSAPP } from "../../../lib/ownerContact";
import { Link } from "react-router-dom";
import {
  Badge,
  DetailRow,
  ErrorState,
  Field,
  LoadingState,
  MetricRow,
  Notice,
} from "../../../components/ui";

// The server resolves its own warranty contact by falling back to the
// owner, so this must agree with it -- a customer shown a different
// number than the one the server messages is worse than no number.
const fallbackWarrantyNumber = OWNER_WHATSAPP;
const EVIDENCE_MAX_BYTES = 650_000;
const ISSUE_MAX_LENGTH = 500;
const HISTORY_LIMIT = 10;

function cleanWhatsapp(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits || fallbackWarrantyNumber;
}

function productLabel(account: ManagedAccount) {
  return [account.product, account.variant].filter(Boolean).join(" - ");
}

function accountSearchText(account: ManagedAccount) {
  return [
    account.product,
    account.productId,
    account.variant,
    account.variantCode,
    account.stockPoolKey,
    account.sheetPool,
    account.sheetPoolSchema,
    account.accountType,
    account.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isCanvaAccount(account: ManagedAccount) {
  return (
    accountSearchText(account).includes("canva") || Boolean(account.canvaLink)
  );
}

function isLinkPoolAccount(account: ManagedAccount) {
  const text = accountSearchText(account);
  return (
    isCanvaAccount(account) ||
    account.accountType === "link_pool" ||
    account.sheetPoolSchema === "link" ||
    text.includes("ms365") ||
    text.includes("microsoft 365") ||
    text.includes("office 365")
  );
}

function accountIdentityLabel(account: ManagedAccount) {
  const text = accountSearchText(account);
  if (isLinkPoolAccount(account)) return "Email Customer";
  if (text.includes("disney")) return "Nomor Login";
  if (text.includes("viu") || text.includes("vidio")) return "Account";
  return "Email Akun";
}

function accountIdentityValue(account: ManagedAccount) {
  return accountIdentityLabel(account) === "Nomor Login"
    ? account.loginPhone || account.email || "-"
    : account.email || "-";
}

function warrantyInfo(account: ManagedAccount) {
  const durationDays = Math.max(1, Number(account.durationDays || 1));
  const warrantyDays = Math.min(durationDays, 25);
  let start = new Date(String(account.startedAt || "").replace(" ", "T"));
  if (Number.isNaN(start.getTime())) {
    const expiry = new Date(String(account.expiresAt || "").replace(" ", "T"));
    start = Number.isNaN(expiry.getTime())
      ? new Date(Number.NaN)
      : new Date(expiry.getTime() - durationDays * 86400000);
  }
  if (Number.isNaN(start.getTime())) {
    return { warrantyDays, endsAt: "", remainingDays: 0, eligible: false };
  }
  const ends = new Date(start.getTime() + warrantyDays * 86400000);
  const remainingMs = ends.getTime() - Date.now();
  return {
    warrantyDays,
    endsAt: ends.toISOString(),
    remainingDays: Math.max(0, Math.ceil(remainingMs / 86400000)),
    eligible: remainingMs >= 0,
  };
}

function isClaimableAccount(account: ManagedAccount) {
  if (
    ["replaced", "disabled"].includes(
      String(account.status || "").toLowerCase(),
    )
  )
    return false;
  return warrantyInfo(account).eligible;
}

function displayDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const date = new Date(raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function warrantyStatusLabel(account?: ManagedAccount) {
  if (!account) return "-";
  const warranty = warrantyInfo(account);
  if (!warranty.eligible) return "GARANSI BERAKHIR";
  if (warranty.remainingDays <= 5)
    return `HAMPIR BERAKHIR - sisa ${warranty.remainingDays} hari`;
  return `AKTIF - sisa ${warranty.remainingDays} hari`;
}

function accountBadge(account: ManagedAccount) {
  const status = normalizeResellerAccountStatus(account);
  const tone =
    status === "expired"
      ? ("danger" as const)
      : status === "expiring"
        ? ("warning" as const)
        : status === "inactive"
          ? ("muted" as const)
          : ("success" as const);
  return { label: resellerAccountStatusLabel(status), tone };
}

function claimStatusLabel(status = "") {
  return (
    ({
      submitted: "Diajukan",
      reviewing: "Sedang diperiksa",
      replaced: "Diganti",
      resolved: "Selesai",
      rejected: "Ditolak",
    } as Record<string, string>)
  )[status] || status;
}

function claimStatusTone(status = "") {
  if (["replaced", "resolved"].includes(status)) return "success" as const;
  if (status === "rejected") return "danger" as const;
  if (status === "submitted") return "warning" as const;
  return "info" as const;
}

type PreparedEvidence = {
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
};

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
  if (!allowed.has(file.type))
    throw new Error("Bukti harus berupa PNG, JPEG, atau WebP.");
  if (file.size <= EVIDENCE_MAX_BYTES) {
    return {
      name: file.name,
      mimeType: file.type,
      dataUrl: await fileAsDataUrl(file),
      size: file.size,
    };
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= EVIDENCE_MAX_BYTES) {
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
  throw new Error(
    "Screenshot masih terlalu besar. Potong gambar lalu pilih kembali.",
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function ClaimHistory({ claims }: { claims: WarrantyClaim[] }) {
  return (
    <section className="reseller-v2-panel reseller-v2-warranty-history">
      <header>
        <div>
          <span>Klaim</span>
          <h2>Riwayat Klaim</h2>
        </div>
      </header>
      <p className="reseller-v2-warranty-panel-note">
        Status klaim tersimpan dan tetap dapat dilihat setelah halaman dimuat
        ulang.
      </p>
      <div className="reseller-v2-warranty-claims">
        {claims.slice(0, HISTORY_LIMIT).map((claim) => (
          <article key={claim.id} className="reseller-v2-warranty-claim">
            <div>
              <strong>
                {claim.product} {claim.variant}
              </strong>
              <small>
                {claim.id} · {claim.orderId || "Tanpa Order ID"} · {claim.issue}
              </small>
              {claim.ownerNote ? (
                <p className="reseller-v2-warranty-claim-note">
                  <b>Catatan Owner:</b> {claim.ownerNote}
                </p>
              ) : null}
              {/*
                A "Diganti" badge on its own tells the reseller their problem was
                handled, and nothing else. `claim.replacement` was already in
                this payload -- `safeClaim` copies the whole claim, so
                `newAccountId` came along with it (warranty-service.js:701-712)
                -- and nothing read it. The replacement account lands in "Akun
                Saya" carrying a `?account=` deep link, so the claim can say
                where the new credentials are instead of leaving the reseller to
                notice an unfamiliar row in another tab.
              */}
              {claim.replacement?.newAccountId ? (
                <p className="reseller-v2-warranty-claim-note">
                  <b>Akun pengganti:</b>{" "}
                  <Link
                    to={`/reseller-v2/accounts?account=${encodeURIComponent(claim.replacement.newAccountId)}`}
                  >
                    Buka di Akun Saya
                  </Link>
                  {claim.replacement.createdAt
                    ? ` (${displayDate(claim.replacement.createdAt)})`
                    : ""}
                </p>
              ) : null}
              <p className="reseller-v2-warranty-claim-evidence">
                <Paperclip size={13} aria-hidden="true" />
                {claim.evidence?.length
                  ? `${claim.evidence.length} bukti terlampir`
                  : "Tidak ada bukti tersimpan"}
              </p>
            </div>
            <Badge tone={claimStatusTone(claim.status)}>
              {claimStatusLabel(claim.status)}
            </Badge>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function ResellerV2WarrantyPage() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [description, setDescription] = useState("");
  const [warrantyNumber, setWarrantyNumber] = useState(fallbackWarrantyNumber);
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [createdClaim, setCreatedClaim] = useState<WarrantyClaim | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [evidence, setEvidence] = useState<PreparedEvidence | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0);
  const mounted = useRef(false);

  const loadData = useCallback(async (options: { silent?: boolean } = {}) => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    if (!options.silent) {
      setLoading(true);
      setLoadError("");
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const [accountRows, health, claimRows] = await Promise.all([
          api.accounts({ view: "light" }),
          api.health().catch(() => null),
          api.warrantyClaims(),
        ]);
        if (!mounted.current || seq !== loadSeq.current) return;
        const claimable = accountRows.filter(isClaimableAccount);
        setAccounts(claimable);
        setWarrantyNumber(
          cleanWhatsapp(
            health?.warrantyWhatsAppNumber || fallbackWarrantyNumber,
          ),
        );
        setClaims(claimRows);
        setSelectedId((current) =>
          current && claimable.some((account) => account.id === current)
            ? current
            : claimable[0]?.id || "",
        );
        setError("");
        setLoadError("");
        setLoading(false);
        return;
      } catch {
        if (attempt < 2) await wait(350 * (attempt + 1));
      }
    }

    if (!mounted.current || seq !== loadSeq.current) return;
    setLoadError(
      "Akun garansi belum dapat dimuat. Periksa koneksi lalu coba lagi.",
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadData().catch(() => undefined);
    const unsubscribe = subscribeRealtime(() => {
      loadData({ silent: true }).catch(() => undefined);
    });
    const refresh = () => {
      loadData({ silent: true }).catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("kavya-session:update", refresh);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("kavya-session:update", refresh);
    };
  }, [loadData]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedId) || null,
    [accounts, selectedId],
  );
  const selectedWarranty = useMemo(
    () => (selectedAccount ? warrantyInfo(selectedAccount) : null),
    [selectedAccount],
  );
  const selectedExpired = selectedWarranty ? !selectedWarranty.eligible : false;
  const isExpiring = Boolean(
    selectedWarranty && selectedWarranty.eligible && selectedWarranty.remainingDays <= 5,
  );
  const activeWarrantyCount = useMemo(
    () =>
      accounts.filter((account) => {
        const warranty = warrantyInfo(account);
        return warranty.eligible && warranty.remainingDays > 5;
      }).length,
    [accounts],
  );
  const expiringWarrantyCount = useMemo(
    () =>
      accounts.filter((account) => {
        const warranty = warrantyInfo(account);
        return warranty.eligible && warranty.remainingDays <= 5;
      }).length,
    [accounts],
  );
  /* Only two sets: warranties about to lapse, and claims where the owner has
     asked for evidence and is waiting on the reseller. A claim the reseller
     just submitted is not outstanding -- it is with the owner now, and
     counting it would put the amber pill up the instant someone does the
     thing the page exists to let them do. */
  const awaitingEvidence = claims.filter((claim) => claim.status === "waiting_evidence").length;
  const warrantyAttention = expiringWarrantyCount + awaitingEvidence;
  const selectedDetailFields = useMemo(() => {
    if (!selectedAccount) return [];
    const warranty = warrantyInfo(selectedAccount);
    return [
      { label: "Produk", value: productLabel(selectedAccount) || "-" },
      {
        label: "Nomor Pesanan",
        value: selectedAccount.orderId || selectedAccount.sourceOrderId || "-",
      },
      { label: "Profil", value: selectedAccount.profile || "-" },
      {
        label: "Tanggal Pembelian",
        value: displayDate(selectedAccount.startedAt),
      },
      {
        label: "Masa Garansi",
        value: `${warranty.warrantyDays} hari / berakhir ${displayDate(warranty.endsAt)}`,
      },
      { label: "Status", value: warrantyStatusLabel(selectedAccount) },
    ];
  }, [selectedAccount]);

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(false);
    setCreatedClaim(null);

    if (!selectedAccount) {
      setError("Pilih akun yang ingin diklaim.");
      return;
    }
    if (!warrantyInfo(selectedAccount).eligible) {
      setError(
        "Akun ini sudah kedaluwarsa, klaim garansi tidak bisa dikirim. Hubungi admin bila tetap memerlukan pengecekan manual.",
      );
      return;
    }
    if (!description.trim()) {
      setError("Kendala wajib diisi.");
      return;
    }
    if (!evidence) {
      setError("Screenshot bukti wajib dilampirkan bersama klaim.");
      return;
    }

    setSubmitting(true);
    try {
      const claim = await api.createWarrantyClaim({
        accountId: selectedAccount.id,
        issue: description.trim(),
        evidence: {
          name: evidence.name,
          mimeType: evidence.mimeType,
          dataUrl: evidence.dataUrl,
        },
      });
      setClaims((current) => [
        claim,
        ...current.filter((item) => item.id !== claim.id),
      ]);
      setCreatedClaim(claim);
      setDescription("");
      setEvidence(null);
      if (evidenceInputRef.current) evidenceInputRef.current.value = "";
      setError("");
      setSent(true);
    } catch (claimError) {
      setError(
        claimError instanceof Error
          ? claimError.message
          : "Klaim belum dapat dibuat. Coba lagi.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResellerShell
      title="Garansi"
      description="Pilih akun, jelaskan kendala, dan lampirkan bukti untuk diperiksa Owner."
      loading={loading}
      attentionCount={warrantyAttention}
      systemState={systemStateFor(warrantyAttention, { error: Boolean(error), loading })}
      onRefresh={() => {
        loadData().catch(() => undefined);
      }}
    >
      <MetricRow
        label="Ringkasan garansi"
        items={[
          {
            label: "Akun Bisa Klaim",
            value: accounts.length,
            loading,
            icon: <ShieldCheck size={16} />,
            tone: "info",
            hint: "Akun aktif yang masih masuk alur garansi",
          },
          {
            label: "Perlu Dicek Dulu",
            value: expiringWarrantyCount,
            loading,
            icon: <Clock size={16} />,
            tone: "warning",
            hint: "Akun yang masa aktifnya hampir habis",
          },
          {
            label: "Masih Aman",
            value: activeWarrantyCount,
            loading,
            icon: <CircleCheck size={16} />,
            tone: "success",
            hint: "Akun dengan masa aktif yang masih panjang",
          },
        ]}
      />

      {loading ? (
        <div className="reseller-v2-warranty-loading">
          <LoadingState label="Memuat akun garansi..." />
        </div>
      ) : null}
      {loadError ? (
        <ErrorState message={loadError} onRetry={() => loadData()} />
      ) : null}

      {selectedAccount ? (
        <p className="reseller-v2-warranty-target" role="status">
          Klaim aktif akan dikirim untuk{" "}
          <strong>
            {productLabel(selectedAccount) || selectedAccount.email || "-"}
          </strong>{" "}
          dengan status <strong>{warrantyStatusLabel(selectedAccount)}</strong>.
        </p>
      ) : null}

      {!loadError ? (
        <section className="reseller-v2-panel reseller-v2-warranty-panel">
          <header>
            <div>
              <span>Garansi</span>
              <h2>Form Klaim Garansi</h2>
            </div>
            <p className="reseller-v2-warranty-admin">
              Admin garansi: <strong>+{warrantyNumber}</strong>
            </p>
          </header>
          <p className="reseller-v2-warranty-panel-note">
            Data akun diambil otomatis dari akun reseller yang dipilih.
          </p>
          <form onSubmit={submitClaim} className="reseller-v2-warranty-form">
            <Notice tone="warning">
              <TriangleAlert size={15} aria-hidden="true" />
              <div>
                <strong>Screenshot dikirim bersama tiket</strong>
                <p>
                  Bukti tersimpan aman di tiket. WhatsApp garansi Owner menerima
                  notifikasi dan tautan untuk membuka klaim.
                </p>
              </div>
            </Notice>

            {isExpiring ? (
              <Notice tone="warning">
                <TriangleAlert size={15} aria-hidden="true" />
                <span>
                  Akun ini hampir berakhir. Sisa durasi otomatis ikut
                  tercantum di pesan klaim.
                </span>
              </Notice>
            ) : null}
            {selectedExpired ? (
              <Notice tone="danger">
                <CircleAlert size={15} aria-hidden="true" />
                <span>
                  Akun ini sudah kedaluwarsa, jadi tombol kirim klaim
                  dimatikan. Klaim garansi hanya untuk akun aktif atau hampir
                  berakhir.
                </span>
              </Notice>
            ) : null}

            <Field
              label="Pilih Akun"
              hint={
                !loading && !loadError && !accounts.length
                  ? "Tidak ada akun yang bisa diklaim."
                  : undefined
              }
            >
              <select
                value={selectedId}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setEvidence(null);
                  if (evidenceInputRef.current)
                    evidenceInputRef.current.value = "";
                  setError("");
                  setSent(false);
                }}
                disabled={loading || !accounts.length} aria-busy={loading || undefined}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountIdentityValue(account)} - {productLabel(account)}{" "}
                    - {warrantyStatusLabel(account)}
                  </option>
                ))}
              </select>
            </Field>

            {selectedAccount ? (
              <div className="reseller-v2-warranty-selected">
                <div className="reseller-v2-warranty-selected-head">
                  <div>
                    <span>Akun dipilih</span>
                    <strong>{productLabel(selectedAccount)}</strong>
                  </div>
                  <Badge tone={accountBadge(selectedAccount).tone}>
                    {accountBadge(selectedAccount).label}
                  </Badge>
                </div>
                <dl className="reseller-v2-warranty-details">
                  {selectedDetailFields.map((field) => (
                    <DetailRow key={field.label} label={field.label}>
                      {field.value}
                    </DetailRow>
                  ))}
                </dl>
              </div>
            ) : null}

            <div className="reseller-v2-warranty-counter">
              <Field
                label="Kendala"
                hint={`${description.length}/${ISSUE_MAX_LENGTH}`}
              >
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value.slice(0, ISSUE_MAX_LENGTH));
                    setError("");
                    setSent(false);
                  }}
                  maxLength={ISSUE_MAX_LENGTH}
                  placeholder="Contoh: Tidak bisa login, muncul household, kode tidak masuk, atau akun error..."
                />
              </Field>
            </div>

            <div className="reseller-v2-warranty-evidence">
              <Field
                label="Bukti Kendala"
                hint="Wajib satu screenshot PNG, JPEG, atau WebP. Gambar besar akan diperkecil sebelum dikirim."
              >
                <input
                  ref={evidenceInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (event) => {
                    const input = event.currentTarget;
                    const file = input.files?.[0];
                    setEvidence(null);
                    setError("");
                    if (!file) return;
                    setEvidenceBusy(true);
                    try {
                      setEvidence(await prepareEvidence(file));
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Bukti tidak dapat diproses.",
                      );
                      input.value = "";
                    } finally {
                      setEvidenceBusy(false);
                    }
                  }}
                />
              </Field>
              <p className="reseller-v2-warranty-evidence-status" role="status">
                {evidenceBusy
                  ? "Memproses screenshot..."
                  : evidence
                    ? `${evidence.name} (${Math.ceil(evidence.size / 1024)} KB) siap dikirim.`
                    : "Belum ada bukti dipilih."}
              </p>
            </div>

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {sent ? (
              <Notice tone="success">
                Klaim {createdClaim?.id || ""} berhasil dibuat dan Owner sudah
                diberi notifikasi. Screenshot sudah tersimpan bersama tiket.
              </Notice>
            ) : null}

            <button
              type="submit"
              className="reseller-v2-warranty-submit"
              disabled={
                loading ||
                submitting ||
                evidenceBusy ||
                !selectedAccount ||
                selectedExpired
              }
            >
              {submitting ? (
                <LoaderCircle
                  className="reseller-v2-warranty-spin"
                  size={16}
                  aria-hidden="true"
                />
              ) : (
                <ShieldCheck size={16} aria-hidden="true" />
              )}
              {evidenceBusy
                ? "Memproses bukti..."
                : submitting
                  ? "Membuat klaim..."
                  : "Buat Klaim Garansi"}
            </button>
          </form>
        </section>
      ) : null}

      {!loading && claims.length ? (
        <ClaimHistory claims={claims} />
      ) : null}
    </ResellerShell>
  );
}
