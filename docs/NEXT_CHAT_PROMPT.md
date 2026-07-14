# Prompt Untuk Chat Baru

Copy bagian ini ke chat baru kalau mau lanjut kerja di project Kavya.

```text
Kita sedang mengerjakan project Kavya di folder lokal:
C:\Users\tegar\Downloads\File Backup21

Struktur project saat ini:
- apps/dashboard = backend API + frontend owner/reseller panel
- apps/bot = WhatsApp Baileys bot aktif
- plugins = plugin legacy/autoresbot yang masih disambungkan
- packages = shared helper
- scripts = deploy/maintenance/backup/cleanup
- pterodactyl/startup/ptero-start.mjs = launcher utama VPS/Pterodactyl
- database dan lib root masih legacy, jangan dipindah tanpa update import
- release/backups berisi arsip lama
- kavya-pterodactyl-linux-latest.tar.gz di root adalah file deploy terbaru

Aturan penting:
- Jangan hapus atau pindah .env, apps/dashboard/runtime, apps/bot/database, database root, lib root, atau plugins tanpa audit import.
- Kalau edit code, test minimal:
  node --check ptero-start.mjs
  node --check pterodactyl/startup/ptero-start.mjs
  npm run ptero:build
  npm run whatsapp:check
- Untuk deploy VPS, jangan hilangkan database, session WA, runtime dashboard, atau .env.
- Fokus Kavya: dashboard owner/reseller, WhatsApp bot, Google Sheets stock, Pakasir QRIS/deposit, account access Netflix, garansi, dan order auto drop.

Tolong baca docs/PROJECT_STRUCTURE.md dulu sebelum mengubah struktur folder.
```
