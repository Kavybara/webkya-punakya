import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AtSign,
  BarChart3,
  Lock,
  LogOut,
  Monitor,
  Pencil,
  Save,
  ShoppingBag,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { api, type ApiOrder, type ApiReseller } from "../../../lib/api";
import { clearSession, readSession, updateSession } from "../../../lib/session";
import { formatRupiah } from "../../../lib/format";
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";
import {
  Badge,
  ErrorState,
  Field,
  LoadingSkeleton,
  MetricRow,
  Notice,
  Toast,
} from "../../../components/ui";
import "./settings.css";

type SettingsTab = "profile" | "security";

const tabs: Array<{ id: SettingsTab; label: string; icon: typeof UserRound }> = [
  { id: "profile", label: "Profil", icon: UserRound },
  { id: "security", label: "Keamanan", icon: Lock },
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

/**
 * The card every region of this page sits in.
 *
 * The shell of it is the reseller panel the accounts page already uses; only the
 * body padding and the icon slot are this page's, which is why they carry a
 * `reseller-v2-settings-` name rather than being added to the shared sheet.
 */
function Panel({
  eyebrow,
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="reseller-v2-panel reseller-v2-settings-panel">
      <header>
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ?? (icon ? <i aria-hidden="true">{icon}</i> : null)}
      </header>
      <div className="reseller-v2-settings-panel-body">{children}</div>
    </section>
  );
}

/**
 * Keep the shell's copy of the signed-in reseller in step with what the server
 * just confirmed, so the panel header does not keep showing the name and email
 * the reseller has just changed.
 *
 * Best effort by design: a failure here must not fail a save that already
 * succeeded, and the auth guard owns invalid sessions.
 */
function syncResellerSession(profile: ApiReseller, token?: string) {
  try {
    const session = readSession();
    if (session?.role !== "reseller") return;
    updateSession({
      ...(token ? { token } : {}),
      user: {
        ...(session.user || {}),
        id: profile.id,
        name: profile.name,
        email: profile.email,
        username: profile.username,
        whatsapp: profile.whatsapp,
      },
    });
  } catch {
    // Session sync is best-effort; auth guard handles invalid sessions.
  }
}

function settingsErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (!message || message.includes("Unexpected end of JSON input")) return "";
  return message;
}

function draftFromReseller(reseller: ApiReseller | null) {
  return {
    name: reseller?.name || "",
    username: reseller?.username || "",
    email: reseller?.email || "",
    whatsapp: reseller?.whatsapp || "",
  };
}

export default function ResellerV2SettingsPage() {
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const messageTimer = useRef<number | null>(null);

  const accountStats = useMemo(() => {
    const paidOrders = orders.filter(
      (order) => order.qrisStatus === "paid" || order.orderStatus === "completed",
    );
    return {
      transactions: orders.length,
      paid: paidOrders.length,
      spending: paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    };
  }, [orders]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [resellerRows, orderRows] = await Promise.all([api.resellers(), api.orders()]);
      const current = resellerRows[0] || null;
      setReseller(current);
      setDraft(draftFromReseller(current));
      if (current) syncResellerSession(current);
      setOrders(orderRows);
      setError("");
      setLoadFailed(false);
    } catch (loadError) {
      // The blank/JSON-blip case is still swallowed exactly as it was before,
      // but the region has to say it could not load -- otherwise the form below
      // renders as if it had.
      const friendlyMessage = settingsErrorMessage(loadError);
      setLoadFailed(true);
      setError(friendlyMessage || "Profil belum dapat dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(
    () => () => {
      if (messageTimer.current) window.clearTimeout(messageTimer.current);
    },
    [],
  );

  function selectTab(tab: SettingsTab) {
    if (tab !== activeTab) {
      setSearchParams({ tab }, { replace: true });
    }
    setError("");
    setLoadFailed(false);
  }

  function showMessage(text: string, delay = 2000) {
    setMessage(text);
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(""), delay);
  }

  function resetDraft() {
    setDraft(draftFromReseller(reseller));
    setProfileEditing(false);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!reseller?.id) {
      setError("Data reseller tidak ditemukan");
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await api.updateReseller(reseller.id, {
        name: draft.name,
        username: draft.username,
        email: draft.email,
      });
      setReseller(updated);
      setDraft(draftFromReseller(updated));
      syncResellerSession(updated);
      setProfileEditing(false);
      showMessage("Profil berhasil disimpan");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Profil gagal disimpan");
    } finally {
      setSavingProfile(false);
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
    setSavingPassword(true);
    try {
      const result = await api.changePassword(passwordForm);
      if (result.token && reseller) syncResellerSession(reseller, result.token);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showMessage("Password berhasil diperbarui");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Password gagal diperbarui");
    } finally {
      setSavingPassword(false);
    }
  }

  function logoutCurrentSession() {
    api.logout().catch(() => undefined);
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <ResellerShell
      title="Pengaturan"
      description="Kelola identitas panel reseller, keamanan login, dan sesi aktif."
      loading={loading}
      // No attention props -- listed in `PAGES_WITHOUT_ATTENTION`. A form has
      // nothing queued, blocked, or overdue; the one thing worth surfacing is a
      // failed save, and that is already the MetricRow and Notice below.
      onRefresh={() => load().catch(() => undefined)}
    >
      <MetricRow
        label="Ringkasan pengaturan"
        items={[
          {
            label: "Username Panel",
            value: reseller?.username || "-",
            icon: <AtSign size={15} />,
            hint: "Dipakai untuk identitas panel",
            loading,
          },
          {
            label: "Total Transaksi",
            value: String(accountStats.transactions),
            icon: <ShoppingBag size={15} />,
            hint: "Total order yang tercatat",
            loading,
          },
          {
            label: "Total Belanja",
            value: formatRupiah(accountStats.spending),
            icon: <Wallet size={15} />,
            hint: "Akumulasi order yang sudah dibayar",
            loading,
          },
        ]}
      />

      {loadFailed && error ? <ErrorState message={error} onRetry={load} /> : null}
      {!loadFailed && error ? <Notice tone="danger">{error}</Notice> : null}
      <Toast message={message} tone="success" onClose={() => setMessage("")} />

      <div className="reseller-v2-settings-layout">
        <aside className="reseller-v2-panel reseller-v2-settings-aside">
          <div className="reseller-v2-settings-identity">
            <div>
              <strong>{reseller?.name || reseller?.username || "Reseller"}</strong>
              <span>{reseller?.email || "Email belum tersedia"}</span>
            </div>
            <Badge tone="success">Aman</Badge>
          </div>
          <div
            className="reseller-v2-settings-tabs"
            role="tablist"
            aria-label="Bagian pengaturan"
          >
            {tabs.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "is-active" : ""}
                  onClick={() => selectTab(tab.id)}
                >
                  <TabIcon size={16} aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </aside>

        <div className="reseller-v2-settings-content">
          {loading ? (
            <section className="reseller-v2-panel reseller-v2-settings-panel">
              <div className="reseller-v2-settings-panel-body">
                <LoadingSkeleton lines={6} />
              </div>
            </section>
          ) : null}

          {!loading && activeTab === "profile" ? (
            <>
              <Panel
                eyebrow="Profil"
                title="Informasi Profil"
                subtitle="Data reseller untuk identitas panel dan login berdasarkan email atau username."
                action={
                  <button
                    type="button"
                    className="reseller-v2-settings-icon-button"
                    onClick={() => setProfileEditing((current) => !current)}
                    aria-label="Edit profil"
                  >
                    {profileEditing ? <X size={16} /> : <Pencil size={16} />}
                  </button>
                }
              >
                <form onSubmit={saveProfile} className="reseller-v2-settings-form">
                  <div className="reseller-v2-settings-form-grid">
                    <Field label="Username">
                      <input
                        value={draft.username}
                        readOnly={!profileEditing}
                        onChange={(event) =>
                          setDraft({ ...draft, username: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Nama Reseller">
                      <input
                        value={draft.name}
                        readOnly={!profileEditing}
                        onChange={(event) =>
                          setDraft({ ...draft, name: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Email">
                      <input
                        value={draft.email}
                        readOnly={!profileEditing}
                        onChange={(event) =>
                          setDraft({ ...draft, email: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Nomor WA">
                      <input value={draft.whatsapp} readOnly />
                    </Field>
                  </div>
                  {profileEditing ? (
                    <div className="reseller-v2-settings-actions">
                      <button
                        type="submit"
                        className="reseller-v2-settings-button is-primary"
                        disabled={savingProfile}
                      >
                        <Save size={15} aria-hidden="true" />
                        {savingProfile ? "Menyimpan..." : "Simpan Profil"}
                      </button>
                      <button
                        type="button"
                        className="reseller-v2-settings-button"
                        onClick={resetDraft}
                        disabled={savingProfile}
                      >
                        Batal
                      </button>
                    </div>
                  ) : null}
                </form>
              </Panel>

              <Panel
                eyebrow="Akun"
                title="Ringkasan Akun"
                icon={<BarChart3 size={17} />}
              >
                <MetricRow
                  label="Ringkasan akun"
                  items={[
                    { label: "Transaksi", value: String(accountStats.transactions) },
                    { label: "Order Dibayar", value: String(accountStats.paid) },
                    { label: "Total Belanja", value: formatRupiah(accountStats.spending) },
                    { label: "Role", value: "Reseller" },
                  ]}
                />
              </Panel>
            </>
          ) : null}

          {!loading && activeTab === "security" ? (
            <>
              <Panel
                eyebrow="Keamanan"
                title="Ganti Password"
                icon={<Lock size={17} />}
              >
                <form onSubmit={changePassword} className="reseller-v2-settings-form">
                  <div className="reseller-v2-settings-form-grid is-single">
                    <Field label="Password Saat Ini">
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={passwordForm.currentPassword}
                        onChange={(event) =>
                          setPasswordForm({
                            ...passwordForm,
                            currentPassword: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Password Baru" hint="Minimal 8 karakter">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={passwordForm.newPassword}
                        onChange={(event) =>
                          setPasswordForm({
                            ...passwordForm,
                            newPassword: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Konfirmasi Password Baru">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={passwordForm.confirmPassword}
                        onChange={(event) =>
                          setPasswordForm({
                            ...passwordForm,
                            confirmPassword: event.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className="reseller-v2-settings-actions">
                    <button
                      type="submit"
                      className="reseller-v2-settings-button is-primary"
                      disabled={savingPassword}
                    >
                      <Lock size={15} aria-hidden="true" />
                      {savingPassword ? "Menyimpan..." : "Simpan Password"}
                    </button>
                  </div>
                </form>
              </Panel>

              <Panel
                eyebrow="Keamanan"
                title="Sesi Aktif"
                subtitle="Ringkasan browser yang sedang memakai akun reseller ini."
                icon={<Monitor size={17} />}
              >
                <div className="reseller-v2-settings-session">
                  <div>
                    <span className="reseller-v2-settings-session-icon" aria-hidden="true">
                      <Monitor size={17} />
                    </span>
                    <p>
                      Browser Saat Ini <Badge tone="success">Aktif</Badge>
                    </p>
                  </div>
                  <span>Sekarang</span>
                </div>
                <div className="reseller-v2-settings-actions">
                  <button
                    type="button"
                    className="reseller-v2-settings-button is-danger"
                    onClick={logoutCurrentSession}
                  >
                    <LogOut size={15} aria-hidden="true" />
                    Keluar dari Sesi Ini
                  </button>
                </div>
              </Panel>
            </>
          ) : null}
        </div>
      </div>
    </ResellerShell>
  );
}
