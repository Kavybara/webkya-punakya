import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel, OwnerStat, PageToolbar, SearchBox } from "../../../components/feature/OwnerUi";
import { api, subscribeRealtime, type AccountAuditResult, type ApiProduct, type ApiReseller, type ApiStockItem } from "../../../lib/api";
import type { ManagedAccount, Product } from "../../../mocks/data";

type AccountForm = Pick<
  ManagedAccount,
  "email" | "password" | "profile" | "pin" | "startedAt" | "expiresAt" | "status" | "signInCode" | "verificationCode" | "resetLink" | "householdLink"
>;

type ManualAccountForm = {
  resellerId: string;
  productId: string;
  variantId: string;
  usageMode: "monthly" | "daily";
  email: string;
  password: string;
  profile: string;
  pin: string;
  startedAt: string;
  durationDays: string;
  expiresAt: string;
};

type ReplaceForm = {
  replacementStockId: string;
  oldAccountDisposition: "release_via_sheets" | "keep_sold";
  reason: string;
};

type ToastState = {
  id: number;
  text: string;
  type: "success" | "error" | "info";
};

const emptyManualForm: ManualAccountForm = {
  resellerId: "",
  productId: "",
  variantId: "",
  usageMode: "monthly",
  email: "",
  password: "",
  profile: "",
  pin: "",
  startedAt: todayInput(),
  durationDays: "30",
  expiresAt: "",
};

function todayInput() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nowDateTimeInput() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addDaysInput(dateText: string, days: number, keepTime = false) {
  const source = dateText || (keepTime ? nowDateTimeInput() : todayInput());
  const date = new Date(keepTime ? source.replace(" ", "T") : `${source}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Math.max(1, Math.floor(days || 1)));
  const pad = (value: number) => String(value).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return keepTime ? `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}` : datePart;
}

function hasTimePart(value = "") {
  return /\d{1,2}:\d{2}/.test(String(value));
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

function accountDate(value = "", options: { endOfDay?: boolean; referenceDate?: Date } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return new Date(Number.NaN);
  const monthMatch = raw.match(/^(\d{1,2})[\s/-]*([a-zA-Z]+)(?:[\s/-]+(\d{4}))?(?:[\s,]+(\d{1,2})[:.](\d{2}))?$/);
  if (monthMatch) {
    const month = monthNumber(monthMatch[2]);
    if (month !== undefined) {
      const reference = options.referenceDate && !Number.isNaN(options.referenceDate.getTime()) ? options.referenceDate : null;
      const year = Number(monthMatch[3] || reference?.getFullYear() || new Date().getFullYear());
      const hasTime = Boolean(monthMatch[4]);
      const date = new Date(year, month, Number(monthMatch[1]), Number(monthMatch[4] || 0), Number(monthMatch[5] || 0));
      if (!monthMatch[3] && reference && date.getTime() < reference.getTime() - 86400000) {
        date.setFullYear(date.getFullYear() + 1);
      }
      if (options.endOfDay && !hasTime) date.setHours(23, 59, 59, 999);
      return date;
    }
  }
  const normalized = raw.replace(" ", "T");
  const date = new Date(hasTimePart(raw) ? normalized : `${raw}T00:00:00`);
  if (!Number.isNaN(date.getTime()) && options.endOfDay && !hasTimePart(raw)) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function accountExpiryDate(account: ManagedAccount) {
  const startedAt = accountDate(account.startedAt);
  return accountDate(account.expiresAt, { endOfDay: true, referenceDate: startedAt });
}

function toDateTimeInput(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00`;
  return raw.replace(" ", "T").slice(0, 16);
}

function fromDateTimeInput(value = "") {
  return String(value || "").trim().replace("T", " ");
}

function normalizeCode(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
}

function isNetflixPrivateVariant(product?: Product, variant?: Product["variants"][number]) {
  if (!product || !variant) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  return (productText.includes("netflix") || normalizeCode(product.code) === "NET") && variantText.includes("private") && !variantText.includes("semi");
}

function isNetflixSharedVariant(product?: Product, variant?: Product["variants"][number]) {
  if (!product || !variant) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  return (productText.includes("netflix") || normalizeCode(product.code) === "NET") && (variantText.includes("1p1u") || variantText.includes("semi"));
}

function isNetflixTwoUserVariant(product?: Product, variant?: Product["variants"][number]) {
  if (!product || !variant) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  return (productText.includes("netflix") || normalizeCode(product.code) === "NET") && (/\b2u\b/.test(variantText) || variantText.includes("2p1u") || variantText.includes("1p2u"));
}

function isViuVariant(product?: Product, variant?: Product["variants"][number]) {
  if (!product || !variant || variant.isActive === false) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  return productText.includes("viu") || normalizeCode(product.code) === "VIU";
}

function isVidioPlatinumVariant(product?: Product, variant?: Product["variants"][number]) {
  if (!product || !variant || variant.isActive === false) return false;
  const productText = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  return (productText.includes("vidio") || normalizeCode(product.code) === "VIDIO") && variantText.includes("platinum");
}

function variantPoolKey(product?: Product, variant?: Product["variants"][number]) {
  if (!product || !variant) return "";
  const variantText = [variant.id, variant.code, variant.name].join(" ").toLowerCase();
  if (isNetflixSharedVariant(product, variant)) return `${product.id}::netflix-1p1u-semi`;
  if (isNetflixTwoUserVariant(product, variant)) return `${product.id}::netflix-2u`;
  if (isViuVariant(product, variant)) return `${product.id}::viu`;
  if (isVidioPlatinumVariant(product, variant) && /\btv\b/.test(variantText)) return `${product.id}::vidio-platinum-tv`;
  if (isVidioPlatinumVariant(product, variant) && (variantText.includes("mobile") || variantText.includes("hp") || variantText.includes("phone"))) return `${product.id}::vidio-platinum-mobile`;
  if (isVidioPlatinumVariant(product, variant) && (variantText.includes("all") || variantText.includes("device") || variantText.includes("alldev"))) return `${product.id}::vidio-platinum-all-device`;
  return `${product.id}::${variant.id}`;
}

function stockPoolKey(products: ApiProduct[], stock: ApiStockItem) {
  const product = products.find((item) => item.id === stock.productId);
  const variant = product?.variants?.find((item) => item.id === stock.variantId);
  return variantPoolKey(product, variant);
}

function replacementStockMatches(products: ApiProduct[], account: ManagedAccount, stock: ApiStockItem) {
  if (stock.status !== "available" || stock.productId !== account.productId) return false;
  const product = products.find((item) => item.id === account.productId);
  const variant = product?.variants?.find((item) => item.id === account.variantId);
  const accountPool = account.stockPoolKey || variantPoolKey(product, variant);
  return stockPoolKey(products, stock) === accountPool;
}

function accountPoolKey(products: ApiProduct[], account: ManagedAccount) {
  if (account.stockPoolKey) return account.stockPoolKey;
  const product = products.find((item) => item.id === account.productId);
  const variant = product?.variants?.find((item) => item.id === account.variantId);
  return variantPoolKey(product, variant);
}

function isNetflixAccount(account: ManagedAccount) {
  return [account.product, account.productId, account.variant, account.variantCode].join(" ").toLowerCase().includes("netflix");
}

function orderableVariants(product?: Product) {
  return (product?.variants || []).filter((variant) => variant.isActive !== false && !isNetflixPrivateVariant(product, variant));
}

function isDisneyManagedAccount(account: ManagedAccount) {
  return [account.product, account.productId, account.variant, account.variantCode, account.sheetPool]
    .join(" ")
    .toLowerCase()
    .includes("disney");
}

function managedAccountIdentity(account: ManagedAccount) {
  return isDisneyManagedAccount(account) ? (account.loginPhone || account.email || "-") : (account.email || "-");
}

function accountManageProducts(products: ApiProduct[]) {
  return products.filter((product) => !product.isArchived);
}

function daysLeft(account: ManagedAccount) {
  const target = accountExpiryDate(account);
  if (Number.isNaN(target.getTime())) return 0;
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

function accountComputedStatus(account: ManagedAccount) {
  if (account.status === "replaced" || account.status === "disabled") return account.status;
  const days = daysLeft(account);
  const durationDays = Number(account.durationDays || 0);
  if (days <= 0) return "expired";
  if (durationDays >= 30 && days <= 5) return "expiring";
  return "active";
}

function remainingLabel(account: ManagedAccount) {
  if (account.status === "replaced") return "Replaced";
  if (account.status === "disabled") return "Disabled";
  if (!account.expiresAt) return "-";
  const target = accountExpiryDate(account);
  if (Number.isNaN(target.getTime())) return "-";
  const msLeft = target.getTime() - Date.now();
  if (accountComputedStatus(account) === "expired" || msLeft <= 0) return "Expired";
  const hours = Math.ceil(msLeft / 3600000);
  if (hours < 48) return `${hours} jam`;
  const remainingDays = Math.ceil(hours / 24);
  const durationDays = Number(account.durationDays || 0);
  return `${durationDays > 0 ? Math.min(remainingDays, durationDays) : remainingDays} hari`;
}

function statusTone(account: ManagedAccount) {
  const status = accountComputedStatus(account);
  if (status === "replaced") return "info";
  if (status === "disabled") return "red";
  if (status === "expired") return "red";
  if (status === "expiring") return "amber";
  return "emerald";
}

function canArchiveNonNetflixAccount(account: ManagedAccount) {
  return !isNetflixAccount(account) && ["expired", "replaced", "disabled"].includes(accountComputedStatus(account));
}

function durationLabel(account: ManagedAccount) {
  const rawDuration = String(account.duration || "").trim();
  const amount = Number(rawDuration.match(/\d+/)?.[0] || 0);
  if (/^\d+\s*b$/i.test(rawDuration) || /\bbulan\b|\bmonth/i.test(rawDuration)) return `${amount || 1} Bulan`;
  if (/^\d+\s*[dh]$/i.test(rawDuration) || /\bhari\b|\bday/i.test(rawDuration)) return `${amount || account.durationDays || 1} Hari`;
  if (/\bjam\b|\bhour\b|\bhr\b/i.test(rawDuration)) return `${amount || 1} Jam`;
  if (rawDuration) return rawDuration;
  if (account.durationDays && !account.duration) return `${account.durationDays} hari`;
  if (!account.startedAt || !account.expiresAt) return "-";
  const start = accountDate(account.startedAt);
  const end = accountDate(account.expiresAt, { endOfDay: true, referenceDate: start });
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
  return `${Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000))} hari`;
}

function displayAccountDate(value = "", referenceValue = "") {
  const reference = accountDate(referenceValue);
  const date = accountDate(value, { referenceDate: reference });
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function accountToForm(account: ManagedAccount): AccountForm {
  return {
    email: account.email || "",
    password: account.password || "",
    profile: account.profile || "",
    pin: account.pin || "",
    startedAt: account.startedAt || "",
    expiresAt: account.expiresAt || "",
    status: account.status || "active",
    signInCode: account.signInCode || "",
    verificationCode: account.verificationCode || "",
    resetLink: account.resetLink || "",
    householdLink: account.householdLink || "",
  };
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-red-300"
      />
    </label>
  );
}

function scrollToElement(id = "") {
  if (!id || typeof document === "undefined") return;
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

export default function AccountsPage() {
  const [params] = useSearchParams();
  const accountParam = params.get("account")?.trim() || "";
  const [query, setQuery] = useState(accountParam);
  const [statusFilter, setStatusFilter] = useState(accountParam ? "all" : "active");
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [stock, setStock] = useState<ApiStockItem[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualAccountForm>(emptyManualForm);
  const [creatingManual, setCreatingManual] = useState(false);
  const [editing, setEditing] = useState<ManagedAccount | null>(null);
  const [form, setForm] = useState<AccountForm>(() => accountToForm({} as ManagedAccount));
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState<ManagedAccount | null>(null);
  const [replaceForm, setReplaceForm] = useState<ReplaceForm>({ replacementStockId: "", oldAccountDisposition: "release_via_sheets", reason: "" });
  const [replaceSaving, setReplaceSaving] = useState(false);
  const [returningAccount, setReturningAccount] = useState<ManagedAccount | null>(null);
  const [auditAccount, setAuditAccount] = useState<ManagedAccount | null>(null);
  const [auditResult, setAuditResult] = useState<AccountAuditResult | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warrantyText?: string } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState("");

  function focusAccountFilter(nextFilter: string) {
    setStatusFilter(nextFilter);
    scrollToElement("accounts-filter-toolbar");
  }

  async function loadData() {
    const [accountRows, productRows, resellerRows, stockRows] = await Promise.all([api.accounts(), api.products(), api.resellers(), api.stock()]);
    const manageableProducts = accountManageProducts(productRows);
    setAccounts(accountRows);
    setProducts(productRows);
    setResellers(resellerRows);
    setStock(stockRows);
    setManualForm((current) => {
      const productId = current.productId || manageableProducts[0]?.id || "";
      const product = manageableProducts.find((item) => item.id === productId) || manageableProducts[0];
      return {
        ...current,
        resellerId: current.resellerId || resellerRows[0]?.id || "",
        productId,
        variantId: current.variantId || orderableVariants(product)[0]?.id || "",
      };
    });
  }

  useEffect(() => {
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  useEffect(() => {
    setQuery(accountParam);
    if (accountParam) setStatusFilter("all");
  }, [accountParam]);

  useEffect(() => {
    if (!accountParam || !accounts.some((item) => item.id === accountParam)) return;
    scrollToElement(`account-row-${accountParam}`);
  }, [accountParam, accounts]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showToast(text: string, type: ToastState["type"] = "success") {
    setToast({ id: Date.now(), text, type });
  }

  function openEdit(account: ManagedAccount) {
    setEditing(account);
    setForm(accountToForm(account));
    setError("");
  }

  function closeEdit() {
    setEditing(null);
    setError("");
  }

  function replacementCandidates(account: ManagedAccount) {
    return stock.filter((item) => replacementStockMatches(products, account, item));
  }

  function openReplace(account: ManagedAccount) {
    const candidates = replacementCandidates(account);
    const netflixAccount = isNetflixAccount(account);
    setReplacing(account);
    setReplaceForm({
      replacementStockId: candidates[0]?.id || "",
      oldAccountDisposition: netflixAccount ? "release_via_sheets" : "keep_sold",
      reason: "",
    });
    setNotice(null);
    setError("");
  }

  async function openAudit(account: ManagedAccount) {
    setAuditAccount(account);
    setAuditResult(null);
    setAuditLoading(true);
    setError("");
    try {
      setAuditResult(await api.accountAudit(account.id));
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : "Audit akun gagal dimuat.");
    } finally {
      setAuditLoading(false);
    }
  }

  function closeReplace() {
    setReplacing(null);
    setReplaceSaving(false);
    setError("");
  }

  async function saveReplace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!replacing) return;
    if (!replaceForm.replacementStockId) {
      setError("Pilih stok pengganti dulu.");
      return;
    }
    setReplaceSaving(true);
    setError("");
    try {
      const result = await api.replaceAccount(replacing.id, replaceForm);
      await loadData();
      setNotice({
        text: `${replacing.email} berhasil direplace ke ${result.newAccount.email}.`,
        warrantyText: result.warrantyCompleteText,
      });
      closeReplace();
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : "Replace akun gagal");
    } finally {
      setReplaceSaving(false);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (!form.email.trim()) {
      setError("Email akun wajib diisi.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.updateAccount(editing.id, form);
      await loadData();
      closeEdit();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Akun gagal diperbarui");
    } finally {
      setSaving(false);
    }
  }

  function accountsReturnedTogether(account: ManagedAccount) {
    if (!isNetflixAccount(account)) return [];
    const emailKey = account.email.trim().toLowerCase();
    const poolKey = accountPoolKey(products, account);
    return accounts.filter((item) => {
      if (item.returnedToStockAt || item.hidden || ["replaced", "disabled"].includes(accountComputedStatus(item))) return false;
      if (item.id === account.id) return true;
      if (!emailKey || item.email.trim().toLowerCase() !== emailKey) return false;
      if (!poolKey || accountPoolKey(products, item) !== poolKey) return false;
      return accountComputedStatus(item) === "expired";
    });
  }

  function openReturnConfirm(account: ManagedAccount) {
    const isNetflix = isNetflixAccount(account);
    if (!isNetflix && !canArchiveNonNetflixAccount(account)) {
      setError("Akun non-Netflix yang masih aktif tidak bisa dihapus dari manajemen.");
      return;
    }
    setError("");
    setReturningAccount(account);
  }

  function closeReturnConfirm() {
    if (saving) return;
    setReturningAccount(null);
  }

  async function confirmReturnAccount() {
    if (!returningAccount) return;
    const account = returningAccount;
    setSaving(true);
    setError("");
    try {
      await api.deleteAccount(account.id);
      await loadData();
      setReturningAccount(null);
      const noticeText = `${managedAccountIdentity(account)} berhasil dihapus dari Manajemen Akun.`;
      setNotice({ text: noticeText });
      showToast(noticeText, "success");
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Akun gagal diproses";
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  function openManualModal() {
    const product = manageableProducts.find((item) => item.id === manualForm.productId) || manageableProducts[0];
    setManualForm({
      ...emptyManualForm,
      resellerId: manualForm.resellerId || resellers[0]?.id || "",
      productId: product?.id || "",
      variantId: orderableVariants(product)[0]?.id || "",
      startedAt: todayInput(),
      durationDays: "30",
      usageMode: "monthly",
    });
    setError("");
    setManualOpen(true);
  }

  function closeManualModal() {
    setManualOpen(false);
    setError("");
  }

  function setManualProduct(productId: string) {
    const product = manageableProducts.find((item) => item.id === productId);
    setManualForm((current) => ({
      ...current,
      productId,
      variantId: orderableVariants(product)[0]?.id || "",
    }));
  }

  async function saveManualAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualForm.resellerId || !manualForm.productId || !manualForm.variantId || !manualForm.email.trim()) {
      setError("Reseller, produk, varian, dan email wajib diisi.");
      return;
    }
    setCreatingManual(true);
    setError("");
    try {
      await api.createAccount({
        ...manualForm,
        usageMode: manualForm.usageMode,
        startedAt: manualForm.usageMode === "daily" ? fromDateTimeInput(manualForm.startedAt) : manualForm.startedAt,
        durationDays: Number(manualForm.durationDays || 30),
        expiresAt: manualForm.expiresAt
          ? manualForm.usageMode === "daily"
            ? fromDateTimeInput(manualForm.expiresAt)
            : manualForm.expiresAt
          : addDaysInput(manualForm.startedAt, Number(manualForm.durationDays || 30), manualForm.usageMode === "daily"),
      } as Partial<ManagedAccount>);
      await loadData();
      closeManualModal();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Akun manual gagal ditambahkan");
    } finally {
      setCreatingManual(false);
    }
  }

  const rows = useMemo(
    () =>
      accounts
        .filter((item) => statusFilter === "all" || accountComputedStatus(item) === statusFilter)
        .filter((item) =>
          [item.id, item.email, item.loginPhone, item.otpEmail, item.reseller, item.buyer, item.product, item.variant, item.profile, item.pin, item.stockId]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    [accounts, query, statusFilter],
  );
  const statusCounts = useMemo(
    () => ({
      all: accounts.length,
      active: accounts.filter((item) => accountComputedStatus(item) === "active").length,
      expiring: accounts.filter((item) => accountComputedStatus(item) === "expiring").length,
      expired: accounts.filter((item) => accountComputedStatus(item) === "expired").length,
      replaced: accounts.filter((item) => accountComputedStatus(item) === "replaced").length,
    }),
    [accounts],
  );
  const manageableProducts = useMemo(() => accountManageProducts(products), [products]);
  const manualProduct = manageableProducts.find((item) => item.id === manualForm.productId) || manageableProducts[0];
  const manualVariants = orderableVariants(manualProduct);
  const returnBatch = returningAccount ? [returningAccount] : [];
  const returnBatchPasswords = Array.from(new Set(returnBatch.map((item) => String(item.password || "").trim()).filter(Boolean)));

  return (
    <DashboardLayout role="owner" title="Manajemen Akun">
      {toast ? (
        <div
          key={toast.id}
          className={`fixed left-1/2 top-5 z-[90] flex min-h-11 min-w-[280px] max-w-[calc(100vw-32px)] -translate-x-1/2 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-center text-xs font-semibold shadow-lg animate-toast-rise ${
            toast.type === "error"
              ? "border-red-100 bg-red-50 text-red-700"
              : toast.type === "info"
                ? "border-blue-100 bg-blue-50 text-blue-700"
                : "border-emerald-100 bg-emerald-50 text-emerald-700"
          }`}
        >
          <i className={toast.type === "error" ? "ri-close-circle-line" : toast.type === "info" ? "ri-information-line" : "ri-check-line"} />
          <span>{toast.text}</span>
        </div>
      ) : null}

      <div className="sticky top-16 z-40 isolate -mx-3 mt-2 space-y-3 border-b border-white/60 bg-[#f2ece2] px-3 py-3 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.45)] sm:-mx-4 sm:px-4 md:-mx-6 md:space-y-4 md:px-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <OwnerStat label="Semua" value={accounts.length} active={statusFilter === "all"} onClick={() => focusAccountFilter("all")} />
          <OwnerStat label="Aktif" value={statusCounts.active} active={statusFilter === "active"} onClick={() => focusAccountFilter("active")} />
          <OwnerStat label="Expiring" value={statusCounts.expiring} active={statusFilter === "expiring"} onClick={() => focusAccountFilter("expiring")} />
          <OwnerStat label="Expired" value={statusCounts.expired} active={statusFilter === "expired"} onClick={() => focusAccountFilter("expired")} />
        </div>

        {notice ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-700">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <span>{notice.text}</span>
              {notice.warrantyText ? (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(notice.warrantyText || "")}
                  className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <i className="ri-file-copy-line" />
                  Copy Warranty Complete
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
          <span className="mr-2 inline-flex h-4 w-4 items-center justify-center">
            <i className="ri-information-line" />
          </span>
          Jika reseller melapor akun bermasalah, klik edit untuk replace email/password akun aktif. History expired tetap disimpan sebagai snapshot dan tidak ikut sinkron password.
        </div>

        <div id="accounts-filter-toolbar">
          <PageToolbar>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <SearchBox value={query} onChange={setQuery} placeholder="Cari email, reseller, atau produk..." />
              </div>
              <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
                {[
                  ["all", "Semua", statusCounts.all],
                  ["active", "Aktif", statusCounts.active],
                  ["expiring", "Expiring", statusCounts.expiring],
                  ["expired", "Expired", statusCounts.expired],
                  ["replaced", "Replaced", statusCounts.replaced],
                ].map(([id, label, count]) => (
                  <button
                    key={String(id)}
                    type="button"
                    onClick={() => setStatusFilter(String(id))}
                    className={`h-9 rounded-md px-4 text-xs font-medium transition-colors ${
                      statusFilter === id ? "bg-[#2b2b2b] text-white" : "bg-[#f7f1e8] text-slate-700 hover:bg-white"
                    }`}
                  >
                    {label} <span className="ml-1 text-[10px] opacity-70">({count})</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={openManualModal}
                disabled={!manageableProducts.length}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#2b2b2b] px-4 text-xs font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <i className="ri-add-line" />
                {manageableProducts.length ? "Tambah Akun Manual" : "Tidak Ada Produk Aktif"}
              </button>
            </div>
          </div>
          {accountParam ? (
            <div className="mt-3 rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700">
              Fokus ke akun <span className="font-semibold">{accountParam}</span>. Filter dibuka ke semua status supaya row target langsung kelihatan.
            </div>
          ) : null}
          </PageToolbar>
        </div>
      </div>

      <DataPanel className="mt-4 overflow-hidden p-0">
        <div className="kavya-mobile-scroll-hint">Geser tabel ke samping untuk melihat detail akun dan tombol aksi.</div>
        <div className="max-h-[calc(100vh-360px)] min-h-[360px] overflow-auto">
          <table className="w-full min-w-[1120px] text-left text-xs">
            <thead className="sticky top-0 z-20 bg-[#fbf8f2] text-slate-400 shadow-sm shadow-slate-950/5">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Reseller</th>
                <th className="px-4 py-3 font-medium">Email Akun</th>
                <th className="px-4 py-3 font-medium">Produk</th>
                <th className="px-4 py-3 font-medium">Variant</th>
                <th className="px-4 py-3 font-medium">Profil</th>
                <th className="px-4 py-3 font-medium">PIN</th>
                <th className="px-4 py-3 font-medium">Tgl Beli</th>
                <th className="px-4 py-3 font-medium">Durasi</th>
                <th className="px-4 py-3 font-medium">Expiry</th>
                <th className="px-4 py-3 font-medium">Sisa</th>
                <th className="sticky right-0 z-30 bg-[#fbf8f2] px-4 py-3 text-right font-medium shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const tone = statusTone(item);
                return (
                  <tr
                    key={item.id}
                    id={`account-row-${item.id}`}
                    className={`border-t border-gray-100 text-slate-700 transition-colors ${item.id === accountParam ? "bg-sky-50/70" : ""}`}
                  >
                    <td className="px-4 py-4 font-medium uppercase">{item.id.replace("acc", "MGT")}</td>
                    <td className="px-4 py-4 font-semibold text-slate-800">{item.reseller || item.buyer}</td>
                    <td className="max-w-[220px] truncate px-4 py-4 font-medium text-slate-800">{item.email}</td>
                    <td className="px-4 py-4">
                      <Badge variant={item.product.includes("Netflix") ? "red" : item.product.includes("Spotify") ? "emerald" : "amber"}>
                        {item.product.split(" ")[0]}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">{item.variant || "-"}</td>
                    <td className="px-4 py-4">{item.profile || "-"}</td>
                    <td className="px-4 py-4">{item.pin || "-"}</td>
                    <td className="px-4 py-4">{displayAccountDate(item.startedAt)}</td>
                    <td className="px-4 py-4">{durationLabel(item)}</td>
                    <td className="px-4 py-4">{displayAccountDate(item.expiresAt, item.startedAt)}</td>
                    <td className="px-4 py-4">
                      <Badge variant={tone}>{remainingLabel(item)}</Badge>
                    </td>
                    <td className="sticky right-0 bg-[#fbf8f2] px-4 py-4 shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">
                      <div className="flex min-w-[190px] justify-end gap-2 text-slate-400">
                        <button
                          type="button"
                          onClick={() => openAudit(item)}
                          aria-label="Riwayat audit akun"
                          title="Riwayat audit akun"
                          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-sky-50 hover:text-sky-600"
                        >
                          <i className="ri-history-line" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openReplace(item)}
                          disabled={["expired", "replaced", "disabled"].includes(accountComputedStatus(item))}
                          aria-label="Replace dari stok"
                          title="Replace dari stok"
                          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <i className="ri-shield-check-line" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          aria-label="Edit / replace akun"
                          title="Edit / replace akun"
                          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                          <i className="ri-edit-2-line" />
                        </button>
                        {canArchiveNonNetflixAccount(item) ? (
                          <button
                            type="button"
                            onClick={() => openReturnConfirm(item)}
                            aria-label="Hapus dari manajemen"
                            title="Hapus dari manajemen"
                            className="h-7 rounded-md px-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
                          >
                            Hapus
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">
                    Belum ada akun.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DataPanel>

      {auditAccount ? (
        <div className="fixed inset-0 z-50 bg-black/45" onMouseDown={() => setAuditAccount(null)}>
          <aside className="ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-slate-400">Audit Trail Akun</p>
                <h2 className="mt-1 truncate text-lg font-semibold text-slate-950">{auditAccount.email || auditAccount.id}</h2>
                <p className="mt-1 text-xs text-slate-500">{auditAccount.profile || "Tanpa profil"} · {auditAccount.reseller || auditAccount.buyer || "-"}</p>
              </div>
              <button type="button" aria-label="Tutup audit" title="Tutup" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setAuditAccount(null)}>
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="grid grid-cols-3 border-b border-slate-100 px-5 py-3 text-xs">
              <div><p className="text-slate-400">Order</p><p className="mt-1 truncate font-semibold text-slate-800">{auditResult?.orderId || "-"}</p></div>
              <div><p className="text-slate-400">Stock</p><p className="mt-1 truncate font-semibold text-slate-800">{auditResult?.stockId || "-"}</p></div>
              <div><p className="text-slate-400">Sheets</p><p className="mt-1 font-semibold text-slate-800">{auditResult?.sheet.name || "-"} #{auditResult?.sheet.row || "-"}</p></div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {auditLoading ? <div className="py-12 text-center text-sm text-slate-500"><i className="ri-loader-4-line mr-2 animate-spin" />Memuat riwayat...</div> : null}
              {!auditLoading && auditResult?.timeline.length ? (
                <div className="border-l border-slate-200 pl-5">
                  {auditResult.timeline.map((event) => (
                    <div key={event.id} className="relative pb-5 last:pb-0">
                      <span className="absolute -left-[25px] top-1 h-2 w-2 rounded-full bg-sky-500" />
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                        <time className="shrink-0 text-[11px] text-slate-400">{displayAccountDate(event.createdAt)}</time>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{event.detail}</p>
                      <p className="mt-1 text-[10px] uppercase text-slate-400">{event.source}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {!auditLoading && auditResult && !auditResult.timeline.length ? <p className="py-12 text-center text-sm text-slate-500">Belum ada riwayat akun.</p> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {returningAccount ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Konfirmasi Hapus Akun</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Data ini hanya diarsipkan dari Manajemen Akun dan tidak mengubah stok Google Sheets.
                </p>
              </div>
              <button
                type="button"
                onClick={closeReturnConfirm}
                disabled={saving}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                aria-label="Tutup"
              >
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
              Akun non-Netflix tidak akan masuk stok lagi setelah dihapus dari Manajemen Akun.
            </div>

            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-slate-100">
              {returnBatch.map((account) => (
                <div key={account.id} className="grid gap-2 border-b border-slate-100 px-4 py-3 text-xs last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px_100px] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{managedAccountIdentity(account)}</p>
                    <p className="mt-0.5 truncate text-slate-500">
                      {[account.reseller || account.buyer, account.variant, account.profile].filter(Boolean).join(" - ") || account.id}
                    </p>
                  </div>
                  <span className="text-slate-500">{displayAccountDate(account.expiresAt, account.startedAt)}</span>
                  <Badge variant={statusTone(account)}>{remainingLabel(account)}</Badge>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={closeReturnConfirm}
                disabled={saving}
                className="h-11 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmReturnAccount}
                disabled={saving || !returnBatch.length}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#2b2b2b] text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-wait disabled:bg-slate-300"
              >
                <i className={saving ? "ri-loader-4-line animate-spin" : "ri-delete-bin-line"} />
                {saving ? "Memproses..." : "Hapus dari Manajemen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {manualOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <form onSubmit={saveManualAccount} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">Tambah Akun Manual / Harian</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Untuk akun yang sudah pernah dibeli manual. Akun langsung muncul di Manage Account reseller dan tidak masuk stok available.
                </p>
              </div>
              <button type="button" onClick={closeManualModal} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="space-y-5 p-5">
              {error ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">{error}</div> : null}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">Reseller Tujuan</span>
                  <select
                    value={manualForm.resellerId}
                    onChange={(event) => setManualForm({ ...manualForm, resellerId: event.target.value })}
                    className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-slate-800 outline-none transition-colors focus:border-red-300"
                  >
                    <option value="">Pilih reseller</option>
                    {resellers.map((reseller) => (
                      <option key={reseller.id} value={reseller.id}>
                        {reseller.name || reseller.username} - {reseller.whatsapp}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">Produk</span>
                  <select
                    value={manualForm.productId}
                    onChange={(event) => setManualProduct(event.target.value)}
                    className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-slate-800 outline-none transition-colors focus:border-red-300"
                  >
                    {manageableProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">Varian Customer</span>
                  <select
                    value={manualForm.variantId}
                    onChange={(event) => setManualForm({ ...manualForm, variantId: event.target.value })}
                    className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-slate-800 outline-none transition-colors focus:border-red-300"
                  >
                    {manualVariants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.name} ({variant.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">Jenis Akses</span>
                  <select
                    value={manualForm.usageMode}
                    onChange={(event) => {
                      const usageMode = event.target.value as ManualAccountForm["usageMode"];
                      setManualForm({
                        ...manualForm,
                        usageMode,
                        startedAt: usageMode === "daily" ? nowDateTimeInput() : todayInput(),
                        durationDays: usageMode === "daily" ? "1" : "30",
                        expiresAt: "",
                      });
                    }}
                    className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-slate-800 outline-none transition-colors focus:border-red-300"
                  >
                    <option value="monthly">Bulanan / manual</option>
                    <option value="daily">Harian dengan jam</option>
                  </select>
                </label>
                <Field label="Email Akun" value={manualForm.email} onChange={(value) => setManualForm({ ...manualForm, email: value })} placeholder="email@domain.com" />
                <Field label="Password / Link" value={manualForm.password} onChange={(value) => setManualForm({ ...manualForm, password: value })} placeholder="Password atau link akun" />
                <Field label="Profile" value={manualForm.profile} onChange={(value) => setManualForm({ ...manualForm, profile: value })} placeholder="Opsional" />
                <Field label="PIN" value={manualForm.pin} onChange={(value) => setManualForm({ ...manualForm, pin: value })} placeholder="Opsional" />
                <Field label="Tanggal Beli" type={manualForm.usageMode === "daily" ? "datetime-local" : "date"} value={manualForm.startedAt} onChange={(value) => setManualForm({ ...manualForm, startedAt: value })} />
                <Field label="Durasi Hari" type="number" value={manualForm.durationDays} onChange={(value) => setManualForm({ ...manualForm, durationDays: value })} placeholder="30" />
                <Field label="Tanggal Expired" type={manualForm.usageMode === "daily" ? "datetime-local" : "date"} value={manualForm.expiresAt} onChange={(value) => setManualForm({ ...manualForm, expiresAt: value })} />
              </div>

              <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                Kalau tanggal expired dikosongkan, sistem otomatis hitung dari tanggal beli + durasi hari.
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-gray-100 p-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeManualModal} className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Batal
              </button>
              <button type="submit" disabled={creatingManual} className="h-10 rounded-lg bg-red-600 px-5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-wait disabled:bg-red-300">
                {creatingManual ? "Menyimpan..." : "Simpan Akun Manual"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {replacing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <form onSubmit={saveReplace} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">Replace Akun dari Stok</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Akun baru memakai sisa durasi akun lama. Akun lama tetap mengikuti row Google Sheets, jadi release reuse dilakukan dari Sheets lalu sync.
                </p>
              </div>
              <button type="button" onClick={closeReplace} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="space-y-5 p-5">
              {error ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">{error}</div> : null}

              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                Akun lama: <strong>{replacing.email}</strong> untuk <strong>{replacing.reseller || replacing.buyer}</strong>. Status history reseller akan menjadi <strong>Replaced</strong>.
              </div>

              <label className="block">
                <span className="text-xs font-medium text-slate-700">Stok Pengganti</span>
                <select
                  value={replaceForm.replacementStockId}
                  onChange={(event) => setReplaceForm({ ...replaceForm, replacementStockId: event.target.value })}
                  className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-slate-800 outline-none transition-colors focus:border-red-300"
                >
                  <option value="">Pilih stok available</option>
                  {replacementCandidates(replacing).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.email} - {item.profile || "-"} {item.pin ? `/ ${item.pin}` : ""}
                    </option>
                  ))}
                </select>
                {!replacementCandidates(replacing).length ? (
                  <span className="mt-2 block text-xs text-red-600">Belum ada stok available di pool yang sama.</span>
                ) : null}
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-xs leading-5 text-emerald-700">
                  <input
                    type="radio"
                    name="oldAccountDisposition"
                    checked={replaceForm.oldAccountDisposition !== "keep_sold"}
                    disabled={!isNetflixAccount(replacing)}
                    onChange={() => setReplaceForm({ ...replaceForm, oldAccountDisposition: "release_via_sheets" })}
                    className="mr-2"
                  />
                  Akun lama normal, release reuse dilakukan dari Sheets.
                </label>
                <label className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-xs leading-5 text-amber-700">
                  <input
                    type="radio"
                    name="oldAccountDisposition"
                    checked={replaceForm.oldAccountDisposition === "keep_sold"}
                    onChange={() => setReplaceForm({ ...replaceForm, oldAccountDisposition: "keep_sold" })}
                    className="mr-2"
                  />
                  Akun lama bermasalah, tahan untuk cek manual.
                </label>
              </div>
              {!isNetflixAccount(replacing) ? (
                <p className="text-xs text-amber-700">
                  Akun non-Netflix tidak direlease ulang lewat web. Replace akan menyimpan akun lama untuk cek manual.
                </p>
              ) : null}

              <label className="block">
                <span className="text-xs font-medium text-slate-700">Catatan Replace</span>
                <textarea
                  value={replaceForm.reason}
                  onChange={(event) => setReplaceForm({ ...replaceForm, reason: event.target.value.slice(0, 240) })}
                  className="mt-2 h-24 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition-colors focus:border-red-300"
                  placeholder="Contoh: household, profile error, akun masih normal setelah dicek, dll."
                />
              </label>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-gray-100 p-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeReplace} className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Batal
              </button>
              <button type="submit" disabled={replaceSaving || !replaceForm.replacementStockId} className="h-10 rounded-lg bg-emerald-600 px-5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:bg-emerald-300">
                {replaceSaving ? "Memproses..." : "Replace Akun"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
          <form onSubmit={saveEdit} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">Edit / Replace Akun</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Mengubah email atau password di sini menyinkronkan akun aktif. Akun expired tetap menjadi history lama.
                </p>
              </div>
              <button type="button" onClick={closeEdit} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="space-y-5 p-5">
              {error ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">{error}</div> : null}

              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
                Akun lama: <strong>{editing.email}</strong> untuk <strong>{editing.reseller || editing.buyer}</strong>. Jika email diganti, Activity Log akan mencatat <strong>Account replaced into email ...</strong>.
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Email Akun Baru" value={form.email} onChange={(value) => setForm({ ...form, email: value })} placeholder="email@domain.com" />
                <Field label="Password / Link" value={form.password || ""} onChange={(value) => setForm({ ...form, password: value })} placeholder="Password atau link akun" />
                <Field label="Profile" value={form.profile || ""} onChange={(value) => setForm({ ...form, profile: value })} placeholder="Nama profile" />
                <Field label="PIN" value={form.pin || ""} onChange={(value) => setForm({ ...form, pin: value })} placeholder="PIN akun" />
                <Field label="Tanggal Mulai" type="datetime-local" value={toDateTimeInput(form.startedAt || "")} onChange={(value) => setForm({ ...form, startedAt: fromDateTimeInput(value) })} />
                <Field label="Tanggal Expired" type="datetime-local" value={toDateTimeInput(form.expiresAt || "")} onChange={(value) => setForm({ ...form, expiresAt: fromDateTimeInput(value) })} />
                <label className="block">
                  <span className="text-xs font-medium text-slate-700">Status</span>
                  <select
                    value={form.status}
                    onChange={(event) => setForm({ ...form, status: event.target.value as ManagedAccount["status"] })}
                    className="mt-2 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-slate-800 outline-none transition-colors focus:border-red-300"
                  >
                    <option value="active">Active</option>
                    <option value="expiring">Expiring</option>
                    <option value="expired">Expired</option>
                    <option value="replaced">Replaced</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-700">
                Jika password/link diubah, data untuk email yang sama otomatis ikut berubah di stok dan semua akun reseller yang masih aktif. Profile dan PIN tetap manual.
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Sign-in Code Manual" value={form.signInCode || ""} onChange={(value) => setForm({ ...form, signInCode: value })} placeholder="Opsional fallback 4 digit" />
                <Field label="Verification Code Manual" value={form.verificationCode || ""} onChange={(value) => setForm({ ...form, verificationCode: value })} placeholder="Opsional fallback 6 digit" />
                <Field label="Reset Password Link" value={form.resetLink || ""} onChange={(value) => setForm({ ...form, resetLink: value })} placeholder="Opsional fallback link" />
                <Field label="Household Link" value={form.householdLink || ""} onChange={(value) => setForm({ ...form, householdLink: value })} placeholder="Opsional fallback link" />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-gray-100 p-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeEdit} className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Batal
              </button>
              <button type="submit" disabled={saving} className="h-10 rounded-lg bg-red-600 px-5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-wait disabled:bg-red-300">
                {saving ? "Menyimpan..." : "Simpan Replace"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </DashboardLayout>
  );
}

