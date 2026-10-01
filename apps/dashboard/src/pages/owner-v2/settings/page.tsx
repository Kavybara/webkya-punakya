import { useCallback, useEffect, useState, type ReactNode } from "react";
import { KeyRound, Save, UserRound } from "lucide-react";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type OwnerProfile } from "../../../lib/api";
import { clearSession } from "../../../lib/session";
import { Button, Field, Notice } from "../../../components/ui";

const emptyProfile: OwnerProfile = { name: "", username: "", email: "", whatsapp: "", initial: "" };

/** One settings panel: a heading, a grid of fields, and a save row. */
function Panel({
  eyebrow,
  title,
  icon,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <section className="console-panel">
      <div className="console-panel-header">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {icon}
      </div>
      <div className="console-resource-dialog-body">
        <div className="console-resource-form-grid">{children}</div>
        <div className="console-settings-save">{action}</div>
      </div>
    </section>
  );
}

export default function OwnerConsoleSettingsPage() {
  const [profile, setProfile] = useState(emptyProfile);
  const [password, setPassword] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setProfile(await api.ownerProfile()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Profil gagal dimuat."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  async function saveProfile() {
    setBusy("profile");
    setError("");
    try {
      setProfile(await api.updateOwnerProfile(profile));
      setMessage("Profil owner diperbarui.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profil gagal disimpan.");
    } finally {
      setBusy("");
    }
  }

  async function changePassword() {
    if (!password.currentPassword || password.newPassword.length < 8 || password.newPassword !== password.confirmPassword) {
      setError("Periksa password lama, minimal 8 karakter, dan konfirmasi password baru.");
      return;
    }
    setBusy("password");
    setError("");
    try {
      await api.changePassword(password);
      clearSession();
      window.location.assign("/login?reason=password-changed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password gagal diubah.");
    } finally {
      setBusy("");
    }
  }

  return (
    <ConsoleShell
      title="Pengaturan Owner"
      description="Kelola profil dan keamanan akun owner."
      refreshing={loading}
      // No attention props -- named in `PAGES_WITHOUT_ATTENTION`. This is a
      // form: nothing on it is queued, blocked or overdue. The one thing
      // worth surfacing is a failed save, and that is already the Notice
      // directly below.
      onRefresh={load}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}

      <div className="console-settings-grid">
        <Panel
          eyebrow="Identitas"
          title="Profil owner"
          icon={<UserRound size={18} />}
          action={
            <Button weight="primary" disabled={Boolean(busy)} onClick={() => void saveProfile()}>
              <Save size={15} /> {busy === "profile" ? "Menyimpan..." : "Simpan profil"}
            </Button>
          }
        >
          <Field label="Nama">
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </Field>
          <Field label="Username">
            <input value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} />
          </Field>
          <Field label="Email">
            <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </Field>
          <Field label="WhatsApp">
            <input value={profile.whatsapp} onChange={(e) => setProfile({ ...profile, whatsapp: e.target.value })} />
          </Field>
        </Panel>

        <Panel
          eyebrow="Keamanan"
          title="Ubah password"
          icon={<KeyRound size={18} />}
          action={
            <Button weight="primary" disabled={Boolean(busy)} onClick={() => void changePassword()}>
              <KeyRound size={15} /> {busy === "password" ? "Memproses..." : "Ubah password"}
            </Button>
          }
        >
          <Field label="Password sekarang">
            <input
              type="password"
              autoComplete="current-password"
              value={password.currentPassword}
              onChange={(e) => setPassword({ ...password, currentPassword: e.target.value })}
            />
          </Field>
          {/* The grid is two columns; the confirm field is the third of three, so
              something has to hold the row open. */}
          <span />
          <Field label="Password baru">
            <input
              type="password"
              autoComplete="new-password"
              value={password.newPassword}
              onChange={(e) => setPassword({ ...password, newPassword: e.target.value })}
            />
          </Field>
          <Field label="Konfirmasi password">
            <input
              type="password"
              autoComplete="new-password"
              value={password.confirmPassword}
              onChange={(e) => setPassword({ ...password, confirmPassword: e.target.value })}
            />
          </Field>
        </Panel>
      </div>
    </ConsoleShell>
  );
}
