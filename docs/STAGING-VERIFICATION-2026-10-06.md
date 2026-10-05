# Verifikasi Staging VPS - 6 Oktober 2026

## Isolasi Dan Izin

Pengguna mengizinkan staging, akun, stok serta sheet khusus uji, tanpa mengganti
website/bot live. Pembayaran uji dibatasi Rp1.000 dan akan dibayar pengguna jika
diperlukan. Push tetap ditahan. Folder staging: `/opt/kavya-staging-20261006`.

Konfigurasi/data live tidak disalin sebagai database staging. Sesi WhatsApp
tidak disalin atau dipair ulang. Proses PM2 live tidak dihentikan/restart, DNS dan
Cloudflare tidak diubah. Database aktif diperiksa melalui lingkungan proses,
bukan dipilih dari beberapa database lama yang masih ada di VPS.

## Bukti Linux

- Kode-only release awal diverifikasi terhadap manifest sebelum instalasi.
- npm ci root/dashboard/bot berhasil pada direktori terpisah di Linux.
- Tiga audit runtime: nol vulnerability; typecheck, bot check dan build lulus.
- Restore drill awal gagal: penyaring rilis menghilangkan runtime-backup.mjs
  dan tes bernama runtime-backup. Regresi direproduksi lokal, lalu filter diubah
  agar pengecualian direktori data tidak ikut membuang file kode.
- Paket perbaikan: 886 file, SHA-256
  `66e1b105511b5a94bbf4b246efa2edfd8e888c29e258334c7e124df2ea40a8fb`.
  Manifest dan keberadaan module runtime backup diverifikasi di VPS.
- Restore terenkripsi ke direktori kosong, boot kode restore/login serta
  simulasi rollout gagal/rollback lulus pada VPS. Dependency memakai instalasi
  staging yang ditautkan, bukan runtime produksi.
- 23 tes terfokus payment reconciliation, fulfillment, warranty route dan
  pemetaan dua baris Sheets lulus.
- 12 tes browser desktop/mobile pada spec paket tersebut lulus. Pada paket
  tersebut, penggantian garansi masih API-assisted; spec lokal selanjutnya
  sudah menguji pengajuan reseller dan penggantian owner melalui UI.
- Chromium awal gagal karena library Linux tidak tersedia. Library diunduh
  sebagai paket dan diekstrak hanya ke staging; LD_LIBRARY_PATH khusus proses
  tes. Tidak menjalankan instalasi/upgrade paket sistem.

## Integrasi Yang Menunggu

Google menolak pembuatan spreadsheet baru oleh service account (HTTP 403,
PERMISSION_DENIED). Spreadsheet produksi tidak dijadikan pengganti. Pengguna
diminta membuat spreadsheet kosong dan membagikannya sebagai Editor kepada
akun integrasi yang sudah dipakai. Setup berhenti sebelum seeding database,
menyalakan server staging, mengirim notifikasi atau membuat invoice aplikasi.

Setelah sheet tersedia, verifikasi penggantian harus membaca kembali sel lama
dan baru dari Google, memeriksa order/stock ID, serta menerima notifikasi owner.
Tes pembelian harus dibayar pengguna dan direkonsiliasi berdasarkan jawaban
provider asli. Simulasi callback lokal atau invoice provider lama yang belum
dibayar tidak menggantikan bukti ini.

Workflow GitHub belum berjalan. Jangan menyatakan target 90/100 atau semua
alur live selesai sebelum pengujian eksternal dan CI menghasilkan bukti.
