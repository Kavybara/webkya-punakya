import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Cloud, ExternalLink, Mail, MessageCircle, Save, Sheet, WalletCards } from "lucide-react";
import { ConsoleShell } from "../../../../components/console/ConsoleShell";
import { api, type OwnerSettings } from "../../../../lib/api";
import { Button, Dialog, DialogActions, Field, Notice } from "../../../../components/ui";
import { systemStateFor } from "../../../../components/attention";

type IntegrationSection = "pakasir" | "bailey" | "gmail" | "googleSheets" | "cloudflare";

/**
 * Set one string field on one integration's settings.
 *
 * Every panel on this page was a wall of `setSettings({ ...settings, gmail: {
 * ...settings.gmail, clientId: e.target.value } })` -- twenty-odd copies of the
 * same spread, each one a place to drop a key. The cast is the price of not
 * spelling out a union of five different settings shapes; the behaviour is the
 * same immutable replace the project uses everywhere else.
 */
function withField<K extends IntegrationSection>(
  settings: OwnerSettings,
  section: K,
  field: string,
  value: string,
): OwnerSettings {
  return { ...settings, [section]: { ...settings[section], [field]: value } } as OwnerSettings;
}

/**
 * One integration panel: a heading, a grid of fields, and an action row.
 *
 * The five panels on this page were structurally identical and each was written
 * out in full on a single line -- the Google Sheets one ran to 1,991 characters.
 * The shape is now stated once.
 */
function Panel({
  eyebrow,
  title,
  icon,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  actions: ReactNode;
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
        {actions}
      </div>
    </section>
  );
}

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

  function edit(section: IntegrationSection, field: string) {
    return (value: string) => {
      setSettings((current) => (current ? withField(current, section, field, value) : current));
    };
  }

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

  if (!settings) {
    return (
      <ConsoleShell
        title="Konfigurasi Integrasi"
        description="Atur koneksi owner melalui endpoint yang sudah ada."
        refreshing={loading}
        // The skeleton branch passes no attention on purpose. Nothing has been
        // fetched yet, so there is no count and no state -- and the old
        // `error ? "unknown" : "healthy"` here rendered "Operasional normal"
        // above five empty password forms for as long as they were empty.
        onRefresh={load}
      >
        {error
          ? <Notice tone="danger">{error}</Notice>
          : <div className="console-settings-skeleton" aria-label="Memuat konfigurasi" />}
      </ConsoleShell>
    );
  }

  /* How many of the five integrations still have no credentials on this
     account. This is the page where that is fixable -- it is five password
     forms and nothing else -- so "kamu" is the only side that applies, and a
     non-zero count is one line of work per integration.

     Read off the fields the form itself edits rather than off
     `settings.status`, which is what the sibling Status Integrasi page
     renders. Two pages reading two different structures to answer one
     question is how they come to disagree, and this page has the more direct
     answer in front of it: a field the owner can see is empty. */
  const unconfigured = [
    settings.pakasir.merchantId && settings.pakasir.apiKey,
    settings.bailey.botNumber,
    settings.gmail.inboxEmail,
    settings.googleSheets.spreadsheetId && settings.googleSheets.serviceAccountEmail,
    settings.cloudflare.publicDomain && settings.cloudflare.tunnelToken,
  ].filter((ready) => !ready).length;

  const saveButton = (section: IntegrationSection, label: string) => (
    <Button weight="primary" className="console-config-save" disabled={Boolean(busy)} onClick={() => void save(section)}>
      <Save size={14} /> {label}
    </Button>
  );

  return (
    <ConsoleShell
      title="Konfigurasi Integrasi"
      description="Secret dimasking dan nilai lama dipertahankan bila tidak diganti."
      refreshing={loading}
      attentionCount={unconfigured}
      systemState={systemStateFor(unconfigured, { error: Boolean(error) })}
      onRefresh={load}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {message ? <Notice>{message}</Notice> : null}

      <div className="console-integration-config-grid">
        <Panel
          eyebrow="Pembayaran"
          title="Pakasir"
          icon={<WalletCards size={18} />}
          actions={saveButton("pakasir", "Simpan Pakasir")}
        >
          <Field label="Merchant ID">
            <input value={settings.pakasir.merchantId} onChange={(e) => edit("pakasir", "merchantId")(e.target.value)} />
          </Field>
          <Field label="API key">
            <input type="password" autoComplete="off" value={settings.pakasir.apiKey} onChange={(e) => edit("pakasir", "apiKey")(e.target.value)} />
          </Field>
          <Field label="Webhook secret">
            <input type="password" autoComplete="off" value={settings.pakasir.webhookSecret} onChange={(e) => edit("pakasir", "webhookSecret")(e.target.value)} />
          </Field>
        </Panel>

        <Panel
          eyebrow="Bot"
          title="WhatsApp Bailey"
          icon={<MessageCircle size={18} />}
          actions={saveButton("bailey", "Simpan WhatsApp")}
        >
          <Field label="Session ID">
            <input value={settings.bailey.sessionId} onChange={(e) => edit("bailey", "sessionId")(e.target.value)} />
          </Field>
          <Field label="Nomor bot">
            <input value={settings.bailey.botNumber} onChange={(e) => edit("bailey", "botNumber")(e.target.value)} />
          </Field>
          <Field label="Public URL">
            <input value={settings.bailey.publicUrl} onChange={(e) => edit("bailey", "publicUrl")(e.target.value)} />
          </Field>
          <Field label="Webhook URL">
            <input value={settings.bailey.webhookUrl} onChange={(e) => edit("bailey", "webhookUrl")(e.target.value)} />
          </Field>
          <Field label="Bot token">
            <input type="password" autoComplete="off" value={settings.bailey.botToken} onChange={(e) => edit("bailey", "botToken")(e.target.value)} />
          </Field>
          <Field label="Inbound token">
            <input type="password" autoComplete="off" value={settings.bailey.inboundToken} onChange={(e) => edit("bailey", "inboundToken")(e.target.value)} />
          </Field>
        </Panel>

        <Panel
          eyebrow="Email access"
          title="Gmail"
          icon={<Mail size={18} />}
          actions={
            <div className="console-config-actions">
              <Button weight="secondary" disabled={Boolean(busy)} onClick={() => void save("gmail")}>Simpan Gmail</Button>
              <Button weight="primary" disabled={Boolean(busy)} onClick={() => void connectGmail()}>
                Hubungkan OAuth <ExternalLink size={14} />
              </Button>
            </div>
          }
        >
          <Field label="Mode">
            <select value={settings.gmail.mode} onChange={(e) => edit("gmail", "mode")(e.target.value)}>
              <option value="oauth">OAuth</option>
              <option value="imap">IMAP</option>
            </select>
          </Field>
          <Field label="Inbox email">
            <input type="email" value={settings.gmail.inboxEmail} onChange={(e) => edit("gmail", "inboxEmail")(e.target.value)} />
          </Field>
          <Field label="Client ID">
            <input value={settings.gmail.clientId} onChange={(e) => edit("gmail", "clientId")(e.target.value)} />
          </Field>
          <Field label="Client secret">
            <input type="password" autoComplete="off" value={settings.gmail.clientSecret} onChange={(e) => edit("gmail", "clientSecret")(e.target.value)} />
          </Field>
          <Field label="Redirect URI">
            <input value={settings.gmail.redirectUri} onChange={(e) => edit("gmail", "redirectUri")(e.target.value)} />
          </Field>
          <Field label="IMAP user">
            <input value={settings.gmail.imapUser} onChange={(e) => edit("gmail", "imapUser")(e.target.value)} />
          </Field>
          <Field label="IMAP password">
            <input type="password" autoComplete="off" value={settings.gmail.imapPassword} onChange={(e) => edit("gmail", "imapPassword")(e.target.value)} />
          </Field>
        </Panel>

        <Panel
          eyebrow="Source of truth"
          title="Google Sheets"
          icon={<Sheet size={18} />}
          actions={
            <div className="console-config-actions">
              <Button weight="secondary" disabled={Boolean(busy)} onClick={() => void save("googleSheets")}>Simpan Sheets</Button>
              <Button weight="primary" disabled={Boolean(busy)} onClick={() => setConfirmTemplate(true)}>Buat template</Button>
            </div>
          }
        >
          <Field label="Spreadsheet ID">
            <input value={settings.googleSheets.spreadsheetId} onChange={(e) => edit("googleSheets", "spreadsheetId")(e.target.value)} />
          </Field>
          <Field label="Sheet default">
            <input value={settings.googleSheets.sheetName} onChange={(e) => edit("googleSheets", "sheetName")(e.target.value)} />
          </Field>
          <Field label="Service account email">
            <input type="email" value={settings.googleSheets.serviceAccountEmail} onChange={(e) => edit("googleSheets", "serviceAccountEmail")(e.target.value)} />
          </Field>
          <Field label="Private key">
            <textarea value={settings.googleSheets.privateKey} onChange={(e) => edit("googleSheets", "privateKey")(e.target.value)} />
          </Field>
        </Panel>

        <Panel
          eyebrow="Tunnel"
          title="Cloudflare"
          icon={<Cloud size={18} />}
          actions={saveButton("cloudflare", "Simpan Cloudflare")}
        >
          <Field label="Public domain">
            <input value={settings.cloudflare.publicDomain} onChange={(e) => edit("cloudflare", "publicDomain")(e.target.value)} />
          </Field>
          <Field label="Tunnel token">
            <input type="password" autoComplete="off" value={settings.cloudflare.tunnelToken} onChange={(e) => edit("cloudflare", "tunnelToken")(e.target.value)} />
          </Field>
        </Panel>
      </div>

      {confirmTemplate ? (
        <Dialog
          open
          title="Buat template Google Sheets"
          eyebrow="Tindakan menulis spreadsheet"
          onClose={() => setConfirmTemplate(false)}
          footer={
            <DialogActions
              onCancel={() => setConfirmTemplate(false)}
              onConfirm={() => void setupTemplate()}
              confirmLabel="Buat template"
              busy={busy === "sheets-template"}
            />
          }
        >
          <Notice tone="warning">
            Header dan layout template akan ditulis ke spreadsheet yang dikonfigurasi. Pastikan Spreadsheet ID sudah benar.
          </Notice>
        </Dialog>
      ) : null}
    </ConsoleShell>
  );
}
