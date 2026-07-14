import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, subscribeRealtime, type AccountAccessLookupResult, type AccountAccessLookupType, type ApiReseller } from "../../../lib/api";
import type { ManagedAccount } from "../../../mocks/data";
import {
  MiniBadge,
  ResellerPageTitle,
  ResellerStatCard,
  accountStatus,
  accountStatusClass,
  productLabel,
} from "../resellerUi";

type AccessSource = "netflix" | "disney";
type AccessTool = AccountAccessLookupType;
type AccountGroup = {
  key: string;
  label: string;
  accounts: ManagedAccount[];
  primary: ManagedAccount;
};

const netflixTools: Array<{ id: AccessTool; label: string; icon: string; hint: string }> = [
  { id: "signin", label: "Sign-in Code", icon: "ri-key-2-line", hint: "Ambil 4 digit kode login terbaru" },
  { id: "verification", label: "Verification Code", icon: "ri-shield-keyhole-line", hint: "Ambil 6 digit kode verifikasi" },
  { id: "reset", label: "Reset Password", icon: "ri-lock-password-line", hint: "Ambil link reset password" },
  { id: "household", label: "Household", icon: "ri-home-wifi-line", hint: "Ambil kode/link household" },
];

const disneyTools: Array<{ id: AccessTool; label: string; icon: string; hint: string }> = [
  { id: "disney_otp", label: "Disney OTP", icon: "ri-smartphone-line", hint: "Ambil 4 digit OTP Disney dari label Gmail owner" },
];

function toolLabel(type: AccessTool) {
  return [...netflixTools, ...disneyTools].find((tool) => tool.id === type)?.label || "Account Access";
}

function valueLabel(type: AccessTool) {
  if (type === "signin") return "Sign-in code 4 digit";
  if (type === "verification") return "Verification code 6 digit";
  if (type === "reset") return "Link reset password";
  if (type === "household") return "Kode/link household";
  return "Disney OTP 4 digit";
}

function emptyText(type: AccessTool) {
  if (type === "signin") return "Belum ada sign-in code 4 digit untuk email ini.";
  if (type === "verification") return "Belum ada verification code 6 digit untuk email ini.";
  if (type === "reset") return "Belum ada link reset password untuk email ini.";
  if (type === "household") return "Belum ada kode/link household untuk email ini.";
  return "Belum ada Disney OTP 4 digit untuk nomor ini.";
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

function isNetflixAccount(account: ManagedAccount) {
  return [account.product, account.productId, account.variant, account.variantCode]
    .join(" ")
    .toLowerCase()
    .includes("netflix");
}

function isDisneyAccount(account: ManagedAccount) {
  return [account.product, account.productId, account.variant, account.variantCode]
    .join(" ")
    .toLowerCase()
    .includes("disney");
}

function monthNumber(value = "") {
  const key = String(value || "").trim().toLowerCase().replace(/\./g, "");
  const months: Record<string, number> = {
    jan: 0,
    januari: 0,
    feb: 1,
    februari: 1,
    mar: 2,
    maret: 2,
    apr: 3,
    april: 3,
    mei: 4,
    may: 4,
    jun: 5,
    juni: 5,
    jul: 6,
    juli: 6,
    agu: 7,
    agustus: 7,
    aug: 7,
    sep: 8,
    september: 8,
    okt: 9,
    oktober: 9,
    oct: 9,
    nov: 10,
    november: 10,
    des: 11,
    desember: 11,
    dec: 11,
  };
  return months[key];
}

function parseAccountDate(value = "") {
  const raw = String(value || "").trim();
  const monthMatch = raw.match(/^(\d{1,2})[\s/-]*([a-zA-Z]+)(?:[\s/-]+(\d{4}))?(?:[\s,]+(\d{1,2})[:.](\d{2}))?$/);
  if (monthMatch) {
    const month = monthNumber(monthMatch[2]);
    if (month !== undefined) return new Date(Number(monthMatch[3] || new Date().getFullYear()), month, Number(monthMatch[1]), Number(monthMatch[4] || 0), Number(monthMatch[5] || 0));
  }
  const hasTime = /\d{1,2}:\d{2}/.test(raw);
  const target = new Date(hasTime ? raw.replace(" ", "T") : `${raw}T00:00:00`);
  if (!Number.isNaN(target.getTime()) && !hasTime) target.setHours(23, 59, 59, 999);
  return target;
}

function isExpiredAccount(account?: ManagedAccount | AccountAccessLookupResult["account"] | null) {
  if (!account) return false;
  if (["expired", "replaced", "disabled"].includes(account.status)) return true;
  const target = parseAccountDate(account.expiresAt || "");
  return Boolean(account.expiresAt && !Number.isNaN(target.getTime()) && target.getTime() <= Date.now());
}

function inactiveLookupMessage(account?: ManagedAccount | AccountAccessLookupResult["account"] | null) {
  if (account?.status === "replaced") return "Akun sudah replaced, lookup kode tidak aktif.";
  if (account?.status === "disabled") return "Akun sudah nonaktif, lookup kode tidak aktif.";
  return "Akun sudah expired, lookup kode tidak aktif.";
}

function isUrl(value = "") {
  return /^https?:\/\//i.test(value.trim());
}

function sourceText(result: AccountAccessLookupResult) {
  if (result.result.source === "gmail") return result.gmail.mode === "imap" || result.result.mode === "imap" ? "Diambil dari label Gmail owner via IMAP" : "Diambil dari label Gmail owner";
  if (result.result.source === "managed_account") return "Data lama akun tidak dipakai untuk lookup otomatis";
  if (result.result.source === "mapping") return "Diambil dari mapping backend";
  if (result.result.source === "history") return "Akun ditemukan di riwayat reseller, tetapi statusnya sudah nonaktif";
  if (!result.gmail.connected) return result.gmail.mode === "imap" ? "Gmail IMAP owner belum tersambung" : "Gmail owner belum tersambung OAuth";
  return "Belum ditemukan di label Gmail owner";
}

function formatEmailDateWib(date = "", internalDate = "") {
  const timestamp = Number(internalDate || 0) || Date.parse(date || "");
  if (!Number.isFinite(timestamp) || timestamp <= 0) return date || "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function accountActiveLabel(account: AccountAccessLookupResult["account"]) {
  if (account.status === "replaced") return "Replaced";
  if (account.status === "disabled") return "Disabled";
  return isExpiredAccount(account) ? "Non-aktif" : "Aktif";
}

function accountActiveClass(account: AccountAccessLookupResult["account"]) {
  return accountActiveLabel(account) === "Aktif" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600";
}

function preferredAccount(accounts: ManagedAccount[]) {
  return accounts.find((account) => !isExpiredAccount(account)) || accounts[0];
}

function groupAccounts(accounts: ManagedAccount[], source: AccessSource): AccountGroup[] {
  const groups = new Map<string, ManagedAccount[]>();
  for (const account of accounts) {
    const key = source === "disney" ? normalizePhone(account.loginPhone || account.email || "") : normalizeEmail(account.email);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), account]);
  }
  return Array.from(groups.entries())
    .map(([key, groupRows]) => ({
      key,
      label: source === "disney" ? (groupRows[0]?.loginPhone || key) : key,
      accounts: groupRows,
      primary: preferredAccount(groupRows),
    }))
    .sort((a, b) => {
      const aActive = isExpiredAccount(a.primary) ? 0 : 1;
      const bActive = isExpiredAccount(b.primary) ? 0 : 1;
      if (aActive !== bActive) return bActive - aActive;
      return a.label.localeCompare(b.label);
    });
}

function groupDescription(group: AccountGroup, source: AccessSource) {
  const variants = Array.from(new Set(group.accounts.map((account) => productLabel(account)).filter(Boolean)));
  const profileCount = group.accounts.length;
  if (source === "disney") {
    const profiles = Array.from(new Set(group.accounts.map((account) => account.profile).filter(Boolean))).slice(0, 3);
    const base = variants.slice(0, 2).join(" / ") || productLabel(group.primary);
    const profileText = profiles.length ? ` - profil ${profiles.join(", ")}` : "";
    return `${base}${profileText}${profileCount > profiles.length ? ` +${profileCount - profiles.length}` : ""}`;
  }
  const base = variants.slice(0, 2).join(" / ") || productLabel(group.primary);
  return profileCount > 1 ? `${base} - ${profileCount} profil` : base;
}

function ResultPanel({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-100 bg-white p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <i className={`${icon} text-base`} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-950">{title}</h2>
            <div className="mt-3">{children}</div>
          </div>
        </div>
        {action}
      </div>
    </section>
  );
}

function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-700"
      title="Copy"
    >
      <i className={copied ? "ri-check-line" : "ri-file-copy-line"} />
    </button>
  );
}

function ValueBox({
  label,
  value,
  kind,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  kind?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  if (kind === "link" && isUrl(value)) {
    const fullUrl = value.trim();
    const host = (() => {
      try {
        return new URL(fullUrl).hostname;
      } catch {
        return "link";
      }
    })();
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-5">
        <p className="text-xs font-semibold text-red-700">{label}</p>
        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1 rounded-lg border border-red-100 bg-white/90 px-3 py-3">
            <p className="truncate text-sm font-semibold text-red-700">{host}</p>
            <p className="mt-1 text-xs text-slate-500">Link lengkap siap disalin ({fullUrl.length} karakter).</p>
          </div>
          <div className="flex gap-2">
            <CopyButton copied={copied} onCopy={onCopy} />
            <a
              href={fullUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <i className="ri-external-link-line" />
              Buka Link
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-100 bg-red-50 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-red-700">{label}</p>
          <p className="mt-3 font-mono text-2xl font-bold tracking-[0.18em] text-red-700">{value}</p>
        </div>
        <CopyButton copied={copied} onCopy={onCopy} />
      </div>
    </div>
  );
}

function EmptyResult({ text, details }: { text: string; details?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-500">
      <i className="ri-information-line text-2xl text-slate-400" />
      <p className="mt-2 font-medium">{text}</p>
      {details ? <p className="mt-1 text-xs">{details}</p> : null}
    </div>
  );
}

export default function ResellerAccountsPage() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [reseller, setReseller] = useState<ApiReseller | null>(null);
  const [lookup, setLookup] = useState("");
  const [activeSource, setActiveSource] = useState<AccessSource>("netflix");
  const [activeTool, setActiveTool] = useState<AccessTool>("signin");
  const [lookupResult, setLookupResult] = useState<AccountAccessLookupResult | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState("");
  const [lastRefresh, setLastRefresh] = useState("");

  const loadAccounts = useCallback(async () => {
    const [accountRows, resellerRows] = await Promise.all([api.accounts(), api.resellers()]);
    setAccounts(accountRows);
    setReseller(resellerRows[0] || null);
    setLastRefresh(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }, []);

  const netflixAccounts = useMemo(() => accounts.filter(isNetflixAccount), [accounts]);
  const disneyAccounts = useMemo(() => accounts.filter(isDisneyAccount), [accounts]);
  const netflixGroups = useMemo(() => groupAccounts(netflixAccounts, "netflix"), [netflixAccounts]);
  const disneyGroups = useMemo(() => groupAccounts(disneyAccounts, "disney"), [disneyAccounts]);

  const hasNetflix = netflixGroups.length > 0;
  const hasDisney = disneyGroups.length > 0;

  const netflixAllowedTools = useMemo(() => {
    const fallback: Array<"signin" | "verification" | "household"> = ["signin", "verification", "household"];
    const source = Array.isArray(reseller?.allowedAccessTools) ? reseller.allowedAccessTools : fallback;
    return netflixTools.filter((tool) => source.includes(tool.id as "signin" | "verification" | "reset" | "household"));
  }, [reseller]);

  const disneyAllowedTools = useMemo(() => (
    netflixAllowedTools.some((tool) => tool.id === "signin") ? disneyTools : []
  ), [netflixAllowedTools]);

  const currentGroups = activeSource === "disney" ? disneyGroups : netflixGroups;
  const currentTools = activeSource === "disney" ? disneyAllowedTools : netflixAllowedTools;
  const currentLookupLabel = activeSource === "disney" ? "Nomor Aktif" : "Email Aktif";
  const currentInactiveLabel = activeSource === "disney" ? "Nomor Non-Aktif" : "Email Non-Aktif";

  const activeCount = currentGroups.filter((group) => !isExpiredAccount(group.primary)).length;
  const inactiveCount = Math.max(0, currentGroups.length - activeCount);
  const lookupToolLabel = currentTools.find((tool) => tool.id === activeTool)?.label || "Lookup";

  const runLookup = useCallback(async (payload: { target: string; type: AccessTool }, options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    try {
      const result = await api.lookupAccountAccess({ target: payload.target, type: payload.type, silent: Boolean(options.silent) });
      setLookupResult(result);
      setLookupError("");
    } catch (error) {
      setLookupResult(null);
      if (!options.silent) {
        setLookupError(error instanceof Error ? error.message : "Lookup gagal");
      }
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts().catch(console.error);
    const unsubscribe = subscribeRealtime(() => {
      loadAccounts().catch(console.error);
    });
    return () => {
      unsubscribe();
    };
  }, [loadAccounts]);

  useEffect(() => {
    if (activeSource === "netflix" && !hasNetflix && hasDisney) {
      setActiveSource("disney");
      setLookup("");
      setLookupResult(null);
      setLookupError("");
      return;
    }
    if (activeSource === "disney" && !hasDisney && hasNetflix) {
      setActiveSource("netflix");
      setLookup("");
      setLookupResult(null);
      setLookupError("");
    }
  }, [activeSource, hasDisney, hasNetflix]);

  useEffect(() => {
    if (!currentTools.length) {
      if (activeTool !== "signin" && activeTool !== "disney_otp") setActiveTool("signin");
      setLookupResult(null);
      setLookupError("");
      return;
    }
    if (currentTools.some((tool) => tool.id === activeTool)) return;
    setActiveTool(currentTools[0].id);
    setLookupResult(null);
    setLookupError("");
  }, [activeTool, currentTools]);

  async function copyValue(id: string, text = "") {
    if (!text) return;
    const value = String(text || "").trim();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(id);
    window.setTimeout(() => setCopied(""), 1500);
  }

  function clearResult() {
    setLookupResult(null);
    setLookupError("");
  }

  function accountForTarget(target: string) {
    if (activeSource === "disney") {
      const normalized = normalizePhone(target);
      const matched = disneyAccounts.filter((account) => normalizePhone(account.loginPhone || account.email || "") === normalized);
      return matched.find((account) => !isExpiredAccount(account)) || matched[0] || null;
    }
    const normalized = normalizeEmail(target);
    const matched = netflixAccounts.filter((account) => normalizeEmail(account.email) === normalized);
    return matched.find((account) => !isExpiredAccount(account)) || matched[0] || null;
  }

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = activeSource === "disney" ? normalizePhone(lookup) : normalizeEmail(lookup);
    if (!target) {
      setLookupError(activeSource === "disney" ? "Nomor login Disney wajib diisi" : "Email akun wajib diisi");
      return;
    }
    const selectedAccount = accountForTarget(target);
    if (isExpiredAccount(selectedAccount)) {
      setLookupResult(null);
      setLookupError(inactiveLookupMessage(selectedAccount));
      return;
    }
    runLookup({ target, type: activeTool }).catch(console.error);
  }

  function renderResult() {
    if (!lookupResult) return null;
    const value = String(lookupResult.result.value || "").trim();
    const activeToolConfig = [...netflixTools, ...disneyTools].find((tool) => tool.id === lookupResult.type) || netflixTools[0];
    const source = sourceText(lookupResult);
    const targetLabel = lookupResult.type === "disney_otp"
      ? (lookupResult.account.loginPhone || lookupResult.account.email)
      : lookupResult.account.email;
    const detail = lookupResult.result.error || (lookupResult.result.reason === "not_found"
      ? lookupResult.type === "disney_otp"
        ? "Nomor ditemukan, tapi Disney OTP terbaru belum ada di label Gmail owner."
        : "Email ditemukan, tapi pesan/kode terbaru belum ada di label Gmail yang dipilih."
      : source);

    return (
      <>
        <section className="rounded-xl border border-slate-100 bg-white p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
                <i className="ri-shield-check-line" />
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-950">{targetLabel}</h2>
                <p className="mt-1 text-sm text-slate-500">{[lookupResult.account.product, lookupResult.account.variant].filter(Boolean).join(" - ")}</p>
              </div>
            </div>
            <MiniBadge className={accountActiveClass(lookupResult.account)}>{accountActiveLabel(lookupResult.account)}</MiniBadge>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Lookup manual dari label Gmail. Klik Cari Akun untuk membaca email terbaru. Update akun terakhir: {lastRefresh || lookupResult.refreshedAt}
          </p>
        </section>

        <ResultPanel title={toolLabel(lookupResult.type)} icon={activeToolConfig.icon}>
          {value ? (
            <>
              <ValueBox
                label={lookupResult.result.label || valueLabel(lookupResult.type)}
                value={value}
                kind={lookupResult.result.kind}
                copied={copied === lookupResult.type}
                onCopy={() => copyValue(lookupResult.type, value)}
              />
              <p className="mt-3 text-xs text-slate-500">{source}</p>
              {lookupResult.result.date ? (
                <p className="mt-1 text-xs text-slate-400">
                  Email date (WIB): {formatEmailDateWib(lookupResult.result.date, lookupResult.result.internalDate)}
                </p>
              ) : null}
            </>
          ) : (
            <EmptyResult text={emptyText(lookupResult.type)} details={detail} />
          )}
        </ResultPanel>
      </>
    );
  }

  const typedAccount = lookup.trim() ? accountForTarget(lookup) : null;
  const lookupDisabled = !currentTools.length || Boolean(typedAccount && isExpiredAccount(typedAccount));
  const sourceLabel = activeSource === "disney" ? "Nomor yang Tersedia" : "Email yang Tersedia";
  const sourceHint = activeSource === "disney"
    ? "Klik nomor login Disney untuk mengisi kolom pencarian, lalu klik Cari Akun."
    : "Klik email untuk mengisi kolom pencarian, lalu klik Cari Akun.";
  const sourceRefreshText = activeSource === "disney"
    ? `Tersedia ${currentGroups.length} nomor Disney untuk akses OTP.`
    : `Tersedia ${currentGroups.length} email Netflix untuk akses bantuan.`;

  return (
    <DashboardLayout role="reseller" title="Account Access">
      <div className="space-y-5">
        <ResellerPageTitle title="Account Access" subtitle="Lookup kode sign-in, verification code, reset password, household, dan Disney OTP dari label Gmail owner tanpa buka email owner." />

        <div className="grid gap-4 md:grid-cols-3">
          <ResellerStatCard label={currentLookupLabel} value={activeCount} icon={activeSource === "disney" ? "ri-smartphone-line" : "ri-mail-check-line"} tone="emerald" hint="Masih bisa dipakai untuk lookup" />
          <ResellerStatCard label={currentInactiveLabel} value={inactiveCount} icon={activeSource === "disney" ? "ri-smartphone-line" : "ri-mail-close-line"} tone="red" hint="Sudah expired atau nonaktif" />
          <ResellerStatCard label="Tool Dipilih" value={currentTools.length ? lookupToolLabel : "Dikunci Owner"} icon="ri-key-2-line" tone="blue" hint={currentTools.length ? "Mode lookup yang sedang aktif" : "Owner belum memberi akses tool"} />
        </div>

        <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm shadow-slate-950/5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveSource("netflix");
                setLookup("");
                clearResult();
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${activeSource === "netflix" ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Netflix
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveSource("disney");
                setLookup("");
                clearResult();
              }}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${activeSource === "disney" ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Disney
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <i className="ri-time-line" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-amber-900">{activeSource === "disney" ? "Disney OTP 15 menit" : "Kode 15 menit, link 24 jam"}</h2>
              <p className="mt-1 text-xs leading-5 text-amber-700">
                {activeSource === "disney"
                  ? "Mode Disney membaca label Gmail khusus DISNEY_CODE. Reseller cukup pakai nomor login Disney; email OTP owner tetap disembunyikan dari panel reseller."
                  : "Mode Netflix membaca label Gmail khusus NF_SIGNIN, NF_VERIF, NF_RESET, dan NF_HOUSE. Lookup dilakukan manual saat tombol Cari Akun ditekan."}
              </p>
            </div>
          </div>
        </div>

        <div className="sticky top-16 z-30 isolate -mx-4 border-b border-white/60 bg-[#f2ece2] px-4 py-3 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.45)] md:-mx-6 md:px-6">
          <div className="space-y-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm shadow-slate-950/5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {currentTools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    setActiveTool(tool.id);
                    clearResult();
                  }}
                  className={`rounded-xl border px-3 py-3 text-left transition-colors ${activeTool === tool.id ? "border-red-100 bg-red-50 text-red-600" : "border-slate-100 bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold">
                    <i className={tool.icon} />
                    <span className="truncate">{tool.label}</span>
                  </span>
                  <span className="mt-1 hidden text-[11px] leading-4 text-slate-400 sm:block">{tool.hint}</span>
                </button>
              ))}
            </div>

            {!currentTools.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
                Owner belum mengaktifkan akses tool untuk mode {activeSource === "disney" ? "Disney" : "Netflix"} di akun reseller ini.
              </div>
            ) : null}

            <form onSubmit={submitLookup} className="flex flex-col gap-3 md:flex-row">
              <label className="relative block flex-1">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <i className={activeSource === "disney" ? "ri-smartphone-line text-sm" : "ri-mail-line text-sm"} />
                </span>
                <input
                  value={lookup}
                  onChange={(event) => {
                    setLookup(event.target.value);
                    clearResult();
                  }}
                  className="h-11 w-full rounded-xl border border-slate-100 bg-white pl-10 pr-4 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-red-200"
                  placeholder={activeSource === "disney" ? "Masukkan nomor login Disney" : "Masukkan email akun"}
                />
              </label>
              <button
                type="submit"
                disabled={loading || lookupDisabled}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-6 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-wait disabled:bg-red-300"
              >
                <i className={loading ? "ri-loader-4-line animate-spin" : "ri-search-line"} />
                {loading ? "Mencari..." : "Cari Akun"}
              </button>
            </form>
          </div>
        </div>

        {!!currentGroups.length ? (
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm shadow-slate-950/5">
            {sourceRefreshText} Refresh terakhir <span className="font-semibold text-slate-900">{lastRefresh || "-"}</span>.
          </div>
        ) : null}

        {lookupError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-medium text-red-700">
            {lookupError}
          </div>
        ) : null}

        {renderResult()}

        <section className="overflow-hidden rounded-xl border border-slate-100 bg-white">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-base font-bold text-slate-950">{sourceLabel}</h2>
            <p className="mt-1 text-xs text-slate-500">{sourceHint}</p>
          </div>
          <div className="divide-y divide-slate-50">
            {currentGroups.map((group) => (
              <button
                key={group.key}
                type="button"
                onClick={() => {
                  setLookup(group.label);
                  clearResult();
                  if (isExpiredAccount(group.primary)) {
                    setLookupError(inactiveLookupMessage(group.primary));
                  }
                }}
                className={`flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 ${isExpiredAccount(group.primary) ? "opacity-75" : ""}`}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-50 text-slate-400">
                  <i className={activeSource === "disney" ? "ri-smartphone-line text-sm" : "ri-mail-line text-sm"} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{group.label}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{groupDescription(group, activeSource)}</p>
                </div>
                <MiniBadge className={accountStatusClass(group.primary)}>{accountStatus(group.primary)}</MiniBadge>
                <i className="ri-arrow-right-s-line text-slate-300" />
              </button>
            ))}
            {!currentGroups.length ? (
              <div className="py-10 text-center text-sm text-slate-500">
                Belum ada {activeSource === "disney" ? "nomor Disney" : "email Netflix"} yang bisa diakses.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
