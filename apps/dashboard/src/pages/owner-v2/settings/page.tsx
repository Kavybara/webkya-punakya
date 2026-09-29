import { useCallback, useEffect, useState } from "react";
import { KeyRound, Save, UserRound } from "lucide-react";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { api, type OwnerProfile } from "../../../lib/api";
import { clearSession } from "../../../lib/session";
import { Field, Notice } from "../../../components/ui";

const emptyProfile: OwnerProfile = { name: "", username: "", email: "", whatsapp: "", initial: "" };

export default function OwnerConsoleSettingsPage() {
  const [profile, setProfile] = useState(emptyProfile);
  const [password, setPassword] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setProfile(await api.ownerProfile()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Profil gagal dimuat."); } finally { setLoading(false); } }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  async function saveProfile() { setBusy("profile"); setError(""); try { setProfile(await api.updateOwnerProfile(profile)); setMessage("Profil owner diperbarui."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Profil gagal disimpan."); } finally { setBusy(""); } }
  async function changePassword() { if (!password.currentPassword || password.newPassword.length < 8 || password.newPassword !== password.confirmPassword) { setError("Periksa password lama, minimal 8 karakter, dan konfirmasi password baru."); return; } setBusy("password"); setError(""); try { await api.changePassword(password); clearSession(); window.location.assign("/login?reason=password-changed"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Password gagal diubah."); setBusy(""); } }
  return <ConsoleShell title="Pengaturan Owner" description="Kelola profil dan keamanan akun owner." refreshing={loading} systemState={error ? "unknown" : "healthy"} onRefresh={load}>
    {error ? <Notice tone="danger">{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    <div className="console-settings-grid"><section className="console-panel"><div className="console-panel-header"><div><span>Identitas</span><h2>Profil owner</h2></div><UserRound size={18} /></div><div className="console-resource-dialog-body"><div className="console-resource-form-grid"><Field label="Nama"><input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field><Field label="Username"><input value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} /></Field><Field label="Email"><input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field><Field label="WhatsApp"><input value={profile.whatsapp} onChange={(e) => setProfile({ ...profile, whatsapp: e.target.value })} /></Field></div><div className="console-settings-save"><button type="button" className="console-primary-button" disabled={Boolean(busy)} onClick={saveProfile}><Save size={15} /> {busy === "profile" ? "Menyimpan..." : "Simpan profil"}</button></div></div></section>
      <section className="console-panel"><div className="console-panel-header"><div><span>Keamanan</span><h2>Ubah password</h2></div><KeyRound size={18} /></div><div className="console-resource-dialog-body"><div className="console-resource-form-grid"><Field label="Password sekarang"><input type="password" autoComplete="current-password" value={password.currentPassword} onChange={(e) => setPassword({ ...password, currentPassword: e.target.value })} /></Field><span /><Field label="Password baru"><input type="password" autoComplete="new-password" value={password.newPassword} onChange={(e) => setPassword({ ...password, newPassword: e.target.value })} /></Field><Field label="Konfirmasi password"><input type="password" autoComplete="new-password" value={password.confirmPassword} onChange={(e) => setPassword({ ...password, confirmPassword: e.target.value })} /></Field></div><div className="console-settings-save"><button type="button" className="console-primary-button" disabled={Boolean(busy)} onClick={changePassword}><KeyRound size={15} /> {busy === "password" ? "Memproses..." : "Ubah password"}</button></div></div></section></div>
  </ConsoleShell>;
}
