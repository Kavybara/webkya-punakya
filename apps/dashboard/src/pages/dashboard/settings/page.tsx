import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, type ApiOrder, type OwnerSettings } from "../../../lib/api";
import { clearSession, readSession, writeSession } from "../../../lib/session";
import { formatRupiah } from "../../../mocks/data";

type SettingsTab = "profile" | "security" | "api";
type SecretSection = "pakasir" | "bailey" | "gmail" | "cloudflare" | "googleSheets";
type SavingSection = SecretSection | "payment" | "profile" | "security" | "gmail-oauth" | "";
type ToastState = { id: number; text: string; type: "success" | "error" | "info" };

const emptySettings: OwnerSettings = {
  profile: { name: "", username: "", email: "", whatsapp: "", initial: "O" },
  pakasir: { apiKey: "", merchantId: "", webhookSecret: "" },
  bailey: { sessionId: "", botNumber: "", publicUrl: "", webhookUrl: "", qrisGenerateUrl: "", botToken: "", inboundToken: "" },
  gmail: {
    mode: "imap",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    inboxEmail: "",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapUser: "",
    imapPassword: "",
    imapSecure: true,
  },
  googleSheets: { spreadsheetId: "", sheetName: "Netflix", serviceAccountEmail: "", privateKey: "" },
  cloudflare: { publicDomain: "", tunnelToken: "" },
  payment: {
    ownerQrisImageUrl: "",
    ownerQrisNote: "",
    danaNumber: "",
    danaName: "",
    livinNumber: "",
    livinName: "",
    bcaNumber: "",
    bcaName: "",
    gopayNumber: "",
    gopayName: "",
    shopeepayNumber: "",
    shopeepayName: "",
  },
  status: { pakasir: "disconnected", bailey: "disconnected", gmail: "needs_oauth", googleSheets: "disconnected" },
};

function normalizeOwnerSettings(value?: Partial<OwnerSettings> | null): OwnerSettings {
  return {
    ...emptySettings,
    ...value,
    profile: { ...emptySettings.profile, ...(value?.profile || {}) },
    pakasir: { ...emptySettings.pakasir, ...(value?.pakasir || {}) },
    bailey: { ...emptySettings.bailey, ...(value?.bailey || {}) },
    gmail: { ...emptySettings.gmail, ...(value?.gmail || {}) },
    googleSheets: { ...emptySettings.googleSheets, ...(value?.googleSheets || {}) },
    cloudflare: { ...emptySettings.cloudflare, ...(value?.cloudflare || {}) },
    payment: { ...emptySettings.payment, ...(value?.payment || {}) },
    status: { ...emptySettings.status, ...(value?.status || {}) },
  };
}

const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: "profile", label: "Profile", icon: "ri-user-3-line" },
  { id: "security", label: "Security", icon: "ri-lock-2-line" },
  { id: "api", label: "API & Integrasi", icon: "ri-key-2-line" },
];

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "profile" || value === "security" || value === "api";
}

function maskText(value: string) {
  const text = String(value || "");
  if (!text) return "------";
  if (text.length <= 8) return `${text.slice(0, 4)}${"-".repeat(6)}${text.slice(-4)}`;
  return `${text.slice(0, 4)}${"-".repeat(Math.max(6, text.length - 8))}${text.slice(-4)}`;
}

function Panel({
  id,
  icon,
  title,
  subtitle,
  tone = "bg-red-50 text-red-600",
  action,
  children,
}: {
  id?: string;
  icon: string;
  title: string;
  subtitle?: string;
  tone?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-gray-100 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
            <i className={`${icon} text-base`} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  mono,
  masked,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  mono?: boolean;
  masked?: boolean;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        type={masked ? "text" : type}
        value={masked ? maskText(value) : value}
        onChange={(event) => onChange?.(event.target.value)}
        readOnly={readOnly || masked}
        className={`mt-2 h-11 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none transition-colors focus:border-red-300 ${
          mono ? "font-mono" : ""
        } ${readOnly || masked ? "bg-slate-50 text-slate-500" : "bg-white text-slate-900"}`}
      />
      {hint ? <span className="mt-2 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

function CopyButton({
  id,
  text,
  copiedId,
  onCopy,
}: {
  id: string;
  text: string;
  copiedId: string;
  onCopy: (id: string, text: string) => void;
}) {
  const copied = copiedId === id;
  return (
    <button
      type="button"
      onClick={() => onCopy(id, text)}
      className={`flex h-11 w-11 items-center justify-center rounded-lg border text-sm transition-colors ${
        copied ? "border-emerald-100 bg-emerald-50 text-emerald-600" : "border-gray-200 text-slate-500 hover:border-red-100 hover:bg-red-50 hover:text-red-600"
      }`}
      aria-label="Copy"
    >
      <i className={copied ? "ri-check-line" : "ri-file-copy-line"} />
    </button>
  );
}

function SecretField({
  id,
  label,
  value,
  visible,
  copiedId,
  onChange,
  onCopy,
}: {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  copiedId: string;
  onChange: (value: string) => void;
  onCopy: (id: string, text: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
      <Field label={label} value={value} onChange={onChange} masked={!visible} mono />
      <div className="flex items-end">
        <CopyButton id={id} text={value} copiedId={copiedId} onCopy={onCopy} />
      </div>
    </div>
  );
}

function EyeToggle({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-slate-500 hover:border-red-100 hover:bg-red-50 hover:text-red-600"
      aria-label={visible ? "Sembunyikan" : "Tampilkan"}
    >
      <i className={visible ? "ri-eye-off-line" : "ri-eye-line"} />
    </button>
  );
}

function SaveButton({ children = "Simpan", loading = false }: { children?: ReactNode; loading?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="inline-flex h-9 items-center justify-center rounded-md bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-wait disabled:bg-red-300"
    >
      {loading ? "Menyimpan..." : children}
    </button>
  );
}

function StatusItem({ label, state }: { label: string; state: "connected" | "needs_oauth" | "disconnected" }) {
  const connected = state === "connected";
  const warning = state === "needs_oauth";
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : warning ? "bg-amber-500" : "bg-slate-300"}`} />
        <span className="text-sm font-medium text-slate-800">{label}</span>
      </div>
      <span className={`text-xs font-semibold ${connected ? "text-emerald-600" : warning ? "text-amber-600" : "text-slate-400"}`}>
        {connected ? "connected" : warning ? "perlu koneksi ulang" : "disconnected"}
      </span>
    </div>
  );
}

function buildBaileyQrUrl(settings: OwnerSettings) {
  const publicUrl = String(settings.bailey.publicUrl || "").trim().replace(/\/$/, "");
  const botToken = String(settings.bailey.botToken || "").trim();
  if (!publicUrl || !botToken) return "";
  return `${publicUrl}/session/qr?token=${encodeURIComponent(botToken)}`;
}

function localApiBaseUrl() {
  if (typeof window === "undefined") return "http://127.0.0.1:4174";
  const { protocol, hostname, port, origin } = window.location;
  if (port === "5174") return `${protocol}//${hostname}:4174`;
  return origin;
}

function makePanelSecret(prefix: string) {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function OverviewMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function syncOwnerSession(profile: OwnerSettings["profile"], token?: string) {
  try {
    const session = readSession();
    if (session?.role !== "owner") return;
    writeSession(
      {
        ...session,
        ...(token ? { token } : {}),
        user: {
          ...(session.user || {}),
          id: "owner",
          name: profile.name,
          email: profile.email,
          username: profile.username,
          whatsapp: profile.whatsapp,
        },
      },
      Boolean(localStorage.getItem("kavya-session")),
    );
  } catch {
    // Session sync is best-effort; auth guard will handle invalid sessions.
  }
}

export default function DashboardSettings() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: SettingsTab = isSettingsTab(requestedTab) ? requestedTab : "profile";
  const [draft, setDraft] = useState<OwnerSettings>(emptySettings);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [profileEditing, setProfileEditing] = useState(false);
  const [visible, setVisible] = useState<Record<SecretSection, boolean>>({ pakasir: false, bailey: false, gmail: false, cloudflare: false, googleSheets: false });
  const [copiedId, setCopiedId] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [savingSection, setSavingSection] = useState<SavingSection>("");
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const toastTimer = useRef<number | null>(null);

  const accountStats = useMemo(() => {
    const paidOrders = orders.filter((order) => !order.excludeFromSalesMetrics && (order.qrisStatus === "paid" || order.orderStatus === "completed"));
    return {
      transactions: orders.length,
      paid: paidOrders.length,
      revenue: paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    };
  }, [orders]);

  useEffect(() => {
    async function loadData() {
      const [settings, orderRows] = await Promise.all([api.ownerSettings(), api.orders()]);
      const normalized = normalizeOwnerSettings(settings);
      setDraft(normalized);
      syncOwnerSession(normalized.profile);
      setOrders(orderRows);
      setError("");
    }
    loadData().catch((loadError) => showError(loadError instanceof Error ? loadError.message : "Gagal memuat settings"));
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "api" || !location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [activeTab, location.hash]);

  function selectTab(tab: SettingsTab) {
    if (tab !== activeTab) {
      setSearchParams({ tab }, { replace: true });
    }
    setError("");
  }

  function showToast(text: string, type: ToastState["type"] = "success", delay = 2200) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, type });
    toastTimer.current = window.setTimeout(() => setToast(null), delay);
  }

  function showMessage(text: string, delay = 2200) {
    setError("");
    showToast(text, "success", delay);
  }

  function showError(text: string, delay = 3000) {
    setError(text);
    showToast(text, "error", delay);
  }

  function fillBaileyLocalDefaults() {
    const apiBase = localApiBaseUrl().replace(/\/$/, "");
    const publicDomain = String(draft.cloudflare.publicDomain || "").trim().replace(/\/$/, "");
    const botPublicUrl = publicDomain ? `${publicDomain}/whatsapp-bot` : `${apiBase}/whatsapp-bot`;
    setDraft({
      ...draft,
      bailey: {
        sessionId: draft.bailey.sessionId || "kavya-main",
        botNumber: String(draft.bailey.botNumber || draft.profile.whatsapp || "").replace(/[^\d]/g, ""),
        publicUrl: botPublicUrl,
        webhookUrl: draft.bailey.webhookUrl || `${apiBase}/api/whatsapp/inbound`,
        qrisGenerateUrl: draft.bailey.qrisGenerateUrl || `${apiBase}/api/orders`,
        botToken: draft.bailey.botToken || makePanelSecret("wabot"),
        inboundToken: draft.bailey.inboundToken || makePanelSecret("wain"),
      },
    });
    showMessage("Default lokal WhatsApp Bailey sudah diisi. Klik Simpan untuk menyimpan.");
  }

  async function copyValue(id: string, text: string) {
    await navigator.clipboard.writeText(text || "");
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(""), 1500);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSavingSection("profile");
    try {
      const updated = await api.updateOwnerSettings({ profile: draft.profile });
      const normalized = normalizeOwnerSettings(updated);
      setDraft(normalized);
      syncOwnerSession(normalized.profile);
      setProfileEditing(false);
      showMessage("Profil berhasil disimpan");
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : "Profil gagal disimpan");
    } finally {
      setSavingSection("");
    }
  }

  async function saveIntegration(event: FormEvent<HTMLFormElement>, section: SecretSection) {
    event.preventDefault();
    setError("");
    setSavingSection(section);
    try {
      const updated = await api.updateOwnerSettings({ [section]: draft[section] });
      setDraft(normalizeOwnerSettings(updated));
      const sectionLabel = { pakasir: "Pakasir", bailey: "WhatsApp Bailey", gmail: "Gmail", cloudflare: "Cloudflare", googleSheets: "Google Sheets" }[section];
      showMessage(`${sectionLabel} berhasil disimpan`);
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : "Pengaturan gagal disimpan");
    } finally {
      setSavingSection("");
    }
  }

  async function savePaymentSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSavingSection("payment");
    try {
      const updated = await api.updateOwnerSettings({ payment: draft.payment });
      setDraft(normalizeOwnerSettings(updated));
      showMessage("Pengaturan deposit berhasil disimpan");
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : "Pengaturan deposit gagal disimpan");
    } finally {
      setSavingSection("");
    }
  }

  async function connectGmailOAuth() {
    setError("");
    setSavingSection("gmail-oauth");
    const oauthWindow = window.open("about:blank", "_blank");
    try {
      const updated = await api.updateOwnerSettings({ gmail: draft.gmail });
      setDraft(normalizeOwnerSettings(updated));
      const result = await api.startGmailOAuth();
      if (oauthWindow) {
        oauthWindow.opener = null;
        oauthWindow.location.href = result.url;
      } else {
        window.location.href = result.url;
      }
      showMessage("Tab Google OAuth dibuka. Login dengan email owner, lalu izinkan akses Gmail read-only.", 3500);
    } catch (oauthError) {
      oauthWindow?.close();
      showError(oauthError instanceof Error ? oauthError.message : "Gagal membuat link OAuth Gmail");
    } finally {
      setSavingSection("");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (passwordForm.newPassword.length < 8) {
      showError("Password baru minimal 8 karakter");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showError("Konfirmasi password tidak sama");
      return;
    }
    setSavingSection("security");
    try {
      const result = await api.changePassword(passwordForm);
      if (result.token) {
        syncOwnerSession(draft.profile, result.token);
      }
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showMessage("Password berhasil diperbarui");
    } catch (saveError) {
      showError(saveError instanceof Error ? saveError.message : "Password gagal diperbarui");
    } finally {
      setSavingSection("");
    }
  }

  function logoutCurrentSession() {
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <DashboardLayout role="owner" title="Settings">
      <div className="space-y-5">
        {toast ? (
          <div
            key={toast.id}
            className={`fixed left-1/2 top-5 z-[90] flex min-h-11 min-w-[260px] max-w-[calc(100vw-32px)] -translate-x-1/2 items-center justify-center gap-2 rounded-lg border px-4 py-3 text-center text-xs font-semibold shadow-lg animate-toast-rise ${
              toast.type === "error"
                ? "border-red-100 bg-red-50 text-red-700"
                : toast.type === "info"
                  ? "border-sky-100 bg-sky-50 text-sky-700"
                  : "border-emerald-100 bg-emerald-50 text-emerald-700"
            }`}
          >
            <i className={toast.type === "error" ? "ri-close-circle-line" : toast.type === "info" ? "ri-information-line" : "ri-check-line"} />
            <span>{toast.text}</span>
          </div>
        ) : null}
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-950">
            <i className="ri-settings-3-line text-base" />
            SETTINGS
          </h1>
          <p className="mt-2 text-sm text-slate-500">Kelola akun owner, security, API key, dan integrasi service.</p>
        </div>

        {error ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{error}</div> : null}

        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-gray-100 bg-white p-2 lg:sticky lg:top-24 lg:self-start">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectTab(tab.id)}
                className={`flex h-12 w-full items-center gap-3 rounded-lg px-4 text-sm font-medium transition-colors ${
                  activeTab === tab.id ? "bg-red-50 text-red-600" : "text-slate-700 hover:bg-slate-50 hover:text-red-600"
                }`}
              >
                <i className={`${tab.icon} ${activeTab === tab.id ? "text-red-600" : "text-slate-500"}`} />
                {tab.label}
              </button>
            ))}
          </aside>

          <div className="min-w-0 space-y-5">
            {activeTab === "profile" ? (
              <>
                <Panel
                  icon="ri-user-3-line"
                  title="Profile Information"
                  subtitle="Data owner untuk identitas panel dan login otomatis berdasarkan email atau username."
                  action={
                    <button
                      type="button"
                      onClick={() => setProfileEditing((current) => !current)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-slate-500 hover:border-red-100 hover:bg-red-50 hover:text-red-600"
                      aria-label="Edit profil"
                    >
                      <i className={profileEditing ? "ri-close-line" : "ri-settings-3-line"} />
                    </button>
                  }
                >
                  <form onSubmit={saveProfile} className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Username" value={draft.profile.username} readOnly={!profileEditing} onChange={(value) => setDraft({ ...draft, profile: { ...draft.profile, username: value } })} />
                      <Field label="Nama Owner" value={draft.profile.name} readOnly={!profileEditing} onChange={(value) => setDraft({ ...draft, profile: { ...draft.profile, name: value } })} />
                      <Field label="Email" value={draft.profile.email} readOnly={!profileEditing} onChange={(value) => setDraft({ ...draft, profile: { ...draft.profile, email: value } })} />
                      <Field label="Nomor WA" value={draft.profile.whatsapp} readOnly={!profileEditing} onChange={(value) => setDraft({ ...draft, profile: { ...draft.profile, whatsapp: value } })} />
                    </div>
                    {profileEditing ? (
                      <div className="flex gap-2">
                        <SaveButton loading={savingSection === "profile"}>Simpan Profil</SaveButton>
                        <button
                          type="button"
                          onClick={() => {
                            api.ownerSettings().then((value) => setDraft(normalizeOwnerSettings(value))).catch(console.error);
                            setProfileEditing(false);
                          }}
                          className="h-9 rounded-md border border-gray-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Batal
                        </button>
                      </div>
                    ) : null}
                  </form>
                </Panel>

                <Panel icon="ri-bar-chart-box-line" title="Account Overview" tone="bg-sky-50 text-sky-600">
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    <OverviewMetric value={String(accountStats.transactions)} label="Transaksi" />
                    <OverviewMetric value={String(accountStats.paid)} label="Order Dibayar" />
                    <OverviewMetric value={formatRupiah(accountStats.revenue)} label="Pendapatan" />
                    <OverviewMetric value="Owner" label="Role" />
                  </div>
                </Panel>
              </>
            ) : null}

            {activeTab === "security" ? (
              <>
                <Panel icon="ri-lock-2-line" title="Change Password" tone="bg-indigo-50 text-indigo-600">
                  <form onSubmit={changePassword} className="max-w-xl space-y-5">
                    <Field
                      label="Current Password"
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(value) => setPasswordForm({ ...passwordForm, currentPassword: value })}
                    />
                    <Field
                      label="New Password"
                      type="password"
                      value={passwordForm.newPassword}
                      hint="Minimum 8 characters"
                      onChange={(value) => setPasswordForm({ ...passwordForm, newPassword: value })}
                    />
                    <Field
                      label="Confirm New Password"
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(value) => setPasswordForm({ ...passwordForm, confirmPassword: value })}
                    />
                    <SaveButton loading={savingSection === "security"}>
                      <span className="inline-flex items-center gap-2">
                        <i className="ri-lock-password-line" />
                        Update Password
                      </span>
                    </SaveButton>
                  </form>
                </Panel>

                <Panel icon="ri-computer-line" title="Active Sessions" tone="bg-slate-50 text-slate-600">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <i className="ri-computer-line text-lg text-indigo-500" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Current Browser <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Current</span>
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-slate-500">Now</span>
                  </div>
                  <button
                    type="button"
                    onClick={logoutCurrentSession}
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-red-100 px-4 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    <i className="ri-logout-box-r-line" />
                    Logout Session
                  </button>
                </Panel>
              </>
            ) : null}

            {activeTab === "api" ? (
              <>
                <form onSubmit={(event) => saveIntegration(event, "pakasir")}>
                  <Panel
                    id="pakasir-qris"
                    icon="ri-key-2-line"
                    title="QRIS Pakasir"
                    subtitle="API Key dan Merchant ID dipakai backend untuk membuat QRIS otomatis saat order masuk."
                    tone="bg-amber-50 text-amber-600"
                    action={<EyeToggle visible={visible.pakasir} onClick={() => setVisible({ ...visible, pakasir: !visible.pakasir })} />}
                  >
                    <div className="grid gap-4">
                      <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-4 py-3 text-xs leading-5 text-amber-700">
                        Merchant ID adalah project/slug toko di Pakasir. API Key diambil dari dashboard Pakasir, bukan password login akun Pakasir.
                      </div>
                      <SecretField id="pakasir-api-key" label="API Key" value={draft.pakasir.apiKey} visible={visible.pakasir} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, pakasir: { ...draft.pakasir, apiKey: value } })} />
                      <SecretField id="pakasir-merchant" label="Merchant ID" value={draft.pakasir.merchantId} visible={visible.pakasir} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, pakasir: { ...draft.pakasir, merchantId: value } })} />
                      <SecretField id="pakasir-webhook" label="Webhook Secret" value={draft.pakasir.webhookSecret} visible={visible.pakasir} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, pakasir: { ...draft.pakasir, webhookSecret: value } })} />
                      <SaveButton loading={savingSection === "pakasir"} />
                    </div>
                  </Panel>
                </form>

                <form onSubmit={(event) => saveIntegration(event, "bailey")}>
                  <Panel
                    id="whatsapp-bailey"
                    icon="ri-whatsapp-line"
                    title="WhatsApp Bailey"
                    subtitle="Konfigurasi service bot WhatsApp untuk menerima order dan meneruskan request QRIS ke backend."
                    tone="bg-emerald-50 text-emerald-600"
                    action={<EyeToggle visible={visible.bailey} onClick={() => setVisible({ ...visible, bailey: !visible.bailey })} />}
                  >
                    <div className="grid gap-4">
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-4 py-3 text-xs leading-5 text-emerald-700">
                        Webhook URL dipakai bot Bailey untuk kirim event ke dashboard. Jika token Bailey diganti, restart service Pterodactyl agar bot memakai token baru.
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={fillBaileyLocalDefaults}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-100 bg-white px-4 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                        >
                          <i className="ri-magic-line" />
                          Isi Default Lokal
                        </button>
                        <span className="text-xs text-slate-500">
                          Pakai ini untuk lokal/Pterodactyl awal. Nanti domain bisa diganti ke Cloudflare.
                        </span>
                      </div>
                      <SecretField id="bailey-session" label="Bailey Session ID" value={draft.bailey.sessionId} visible={visible.bailey} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, bailey: { ...draft.bailey, sessionId: value } })} />
                      <SecretField id="bailey-number" label="Nomor WhatsApp Bot" value={draft.bailey.botNumber} visible={visible.bailey} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, bailey: { ...draft.bailey, botNumber: value } })} />
                      <SecretField id="bailey-public" label="Bot Public URL" value={draft.bailey.publicUrl} visible={visible.bailey} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, bailey: { ...draft.bailey, publicUrl: value } })} />
                      <SecretField id="bailey-webhook" label="Webhook URL" value={draft.bailey.webhookUrl} visible={visible.bailey} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, bailey: { ...draft.bailey, webhookUrl: value } })} />
                      <SecretField id="bailey-qris" label="QRIS Generate URL" value={draft.bailey.qrisGenerateUrl} visible={visible.bailey} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, bailey: { ...draft.bailey, qrisGenerateUrl: value } })} />
                      <SecretField id="bailey-bot-token" label="Bot API Token" value={draft.bailey.botToken} visible={visible.bailey} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, bailey: { ...draft.bailey, botToken: value } })} />
                      <SecretField id="bailey-inbound-token" label="Inbound Webhook Token" value={draft.bailey.inboundToken} visible={visible.bailey} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, bailey: { ...draft.bailey, inboundToken: value } })} />
                      {buildBaileyQrUrl(draft) ? (
                        <a
                          href={buildBaileyQrUrl(draft)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 w-fit items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50 px-4 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          <i className="ri-qr-code-line" />
                          Buka QR Pairing
                        </a>
                      ) : (
                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                          Isi Bot Public URL dan Bot API Token dulu supaya link QR pairing bisa dibuat.
                        </div>
                      )}
                      <SaveButton loading={savingSection === "bailey"} />
                    </div>
                  </Panel>
                </form>

                <form onSubmit={(event) => saveIntegration(event, "cloudflare")}>
                  <Panel
                    icon="ri-cloud-line"
                    title="Cloudflare Tunnel"
                    subtitle="Domain publik dashboard. Tunnel token dibaca dari file .env Pterodactyl."
                    tone="bg-violet-50 text-violet-600"
                    action={<EyeToggle visible={visible.cloudflare} onClick={() => setVisible({ ...visible, cloudflare: !visible.cloudflare })} />}
                  >
                    <div className="grid gap-4">
                      <div className="rounded-lg border border-violet-100 bg-violet-50/50 px-4 py-3 text-xs leading-5 text-violet-700">
                        Public Domain dipakai untuk link order, QRIS, OAuth callback, dan URL bot. Isi CLOUDFLARED_TOKEN di /home/container/.env untuk menyalakan tunnel.
                      </div>
                      <SecretField id="cloudflare-domain" label="Public Domain" value={draft.cloudflare.publicDomain} visible={visible.cloudflare} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, cloudflare: { ...draft.cloudflare, publicDomain: value } })} />
                      <SaveButton loading={savingSection === "cloudflare"} />
                    </div>
                  </Panel>
                </form>

                <form onSubmit={savePaymentSettings}>
                  <Panel
                    icon="ri-bank-card-line"
                    title="Deposit Manual Owner"
                    subtitle="Gambar QRIS owner dan rekening manual yang tampil di form pengajuan deposit reseller."
                    tone="bg-fuchsia-50 text-fuchsia-600"
                  >
                    <div className="grid gap-4">
                      <div className="rounded-lg border border-fuchsia-100 bg-fuchsia-50/50 px-4 py-3 text-xs leading-5 text-fuchsia-700">
                        Isi bagian ini supaya modal deposit reseller tidak kosong. QRIS owner akan tampil sebagai gambar, sedangkan metode manual menampilkan nomor rekening dan nama pemilik.
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                        <div className="space-y-4">
                          <Field
                            label="URL Gambar QRIS Owner"
                            value={draft.payment.ownerQrisImageUrl}
                            onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, ownerQrisImageUrl: value } })}
                          />
                          <label className="block">
                            <span className="text-xs font-medium text-slate-700">Catatan QRIS Owner</span>
                            <textarea
                              value={draft.payment.ownerQrisNote}
                              onChange={(event) => setDraft({ ...draft, payment: { ...draft.payment, ownerQrisNote: event.target.value } })}
                              rows={3}
                              placeholder="Contoh: QRIS manual owner, kirim bukti transfer bila diperlukan."
                              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs outline-none transition-colors focus:border-fuchsia-300"
                            />
                          </label>
                        </div>
                        <div className="rounded-xl border border-fuchsia-100 bg-fuchsia-50/40 p-3">
                          {draft.payment.ownerQrisImageUrl ? (
                            <img
                              src={draft.payment.ownerQrisImageUrl}
                              alt="QRIS Owner"
                              className="h-48 w-full rounded-lg border border-fuchsia-100 object-contain bg-white"
                            />
                          ) : (
                            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-fuchsia-200 bg-white text-center text-xs text-slate-400">
                              Preview QRIS owner akan muncul di sini
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <Field
                          label="Nomor DANA"
                          value={draft.payment.danaNumber}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, danaNumber: value } })}
                        />
                        <Field
                          label="Atas Nama DANA"
                          value={draft.payment.danaName}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, danaName: value } })}
                        />
                        <Field
                          label="Nomor Livin Mandiri"
                          value={draft.payment.livinNumber}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, livinNumber: value } })}
                        />
                        <Field
                          label="Atas Nama Livin Mandiri"
                          value={draft.payment.livinName}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, livinName: value } })}
                        />
                        <Field
                          label="Nomor BCA"
                          value={draft.payment.bcaNumber}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, bcaNumber: value } })}
                        />
                        <Field
                          label="Atas Nama BCA"
                          value={draft.payment.bcaName}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, bcaName: value } })}
                        />
                        <Field
                          label="Nomor GoPay"
                          value={draft.payment.gopayNumber}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, gopayNumber: value } })}
                        />
                        <Field
                          label="Atas Nama GoPay"
                          value={draft.payment.gopayName}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, gopayName: value } })}
                        />
                        <Field
                          label="Nomor ShopeePay"
                          value={draft.payment.shopeepayNumber}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, shopeepayNumber: value } })}
                        />
                        <Field
                          label="Atas Nama ShopeePay"
                          value={draft.payment.shopeepayName}
                          onChange={(value) => setDraft({ ...draft, payment: { ...draft.payment, shopeepayName: value } })}
                        />
                      </div>

                      <SaveButton loading={savingSection === "payment"} />
                    </div>
                  </Panel>
                </form>

                <form onSubmit={(event) => saveIntegration(event, "gmail")}>
                  <Panel
                    id="gmail-auth"
                    icon="ri-mail-settings-line"
                    title="Gmail Inbox"
                    subtitle="Akses inbox owner untuk lookup sign-in code, verification, reset password, dan household."
                    tone="bg-sky-50 text-sky-600"
                    action={<EyeToggle visible={visible.gmail} onClick={() => setVisible({ ...visible, gmail: !visible.gmail })} />}
                  >
                    <div className="grid gap-4">
                      <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-4 py-3 text-xs leading-5 text-amber-700">
                        Mode IMAP disarankan untuk akun sendiri: aktifkan IMAP di Gmail, buat App Password Google, lalu simpan di sini. OAuth tetap tersedia sebagai fallback.
                      </div>
                      <div>
                        <span className="text-xs font-medium text-slate-700">Mode Gmail</span>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {[
                            { id: "imap", title: "IMAP App Password", subtitle: "Stabil untuk Gmail owner sendiri" },
                            { id: "oauth", title: "OAuth Google", subtitle: "Butuh refresh token Google" },
                          ].map((mode) => (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => setDraft({ ...draft, gmail: { ...draft.gmail, mode: mode.id } })}
                              className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                                draft.gmail.mode === mode.id
                                  ? "border-sky-200 bg-sky-50 text-sky-800"
                                  : "border-gray-200 bg-white text-slate-600 hover:border-sky-100 hover:bg-sky-50/50"
                              }`}
                            >
                              <span className="block text-sm font-semibold">{mode.title}</span>
                              <span className="mt-1 block text-xs">{mode.subtitle}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      {draft.gmail.mode === "imap" ? (
                        <>
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Inbox Email" value={draft.gmail.inboxEmail} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, inboxEmail: value, imapUser: draft.gmail.imapUser || value } })} />
                            <Field label="IMAP User" value={draft.gmail.imapUser} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, imapUser: value } })} />
                            <Field label="IMAP Host" value={draft.gmail.imapHost} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, imapHost: value } })} />
                            <Field label="IMAP Port" value={String(draft.gmail.imapPort || "")} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, imapPort: Number(value.replace(/[^\d]/g, "")) || 993 } })} />
                          </div>
                          <SecretField id="gmail-imap-password" label="App Password Gmail" value={draft.gmail.imapPassword} visible={visible.gmail} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, imapPassword: value } })} />
                          <label className="flex items-center gap-3 text-xs font-medium text-slate-700">
                            <input
                              type="checkbox"
                              checked={draft.gmail.imapSecure !== false}
                              onChange={(event) => setDraft({ ...draft, gmail: { ...draft.gmail, imapSecure: event.target.checked } })}
                              className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-200"
                            />
                            Gunakan koneksi aman TLS/SSL
                          </label>
                          <SaveButton loading={savingSection === "gmail"} />
                        </>
                      ) : (
                        <>
                          <SecretField id="gmail-client-id" label="Client ID" value={draft.gmail.clientId} visible={visible.gmail} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, clientId: value } })} />
                          <SecretField id="gmail-client-secret" label="Client Secret" value={draft.gmail.clientSecret} visible={visible.gmail} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, clientSecret: value } })} />
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Redirect URI" value={draft.gmail.redirectUri} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, redirectUri: value } })} />
                            <Field label="Inbox Email" value={draft.gmail.inboxEmail} onChange={(value) => setDraft({ ...draft, gmail: { ...draft.gmail, inboxEmail: value } })} />
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <SaveButton loading={savingSection === "gmail"} />
                            <button
                              type="button"
                              onClick={connectGmailOAuth}
                              disabled={savingSection === "gmail-oauth"}
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-4 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60"
                            >
                              <i className={savingSection === "gmail-oauth" ? "ri-loader-4-line animate-spin" : "ri-google-line"} />
                              {savingSection === "gmail-oauth" ? "Membuka OAuth..." : "Sambungkan OAuth Gmail"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </Panel>
                </form>

                <form onSubmit={(event) => saveIntegration(event, "googleSheets")}>
                  <Panel
                    id="google-sheets-stock"
                    icon="ri-file-excel-2-line"
                    title="Google Sheets Stock"
                    subtitle="Sheets dipakai sebagai tempat drop stok Netflix dan Canva. Kavya tetap mengunci stok di database agar tidak double drop."
                    tone="bg-emerald-50 text-emerald-600"
                    action={<EyeToggle visible={visible.googleSheets} onClick={() => setVisible({ ...visible, googleSheets: !visible.googleSheets })} />}
                  >
                    <div className="grid gap-4">
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-4 py-3 text-xs leading-5 text-emerald-700">
                        Share spreadsheet ke email service account sebagai Editor. Format Netflix memakai marker POOL: NETFLIX_SHARED dan POOL: NETFLIX_2U. Canva memakai tab Canva dengan CANVA POOL dan CANVA USAGE.
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Spreadsheet ID" value={draft.googleSheets.spreadsheetId} onChange={(value) => setDraft({ ...draft, googleSheets: { ...draft.googleSheets, spreadsheetId: value } })} mono />
                        <Field label="Sheet Name" value={draft.googleSheets.sheetName} onChange={(value) => setDraft({ ...draft, googleSheets: { ...draft.googleSheets, sheetName: value } })} />
                      </div>
                      <SecretField id="sheets-service-email" label="Service Account Email" value={draft.googleSheets.serviceAccountEmail} visible={visible.googleSheets} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, googleSheets: { ...draft.googleSheets, serviceAccountEmail: value } })} />
                      <SecretField id="sheets-private-key" label="Private Key" value={draft.googleSheets.privateKey} visible={visible.googleSheets} copiedId={copiedId} onCopy={copyValue} onChange={(value) => setDraft({ ...draft, googleSheets: { ...draft.googleSheets, privateKey: value } })} />
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <SaveButton loading={savingSection === "googleSheets"} />
                        <button
                          type="button"
                          onClick={async () => {
                            const confirmed = window.confirm(
                              "Template Sheets hanya dibuat dari halaman Settings. Pastikan spreadsheet benar, karena tombol ini menulis header/layout Netflix dan Canva. Lanjut buat template?",
                            );
                            if (!confirmed) return;
                            setSavingSection("googleSheets");
                            try {
                              const updated = await api.updateOwnerSettings({ googleSheets: draft.googleSheets });
                              setDraft(updated);
                              await api.setupSheetsTemplate();
                              showMessage("Template Netflix dan Canva berhasil dibuat di Google Sheets.");
                            } catch (setupError) {
                              showError(setupError instanceof Error ? setupError.message : "Template Google Sheets gagal dibuat");
                            } finally {
                              setSavingSection("");
                            }
                          }}
                          disabled={savingSection === "googleSheets"}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-100 bg-emerald-50 px-4 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          <i className={savingSection === "googleSheets" ? "ri-loader-4-line animate-spin" : "ri-table-line"} />
                          Buat Template Sheets
                        </button>
                      </div>
                    </div>
                  </Panel>
                </form>

                <Panel icon="ri-pulse-line" title="Status Integrasi" subtitle="Ringkasan koneksi service yang dibaca dari konfigurasi saat ini." tone="bg-slate-50 text-slate-600">
                  <div className="grid gap-3 md:grid-cols-4">
                    <StatusItem label="Pakasir" state={draft.status.pakasir} />
                    <StatusItem label="Bailey" state={draft.status.bailey} />
                    <StatusItem label="Gmail" state={draft.status.gmail} />
                    <StatusItem label="Sheets" state={draft.status.googleSheets} />
                  </div>
                </Panel>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
