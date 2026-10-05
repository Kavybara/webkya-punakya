# Verifikasi Live - 6 Oktober 2026

## Izin Dan Batas

Pengguna mengizinkan pesan uji WhatsApp owner dan transaksi uji. Nominal dasar
dibatasi Rp1.000; hanya kontak owner dan email uji milik pengguna digunakan.
Push ditahan sampai verifikasi live selesai. Tidak ada deploy, rotasi credential,
perubahan profil/settings, stok, rental atau list grup. Tidak memakai pelanggan
atau grup reseller sebagai sasaran tes.

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

## Yang Belum Selesai

- Kode Netflix baru untuk email uji milik pengguna dan pengambilan melalui alur
  aplikasi yang berwenang. Aplikasi membaca kode Netflix, tidak membuat kode itu.
- Pembayaran uji sampai callback dan delivery live; invoice yang dibuat bukan
  order aplikasi dan tidak membuktikan rekonsiliasi order live.
- Warranty replacement dan Sheets writeback menggunakan data uji yang terisolasi.
- Staging kode baru, CI GitHub hijau, clean install serta restore/rollback Linux.

Jangan mengirim ulang pesan atau membuat invoice baru hanya untuk mengulang
pemeriksaan. Jangan mengaktifkan grup, mengimpor legacy atau mengubah data nyata
untuk melengkapi bukti. Semua hasil yang belum terbukti tetap dilaporkan terbuka.
