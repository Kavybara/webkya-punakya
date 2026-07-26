import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, subscribeRealtime } from "../../../lib/api";
import type { ManagedAccount } from "../../../mocks/data";
import {
  MiniBadge,
  ResellerPageTitle,
  ResellerStatCard,
  accountStatus,
  accountStatusClass,
  accountWarrantyStatus,
  daysLeft,
  durationLabel,
  productLabel,
  remainingShort,
} from "../resellerUi";

const fallbackWarrantyNumber = "6285194629029";
const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-300";
const readonlyInputClass =
  "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-800 outline-none";

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
  return accountWarrantyStatus(account) !== "expired";
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
  const remaining = daysLeft(account.expiresAt);
  if (account.status === "expired" || remaining <= 0) return "KEDALUWARSA";
  if (remaining <= 5)
    return `HAMPIR BERAKHIR - sisa ${remainingShort(account)}`;
  return `AKTIF - sisa ${remainingShort(account)}`;
}

function buildWarrantyWhatsAppText(
  account: ManagedAccount,
  description: string,
) {
  const lines = [
    "IKY - FORM KLAIM GARANSI",
    "",
    "Apabila terdapat kendala pada akun, sertakan screenshot masalah.",
    "",
    "----------",
    `> aplikasi : ${productLabel(account) || "-"}`,
    `> nomor pesanan : ${account.orderId || account.sourceOrderId || "-"}`,
    `> profil : ${account.profile || "-"}`,
    `> tanggal pembelian : ${displayDate(account.startedAt)}`,
    `> masa garansi : ${durationLabel(account)} / sisa ${remainingShort(account)}`,
    `> status : ${warrantyStatusLabel(account)}`,
  ];

  lines.push(
    "----------",
    "",
    "> kendala :",
    description.trim(),
    "",
    "----------",
    "NOTE !",
    "- Kirim screenshot/foto kendala bersama form ini.",
    "- Klaim tanpa data akun yang jelas bisa lebih lama diproses.",
    "- Estimasi pengecekan garansi 0-3 hari, jika ramai 3-7 hari.",
    "",
    "----------",
    "IKY - Warranty Service",
    "Secure - Reliable - Trusted",
  );

  return lines.join("\n");
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function ResellerWarrantyPage() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [description, setDescription] = useState("");
  const [warrantyNumber, setWarrantyNumber] = useState(fallbackWarrantyNumber);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
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
        const [accountRows, health] = await Promise.all([
          api.accounts({ view: "light" }),
          api.health().catch(() => null),
        ]);
        if (!mounted.current || seq !== loadSeq.current) return;
        const claimable = accountRows.filter(isClaimableAccount);
        setAccounts(claimable);
        setWarrantyNumber(
          cleanWhatsapp(
            health?.warrantyWhatsAppNumber || fallbackWarrantyNumber,
          ),
        );
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
  const selectedWarrantyStatus = selectedAccount
    ? accountWarrantyStatus(selectedAccount)
    : "";
  const selectedExpired = selectedWarrantyStatus === "expired";
  const isExpiring = selectedAccount
    ? daysLeft(selectedAccount.expiresAt) > 0 &&
      daysLeft(selectedAccount.expiresAt) <= 5
    : false;
  const activeWarrantyCount = useMemo(
    () =>
      accounts.filter((account) => accountWarrantyStatus(account) === "active")
        .length,
    [accounts],
  );
  const expiringWarrantyCount = useMemo(
    () =>
      accounts.filter(
        (account) => accountWarrantyStatus(account) === "expiring",
      ).length,
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
        value: `${durationLabel(selectedAccount)} / ${remainingShort(selectedAccount)}`,
      },
      { label: "Status", value: warrantyStatusLabel(selectedAccount) },
    ];
    return fields;
  }, [selectedAccount]);

  function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSent(false);

    if (!selectedAccount) {
      setError("Pilih akun yang ingin diklaim.");
      return;
    }
    if (accountWarrantyStatus(selectedAccount) === "expired") {
      setError(
        "Akun ini sudah kedaluwarsa, klaim garansi tidak bisa dikirim. Hubungi admin bila tetap memerlukan pengecekan manual.",
      );
      return;
    }
    if (!description.trim()) {
      setError("Kendala wajib diisi.");
      return;
    }

    const message = buildWarrantyWhatsAppText(selectedAccount, description);
    window.open(
      `https://wa.me/${warrantyNumber}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setError("");
    setSent(true);
  }

  return (
    <DashboardLayout role="reseller" title="Garansi">
      <div className="space-y-5">
        <ResellerPageTitle
          title="Garansi"
          subtitle="Pilih akun, isi kendala, lalu kirim form klaim ke WhatsApp admin."
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
                    Form Klaim Garansi Otomatis
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
                      Screenshot bukti tetap dikirim di WhatsApp
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-700">
                      Sistem mengisi data akun otomatis. Reseller hanya perlu
                      menjelaskan kendala dan mengirim screenshot/foto bukti
                      bersama pesan WhatsApp.
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

              {error ? (
                <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              ) : null}
              {sent ? (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
                  WhatsApp sudah dibuka. Kirim pesan bersama screenshot/foto
                  bukti.
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading || !selectedAccount || selectedExpired}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <i className="ri-whatsapp-line" />
                Kirim Klaim via WhatsApp
              </button>
            </div>
          </form>
        </section> : null}
      </div>
    </DashboardLayout>
  );
}
