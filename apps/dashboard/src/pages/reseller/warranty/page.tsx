import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, subscribeRealtime, type WarrantyClaim } from "../../../lib/api";
import type { ManagedAccount } from "../../../mocks/data";
import {
  MiniBadge,
  ResellerPageTitle,
  ResellerStatCard,
  accountStatus,
  accountStatusClass,
  productLabel,
} from "../resellerUi";

const fallbackWarrantyNumber = "6285194629029";
const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-300";
const readonlyInputClass =
  "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-800 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-200/50";

function cleanWhatsapp(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits || fallbackWarrantyNumber;
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

function isClaimableAccount(account: ManagedAccount) {
  if (
    ["replaced", "disabled"].includes(
      String(account.status || "").toLowerCase(),
    )
  )
    return false;
  return warrantyInfo(account).eligible;
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
  if (warranty.remainingDays <= 5) return `HAMPIR BERAKHIR - sisa ${warranty.remainingDays} hari`;
  return `AKTIF - sisa ${warranty.remainingDays} hari`;
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

function claimStatusLabel(status = "") {
  return ({ submitted: "Diajukan", reviewing: "Sedang diperiksa", replaced: "Diganti", resolved: "Selesai", rejected: "Ditolak" } as Record<string, string>)[status] || status;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function ResellerWarrantyPage() {
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
    setLoadError("Akun garansi belum dapat dimuat. Periksa koneksi lalu coba lagi.");
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
  const selectedStatus = selectedAccount ? accountStatus(selectedAccount) : "-";
  const selectedStatusClass = selectedAccount
    ? accountStatusClass(selectedAccount)
    : "bg-slate-100 text-slate-600";
  const selectedExpired = selectedAccount ? !warrantyInfo(selectedAccount).eligible : false;
  const isExpiring = selectedAccount
    ? warrantyInfo(selectedAccount).eligible && warrantyInfo(selectedAccount).remainingDays <= 5
    : false;
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
  const selectedDetailFields = useMemo(() => {
    if (!selectedAccount) return [];
    const fields = [
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
        value: `${warrantyInfo(selectedAccount).warrantyDays} hari / berakhir ${displayDate(warrantyInfo(selectedAccount).endsAt)}`,
      },
      { label: "Status", value: warrantyStatusLabel(selectedAccount) },
    ];
    return fields;
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
        evidence: { name: evidence.name, mimeType: evidence.mimeType, dataUrl: evidence.dataUrl },
      });
      setClaims((current) => [claim, ...current.filter((item) => item.id !== claim.id)]);
      setCreatedClaim(claim);
      setDescription("");
      setEvidence(null);
      if (evidenceInputRef.current) evidenceInputRef.current.value = "";
      setError("");
      setSent(true);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Klaim belum dapat dibuat. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardLayout role="reseller" title="Garansi">
      <div className="space-y-5">
        <ResellerPageTitle
          title="Garansi"
          subtitle="Pilih akun, jelaskan kendala, dan lampirkan bukti untuk diperiksa Owner."
        />

        <div className="grid gap-4 md:grid-cols-3">
          <ResellerStatCard
            label="Akun Bisa Klaim"
            value={loading ? "-" : accounts.length}
            icon="ri-shield-check-line"
            tone="blue"
            hint="Akun aktif yang masih masuk alur garansi"
          />
          <ResellerStatCard
            label="Perlu Dicek Dulu"
            value={loading ? "-" : expiringWarrantyCount}
            icon="ri-time-line"
            tone="amber"
            hint="Akun yang masa aktifnya hampir habis"
          />
          <ResellerStatCard
            label="Masih Aman"
            value={loading ? "-" : activeWarrantyCount}
            icon="ri-checkbox-circle-line"
            tone="emerald"
            hint="Akun dengan masa aktif yang masih panjang"
          />
        </div>

        {loading ? (
          <div className="rounded-xl border border-white/10 bg-[#111216] px-4 py-8 text-center text-sm text-slate-300">
            <i className="ri-loader-4-line mr-2 animate-spin" /> Memuat akun garansi...
          </div>
        ) : null}
        {loadError ? (
          <div className="flex flex-col gap-3 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
            <span>{loadError}</span>
            <button type="button" onClick={() => loadData()} className="h-10 rounded-lg border border-red-300/25 px-4 font-semibold">Coba Lagi</button>
          </div>
        ) : null}

        {selectedAccount ? (
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm shadow-slate-950/5">
            Klaim aktif akan dikirim untuk{" "}
            <span className="font-semibold text-slate-900">
              {productLabel(selectedAccount) || selectedAccount.email || "-"}
            </span>{" "}
            dengan status{" "}
            <span className="font-semibold text-slate-900">
              {warrantyStatusLabel(selectedAccount)}
            </span>
            .
          </div>
        ) : null}

        {!loadError ? <section className="rounded-xl border border-slate-100 bg-white">
          <form onSubmit={submitClaim}>
            <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <i className="ri-shield-check-line text-lg" />
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-950">
                    Form Klaim Garansi
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Data akun diambil otomatis dari akun reseller yang dipilih.
                  </p>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Admin garansi:{" "}
                <span className="font-semibold text-slate-900">
                  +{warrantyNumber}
                </span>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <i className="ri-alert-line" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      Screenshot dikirim bersama tiket
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-700">
                      Bukti tersimpan aman di tiket. WhatsApp garansi Owner
                      menerima notifikasi dan tautan untuk membuka klaim.
                    </p>
                  </div>
                </div>
              </div>

              {isExpiring ? (
                <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
                  Akun ini hampir berakhir. Sisa durasi otomatis ikut tercantum
                  di pesan klaim.
                </div>
              ) : null}
              {selectedExpired ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  Akun ini sudah kedaluwarsa, jadi tombol kirim klaim dimatikan.
                  Klaim garansi hanya untuk akun aktif atau hampir berakhir.
                </div>
              ) : null}

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Pilih Akun
                </span>
                <select
                  value={selectedId}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setEvidence(null);
                    if (evidenceInputRef.current) evidenceInputRef.current.value = "";
                    setError("");
                    setSent(false);
                  }}
                  className={inputClass}
                  disabled={loading || !accounts.length}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {accountIdentityValue(account)} - {productLabel(account)}{" "}
                      - {warrantyStatusLabel(account)}
                    </option>
                  ))}
                </select>
                {!loading && !loadError && !accounts.length ? (
                  <p className="mt-2 text-xs font-medium text-red-600">
                    Tidak ada akun yang bisa diklaim.
                  </p>
                ) : null}
              </label>

              {selectedAccount ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">
                        Akun dipilih
                      </p>
                      <p className="mt-1 text-sm font-bold text-slate-950">
                        {productLabel(selectedAccount)}
                      </p>
                    </div>
                    <MiniBadge className={selectedStatusClass}>
                      {selectedStatus}
                    </MiniBadge>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {selectedDetailFields.map((field) => (
                      <label key={field.label} className="block">
                        <span className="text-sm font-medium text-slate-700">
                          {field.label}
                        </span>
                        <input
                          readOnly
                          value={field.value}
                          className={readonlyInputClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Kendala
                </span>
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value.slice(0, 500));
                    setError("");
                    setSent(false);
                  }}
                  maxLength={500}
                  className="mt-2 h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-300"
                  placeholder="Contoh: Tidak bisa login, muncul household, kode tidak masuk, atau akun error..."
                />
                <span className="mt-1 block text-right text-xs text-slate-400">
                  {description.length}/500
                </span>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Bukti Kendala
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  Wajib satu screenshot PNG, JPEG, atau WebP. Gambar besar akan diperkecil sebelum dikirim.
                </span>
                <input
                  ref={evidenceInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:font-semibold file:text-white"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    setEvidence(null);
                    setError("");
                    if (!file) return;
                    setEvidenceBusy(true);
                    try {
                      setEvidence(await prepareEvidence(file));
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Bukti tidak dapat diproses.");
                      event.target.value = "";
                    } finally {
                      setEvidenceBusy(false);
                    }
                  }}
                />
                <span className="mt-2 block text-xs font-medium text-slate-600">
                  {evidenceBusy
                    ? "Memproses screenshot..."
                    : evidence
                      ? `${evidence.name} (${Math.ceil(evidence.size / 1024)} KB) siap dikirim.`
                      : "Belum ada bukti dipilih."}
                </span>
              </label>

              {error ? (
                <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              ) : null}
              {sent ? (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
                  Klaim {createdClaim?.id || ""} berhasil dibuat dan Owner sudah
                  diberi notifikasi. Screenshot sudah tersimpan bersama tiket.
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading || submitting || evidenceBusy || !selectedAccount || selectedExpired}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <i className={submitting ? "ri-loader-4-line animate-spin" : "ri-shield-check-line"} />
                {evidenceBusy ? "Memproses bukti..." : submitting ? "Membuat klaim..." : "Buat Klaim Garansi"}
              </button>
            </div>
          </form>
        </section> : null}

        {!loading && claims.length ? (
          <section className="overflow-hidden rounded-xl border border-white/10 bg-[#111216] text-slate-100">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="font-semibold">Riwayat Klaim</h2>
              <p className="mt-1 text-xs text-slate-400">Status klaim tersimpan dan tetap dapat dilihat setelah halaman dimuat ulang.</p>
            </div>
            <div className="divide-y divide-white/10">
              {claims.slice(0, 10).map((claim) => (
                <div key={claim.id} className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-white">{claim.product} {claim.variant}</p>
                    <p className="mt-1 text-xs text-slate-400">{claim.id} · {claim.orderId || "Tanpa Order ID"} · {claim.issue}</p>
                    {claim.ownerNote ? <p className="mt-2 text-xs text-slate-300"><span className="font-semibold text-white">Catatan Owner:</span> {claim.ownerNote}</p> : null}
                    <p className="mt-2 text-xs text-slate-500">{claim.evidence?.length ? `${claim.evidence.length} bukti terlampir` : "Tidak ada bukti tersimpan"}</p>
                  </div>
                  <span className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold capitalize text-slate-200">
                    {claimStatusLabel(claim.status)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
