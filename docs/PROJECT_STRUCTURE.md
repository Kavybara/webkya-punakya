# Kavya Project Structure

Dokumen ini menjelaskan struktur folder Kavya saat ini. Project menggabungkan dashboard, bot WhatsApp, plugin, script deploy, dan runtime server.

## Folder utama

```text
project-root/
|-- apps/
|   |-- dashboard/        # Backend API + frontend dashboard owner/reseller
|   `-- bot/              # Service WhatsApp Baileys dan plugin Kavya aktif
|-- plugins/              # Plugin autoresbot/Kavya yang masih dipakai loader legacy
|-- packages/             # Modul/shared helper lintas app
|-- database/             # Data legacy/reference autoresbot lama
|-- lib/                  # Library legacy autoresbot lama
|-- scripts/
|   |-- startup/          # Launcher utama VPS/Linux
|   |-- deploy/           # Script import/deploy
|   `-- maintenance/      # Backup, cleanup, repair auth
|-- docs/                 # Dokumentasi teknis
|-- release/
|   `-- backups/          # Arsip dan patch lama, bukan runtime aktif
|-- outputs/
|   `-- audit/            # Screenshot atau output audit lokal
|-- tmp/
|   `-- logs/             # Log sementara lokal
`-- runtime/              # Runtime lokal, diabaikan dari deploy/git
```

## Cari fitur di mana

```text
apps/dashboard/src/pages/home/         # Landing page publik (satu layar, tanpa scroll)
apps/dashboard/src/pages/pricelist/    # Halaman harga publik /harga + katalog produk
apps/dashboard/src/pages/login/        # Login, register, lupa password
apps/dashboard/src/pages/owner-v2/     # Panel owner
apps/dashboard/src/pages/reseller-v2/  # Panel reseller
apps/dashboard/src/pages/products/     # Checkout reseller (butuh auth)
apps/dashboard/src/components/ui/      # Design-system kit: tombol, field, panel, tabel
apps/dashboard/src/components/feature/ # Komponen lintas halaman (navbar, footer, katalog)
apps/dashboard/server/index.js         # Composition root Express (0 route handler)
apps/dashboard/server/routes/          # 15 modul route, satu domain per file
apps/dashboard/server/services/        # Logika bisnis per domain
```

Catatan: path lama `src/pages/owner/`, `src/pages/reseller/`, dan
`src/pages/public/` **sudah tidak ada**. Yang aktif adalah `owner-v2` dan
`reseller-v2`. URL lama tetap hidup sebagai redirect, jadi bookmark lama
tidak rusak:

| URL lama | Sekarang |
| --- | --- |
| `/store` | redirect ke `/harga` |
| `/track-order` | redirect ke `/order-tracking` |
| `/dashboard/*` | redirect ke `/owner-v2/*` |
| `/reseller/*` | redirect ke `/reseller-v2/*` |

`server/index.js` sudah bukan tempat handler route. Ia hanya composition
root: konfigurasi Express, mount 15 modul dari `server/routes/`, lalu
`app.listen`. Detail tiap domain ada di `apps/dashboard/server/routes/README.md`.

apps/bot/handle/connection.js        # Koneksi Baileys, reconnect, backup, sync grup
apps/bot/handle/messages.js          # Gate pesan masuk, webhook dashboard, blokir grup expired
apps/bot/plugins/kavya/group-basic.js # Command grup utama: .list, .updatelist, .group, sewa
apps/bot/plugins/legacy-handlers.js  # Loader plugin legacy yang masih diperlukan

plugins/kavya/                       # Plugin autoresbot lama yang masih dibaca loader legacy
packages/                            # Helper/shared module lintas dashboard dan bot
scripts/startup/kavya-start.mjs       # Launcher production/VPS
```

## Alur web ke bot

Dashboard dan bot tidak menyatu langsung dalam satu file. Dashboard bicara ke bot lewat API lokal `WHATSAPP_BOT_URL`, biasanya `http://127.0.0.1:4016`. Bot bicara balik ke dashboard lewat webhook inbound. Jadi kalau fitur web perlu mengirim pesan WhatsApp, cek API di `apps/dashboard/server/index.js` dan endpoint bot di `apps/bot/handle/server.js`.

## Alur bot grup

Pesan WhatsApp masuk ke `apps/bot/handle/messages.js` dulu. Di sini pesan dicek owner, grup, expired sewa, duplicate, lalu baru diteruskan ke plugin. Artinya aturan global seperti "grup expired jangan balas list" harus dipasang di `messages.js`, bukan di tiap plugin satu-satu.

## File root yang sengaja tetap di root

- `package.json` dan `package-lock.json`: perintah build/start utama.
- `.env` dan `.env.example`: konfigurasi lokal dan contoh konfigurasi.
- `README.md`: ringkasan cepat project.

## File legacy yang belum dipindah

File `autoresbot.js`, `index.js`, `config.js`, `strings.js`, `database/`, dan `lib/` masih dibiarkan di root karena beberapa bagian legacy/plugin masih bisa bergantung pada path lama. Kalau mau migrasi penuh nanti, lakukan terpisah dengan update import dan test lengkap.

## Aturan cleanup

- Arsip lama masuk ke `release/backups/`.
- Screenshot audit masuk ke `outputs/audit/`.
- Log sementara masuk ke `tmp/logs/`.
- Jangan pindahkan `apps/`, `plugins/`, `packages/`, `scripts/`, `.env`, atau database runtime tanpa update path dan test.
