# Kavya VPS/Linux Deployment

Panduan ini untuk menjalankan Kavya pada VPS atau server Linux. Pterodactyl tetap didukung sebagai salah satu lingkungan container.

## Startup

Install dependency pertama kali:

```bash
npm install
```

Build dashboard kalau ada update tampilan:

```bash
npm run app:build
```

Start command:

```bash
npm run app:start
```

Launcher akan menjalankan dashboard, WhatsApp bot, Cloudflare Tunnel, import data legacy bila perlu, backup runtime, dan cleanup file sementara.

## Struktur Penting

```text
packages/shared          Modul bersama untuk backup dan template WhatsApp
apps/bot            Service WhatsApp Baileys
apps/dashboard  Dashboard owner/reseller dan API
plugins/kavya            Plugin legacy Autoresbot yang diadaptasi
database                 Data legacy awal untuk import
scripts                  Script backup/import/repair runtime
runtime                  Data server aktif, jangan dihapus
```

Folder yang tidak perlu dibawa saat update: `node_modules`, `release`, `_zip_inspect`, `tmp`, cache build, dan archive lama.

## Env Minimal

```env
SERVER_PORT=1912
PORT=1912
PUBLIC_DOMAIN=https://vya.baby
AUTH_SECRET=change-this-auth-secret

WHATSAPP_PORT=4016
WHATSAPP_BOT_URL=http://127.0.0.1:4016

RUNTIME_DIR=runtime
RUNTIME_TMP_DIR=runtime/tmp
RUNTIME_BACKUP_DIR=runtime/backups
WHATSAPP_DATABASE_DIR=runtime/whatsapp-database
BAILEYS_AUTH_DIR=runtime/baileys-auth
LOCAL_DATABASE_DIR=runtime/pglite
RUNTIME_BACKUP_KEEP=30

AUTO_INSTALL_ON_START=true
AUTO_BUILD_ON_START=true
AUTO_IMPORT_LEGACY_ON_START=true
AUTO_CLEANUP_ON_START=true
AUTO_BACKUP=true
AUTO_BACKUP_SCHEDULE_ENABLED=true
AUTO_BACKUP_INTERVAL_HOURS=24
AUTO_BACKUP_ON_START=false
AUTO_BACKUP_ON_CONNECT=false
AUTO_BACKUP_ON_RECONNECT=false
WHATSAPP_SEND_TIMEOUT_MS=90000
WHATSAPP_COMMAND_SEND_TIMEOUT_MS=120000
WHATSAPP_COMMAND_SEND_RETRIES=0
WHATSAPP_STABLE_CONNECT_DELAY_MS=90000
WHATSAPP_GROUP_SYNC_ON_CONNECT=false
WHATSAPP_OWNER_STABLE_NOTIFY=true
WHATSAPP_OWNER_STABLE_NOTIFY_COOLDOWN_MS=1800000
CLOUDFLARED_PROTOCOL=http2
CLOUDFLARED_LOG_LEVEL=error
```

Cloudflare Tunnel aktif jika `CLOUDFLARED_TOKEN` diisi di `.env` atau Dashboard > Settings.

## Data Yang Harus Aman Saat Update

Jangan hapus:

- `.env`
- `runtime/`
- `apps/dashboard/runtime/`
- `apps/bot/database/` jika masih dipakai lokal
- folder auth Baileys yang dipakai server

Saat update ke VPS, copy file project baru dengan exclude data runtime dan `.env`.

## Command Berguna

```bash
npm run whatsapp:check
npm run web:typecheck
npm run app:build
npm run runtime:backup
npm run runtime:cleanup
npm run whatsapp:repair-auth
```

## URL

```text
Dashboard: https://vya.baby/dashboard
QR WhatsApp: https://vya.baby/whatsapp-qr
Public store: https://vya.baby/store
```
