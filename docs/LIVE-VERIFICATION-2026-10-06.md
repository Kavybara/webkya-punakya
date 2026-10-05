# Verifikasi Live - 6 Oktober 2026

## Izin Dan Batas

Pengguna mengizinkan pesan uji WhatsApp owner dan transaksi uji. Nominal dasar
dibatasi Rp1.000; hanya kontak owner dan email uji milik pengguna digunakan.
Push ditahan sampai verifikasi live selesai. Tidak ada deploy ke layanan live,
rotasi credential, edit profil/settings, stok, rental atau list grup. Tidak
memakai pelanggan atau grup reseller sebagai sasaran pengiriman pesan uji.
Pengguna kemudian mengizinkan staging dan data uji terpisah di VPS.

## Hasil

| Pemeriksaan | Bukti | Batas |
| --- | --- | --- |
| Login owner live | HTTP 200, role owner, session dipakai lalu logout | Versi live lama, bukan kode lokal yang belum dideploy |
| WhatsApp owner | Bot connected, API menerima satu pesan `[Tes Kavya]`; pengguna mengonfirmasi terlihat | Tidak membuktikan semua grup atau ketahanan reconnect |
| Pakasir | Satu invoice QRIS Rp1.000 dibuat, total Rp1.000 | Belum dibayar; tidak menguji webhook/fulfillment aplikasi; tidak memakai stok |
| Inbox | Autentikasi IMAP berhasil menggunakan konfigurasi lokal yang cocok dengan user inbox live | Tidak mengubah konfigurasi; auth saja bukan bukti kode terkirim |
| Email Netflix uji | Pencarian recipient-scoped di INBOX selama 24 jam: nol hasil | Tidak membaca body email atau kode; folder lain tidak diperiksa; ekstraksi kode belum terbukti |
| Versi public health | Live masih mengembalikan diagnosis detail | Fix liveness-only lokal belum terpasang; jangan menyatakan aman live berdasarkan tes lokal |

Probe berlangsung sekitar 03:44-03:50 waktu Asia/Bangkok pada 6 Oktober
(20:44-20:50 UTC pada 5 Oktober). Receipt tersanitasi disimpan lokal pada
`tmp/live-verification-receipt.json` dan `tmp/live-inbox-verification-receipt.json`,
tidak dimasukkan Git. Token, password, isi email dan cookie tidak dicatat.

## Tes Lanjutan Email

Pengguna menjelaskan bahwa Gmail adalah inbox forwarding pusat, kemudian
menentukan dua alamat akun asli untuk tes. Pada sekitar 03:57 WIB NF_RESET
menerima pesan baru untuk alamat pertama. Pada 03:58:38 WIB NF_SIGNIN menerima
pesan untuk alamat kedua. Body pesan terbaru yang penerimanya cocok dibaca
read-only; parser lokal yang sama dengan aplikasi mengekstrak kode 4 digit.
Kode tidak dicetak, disimpan di receipt, atau dipakai masuk Netflix.

Sekitar 04:02 WIB endpoint `/api/owner/account-access/lookup` live dipanggil
dengan session owner dan email akun kedua. HTTP 200 mengembalikan kode baru
dari Gmail. Session diakhiri. Ini membuktikan endpoint panel owner, bukan klik
UI reseller atau penerimaan kode di Netflix. Lookup normal dapat memperbarui
snapshot Sheets dan mencatat aktivitas; tidak meminta perubahan Sheets atau
credential. Keempat label ditemukan. NF_VERIF/NF_HOUSE tidak diuji pengambilan
live karena pengguna memilih melanjutkan tes pembelian dan garansi.

## Yang Belum Selesai

- Pengambilan NF_VERIF/NF_HOUSE live dan klik panel reseller belum diuji;
  pencarian kode masuk endpoint owner sudah berhasil.
- Pembayaran uji sampai callback dan delivery live; invoice yang dibuat bukan
  order aplikasi dan tidak membuktikan rekonsiliasi order live.
- Warranty replacement dan Sheets writeback menggunakan data uji yang terisolasi.
- CI GitHub dan integrasi staging eksternal belum lengkap. Instalasi kode baru,
  build, tes browser serta restore/rollback fixture Linux sudah lulus; lihat
  STAGING-VERIFICATION-2026-10-06.md.

Jangan mengirim ulang pesan atau membuat invoice baru hanya untuk mengulang
pemeriksaan. Jangan mengaktifkan grup, mengimpor legacy atau mengubah data nyata
untuk melengkapi bukti. Semua hasil yang belum terbukti tetap dilaporkan terbuka.
