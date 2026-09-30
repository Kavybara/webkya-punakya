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

## Verifikasi (gate wajib sebelum commit)

Dijalankan dari `apps/dashboard`:

```bash
npx tsc -b --force      # typecheck
npx eslint src server   # lint
node --test server/tests/   # 426 test API/server
npm run test:ui             # 40 test UI
```

Lalu build dari root:

```bash
npm run web:build
```

Tidak ada `npm run test:all` atau `npm run lint` di root — keduanya hanya
ada di `apps/dashboard` (`test:all` = `node --test server/tests/`,
`lint` = `eslint src` saja, tanpa `server`).

## Routing publik

```text
/                 Landing page, satu layar
/harga            Katalog harga publik
/order-tracking   Lacak pesanan
/store            -> redirect ke /harga
/dashboard/*      -> redirect ke /owner-v2/*
/reseller/*       -> redirect ke /reseller-v2/*
```

## Catatan struktural

- `kavya-digital-dashboard/runtime/` bukan folder sampah. `apps/bot` masih
  membaca `kavya-db.json` dan `rentals.json` dari sana. Jangan dihapus.
- `apps/dashboard/server/index.js` sudah 0 route handler; ia composition root
  saja. Handler ada di `server/routes/`.

Panduan deploy ada di:

```text
docs/DEPLOYMENT.md
docs/PROJECT_STRUCTURE.md
```
