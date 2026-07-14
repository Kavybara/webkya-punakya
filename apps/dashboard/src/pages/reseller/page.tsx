import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "../../components/feature/DashboardLayout";
import { api, subscribeRealtime, type ApiActivity, type ApiOrder, type ApiPayment, type ApiReseller, type ResellerDepositInstructions } from "../../lib/api";
import type { ManagedAccount } from "../../mocks/data";
import {
  ResellerPageTitle,
  ResellerStatCard,
  accountActive,
  accountStatus,
  compactDate,
  daysLeft,
  durationLabel,
  money,
  orderPaid,
  productLabel,
  remainingShort,
} from "./resellerUi";

function todayKey() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function activityType(order: ApiOrder) {
  if (order.qrisStatus === "expired" || order.orderStatus === "cancelled") return "Error";
  if (orderPaid(order)) return "Success";
  return "Info";
}

function activityClass(type: string) {
  if (type === "Success") return "bg-emerald-50 text-emerald-700";
  if (type === "Error") return "bg-red-50 text-red-600";
  if (type === "Warning") return "bg-amber-50 text-amber-700";
  return "bg-slate-50 text-slate-600";
}

function activityIcon(type: string) {
  if (type === "Success") return "ri-check-line";
  if (type === "Error") return "ri-close-line";
  if (type === "Warning") return "ri-alert-line";
  return "ri-information-line";
}

function isDepositActivity(activity: ApiActivity) {
  const text = [activity.title, activity.description].join(" ").toLowerCase();
  return text.includes("deposit") || text.includes("saldo");
}

function isAccessActivity(activity: ApiActivity) {
  return activity.type === "security";
}

function accessTypeLabel(type = "") {
  if (type === "signin") return "Sign-in";
  if (type === "verification") return "Verification";
  if (type === "reset") return "Reset";
  if (type === "household") return "Household";
  return "Access";
}

function accessStatusLabel(status = "") {
  const lower = status.toLowerCase();
  if (lower === "success") return "Berhasil";
  if (lower.includes("expired")) return "Expired";
  if (lower.includes("not_found") || lower.includes("belum")) return "Belum ada";
  if (lower.includes("gmail")) return "Gmail error";
  return status || "Diproses";
}

function accessStatusClass(status = "") {
  const lower = status.toLowerCase();
  if (lower === "success") return "bg-emerald-50 text-emerald-700";
  if (lower.includes("expired") || lower.includes("disabled") || lower.includes("replaced")) return "bg-red-50 text-red-600";
  return "bg-amber-50 text-amber-700";
}

function sourceLabel(source = "") {
  if (source === "gmail") return "Gmail";
  if (source === "managed_account") return "Manual";
  if (source === "fallback") return "Fallback";
  return source || "-";
}

function depositMethodLabel(method = "") {
  if (method === "qris_auto") return "Deposit otomatis QRIS";
  if (method === "qris_owner") return "QRIS owner manual";
  if (method === "dana") return "DANA";
  if (method === "livin") return "Livin Mandiri";
  if (method === "bca") return "BCA";
  if (method === "gopay") return "GoPay";
  if (method === "shopeepay") return "ShopeePay";
  return method || "-";
}

const depositMethodOrder = ["qris_auto", "qris_owner", "dana", "livin", "bca", "gopay", "shopeepay"];

function depositMethodDetails(method: string, instructions: ResellerDepositInstructions | null) {
  const channel = instructions?.methods?.[method] || null;
  const available = method === "qris_auto" ? Boolean(channel?.available) : Boolean(channel?.available);
  return {
    channel,
    available,
  };
}

function qrImageSource(payment: ApiPayment | null) {
  if (!payment) return "";
  if (payment.qrImageUrl) return payment.qrImageUrl;
  const qrData = payment.qrString || payment.qrisText || payment.paymentUrl || "";
  if (!qrData) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(qrData)}`;
}

function compactDateTime(value = "") {
  if (!value) return "-";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function orderTrackerLabel(order: ApiOrder) {
  const delivery = String(order.deliveryStatus || "").toLowerCase();
  const payment = String(order.qrisStatus || "").toLowerCase();
  if (delivery === "failed") return "Delivery gagal";
  if (delivery === "sent" || order.orderStatus === "completed") return "Selesai";
  if (payment === "expired" || order.orderStatus === "cancelled") return "Expired";
  if (payment === "paid" || ["paid", "processing", "paid_after_expired", "paid_by_deposit"].includes(delivery)) return "Sedang diproses";
  return "Menunggu bayar";
}

function orderTrackerClass(order: ApiOrder) {
  const label = orderTrackerLabel(order);
  if (label === "Selesai") return "bg-emerald-50 text-emerald-700";
  if (label === "Delivery gagal" || label === "Expired") return "bg-red-50 text-red-600";
  if (label === "Sedang diproses") return "bg-amber-50 text-amber-700";
  return "bg-slate-50 text-slate-600";
}

function orderRuntimeType(order: ApiOrder) {
  const runtime = order as Record<string, unknown>;
  return String(runtime.type || runtime.orderType || "").toLowerCase();
}

function quickStatusLabel(status = "") {
  if (status === "pending") return "Menunggu";
  if (status === "open") return "Berjalan";
  return "Aman";
}

function isDisneyManagedAccount(account: ManagedAccount) {
  return [account.product, account.productId, account.variant, account.variantCode]
    .join(" ")
    .toLowerCase()
    .includes("disney");
}

function resellerAccountIdentity(account: ManagedAccount) {
  return isDisneyManagedAccount(account) ? (account.loginPhone || account.email || "-") : (account.email || "-");
}

type OverviewAccountFilter = "active" | "expiring" | "inactive";
type OverviewOrderFilter = "open" | "today" | "all";
type OverviewFocus = "deposit" | "orders" | "accounts" | "tools" | "";

export default function ResellerOverviewPage() {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [activities, setActivities] = useState<ApiActivity[]>([]);
  const [reseller, setReseller] = useState<ApiReseller | null>(null);
  const [depositInstructions, setDepositInstructions] = useState<ResellerDepositInstructions | null>(null);
  const [depositRequestOpen, setDepositRequestOpen] = useState(false);
  const [depositRequestAmount, setDepositRequestAmount] = useState("");
  const [depositRequestMethod, setDepositRequestMethod] = useState("qris_auto");
  const [depositRequestNote, setDepositRequestNote] = useState("");
  const [depositRequestSubmitting, setDepositRequestSubmitting] = useState(false);
  const [depositRequestMessage, setDepositRequestMessage] = useState<string | null>(null);
  const [depositRequestError, setDepositRequestError] = useState<string | null>(null);
  const [depositPaymentOrder, setDepositPaymentOrder] = useState<ApiOrder | null>(null);
  const [depositPayment, setDepositPayment] = useState<ApiPayment | null>(null);
  const [accountFilter, setAccountFilter] = useState<OverviewAccountFilter>("active");
  const [orderFilter, setOrderFilter] = useState<OverviewOrderFilter>("open");
  const [focusedArea, setFocusedArea] = useState<OverviewFocus>("");
  const [overviewDefaultsReady, setOverviewDefaultsReady] = useState(false);
  const accountSectionRef = useRef<HTMLElement | null>(null);
  const orderSectionRef = useRef<HTMLElement | null>(null);
  const depositSectionRef = useRef<HTMLElement | null>(null);
  const toolsSectionRef = useRef<HTMLElement | null>(null);

  async function loadData() {
    const [orderRows, accountRows, activityRows, resellerRows, depositInstructionRows] = await Promise.all([
      api.orders(),
      api.accounts({ view: "overview" }),
      api.activities(),
      api.resellers(),
      api.resellerDepositInstructions(),
    ]);
    setOrders(orderRows);
    setAccounts(accountRows);
    setActivities(activityRows);
    setReseller(resellerRows[0] || null);
    setDepositInstructions(depositInstructionRows);
  }

  async function submitDepositRequest() {
    const amount = Number(depositRequestAmount || 0);
    if (!amount || amount <= 0) {
      setDepositRequestError("Masukkan nominal deposit yang valid.");
      setDepositRequestMessage(null);
      return;
    }

    if (depositRequestMethod === "qris_auto" && !depositInstructions?.methods?.qris_auto?.available) {
      const fallbackMethod = depositMethodOrder.find((method) => method !== "qris_auto" && depositInstructions?.methods?.[method]?.available);
      setDepositRequestError("QRIS otomatis sedang tidak tersedia karena Pakasir disconnected. Pilih QRIS owner manual atau metode bank lain.");
      setDepositRequestMessage(null);
      if (fallbackMethod) setDepositRequestMethod(fallbackMethod);
      return;
    }

    setDepositRequestSubmitting(true);
    setDepositRequestError(null);
    setDepositRequestMessage(null);
    try {
      const result = await api.requestResellerDeposit({
        amount,
        method: depositRequestMethod,
        note: depositRequestNote,
      });
      const createdPayment = result?.paymentRef ? (result.payment || await api.payment(result.paymentRef)) : null;
      const createdOrder = result?.orderId ? await api.order(result.orderId) : null;
      setDepositRequestMessage(result?.message || "Permintaan deposit terkirim.");
      setDepositRequestOpen(false);
      setDepositRequestAmount("");
      setDepositRequestMethod("qris_auto");
      setDepositRequestNote("");
      setDepositPayment(createdPayment);
      setDepositPaymentOrder(createdOrder);
      await loadData();
    } catch (error) {
      setDepositRequestError(error instanceof Error ? error.message : "Gagal mengirim permintaan deposit.");
    } finally {
      setDepositRequestSubmitting(false);
    }
  }

  function openDepositRequest() {
    setDepositRequestError(null);
    setDepositRequestMessage(null);
    setDepositRequestOpen(true);
  }

  function closeDepositRequest() {
    if (depositRequestSubmitting) return;
    setDepositRequestOpen(false);
    setDepositRequestError(null);
  }

  function closeDepositPayment() {
    setDepositPayment(null);
    setDepositPaymentOrder(null);
  }

  useEffect(() => {
    if (!depositInstructions) return;
    if (depositRequestMethod !== "qris_auto") return;
    if (depositInstructions.methods?.qris_auto?.available !== false) return;
    const fallbackMethod = depositMethodOrder.find((method) => method !== "qris_auto" && depositInstructions.methods?.[method]?.available);
    if (fallbackMethod) setDepositRequestMethod(fallbackMethod);
  }, [depositInstructions, depositRequestMethod]);

  useEffect(() => {
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  useEffect(() => {
    const sections: Array<{ key: Exclude<OverviewFocus, "">; ref: RefObject<HTMLElement | null> }> = [
      { key: "tools", ref: toolsSectionRef },
      { key: "accounts", ref: accountSectionRef },
      { key: "orders", ref: orderSectionRef },
      { key: "deposit", ref: depositSectionRef },
    ];
    let ticking = false;

    const updateFocusedArea = () => {
      ticking = false;
      const visible = sections
        .map((section) => {
          const node = section.ref.current;
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return {
            key: section.key,
            topDistance: Math.abs(rect.top - 132),
            inViewport: rect.top < window.innerHeight * 0.7 && rect.bottom > 120,
          };
        })
        .filter(Boolean) as Array<{ key: Exclude<OverviewFocus, "">; topDistance: number; inViewport: boolean }>;
      const next = visible
        .filter((item) => item.inViewport)
        .sort((left, right) => left.topDistance - right.topDistance)[0];
      if (next?.key) setFocusedArea((current) => (current === next.key ? current : next.key));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateFocusedArea);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.setTimeout(updateFocusedArea, 120);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  function focusSection(section: Exclude<OverviewFocus, "">, options: { accountFilter?: OverviewAccountFilter; orderFilter?: OverviewOrderFilter } = {}) {
    if (options.accountFilter) setAccountFilter(options.accountFilter);
    if (options.orderFilter) setOrderFilter(options.orderFilter);
    setFocusedArea(section);
    const target = section === "accounts"
      ? accountSectionRef.current
      : section === "orders"
        ? orderSectionRef.current
        : section === "tools"
          ? toolsSectionRef.current
          : depositSectionRef.current;
    if (!target) return;
    window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  const today = todayKey();
  const todayOrders = orders.filter((order) => String(order.createdAt || "").startsWith(today));
  const activeAccounts = accounts.filter(accountActive);
  const inactiveAccounts = accounts.filter((account) => !accountActive(account));
  const expiringAccounts = accounts.filter((account) => accountStatus(account) === "Expiring");
  const pendingOrdersCount = orders.filter((order) => String(order.qrisStatus || "").toLowerCase() === "pending").length;
  const depositActivities = activities.filter(isDepositActivity).slice(0, 4);
  const accessActivities = activities.filter(isAccessActivity).slice(0, 6);
  const depositUsedToday = todayOrders.reduce((sum, order) => sum + Number(order.depositUsed || 0), 0);
  const pendingPaymentDue = orders
    .filter((order) => order.qrisStatus === "pending")
    .reduce((sum, order) => sum + Number(order.paymentDue || 0), 0);
  const selectedDepositInstruction = depositInstructions?.methods?.[depositRequestMethod] || null;
  const qrisAutoAvailable = Boolean(depositInstructions?.methods?.qris_auto?.available);
  const depositMethodAvailable = depositRequestMethod === "qris_auto" ? qrisAutoAvailable : Boolean(selectedDepositInstruction?.available);
  const canSubmitDepositRequest = depositMethodAvailable;
  const depositMethodChoices = depositMethodOrder
    .map((method) => ({
      value: method,
      label: depositMethodLabel(method),
      available: method === "qris_auto" ? qrisAutoAvailable : Boolean(depositInstructions?.methods?.[method]?.available),
    }))
    .filter((item) => item.available);
  const activeDepositInstruction = depositMethodDetails(depositRequestMethod, depositInstructions);
  const depositQrSrc = qrImageSource(depositPayment);
  const depositQrTotal = Number(depositPayment?.totalPayment || depositPayment?.amount || depositPaymentOrder?.paymentDue || 0);
  const openOrders = useMemo(
    () => orders.filter((order) => !orderPaid(order) || String(order.deliveryStatus || "").toLowerCase() !== "sent"),
    [orders],
  );
  const ordersQuickStatus = pendingOrdersCount > 0 ? "pending" : openOrders.length > 0 ? "open" : "clear";
  const depositQuickStatus = pendingPaymentDue > 0 ? "pending" : "clear";
  const activeAccountsSorted = useMemo(() => {
    const base = accountFilter === "inactive"
      ? inactiveAccounts
      : accountFilter === "expiring"
        ? expiringAccounts
        : activeAccounts;
    return [...base].sort((left, right) => daysLeft(left.expiresAt) - daysLeft(right.expiresAt)).slice(0, 5);
  }, [accountFilter, activeAccounts, expiringAccounts, inactiveAccounts]);
  const trackerOrders = useMemo(() => {
    const base = orderFilter === "today" ? todayOrders : orderFilter === "all" ? orders : openOrders;
    return [...base]
      .sort((left, right) => new Date(String(right.createdAt || "").replace(" ", "T")).getTime() - new Date(String(left.createdAt || "").replace(" ", "T")).getTime())
      .slice(0, 5);
  }, [openOrders, orderFilter, orders, todayOrders]);

  useEffect(() => {
    if (overviewDefaultsReady) return;
    if (!orders.length && !accounts.length) return;
    if (!activeAccounts.length) {
      if (expiringAccounts.length) setAccountFilter("expiring");
      else if (inactiveAccounts.length) setAccountFilter("inactive");
    }
    if (!openOrders.length && orders.length) {
      if (todayOrders.length) setOrderFilter("today");
      else setOrderFilter("all");
    }
    setOverviewDefaultsReady(true);
  }, [accounts.length, activeAccounts.length, expiringAccounts.length, inactiveAccounts.length, openOrders.length, orders.length, overviewDefaultsReady, todayOrders.length]);
  const depositLedger = useMemo(() => {
    const orderEntries = orders
      .filter((order) => orderRuntimeType(order) === "deposit_topup" || Number(order.depositUsed || 0) > 0)
      .map((order) => ({
        id: `order-${order.id}`,
        title: orderRuntimeType(order) === "deposit_topup" ? "Top up saldo" : "Saldo dipakai untuk order",
        detail: orderRuntimeType(order) === "deposit_topup"
          ? `${money(Number(order.total || order.paymentDue || 0))} - ${orderTrackerLabel(order)}`
          : `${order.product} ${order.duration || ""} - ${money(Number(order.depositUsed || 0))}`,
        createdAt: order.createdAt || "",
        tone: orderRuntimeType(order) === "deposit_topup" ? "emerald" : "amber",
      }));
    const activityEntries = activities
      .filter(isDepositActivity)
      .map((activity) => ({
        id: activity.id,
        title: activity.title || "Deposit activity",
        detail: activity.description || "-",
        createdAt: activity.createdAt || "",
        tone: "slate",
      }));
    return [...orderEntries, ...activityEntries]
      .sort((left, right) => new Date(String(right.createdAt || "").replace(" ", "T")).getTime() - new Date(String(left.createdAt || "").replace(" ", "T")).getTime())
      .slice(0, 6);
  }, [activities, orders]);

  const activityLog = useMemo(() => {
    const orderActivities = orders.slice(0, 7).map((order) => {
      const type = activityType(order);
      return {
        id: order.id,
        title: orderPaid(order) ? `Membeli ${order.product} ${order.duration}` : `Order ${order.id} ${order.qrisStatus}`,
        date: order.createdAt,
        type,
      };
    });

    const accountActivities = accounts.slice(0, 3).map((account) => {
      const warning = accountStatus(account) === "Expiring";
      return {
        id: account.id,
        title: warning ? `Durasi akun ${account.product} tinggal ${daysLeft(account.expiresAt)} hari` : `Melihat detail akun ${productLabel(account)}`,
        date: account.startedAt,
        type: warning ? "Warning" : "Info",
      };
    });

    const accountChangeActivities = activities
      .filter((activity) => activity.type === "account")
      .slice(0, 7)
      .map((activity) => ({
        id: activity.id,
        title: activity.title,
        date: activity.createdAt,
        type: activity.title.toLowerCase().includes("diganti") || activity.type === "security" ? "Warning" : "Info",
      }));

    return [...accountChangeActivities, ...orderActivities, ...accountActivities]
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 10);
  }, [accounts, activities, orders]);

  return (
    <DashboardLayout role="reseller" title="Overview">
      <div className="space-y-5">
        <ResellerPageTitle title="Overview" subtitle="Berikut ringkasan aktivitas Anda hari ini" />

        <div className="sticky top-14 z-20 -mx-3 border-y border-slate-100 bg-[#f2ece2]/95 px-3 py-2 backdrop-blur sm:hidden">
          <div className="flex gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={() => focusSection("tools")} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${focusedArea === "tools" ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>Tools<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${focusedArea === "tools" ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"}`}>4</span></button>
            <button type="button" onClick={() => focusSection("accounts", { accountFilter: accountFilter })} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${focusedArea === "accounts" ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-600"}`}>Accounts<span className={`rounded-full px-1.5 py-0.5 text-[10px] ${focusedArea === "accounts" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{accounts.length}</span></button>
            <button
              type="button"
              onClick={() => focusSection("orders", { orderFilter: orderFilter })}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                focusedArea === "orders"
                  ? ordersQuickStatus === "clear"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-amber-50 text-amber-700"
                  : ordersQuickStatus === "clear"
                    ? "bg-white text-slate-600"
                    : "bg-amber-50/70 text-amber-700"
              }`}
            >
              Orders
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                focusedArea === "orders"
                  ? ordersQuickStatus === "clear"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-amber-100 text-amber-700"
                  : ordersQuickStatus === "clear"
                    ? "bg-slate-100 text-slate-500"
                    : "bg-amber-100 text-amber-700"
              }`}>{orders.length}</span>
              <span className={`text-[10px] uppercase tracking-wide ${
                focusedArea === "orders"
                  ? ordersQuickStatus === "clear"
                    ? "text-blue-700"
                    : "text-amber-700"
                  : ordersQuickStatus === "clear"
                    ? "text-slate-400"
                    : "text-amber-700"
              }`}>{quickStatusLabel(ordersQuickStatus)}</span>
            </button>
            <button
              type="button"
              onClick={() => focusSection("deposit")}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                focusedArea === "deposit"
                  ? depositQuickStatus === "pending"
                    ? "bg-red-50 text-red-700"
                    : "bg-amber-50 text-amber-700"
                  : depositQuickStatus === "pending"
                    ? "bg-red-50/80 text-red-700"
                    : "bg-white text-slate-600"
              }`}
            >
              Deposit
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                focusedArea === "deposit"
                  ? depositQuickStatus === "pending"
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-700"
                  : depositQuickStatus === "pending"
                    ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-500"
              }`}>{pendingOrdersCount}</span>
              <span className={`text-[10px] uppercase tracking-wide ${
                focusedArea === "deposit"
                  ? depositQuickStatus === "pending"
                    ? "text-red-700"
                    : "text-amber-700"
                  : depositQuickStatus === "pending"
                    ? "text-red-700"
                    : "text-slate-400"
              }`}>{quickStatusLabel(depositQuickStatus)}</span>
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
          <div className="flex snap-x gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-2 md:overflow-visible md:pb-0 xl:grid-cols-5">
            <ResellerStatCard className="min-w-[188px] snap-start md:min-w-0" label="Saldo Deposit" value={money(Number(reseller?.deposit || 0))} icon="ri-wallet-3-line" tone="amber" hint="Fokus ke saldo" active={focusedArea === "deposit"} onClick={() => focusSection("deposit")} />
            <ResellerStatCard className="min-w-[188px] snap-start md:min-w-0" label="Order Hari Ini" value={todayOrders.length} icon="ri-shopping-cart-2-line" tone="emerald" hint="Filter hari ini" active={focusedArea === "orders" && orderFilter === "today"} onClick={() => focusSection("orders", { orderFilter: "today" })} />
            <ResellerStatCard className="min-w-[188px] snap-start md:min-w-0" label="Total Order" value={orders.length} icon="ri-stack-line" tone="blue" hint="Lihat semua" active={focusedArea === "orders" && orderFilter === "all"} onClick={() => focusSection("orders", { orderFilter: "all" })} />
            <ResellerStatCard className="min-w-[188px] snap-start md:min-w-0" label="Akun Aktif" value={activeAccounts.length} icon="ri-shield-check-line" tone="emerald" hint="Filter aktif" active={focusedArea === "accounts" && accountFilter === "active"} onClick={() => focusSection("accounts", { accountFilter: "active" })} />
            <ResellerStatCard className="min-w-[188px] snap-start md:min-w-0" label="Akun Non-Aktif" value={inactiveAccounts.length} icon="ri-shield-cross-line" tone="red" hint="Filter non-aktif" active={focusedArea === "accounts" && accountFilter === "inactive"} onClick={() => focusSection("accounts", { accountFilter: "inactive" })} />
          </div>

          <section ref={toolsSectionRef} className={`rounded-xl border bg-white p-4 ${focusedArea === "tools" ? "border-slate-300 shadow-sm shadow-slate-950/5" : "border-slate-100"}`}>
            <div>
              <h2 className="text-base font-bold text-slate-950">Access Tools Center</h2>
              <p className="mt-1 text-xs text-slate-500">Shortcut cepat untuk akun, katalog order, dan pengaturan reseller.</p>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Link to="/reseller/accounts" className="rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:border-red-100 hover:bg-red-50/50">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600"><i className="ri-key-2-line text-sm" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">Sign-in & Reset</div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">{accessActivities.length} log</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">Lookup code dan reset.</div>
                  </div>
                </div>
              </Link>
              <Link to="/reseller/manage-account" className="rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:border-emerald-100 hover:bg-emerald-50/50">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><i className="ri-shield-check-line text-sm" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">Manage Account</div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{activeAccounts.length} aktif</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">Cek akun dan expiry.</div>
                  </div>
                </div>
              </Link>
              <Link to="/reseller/catalog" className="rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:border-blue-100 hover:bg-blue-50/50">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><i className="ri-store-2-line text-sm" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">Katalog Produk</div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-blue-700">{todayOrders.length} hari ini</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">Mulai order baru.</div>
                  </div>
                </div>
              </Link>
              <Link to="/reseller/settings" className="rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:border-amber-100 hover:bg-amber-50/50">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><i className="ri-settings-3-line text-sm" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-900">Settings</div>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700">{reseller?.username || "panel"}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">Profil dan security.</div>
                  </div>
                </div>
              </Link>
            </div>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <section ref={accountSectionRef} className={`rounded-xl border bg-white p-5 ${focusedArea === "accounts" ? "border-slate-300 shadow-sm shadow-slate-950/5" : "border-slate-100"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">My Accounts</h2>
                <p className="mt-1 text-xs text-slate-500">Ringkasan akun yang paling dekat perlu kamu cek.</p>
              </div>
              <Link to="/reseller/manage-account" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Buka Manage
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setAccountFilter("active")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${accountFilter === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>Aktif</button>
              <button type="button" onClick={() => setAccountFilter("expiring")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${accountFilter === "expiring" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>Expiring</button>
              <button type="button" onClick={() => setAccountFilter("inactive")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${accountFilter === "inactive" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"}`}>Non-Aktif</button>
            </div>
            <div className="mt-4 space-y-3 md:max-h-[360px] md:overflow-auto md:pr-1">
              {activeAccountsSorted.map((account) => (
                <div key={account.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{productLabel(account)}</p>
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500">{accountStatus(account)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">{resellerAccountIdentity(account)}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {durationLabel(account)} • mulai {compactDate(account.startedAt)} • sisa {remainingShort(account)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2 text-right">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Expiry</div>
                      <div className="mt-1 text-xs font-semibold text-slate-900">{compactDate(account.expiresAt)}</div>
                    </div>
                  </div>
                </div>
              ))}
              {!activeAccountsSorted.length ? (
                <div className="rounded-lg bg-slate-50 px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-slate-700">Tidak ada akun pada filter ini.</p>
                  <p className="mt-1 text-xs text-slate-500">Cek Manage Account untuk melihat semua akun reseller atau pindah filter yang lain.</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <button type="button" onClick={() => setAccountFilter("active")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Aktif</button>
                    <Link to="/reseller/manage-account" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Buka Manage</Link>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section ref={orderSectionRef} className={`rounded-xl border bg-white p-5 ${focusedArea === "orders" ? "border-slate-300 shadow-sm shadow-slate-950/5" : "border-slate-100"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">Order Tracker</h2>
                <p className="mt-1 text-xs text-slate-500">Pantau order yang masih menunggu bayar, sedang diproses, atau perlu cek ulang.</p>
              </div>
              <Link to="/reseller/history" className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Buka History
              </Link>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setOrderFilter("open")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${orderFilter === "open" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>Berjalan</button>
              <button type="button" onClick={() => setOrderFilter("today")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${orderFilter === "today" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>Hari Ini</button>
              <button type="button" onClick={() => setOrderFilter("all")} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${orderFilter === "all" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>Semua</button>
            </div>
            <div className="mt-4 space-y-3 md:max-h-[360px] md:overflow-auto md:pr-1">
              {trackerOrders.map((order) => (
                <div key={order.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{order.product} {order.duration}</p>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${orderTrackerClass(order)}`}>{orderTrackerLabel(order)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{order.id} • {order.variant}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {compactDateTime(order.createdAt)} • {order.paymentRef || "tanpa ref"} • {money(Number(order.total || 0))}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
              {!trackerOrders.length ? (
                <div className="rounded-lg bg-slate-50 px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-slate-700">Tidak ada order pada filter ini.</p>
                  <p className="mt-1 text-xs text-slate-500">Kamu bisa lihat riwayat order lengkap atau mulai order baru dari katalog.</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Link to="/reseller/catalog" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">Buka Katalog</Link>
                    <Link to="/reseller/history" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Buka History</Link>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <section ref={depositSectionRef} className={`rounded-xl border bg-white p-5 ${focusedArea === "deposit" ? "border-amber-200 shadow-sm shadow-amber-950/5" : "border-amber-100"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase text-amber-600">Saldo Deposit</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-950">{money(Number(reseller?.deposit || 0))}</h2>
                <p className="mt-1 text-xs text-slate-500">Saldo aktif untuk order otomatis.</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                  <i className="ri-wallet-3-line text-lg" />
                </span>
                <button
                  type="button"
                  onClick={openDepositRequest}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                >
                  <i className="ri-add-line" />
                  Ajukan Deposit
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-lg bg-[#f7f1e8] p-3">
                <p className="text-slate-400">Dipakai hari ini</p>
                <p className="mt-1 font-semibold text-slate-900">{money(depositUsedToday)}</p>
              </div>
              <div className="rounded-lg bg-[#f7f1e8] p-3">
                <p className="text-slate-400">Sisa QRIS pending</p>
                <p className="mt-1 font-semibold text-slate-900">{money(pendingPaymentDue)}</p>
              </div>
            </div>
            {pendingPaymentDue > 0 ? (
              <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-amber-700">Pending Payment</p>
                    <p className="mt-1 text-sm font-semibold text-amber-950">{money(pendingPaymentDue)} masih menunggu pembayaran.</p>
                    <p className="mt-1 text-xs text-amber-700">Cek order tracker untuk buka detail QRIS yang belum selesai.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => focusSection("orders", { orderFilter: "open" })}
                    className="inline-flex shrink-0 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-700"
                  >
                    Buka Order
                  </button>
                </div>
              </div>
            ) : null}
            <div className="mt-4 max-h-[220px] space-y-2 overflow-auto pr-1">
              {depositActivities.map((activity) => (
                <div key={activity.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800">{activity.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-slate-500">{activity.description}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-400">{compactDate(activity.createdAt)}</span>
                </div>
              ))}
              {!depositActivities.length ? <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-400">Belum ada riwayat deposit.</p> : null}
            </div>
            {depositRequestMessage ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{depositRequestMessage}</p> : null}
            {depositRequestError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{depositRequestError}</p> : null}
          </section>

          <section className="rounded-xl border border-slate-100 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">Access Log</h2>
                <p className="mt-1 text-xs text-slate-500">Riwayat lookup sign-in, verification, reset, dan household.</p>
              </div>
              <span className="rounded-full bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">{accessActivities.length} log</span>
            </div>
            <div className="mt-4 max-h-[320px] divide-y divide-slate-50 overflow-auto pr-1">
              {accessActivities.map((activity) => (
                <div key={activity.id} className="grid gap-3 py-3 md:grid-cols-[120px_minmax(0,1fr)_96px] md:items-center">
                  <div>
                    <p className="text-xs font-semibold text-slate-900">{accessTypeLabel(activity.lookupType)}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{compactDate(activity.createdAt)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-800">{activity.accountEmail || "-"}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                      {[activity.product, activity.variant].filter(Boolean).join(" - ") || sourceLabel(activity.lookupSource)}
                    </p>
                  </div>
                  <span className={`inline-flex h-7 items-center justify-center rounded-full px-2 text-[10px] font-semibold ${accessStatusClass(activity.lookupStatus)}`}>
                    {accessStatusLabel(activity.lookupStatus)}
                  </span>
                </div>
              ))}
              {!accessActivities.length ? <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-xs text-slate-400">Belum ada lookup kode.</p> : null}
            </div>
          </section>
        </div>

        {expiringAccounts.length ? (
          <section className="rounded-xl border border-amber-100 bg-amber-50/70 p-4">
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <i className="ri-alert-line" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-amber-900">Peringatan Durasi</h2>
                <p className="mt-1 text-xs text-amber-700">Beberapa akun Anda akan segera habis durasinya. Segera perpanjang untuk menghindari pemutusan layanan.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {expiringAccounts.slice(0, 3).map((account) => (
                    <span key={account.id} className="rounded-md bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800">
                      {productLabel(account)} - {daysLeft(account.expiresAt)} hari tersisa
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <section className="rounded-xl border border-slate-100 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">Deposit Ledger</h2>
                <p className="mt-1 text-xs text-slate-500">Mutasi top up dan pemakaian saldo terakhir untuk bantu audit reseller.</p>
              </div>
              <button
                type="button"
                onClick={openDepositRequest}
                className="inline-flex h-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-700 hover:bg-amber-100"
              >
                Ajukan Deposit
              </button>
            </div>
            <div className="mt-4 max-h-[340px] space-y-3 overflow-auto pr-1">
              {depositLedger.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{entry.detail}</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                      entry.tone === "emerald" ? "bg-emerald-50 text-emerald-700" : entry.tone === "amber" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                    }`}>
                      {compactDateTime(entry.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
              {!depositLedger.length ? <div className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Belum ada mutasi deposit.</div> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-100 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-950">Quick Summary</h2>
                <p className="mt-1 text-xs text-slate-500">Snapshot singkat untuk access, akun, dan deposit reseller.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-[11px] font-semibold uppercase text-slate-400">Lookup access</div>
                <div className="mt-2 text-lg font-bold text-slate-950">{accessActivities.length}</div>
                <div className="mt-1 text-xs text-slate-500">Aktivitas sign-in, verification, reset, dan household.</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-[11px] font-semibold uppercase text-slate-400">Akun expiring</div>
                <div className="mt-2 text-lg font-bold text-slate-950">{expiringAccounts.length}</div>
                <div className="mt-1 text-xs text-slate-500">Akun yang perlu dicek lebih dulu.</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-[11px] font-semibold uppercase text-slate-400">QRIS pending</div>
                <div className="mt-2 text-lg font-bold text-slate-950">{money(pendingPaymentDue)}</div>
                <div className="mt-1 text-xs text-slate-500">Menunggu pembayaran sebelum order lanjut.</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-[11px] font-semibold uppercase text-slate-400">Dipakai hari ini</div>
                <div className="mt-2 text-lg font-bold text-slate-950">{money(depositUsedToday)}</div>
                <div className="mt-1 text-xs text-slate-500">Saldo yang sudah dipakai hari ini.</div>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-100 bg-white">
          <div className="border-b border-slate-100 p-5">
            <h2 className="text-base font-bold text-slate-950">Log Aktivitas</h2>
            <p className="mt-1 text-xs text-slate-500">Riwayat aktivitas terbaru Anda di panel ini</p>
          </div>
          <div className="max-h-[360px] divide-y divide-slate-50 overflow-auto p-4">
            {activityLog.map((item) => (
              <div key={item.id} className="flex items-center gap-4 py-3">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${activityClass(item.type)}`}>
                  <i className={`${activityIcon(item.type)} text-sm`} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{item.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{compactDate(item.date)}</p>
                </div>
                <span className={`rounded px-2 py-1 text-[11px] font-semibold ${activityClass(item.type)}`}>{item.type}</span>
              </div>
            ))}
            {!activityLog.length ? (
              <div className="py-10 text-center text-sm text-slate-500">
                Belum ada aktivitas.
              </div>
            ) : null}
          </div>
        </section>

        {depositRequestOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-amber-600">Ajukan Deposit</p>
                  <h3 className="mt-1 text-lg font-bold text-slate-950">Top up saldo reseller</h3>
                </div>
                <button
                  type="button"
                  onClick={closeDepositRequest}
                  className="rounded-md p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Tutup"
                >
                  <i className="ri-close-line" />
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Nominal</span>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={depositRequestAmount}
                    onChange={(event) => setDepositRequestAmount(event.target.value)}
                    placeholder="Contoh: 10000"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-amber-300 focus:bg-white"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Metode</span>
                  <select
                    value={depositRequestMethod}
                    onChange={(event) => setDepositRequestMethod(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-amber-300 focus:bg-white"
                  >
                    {depositMethodChoices.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                  <p className="text-xs font-semibold uppercase text-slate-500">Info Pembayaran</p>
                  <div className="mt-2 rounded-lg border border-white bg-white p-4">
                    {depositRequestMethod === "qris_auto" && qrisAutoAvailable ? (
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-950">{depositMethodLabel(depositRequestMethod)}</p>
                        <p className="text-xs leading-5 text-slate-500">
                          Sistem akan membuat QRIS Pakasir. Setelah pembayaran sukses, saldo reseller akan bertambah otomatis tanpa approve manual owner.
                        </p>
                      </div>
                    ) : depositRequestMethod === "qris_auto" ? (
                      <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                        Pakasir sedang disconnected, jadi QRIS otomatis tidak tersedia. Pilih QRIS owner manual atau metode bank seperti DANA, Livin, BCA, GoPay, atau ShopeePay.
                      </div>
                    ) : activeDepositInstruction.available ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-950">{activeDepositInstruction.channel?.label}</p>
                            {activeDepositInstruction.channel?.accountName ? (
                              <p className="text-xs text-slate-500">{activeDepositInstruction.channel.accountName}</p>
                            ) : null}
                          </div>
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Tersedia</span>
                        </div>

                        {depositRequestMethod === "qris_owner" ? (
                          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
                            <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3 text-xs leading-5 text-amber-700">
                              {activeDepositInstruction.channel?.note || "Gunakan QRIS owner berikut untuk deposit manual. Jika perlu, kirim bukti transfer ke owner."}
                            </div>
                            {activeDepositInstruction.channel?.imageUrl ? (
                              <img
                                src={activeDepositInstruction.channel.imageUrl}
                                alt="QRIS Owner"
                                className="h-40 w-full rounded-lg border border-slate-200 object-contain bg-white p-2"
                              />
                            ) : null}
                          </div>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <p className="text-[11px] font-semibold uppercase text-slate-500">Nomor / Akun</p>
                              <p className="mt-1 break-all text-sm font-semibold text-slate-950">{activeDepositInstruction.channel?.accountNumber || "-"}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <p className="text-[11px] font-semibold uppercase text-slate-500">Atas Nama</p>
                              <p className="mt-1 break-all text-sm font-semibold text-slate-950">{activeDepositInstruction.channel?.accountName || "-"}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : depositRequestMethod === "qris_owner" ? (
                      <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                        QRIS owner belum diisi di panel owner.
                      </div>
                    ) : depositRequestMethod === "qris_auto" ? null : (
                      <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                        {depositMethodLabel(depositRequestMethod)} belum diisi di panel owner. Pilih metode lain yang tersedia.
                      </div>
                    )}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Catatan</span>
                  <textarea
                    value={depositRequestNote}
                    onChange={(event) => setDepositRequestNote(event.target.value)}
                    placeholder="Opsional"
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-amber-300 focus:bg-white"
                  />
                </label>
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={closeDepositRequest}
                  className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={submitDepositRequest}
                  disabled={depositRequestSubmitting || !canSubmitDepositRequest}
                  className="flex-1 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {depositRequestSubmitting ? "Memproses..." : depositRequestMethod === "qris_auto" ? "Buat QRIS" : "Kirim ke Owner"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {depositPayment && depositPaymentOrder ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-8">
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">QRIS Deposit Reseller</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{depositPaymentOrder.id}</p>
                </div>
                <button type="button" onClick={closeDepositPayment} className="h-8 w-8 rounded-md text-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                  x
                </button>
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <div className="font-semibold text-slate-900">Top Up Saldo</div>
                  <div className="mt-0.5 text-sm text-slate-500">Bayar QRIS untuk menambah saldo reseller otomatis.</div>
                </div>

                {depositQrSrc ? (
                  <div className="flex justify-center rounded-lg border border-slate-100 bg-slate-50 p-4">
                    <img src={depositQrSrc} alt="QRIS deposit reseller" className="h-60 w-60 rounded-lg bg-white p-2" />
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    QRIS belum tersedia. Buka link QRIS provider di bawah ini.
                  </div>
                )}

                <div className="grid gap-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4">
                    <span>Ref</span>
                    <strong className="text-right text-slate-900">{depositPayment.ref || depositPaymentOrder.paymentRef || "-"}</strong>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>Total</span>
                    <strong className="text-right text-slate-900">{money(depositQrTotal)}</strong>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>Batas Bayar</span>
                    <strong className="text-right text-slate-900">{depositPayment.expiresAt || depositPaymentOrder.paymentExpiresAt || "-"}</strong>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  {depositPayment.paymentUrl ? (
                    <a
                      href={depositPayment.paymentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white"
                    >
                      Buka QRIS
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeDepositPayment}
                    className="h-10 flex-1 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-700"
                  >
                    Tutup
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
