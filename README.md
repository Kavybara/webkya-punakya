# Kavya Auto Order

Kavya berisi dashboard owner/reseller, auto order WhatsApp, QRIS Pakasir, sewa grup, stok akun, dan launcher VPS/Linux.

## Struktur

```text
packages/shared          Modul bersama untuk backup dan template WhatsApp
apps/bot            Service WhatsApp Baileys
apps/dashboard  Dashboard, API, dan public store
plugins/kavya            Plugin legacy Autoresbot yang diadaptasi
database                 Data legacy awal/import
lib                      Helper legacy yang masih dipakai plugin
scripts                  Backup, import, cleanup, dan repair auth
docs                     Panduan deploy
```

Data runtime dan session tidak boleh ikut dihapus saat update:

```text
.env
runtime/
apps/dashboard/runtime/
apps/bot/database/
```

## Command

```bash
npm install
npm run whatsapp:install
npm run dashboard:install
npm run whatsapp:check
npm run web:typecheck
npm run app:build
npm run app:start
```

Panduan deploy ada di:

```text
docs/DEPLOYMENT.md
```
