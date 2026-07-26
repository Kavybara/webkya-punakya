import { useCallback, useEffect, useState } from "react";
import { Cloud, ExternalLink, Mail, MessageCircle, Save, Sheet, WalletCards } from "lucide-react";
import { ConsoleDialog, ConsoleDialogActions, ConsoleField, ConsoleNotice } from "../../../../components/console/ConsoleResource";
import { ConsoleShell } from "../../../../components/console/ConsoleShell";
import { api, type OwnerSettings } from "../../../../lib/api";

type IntegrationSection = "pakasir" | "bailey" | "gmail" | "googleSheets" | "cloudflare";

export default function OwnerConsoleIntegrationConfigurePage() {
  const [settings, setSettings] = useState<OwnerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmTemplate, setConfirmTemplate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setSettings(await api.ownerSettings()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Konfigurasi integrasi gagal dimuat."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  async function save(section: IntegrationSection) {
    if (!settings) return;
    setBusy(section);
    setError("");
    try {
      const updated = await api.updateOwnerSettings({ [section]: settings[section] });
      setSettings(updated);
      setMessage(`${section} berhasil disimpan.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Konfigurasi gagal disimpan."); }
    finally { setBusy(""); }
  }

  async function connectGmail() {
    if (!settings) return;
    setBusy("gmail-oauth");
    setError("");
    try {
      const updated = await api.updateOwnerSettings({ gmail: settings.gmail });
      setSettings(updated);
      const result = await api.startGmailOAuth();
      window.open(result.url, "_blank", "noopener,noreferrer");
      setMessage("Google OAuth dibuka di tab baru.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "OAuth Gmail gagal dimulai."); }
    finally { setBusy(""); }
  }

  async function setupTemplate() {
    if (!settings) return;
    setBusy("sheets-template");
    setError("");
    try {
      const updated = await api.updateOwnerSettings({ googleSheets: settings.googleSheets });
      setSettings(updated);
      await api.setupSheetsTemplate();
      setConfirmTemplate(false);
      setMessage("Template Google Sheets berhasil dibuat.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Template Sheets gagal dibuat."); }
    finally { setBusy(""); }
  }

  if (!settings) return <ConsoleShell title="Konfigurasi Integrasi" description="Atur koneksi owner melalui endpoint yang sudah ada." refreshing={loading} systemState={error ? "unknown" : "healthy"} onRefresh={load}>{error ? <ConsoleNotice tone="danger">{error}</ConsoleNotice> : <div className="console-settings-skeleton" aria-label="Memuat konfigurasi" />}</ConsoleShell>;

  return <ConsoleShell title="Konfigurasi Integrasi" description="Secret dimasking dan nilai lama dipertahankan bila tidak diganti." refreshing={loading} systemState={error ? "unknown" : "healthy"} onRefresh={load}>
    {error ? <ConsoleNotice tone="danger">{error}</ConsoleNotice> : null}{message ? <ConsoleNotice>{message}</ConsoleNotice> : null}
    <div className="console-integration-config-grid">
      <section className="console-panel"><div className="console-panel-header"><div><span>Pembayaran</span><h2>Pakasir</h2></div><WalletCards size={18} /></div><div className="console-resource-dialog-body"><div className="console-resource-form-grid"><ConsoleField label="Merchant ID"><input value={settings.pakasir.merchantId} onChange={(e) => setSettings({ ...settings, pakasir: { ...settings.pakasir, merchantId: e.target.value } })} /></ConsoleField><ConsoleField label="API key"><input type="password" autoComplete="off" value={settings.pakasir.apiKey} onChange={(e) => setSettings({ ...settings, pakasir: { ...settings.pakasir, apiKey: e.target.value } })} /></ConsoleField><ConsoleField label="Webhook secret"><input type="password" autoComplete="off" value={settings.pakasir.webhookSecret} onChange={(e) => setSettings({ ...settings, pakasir: { ...settings.pakasir, webhookSecret: e.target.value } })} /></ConsoleField></div><button className="console-primary-button console-config-save" type="button" disabled={Boolean(busy)} onClick={() => save("pakasir")}><Save size={14} /> Simpan Pakasir</button></div></section>
      <section className="console-panel"><div className="console-panel-header"><div><span>Bot</span><h2>WhatsApp Bailey</h2></div><MessageCircle size={18} /></div><div className="console-resource-dialog-body"><div className="console-resource-form-grid"><ConsoleField label="Session ID"><input value={settings.bailey.sessionId} onChange={(e) => setSettings({ ...settings, bailey: { ...settings.bailey, sessionId: e.target.value } })} /></ConsoleField><ConsoleField label="Nomor bot"><input value={settings.bailey.botNumber} onChange={(e) => setSettings({ ...settings, bailey: { ...settings.bailey, botNumber: e.target.value } })} /></ConsoleField><ConsoleField label="Public URL"><input value={settings.bailey.publicUrl} onChange={(e) => setSettings({ ...settings, bailey: { ...settings.bailey, publicUrl: e.target.value } })} /></ConsoleField><ConsoleField label="Webhook URL"><input value={settings.bailey.webhookUrl} onChange={(e) => setSettings({ ...settings, bailey: { ...settings.bailey, webhookUrl: e.target.value } })} /></ConsoleField><ConsoleField label="Bot token"><input type="password" autoComplete="off" value={settings.bailey.botToken} onChange={(e) => setSettings({ ...settings, bailey: { ...settings.bailey, botToken: e.target.value } })} /></ConsoleField><ConsoleField label="Inbound token"><input type="password" autoComplete="off" value={settings.bailey.inboundToken} onChange={(e) => setSettings({ ...settings, bailey: { ...settings.bailey, inboundToken: e.target.value } })} /></ConsoleField></div><button className="console-primary-button console-config-save" type="button" disabled={Boolean(busy)} onClick={() => save("bailey")}><Save size={14} /> Simpan WhatsApp</button></div></section>
      <section className="console-panel"><div className="console-panel-header"><div><span>Email access</span><h2>Gmail</h2></div><Mail size={18} /></div><div className="console-resource-dialog-body"><div className="console-resource-form-grid"><ConsoleField label="Mode"><select value={settings.gmail.mode} onChange={(e) => setSettings({ ...settings, gmail: { ...settings.gmail, mode: e.target.value } })}><option value="oauth">OAuth</option><option value="imap">IMAP</option></select></ConsoleField><ConsoleField label="Inbox email"><input type="email" value={settings.gmail.inboxEmail} onChange={(e) => setSettings({ ...settings, gmail: { ...settings.gmail, inboxEmail: e.target.value } })} /></ConsoleField><ConsoleField label="Client ID"><input value={settings.gmail.clientId} onChange={(e) => setSettings({ ...settings, gmail: { ...settings.gmail, clientId: e.target.value } })} /></ConsoleField><ConsoleField label="Client secret"><input type="password" autoComplete="off" value={settings.gmail.clientSecret} onChange={(e) => setSettings({ ...settings, gmail: { ...settings.gmail, clientSecret: e.target.value } })} /></ConsoleField><ConsoleField label="Redirect URI"><input value={settings.gmail.redirectUri} onChange={(e) => setSettings({ ...settings, gmail: { ...settings.gmail, redirectUri: e.target.value } })} /></ConsoleField><ConsoleField label="IMAP user"><input value={settings.gmail.imapUser} onChange={(e) => setSettings({ ...settings, gmail: { ...settings.gmail, imapUser: e.target.value } })} /></ConsoleField><ConsoleField label="IMAP password"><input type="password" autoComplete="off" value={settings.gmail.imapPassword} onChange={(e) => setSettings({ ...settings, gmail: { ...settings.gmail, imapPassword: e.target.value } })} /></ConsoleField></div><div className="console-config-actions"><button type="button" disabled={Boolean(busy)} onClick={() => save("gmail")}>Simpan Gmail</button><button className="console-primary-button" type="button" disabled={Boolean(busy)} onClick={connectGmail}>Hubungkan OAuth <ExternalLink size={14} /></button></div></div></section>
      <section className="console-panel"><div className="console-panel-header"><div><span>Source of truth</span><h2>Google Sheets</h2></div><Sheet size={18} /></div><div className="console-resource-dialog-body"><div className="console-resource-form-grid"><ConsoleField label="Spreadsheet ID"><input value={settings.googleSheets.spreadsheetId} onChange={(e) => setSettings({ ...settings, googleSheets: { ...settings.googleSheets, spreadsheetId: e.target.value } })} /></ConsoleField><ConsoleField label="Sheet default"><input value={settings.googleSheets.sheetName} onChange={(e) => setSettings({ ...settings, googleSheets: { ...settings.googleSheets, sheetName: e.target.value } })} /></ConsoleField><ConsoleField label="Service account email"><input type="email" value={settings.googleSheets.serviceAccountEmail} onChange={(e) => setSettings({ ...settings, googleSheets: { ...settings.googleSheets, serviceAccountEmail: e.target.value } })} /></ConsoleField><ConsoleField label="Private key"><textarea value={settings.googleSheets.privateKey} onChange={(e) => setSettings({ ...settings, googleSheets: { ...settings.googleSheets, privateKey: e.target.value } })} /></ConsoleField></div><div className="console-config-actions"><button type="button" disabled={Boolean(busy)} onClick={() => save("googleSheets")}>Simpan Sheets</button><button className="console-primary-button" type="button" disabled={Boolean(busy)} onClick={() => setConfirmTemplate(true)}>Buat template</button></div></div></section>
      <section className="console-panel"><div className="console-panel-header"><div><span>Tunnel</span><h2>Cloudflare</h2></div><Cloud size={18} /></div><div className="console-resource-dialog-body"><div className="console-resource-form-grid"><ConsoleField label="Public domain"><input value={settings.cloudflare.publicDomain} onChange={(e) => setSettings({ ...settings, cloudflare: { ...settings.cloudflare, publicDomain: e.target.value } })} /></ConsoleField><ConsoleField label="Tunnel token"><input type="password" autoComplete="off" value={settings.cloudflare.tunnelToken} onChange={(e) => setSettings({ ...settings, cloudflare: { ...settings.cloudflare, tunnelToken: e.target.value } })} /></ConsoleField></div><button className="console-primary-button console-config-save" type="button" disabled={Boolean(busy)} onClick={() => save("cloudflare")}><Save size={14} /> Simpan Cloudflare</button></div></section>
    </div>
    {confirmTemplate ? <ConsoleDialog title="Buat template Google Sheets" eyebrow="Tindakan menulis spreadsheet" onClose={() => setConfirmTemplate(false)} footer={<ConsoleDialogActions onCancel={() => setConfirmTemplate(false)} onConfirm={setupTemplate} confirmLabel="Buat template" busy={busy === "sheets-template"} />}><ConsoleNotice tone="warning">Header dan layout template akan ditulis ke spreadsheet yang dikonfigurasi. Pastikan Spreadsheet ID sudah benar.</ConsoleNotice></ConsoleDialog> : null}
  </ConsoleShell>;
}
