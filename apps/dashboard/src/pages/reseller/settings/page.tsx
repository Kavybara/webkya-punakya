import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, type ApiOrder, type ApiReseller } from "../../../lib/api";
import { clearSession, readSession, writeSession } from "../../../lib/session";
import { formatRupiah } from "../../../mocks/data";
import { MiniBadge, ResellerPageTitle, ResellerStatCard } from "../resellerUi";

type SettingsTab = "profile" | "security";

const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: "profile", label: "Profil", icon: "ri-user-3-line" },
  { id: "security", label: "Keamanan", icon: "ri-lock-2-line" },
];

const emptyProfile = {
  name: "",
  username: "",
  email: "",
  whatsapp: "",
};

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "profile" || value === "security";
}

function Panel({
  icon,
  title,
  subtitle,
  tone = "bg-red-50 text-red-600",
  action,
  children,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  tone?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white">
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
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        readOnly={readOnly}
        className={`mt-2 h-11 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none transition-colors focus:border-red-300 ${
          readOnly ? "bg-slate-50 text-slate-500" : "bg-white text-slate-900"
        }`}
      />
      {hint ? <span className="mt-2 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

function SaveButton({ children = "Simpan" }: { children?: ReactNode }) {
  return (
    <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700">
      {children}
    </button>
  );
}

function OverviewMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function syncResellerSession(profile: ApiReseller, token?: string) {
  try {
    const session = readSession();
    if (session?.role !== "reseller") return;
    writeSession(
      {
        ...session,
        ...(token ? { token } : {}),
        user: {
          ...(session.user || {}),
          id: profile.id,
          name: profile.name,
          email: profile.email,
          username: profile.username,
          whatsapp: profile.whatsapp,
        },
      },
      Boolean(localStorage.getItem("kavya-session")),
    );
  } catch {
    // Session sync is best-effort; auth guard handles invalid sessions.
  }
}

function settingsErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (!message || message.includes("Unexpected end of JSON input")) return "";
  return message;
}

export default function ResellerSettings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab: SettingsTab = isSettingsTab(requestedTab) ? requestedTab : "profile";
  const [reseller, setReseller] = useState<ApiReseller | null>(null);
  const [draft, setDraft] = useState(emptyProfile);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [profileEditing, setProfileEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  const accountStats = useMemo(() => {
    const paidOrders = orders.filter((order) => order.qrisStatus === "paid" || order.orderStatus === "completed");
    return {
      transactions: orders.length,
      paid: paidOrders.length,
      spending: paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    };
  }, [orders]);

  useEffect(() => {
    async function loadData() {
      const [resellerRows, orderRows] = await Promise.all([api.resellers(), api.orders()]);
      const current = resellerRows[0] || null;
      setReseller(current);
      setDraft({
        name: current?.name || "",
        username: current?.username || "",
        email: current?.email || "",
        whatsapp: current?.whatsapp || "",
      });
      if (current) syncResellerSession(current);
      setOrders(orderRows);
      setError("");
    }
    loadData().catch((loadError) => {
      const friendlyMessage = settingsErrorMessage(loadError);
      if (friendlyMessage) setError(friendlyMessage);
    });
  }, []);

  function selectTab(tab: SettingsTab) {
    if (tab !== activeTab) {
      setSearchParams({ tab }, { replace: true });
    }
    setError("");
  }

  function showMessage(text: string, delay = 2000) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), delay);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!reseller?.id) {
      setError("Data reseller tidak ditemukan");
      return;
    }
    try {
      const updated = await api.updateReseller(reseller.id, {
        name: draft.name,
        username: draft.username,
        email: draft.email,
      });
      setReseller(updated);
      setDraft({
        name: updated.name || "",
        username: updated.username || "",
        email: updated.email || "",
        whatsapp: updated.whatsapp || "",
      });
      syncResellerSession(updated);
      setProfileEditing(false);
      showMessage("Profil berhasil disimpan");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Profil gagal disimpan");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (passwordForm.newPassword.length < 8) {
      setError("Password baru minimal 8 karakter");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("Konfirmasi password tidak sama");
      return;
    }
    try {
      const result = await api.changePassword(passwordForm);
      if (result.token && reseller) syncResellerSession(reseller, result.token);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showMessage("Password berhasil diperbarui");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Password gagal diperbarui");
    }
  }

  function resetDraft() {
    setDraft({
      name: reseller?.name || "",
      username: reseller?.username || "",
      email: reseller?.email || "",
      whatsapp: reseller?.whatsapp || "",
    });
    setProfileEditing(false);
  }

  function logoutCurrentSession() {
    api.logout().catch(() => undefined);
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <DashboardLayout role="reseller" title="Pengaturan">
      <div className="space-y-5">
        <ResellerPageTitle title="Pengaturan" subtitle="Kelola identitas panel reseller, keamanan login, dan sesi aktif." />

        <div className="grid gap-4 md:grid-cols-3">
          <ResellerStatCard label="Username Panel" value={reseller?.username || "-"} icon="ri-at-line" tone="blue" hint="Dipakai untuk identitas panel" />
          <ResellerStatCard label="Total Transaksi" value={accountStats.transactions} icon="ri-shopping-bag-3-line" tone="amber" hint="Total order yang tercatat" />
          <ResellerStatCard label="Total Belanja" value={formatRupiah(accountStats.spending)} icon="ri-wallet-3-line" tone="emerald" hint="Akumulasi order yang sudah dibayar" />
        </div>

        {message ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">{message}</div> : null}
        {error ? <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{error}</div> : null}

        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-gray-100 bg-white p-2 lg:sticky lg:top-24 lg:self-start">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{reseller?.name || reseller?.username || "Reseller"}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-400">{reseller?.email || "Email belum tersedia"}</p>
              </div>
              <MiniBadge className="bg-emerald-50 text-emerald-700">Aman</MiniBadge>
            </div>
            <div className="mt-2">
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
            </div>
          </aside>

          <div className="min-w-0 space-y-5">
            {activeTab === "profile" ? (
              <>
                <Panel
                  icon="ri-user-3-line"
                  title="Informasi Profil"
                  subtitle="Data reseller untuk identitas panel dan login berdasarkan email atau username."
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
                      <Field label="Username" value={draft.username} readOnly={!profileEditing} onChange={(value) => setDraft({ ...draft, username: value })} />
                      <Field label="Nama Reseller" value={draft.name} readOnly={!profileEditing} onChange={(value) => setDraft({ ...draft, name: value })} />
                      <Field label="Email" value={draft.email} readOnly={!profileEditing} onChange={(value) => setDraft({ ...draft, email: value })} />
                      <Field label="Nomor WA" value={draft.whatsapp} readOnly />
                    </div>
                    {profileEditing ? (
                      <div className="flex gap-2">
                        <SaveButton>Simpan Profil</SaveButton>
                        <button
                          type="button"
                          onClick={resetDraft}
                          className="h-9 rounded-md border border-gray-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Batal
                        </button>
                      </div>
                    ) : null}
                  </form>
                </Panel>

                <Panel icon="ri-bar-chart-box-line" title="Ringkasan Akun" tone="bg-sky-50 text-sky-600">
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    <OverviewMetric value={String(accountStats.transactions)} label="Transaksi" />
                    <OverviewMetric value={String(accountStats.paid)} label="Order Dibayar" />
                    <OverviewMetric value={formatRupiah(accountStats.spending)} label="Total Belanja" />
                    <OverviewMetric value="Reseller" label="Role" />
                  </div>
                </Panel>
              </>
            ) : null}

            {activeTab === "security" ? (
              <>
                <Panel icon="ri-lock-2-line" title="Ganti Password" tone="bg-indigo-50 text-indigo-600">
                  <form onSubmit={changePassword} className="max-w-xl space-y-5">
                    <Field
                      label="Password Saat Ini"
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(value) => setPasswordForm({ ...passwordForm, currentPassword: value })}
                    />
                    <Field
                      label="Password Baru"
                      type="password"
                      value={passwordForm.newPassword}
                      hint="Minimal 8 karakter"
                      onChange={(value) => setPasswordForm({ ...passwordForm, newPassword: value })}
                    />
                    <Field
                      label="Konfirmasi Password Baru"
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(value) => setPasswordForm({ ...passwordForm, confirmPassword: value })}
                    />
                    <SaveButton>
                      <span className="inline-flex items-center gap-2">
                        <i className="ri-lock-password-line" />
                        Simpan Password
                      </span>
                    </SaveButton>
                  </form>
                </Panel>

                <Panel icon="ri-computer-line" title="Sesi Aktif" subtitle="Ringkasan browser yang sedang memakai akun reseller ini." tone="bg-slate-50 text-slate-600">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <i className="ri-computer-line text-lg text-indigo-500" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Browser Saat Ini <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Aktif</span>
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-slate-500">Sekarang</span>
                  </div>
                  <button
                    type="button"
                    onClick={logoutCurrentSession}
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-red-100 px-4 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    <i className="ri-logout-box-r-line" />
                    Keluar dari Sesi Ini
                  </button>
                </Panel>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
