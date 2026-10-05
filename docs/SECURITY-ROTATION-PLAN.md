# Rencana Rotasi dan Pembersihan Riwayat

Dokumen ini adalah rencana, bukan izin menjalankan rotasi, push, deploy, atau
rewrite history. Tidak ada nilai credential dicantumkan di sini.

## Rotasi Setelah Disetujui Owner

- Password owner dashboard dan root VPS: gunakan nilai berbeda. Helper deploy
  tidak lagi memakai OWNER_PASSWORD sebagai password SSH.
- Cloudflare tunnel token: buat token pengganti, validasi satu connector live,
  kemudian batalkan token lama. Jangan menyalakan connector laptop dan VPS bersamaan.
- AUTH_SECRET: ganti dengan rencana logout seluruh sesi dan uji login baru.
- BACKUP_ENCRYPTION_KEY: simpan kunci lama offline sampai semua backup lama
  melewati masa retensi; kunci baru tidak dapat membuka backup lama.
- Google Sheets service account/private key, Gmail OAuth/app password,
  Pakasir API/webhook secret, token bot/inbound, dan Tenor API key: inventaris
  pemakaian, rotasi satu per satu, uji integrasi, baru batalkan nilai lama.
- Jangan menghapus satu-satunya salinan kunci atau mengirimkan secret ke log,
  tiket, chat, manifest rilis, dan screenshot.

## Rencana git-filter-repo

1. Setelah persetujuan, hentikan push sementara dan identifikasi branch/tag serta
   clone yang masih memuat secret. Menghapus working-tree tidak menghapus sejarah.
2. Buat mirror repository dan arsip pra-rewrite pada media terbatas; hash dan
   verifikasi pemulihannya. Arsip ini sendiri harus diperlakukan sebagai secret.
3. Analisis riwayat di clone sementara. Inventaris path artifact merge, emoji
   API key, helper deploy, dan setiap literal hasil pemindaian riwayat.
4. Susun pemetaan penggantian literal tanpa menaruhnya di repository. Tinjau
   daftar commit yang berubah serta dampak terhadap tanda tangan/tag dan PR.
5. Jalankan rewrite hanya di clone sementara, lalu ulangi pemindaian semua ref,
   tes, build, dan pemeriksaan bahwa kode/data sah tetap ada.
6. Minta persetujuan terpisah sebelum mengganti ref remote. Koordinasikan reclone
   semua anggota agar commit lama tidak dipush kembali; ikuti proses provider
   untuk cache dan fork yang masih menyimpan secret.
7. Rotasi tetap wajib. Rewrite tidak mencabut credential yang sudah tersebar.

## Verifikasi Saat Ini

Pemindaian working-tree tracked adalah pengaman regresi, bukan bukti bahwa
riwayat Git, log lama, fork, atau credential provider sudah bersih. Modul logging
meredaksi key sensitif, Bearer, query credential, secret terdaftar dari env/settings,
serta error. Tes menggunakan canary buatan, bukan token live.
