import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel, SearchBox } from "../../../components/feature/OwnerUi";
import { api, subscribeRealtime, type ApiActivity, type ApiDepositRequest, type ApiOrder, type ApiReseller } from "../../../lib/api";
import { formatRupiah } from "../../../mocks/data";

type AccessPermission = "signin" | "verification" | "reset" | "household";

const emptyForm = {
  name: "",
  email: "",
  username: "",
  password: "",
  whatsapp: "",
  deposit: 0,
  isActive: true,
};

function normalizeWhatsapp(value = "") {
  const digits = String(value || "").split("@")[0].split(":")[0].replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function duplicateResellerMessage(reseller: ApiReseller, field: string) {
  const status = reseller.isActive === false ? "nonaktif" : "aktif";
  const fieldLabel = field === "whatsapp" ? "Nomor WhatsApp" : field === "username" ? "Username" : "Email";
  return `Reseller sudah ${status}: ${reseller.name || reseller.username || reseller.whatsapp}. ${fieldLabel} ini sudah dipakai.`;
}

function depositMethodLabel(value = "") {
  const method = String(value || "").trim().toLowerCase();
  if (method === "qris_auto") return "QRIS Otomatis";
  if (method === "qris_owner" || method === "qris") return "QRIS Owner";
  if (method === "livin") return "Livin Mandiri";
  if (method === "dana") return "DANA";
  if (method === "bca") return "BCA";
  if (method === "gopay") return "GoPay";
  if (method === "shopeepay") return "ShopeePay";
  return value || "-";
}

const accessPermissionOptions: Array<{ id: AccessPermission; label: string }> = [
  { id: "signin", label: "Sign-in Code" },
  { id: "verification", label: "Verification Code" },
  { id: "reset", label: "Reset Password" },
  { id: "household", label: "Household" },
];

const defaultAccessPermissions: AccessPermission[] = ["signin", "verification", "household"];

export default function ResellersPage() {
  const [params] = useSearchParams();
  const resellerParam = params.get("reseller")?.trim() || "";
  const depositParam = params.get("deposit")?.trim() || "";
  const [resellers, setResellers] = useState<ApiReseller[]>([]);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [activities, setActivities] = useState<ApiActivity[]>([]);
  const [depositRequests, setDepositRequests] = useState<ApiDepositRequest[]>([]);
  const [query, setQuery] = useState(resellerParam || depositParam);
  const [openId, setOpenId] = useState("");
  const [focusedResellerId, setFocusedResellerId] = useState("");
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [depositActionId, setDepositActionId] = useState("");
  const [depositActionError, setDepositActionError] = useState("");
  const [depositActionMessage, setDepositActionMessage] = useState("");
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessPermission[]>>({});
  const [savingAccessId, setSavingAccessId] = useState("");

  async function loadData() {
    const [resellerRows, orderRows, activityRows, depositRequestRows] = await Promise.all([
      api.resellers(),
      api.orders(),
      api.activities(),
      api.depositRequests(),
    ]);
    setResellers(resellerRows);
    setOrders(orderRows);
    setActivities(activityRows);
    setDepositRequests(depositRequestRows);
    setOpenId((current) => (current && resellerRows.some((item) => item.id === current) ? current : ""));
  }

  useEffect(() => {
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  useEffect(() => {
    if (!resellerParam && !depositParam) {
      setQuery("");
      return;
    }
    if (resellerParam) setQuery(resellerParam);
    if (depositParam) setQuery(depositParam);
  }, [depositParam, resellerParam]);

  useEffect(() => {
    if (!resellerParam && !depositParam) return;
    const normalizedResellerParam = normalizeText(resellerParam);
    const normalizedResellerWhatsapp = normalizeWhatsapp(resellerParam);
    const matchedRequest = depositParam ? depositRequests.find((item) => item.id === depositParam) : null;
    const matchedReseller =
      resellers.find((item) => item.id === resellerParam) ||
      resellers.find((item) => normalizedResellerWhatsapp && normalizeWhatsapp(item.whatsapp || "") === normalizedResellerWhatsapp) ||
      resellers.find((item) => normalizedResellerParam && [item.name, item.username, item.email].some((value) => normalizeText(String(value || "")) === normalizedResellerParam)) ||
      (matchedRequest ? resellers.find((item) => item.id === matchedRequest.resellerId) : null);

    if (!matchedReseller) return;
    setQuery(matchedReseller.name || matchedReseller.username || matchedReseller.whatsapp || matchedReseller.email || matchedReseller.id);
    setOpenId(matchedReseller.id);
    setFocusedResellerId(matchedReseller.id);
  }, [depositParam, depositRequests, resellerParam, resellers]);

  const rows = useMemo(
    () => resellers.filter((item) => [item.id, item.name, item.email, item.username, item.whatsapp].join(" ").toLowerCase().includes(query.toLowerCase())),
    [resellers, query],
  );

  useEffect(() => {
    if (!focusedResellerId || !rows.some((item) => item.id === focusedResellerId)) return;
    scrollToElement(`reseller-card-${focusedResellerId}`);
  }, [focusedResellerId, rows]);

  const pendingDepositRequests = useMemo(
    () => depositRequests.filter((item) => !item.status || String(item.status).toLowerCase() === "pending"),
    [depositRequests],
  );

  const recentDepositRequests = useMemo(
    () => depositRequests.filter((item) => item.status && String(item.status).toLowerCase() !== "pending").slice(0, 5),
    [depositRequests],
  );

  const duplicateReseller = useMemo(() => {
    const whatsapp = normalizeWhatsapp(form.whatsapp);
    if (whatsapp) {
      const reseller = resellers.find((item) => item.id !== editingId && normalizeWhatsapp(item.whatsapp || "") === whatsapp);
      if (reseller) return { field: "whatsapp", reseller };
    }

    const username = normalizeText(form.username);
    if (username) {
      const reseller = resellers.find((item) => item.id !== editingId && normalizeText(item.username || "") === username);
      if (reseller) return { field: "username", reseller };
    }

    const email = normalizeText(form.email);
    if (email) {
      const reseller = resellers.find((item) => item.id !== editingId && normalizeText(item.email || "") === email);
      if (reseller) return { field: "email", reseller };
    }

    return null;
  }, [editingId, form.email, form.username, form.whatsapp, resellers]);

  function resellerOrders(reseller: ApiReseller) {
    const resellerWhatsapp = normalizeWhatsapp(reseller.whatsapp || "");
    const exactNames = [reseller.name, reseller.email, reseller.username].filter(Boolean).map((item) => normalizeText(String(item)));
    return orders.filter((order) => {
      if (order.channel !== "Reseller") return false;
      if (order.resellerId) return order.resellerId === reseller.id;

      const orderWhatsapp = normalizeWhatsapp(order.whatsapp || "");
      if (resellerWhatsapp && orderWhatsapp) return resellerWhatsapp === orderWhatsapp;

      const customer = normalizeText(order.customer || "");
      return Boolean(customer && exactNames.some((name) => name && name === customer));
    });
  }

  function resellerActivities(reseller: ApiReseller, predicate?: (activity: ApiActivity) => boolean) {
    const exactNames = [reseller.name, reseller.email, reseller.username].filter(Boolean).map((item) => normalizeText(String(item)));
    const normalizedWhatsapp = normalizeWhatsapp(reseller.whatsapp || "");
    return activities
      .filter((activity) => {
        if (predicate && !predicate(activity)) return false;
        if (activity.resellerId) return activity.resellerId === reseller.id;

        const activityWhatsapp = normalizeWhatsapp(activity.whatsapp || "");
        if (normalizedWhatsapp && activityWhatsapp && activityWhatsapp === normalizedWhatsapp) return true;
        if (activityWhatsapp) return false;

        const activityTextSeparator = new RegExp("[\\-:|]", "g");
        const exactText = [activity.title, activity.description]
          .flatMap((value) => String(value || "").split(activityTextSeparator))
          .map((value) => normalizeText(value))
          .filter(Boolean);
        return exactNames.some((name) => name && exactText.includes(name));
      })
      .slice(0, 5);
  }

function activityTime(value = "") {
  const date = new Date(String(value || "").replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function accessTypeLabel(type = "") {
  if (type === "signin") return "Sign-in";
  if (type === "verification") return "Verification";
  if (type === "reset") return "Reset";
  if (type === "household") return "Household";
  return "Access";
}

function resellerAccessTools(reseller: ApiReseller): AccessPermission[] {
  const source = Array.isArray(reseller.allowedAccessTools) ? reseller.allowedAccessTools : defaultAccessPermissions;
  return Array.from(new Set(source.filter((item): item is AccessPermission => ["signin", "verification", "reset", "household"].includes(item))));
}

function accessStatusLabel(status = "") {
  const lower = status.toLowerCase();
  if (lower === "success") return "Berhasil";
  if (lower.includes("expired")) return "Expired";
  if (lower.includes("archived")) return "Nonaktif";
  if (lower.includes("not_found")) return "Belum ada";
  if (lower.includes("gmail")) return "Gmail error";
  return status || "Diproses";
}

function accessStatusClass(status = "") {
  const lower = status.toLowerCase();
  if (lower === "success") return "bg-emerald-50 text-emerald-700";
  if (lower.includes("expired") || lower.includes("disabled") || lower.includes("replaced") || lower.includes("archived")) return "bg-red-50 text-red-600";
  return "bg-amber-50 text-amber-700";
}

function depositRequestStatusClass(status = "") {
  const lower = String(status || "pending").toLowerCase();
  if (lower === "approved") return "bg-emerald-50 text-emerald-700";
  if (lower === "rejected") return "bg-red-50 text-red-600";
  if (lower === "pending_payment") return "bg-sky-50 text-sky-700";
  return "bg-amber-50 text-amber-700";
}

function depositRequestStatusLabel(status = "") {
  const lower = String(status || "pending").toLowerCase();
  if (lower === "approved") return "Approved";
  if (lower === "rejected") return "Rejected";
  if (lower === "pending_payment") return "Menunggu Bayar";
  return "Pending";
}

function scrollToElement(id = "") {
  if (!id || typeof document === "undefined") return;
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

  function renderActivityList(title: string, subtitle: string, rows: ApiActivity[]) {
    const isAccessLog = title.toLowerCase().includes("access");
    return (
      <div className="rounded-lg border border-gray-100 bg-slate-50/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
            <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
          </div>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500">{rows.length}</span>
        </div>
        <div className="mt-3 space-y-2">
          {rows.map((activity) => (
            <div key={activity.id} className="rounded-md bg-white px-3 py-2 text-xs leading-5">
              {isAccessLog ? (
                <div className="grid gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-800">{accessTypeLabel(activity.lookupType)} - {activity.accountEmail || "-"}</p>
                      <p className="mt-0.5 line-clamp-1 text-slate-500">{[activity.product, activity.variant].filter(Boolean).join(" - ") || activity.description}</p>
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-400">{activityTime(activity.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${accessStatusClass(activity.lookupStatus)}`}>{accessStatusLabel(activity.lookupStatus)}</span>
                    {activity.lookupSource ? <span className="rounded-full bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">{activity.lookupSource}</span> : null}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-slate-800">{activity.title}</p>
                    <span className="shrink-0 text-[10px] text-slate-400">{activityTime(activity.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-slate-500">{activity.description}</p>
                </>
              )}
            </div>
          ))}
          {!rows.length ? <p className="rounded-md bg-white px-3 py-3 text-xs text-slate-400">Belum ada log.</p> : null}
        </div>
      </div>
    );
  }

  function accessDraftFor(reseller: ApiReseller) {
    return accessDrafts[reseller.id] || resellerAccessTools(reseller);
  }

  function toggleAccessPermission(reseller: ApiReseller, permission: AccessPermission) {
    setAccessDrafts((current) => {
      const existing = current[reseller.id] || resellerAccessTools(reseller);
      const next = existing.includes(permission) ? existing.filter((item) => item !== permission) : [...existing, permission];
      return { ...current, [reseller.id]: next };
    });
  }

  async function saveAccessPermission(reseller: ApiReseller) {
    const allowedAccessTools = accessDraftFor(reseller);
    setSavingAccessId(reseller.id);
    try {
      await api.updateReseller(reseller.id, { allowedAccessTools });
      await loadData();
    } finally {
      setSavingAccessId("");
    }
  }

  function resetAccessPermission(reseller: ApiReseller) {
    setAccessDrafts((current) => ({ ...current, [reseller.id]: defaultAccessPermissions }));
  }

  function openCreateModal() {
    setForm(emptyForm);
    setEditingId("");
    setFormError("");
    setModalMode("create");
  }

  function openEditModal(reseller: ApiReseller) {
    setForm({
      name: reseller.name || "",
      email: reseller.email || "",
      username: reseller.username || "",
      password: reseller.password || "",
      whatsapp: reseller.whatsapp || "",
      deposit: Number(reseller.deposit || 0),
      isActive: reseller.isActive !== false,
    });
    setEditingId(reseller.id);
    setFormError("");
    setModalMode("edit");
  }

  function closeModal() {
    setModalMode(null);
    setEditingId("");
    setForm(emptyForm);
    setFormError("");
  }

  function updateForm(patch: Partial<typeof emptyForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setFormError("");
  }

  function openDuplicateReseller() {
    if (!duplicateReseller) return;
    setQuery(duplicateReseller.reseller.name || duplicateReseller.reseller.username || duplicateReseller.reseller.whatsapp || "");
    setOpenId(duplicateReseller.reseller.id);
    closeModal();
  }

  async function saveReseller() {
    if (!form.name || !form.username || !form.password || !form.whatsapp) return;
    if (duplicateReseller) {
      const message = duplicateResellerMessage(duplicateReseller.reseller, duplicateReseller.field);
      setFormError(`${message} Buka akun tersebut lalu edit, jangan buat akun baru.`);
      window.alert(message);
      setOpenId(duplicateReseller.reseller.id);
      return;
    }
    setFormError("");
    try {
      if (modalMode === "edit" && editingId) {
        await api.updateReseller(editingId, form);
        setOpenId(editingId);
      } else {
        const created = await api.createReseller(form);
        setOpenId(created.id);
      }
      closeModal();
      await loadData();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal menyimpan reseller.";
      setFormError(message);
      if (message.toLowerCase().includes("reseller sudah")) window.alert(message);
    }
  }

  async function deleteReseller(id: string) {
    await api.deleteReseller(id);
    await loadData();
  }

  async function approveDepositRequest(request: ApiDepositRequest) {
    const note = window.prompt(`Catatan approval untuk ${request.resellerName || request.whatsapp || request.id} (opsional):`, "") ?? "";
    setDepositActionId(request.id);
    setDepositActionError("");
    setDepositActionMessage("");
    try {
      const result = await api.approveDepositRequest(request.id, note ? { note } : undefined);
      setDepositActionMessage(`Deposit ${result.request.id} berhasil dikreditkan ke ${result.reseller.name || result.reseller.username || result.reseller.whatsapp}.`);
      await loadData();
    } catch (error) {
      setDepositActionError(error instanceof Error ? error.message : "Gagal approve deposit.");
    } finally {
      setDepositActionId("");
    }
  }

  async function rejectDepositRequest(request: ApiDepositRequest) {
    const note = window.prompt(`Catatan penolakan untuk ${request.resellerName || request.whatsapp || request.id} (opsional):`, "") ?? "";
    setDepositActionId(request.id);
    setDepositActionError("");
    setDepositActionMessage("");
    try {
      const result = await api.rejectDepositRequest(request.id, note ? { note } : undefined);
      setDepositActionMessage(`Permintaan deposit ${result.request.id} ditolak.`);
      await loadData();
    } catch (error) {
      setDepositActionError(error instanceof Error ? error.message : "Gagal menolak deposit.");
    } finally {
      setDepositActionId("");
    }
  }

  function toggleReseller(id: string) {
    setOpenId((current) => (current === id ? "" : id));
  }

  function onHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleReseller(id);
  }

  return (
    <DashboardLayout role="owner" title="Manajemen Reseller">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-slate-500">Daftarkan, edit, dan kelola akses reseller.</p>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#2b2b2b] px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-900 sm:h-9 sm:rounded-md"
        >
          <span className="flex h-4 w-4 items-center justify-center">
            <i className="ri-add-line" />
          </span>
          Tambah Reseller
        </button>
      </div>

      <DataPanel className="mb-6 p-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Permintaan Deposit</h2>
            <p className="mt-1 text-xs text-slate-500">Approve atau tolak permintaan deposit reseller langsung dari panel owner.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">Pending {pendingDepositRequests.length}</span>
            <span className="rounded-full bg-slate-50 px-3 py-1 font-semibold text-slate-600">Riwayat {recentDepositRequests.length}</span>
          </div>
        </div>

        {depositActionError ? <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{depositActionError}</div> : null}
        {depositActionMessage ? <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{depositActionMessage}</div> : null}

        <div className="mt-4 grid gap-3">
          {pendingDepositRequests.map((request) => (
            <div key={request.id} className="rounded-lg border border-amber-100 bg-amber-50/40 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-950">{request.resellerName || request.whatsapp || request.id}</p>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${depositRequestStatusClass(request.status)}`}>{depositRequestStatusLabel(request.status)}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{formatRupiah(Number(request.amount || 0))} via {depositMethodLabel(request.method)}</p>
                  <p className="mt-1 text-xs text-slate-400">Request ID {request.id} • {activityTime(request.createdAt)}</p>
                  {request.note ? <p className="mt-2 text-xs leading-5 text-slate-500">Catatan: {request.note}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={depositActionId === request.id}
                    onClick={() => rejectDepositRequest(request)}
                    className="h-9 rounded-md border border-red-200 px-3 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Tolak
                  </button>
                  <button
                    type="button"
                    disabled={depositActionId === request.id}
                    onClick={() => approveDepositRequest(request)}
                    className="h-9 rounded-md bg-[#2b2b2b] px-3 text-sm font-semibold text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {depositActionId === request.id ? "Memproses..." : "Approve"}
                  </button>
                </div>
              </div>
            </div>
          ))}

          {!pendingDepositRequests.length ? <div className="rounded-lg border border-dashed border-[#ded6ca] px-4 py-4 text-sm text-slate-500">Belum ada permintaan deposit yang menunggu approval.</div> : null}
        </div>

        {recentDepositRequests.length ? (
          <div className="mt-4 border-t border-[#ece2d4] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Riwayat singkat</p>
            <div className="mt-3 grid gap-2">
              {recentDepositRequests.map((request) => (
                <div key={request.id} className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700">{request.resellerName || request.whatsapp || request.id} • {formatRupiah(Number(request.amount || 0))}</p>
                    <p className="truncate text-slate-500">{depositMethodLabel(request.method)} • {request.reviewedAt ? activityTime(request.reviewedAt) : activityTime(request.createdAt)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${depositRequestStatusClass(request.status)}`}>{depositRequestStatusLabel(request.status)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </DataPanel>

      <div className="sticky top-16 z-40 isolate -mx-3 mb-6 border-b border-white/60 bg-[#f2ece2] px-3 py-3 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.45)] sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
        <DataPanel className="w-full p-4 shadow-sm shadow-slate-950/5">
          <SearchBox value={query} onChange={setQuery} placeholder="Cari reseller..." />
          {resellerParam || depositParam ? (
            <div className="mt-3 rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700">
              Fokus ke reseller terkait {depositParam ? `request deposit ${depositParam}` : `ID ${resellerParam}`}.
            </div>
          ) : null}
        </DataPanel>
      </div>

      <div className="space-y-4">
        {rows.map((reseller) => {
          const expanded = openId === reseller.id;
          const relatedOrders = resellerOrders(reseller);
          const totalRevenue = relatedOrders.filter((order) => !order.excludeFromSalesMetrics && order.qrisStatus === "paid").reduce((sum, order) => sum + Number(order.total || 0), 0);
          const accessLogs = resellerActivities(reseller, (activity) => activity.type === "security");
          const depositLogs = resellerActivities(reseller, (activity) => {
            const text = [activity.title, activity.description].join(" ").toLowerCase();
            return text.includes("deposit") || text.includes("saldo");
          });
          return (
            <DataPanel
              key={reseller.id}
              id={`reseller-card-${reseller.id}`}
              className={`overflow-hidden p-4 transition-colors sm:p-5 ${expanded ? "border-[#2b2b2b]" : ""} ${reseller.id === focusedResellerId ? "bg-sky-50/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => toggleReseller(reseller.id)}
                  onKeyDown={(event) => onHeaderKeyDown(event, reseller.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-red-200 sm:gap-4"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#f2ece2] text-base font-semibold text-slate-950 sm:h-11 sm:w-11 sm:rounded-md">
                    {reseller.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-slate-950">
                      {reseller.name}
                      <span className="flex h-4 w-4 items-center justify-center text-slate-500">
                        <i className={expanded ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
                      </span>
                    </h2>
                    <p className="mt-1 max-w-[56vw] truncate text-sm text-slate-500 sm:max-w-none">{reseller.email || `${reseller.username}@kavya.id`}</p>
                  </div>
                </div>
                <Badge variant={reseller.isActive ? "emerald" : "red"}>{reseller.isActive ? "Aktif" : "Nonaktif"}</Badge>
              </div>

              {expanded ? (
                <div className="mt-4 space-y-4 pl-0 md:pl-[60px]">
                  <div className="grid gap-4 border-y border-gray-100 py-4 text-sm md:grid-cols-5">
                    <div>
                      <p className="text-xs text-slate-400">Telepon</p>
                      <p className="mt-1 font-medium text-slate-950">+{reseller.whatsapp || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Total Order</p>
                      <p className="mt-1 font-medium text-slate-950">{relatedOrders.length || reseller.orders || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Total Belanja</p>
                      <p className="mt-1 font-medium text-slate-950">{formatRupiah(totalRevenue || reseller.revenue || 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Bergabung</p>
                      <p className="mt-1 font-medium text-slate-950">{reseller.joinedAt || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Total Deposit</p>
                      <p className="mt-1 font-medium text-slate-950">{formatRupiah(reseller.deposit || 0)}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-100 bg-slate-50/60 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">Permission Account Access</h3>
                        <p className="mt-1 text-xs text-slate-400">Centang tool yang boleh dilihat dan dipakai reseller. Yang tidak diceklis tidak akan muncul di panel reseller dan backend juga menolak aksesnya.</p>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500">{accessDraftFor(reseller).length} aktif</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {accessPermissionOptions.map((option) => {
                        const selected = accessDraftFor(reseller).includes(option.id);
                        return (
                          <button
                            key={`${reseller.id}-${option.id}`}
                            type="button"
                            onClick={() => toggleAccessPermission(reseller, option.id)}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                              selected ? "border-red-100 bg-red-50 text-red-600" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                            }`}
                          >
                            <i className={selected ? "ri-checkbox-circle-fill" : "ri-checkbox-blank-circle-line"} />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => resetAccessPermission(reseller)}
                        className="h-8 rounded-md border border-[#ded6ca] px-3 text-sm text-slate-700 hover:bg-[#f7f1e8]"
                      >
                        Default
                      </button>
                      <button
                        type="button"
                        onClick={() => saveAccessPermission(reseller)}
                        disabled={savingAccessId === reseller.id}
                        className="h-8 rounded-md bg-[#2b2b2b] px-3 text-sm font-semibold text-white hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingAccessId === reseller.id ? "Menyimpan..." : "Simpan Akses"}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {renderActivityList("Access Log", "Sign-in, verification, reset, household", accessLogs)}
                    {renderActivityList("Deposit Log", "Top up, pengurangan, dan refund saldo", depositLogs)}
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                    <button className="h-8 rounded-md border border-[#ded6ca] px-3 text-sm text-slate-700 hover:bg-[#f7f1e8]" onClick={() => openEditModal(reseller)}>
                      Edit
                    </button>
                    <button className="h-8 rounded-md border border-red-200 px-3 text-sm text-red-600 hover:bg-red-50" onClick={() => deleteReseller(reseller.id)}>
                      Hapus
                    </button>
                  </div>
                </div>
              ) : null}
            </DataPanel>
          );
        })}

        {!rows.length ? <DataPanel className="p-6 text-sm text-slate-500">Reseller tidak ditemukan.</DataPanel> : null}
      </div>

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">{modalMode === "edit" ? "Edit Reseller" : "Tambah Reseller Baru"}</h2>
              <button className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={closeModal}>
                <i className="ri-close-line" />
              </button>
            </div>
            {duplicateReseller ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <p>{duplicateResellerMessage(duplicateReseller.reseller, duplicateReseller.field)} Pakai tombol edit di akun yang sudah ada.</p>
                  <button
                    type="button"
                    onClick={openDuplicateReseller}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-amber-100 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-200"
                  >
                    Buka Reseller
                  </button>
                </div>
              </div>
            ) : null}
            {formError ? (
              <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{formError}</div>
            ) : null}
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm text-slate-700">Nama Reseller</span>
                <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Nama lengkap reseller" />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Email</span>
                <input value={form.email} onChange={(event) => updateForm({ email: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="email@domain.com" />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Username Login</span>
                <input value={form.username} onChange={(event) => updateForm({ username: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="reseller.username" />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Password Login</span>
                <input type="password" value={form.password} onChange={(event) => updateForm({ password: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Password panel reseller" />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Nomor Telepon</span>
                <input value={form.whatsapp} onChange={(event) => updateForm({ whatsapp: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="628..." />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Total Deposit</span>
                <input type="number" value={form.deposit} onChange={(event) => updateForm({ deposit: Number(event.target.value) })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="0" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                <input type="checkbox" checked={form.isActive} onChange={(event) => updateForm({ isActive: event.target.checked })} className="h-4 w-4 accent-red-600" />
                Akun reseller aktif
              </label>
            </div>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <button className="h-11 rounded-md border border-gray-300 text-sm text-slate-700" onClick={closeModal}>Batal</button>
              <button className="h-11 rounded-md bg-[#2b2b2b] text-sm font-medium text-white hover:bg-slate-900" onClick={saveReseller}>
                {modalMode === "edit" ? "Simpan Perubahan" : "Daftarkan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}

