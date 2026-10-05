# Update Kode Tanpa Menimpa Data VPS

Update kode berbeda dari pemulihan backup. Untuk update biasa, data VPS tetap
menjadi sumber utama. Jangan unggah seluruh folder laptop dan jangan menjalankan
skrip penggabungan atau impor data legacy sebagai bagian dari update.

## Paket Update

Jalankan dari folder proyek:

```bash
npm run test:all
npm run dashboard:typecheck
npm run lint --prefix apps/dashboard
npm run whatsapp:check
npm run app:build
npm run test:e2e --prefix apps/dashboard
npm run release:code
```

Paket `release/kavya-code-*.tar.gz` berisi kode dan hasil build, dengan manifest
hash SHA-256. Paket tidak membawa `.env`, database, list grup, daftar reseller,
folder runtime, sesi Baileys, backup, node_modules, ataupun hasil tes browser.
Path penyimpanan khusus yang dikonfigurasi juga dikecualikan. Jika VPS memakai
path data berbeda dari laptop, tambahkan path itu ke pengecualian sebelum deploy.

## Pemeriksaan Sebelum Deploy

1. Catat path data yang dipakai proses VPS saat ini, bukan sekadar default contoh.
2. Catat jumlah reseller, saldo, rental aktif/jeda, list per grup, dan waktu perubahan terakhir.
3. Pastikan hanya satu proses bot dan satu connector tunnel live.
4. Hentikan penerimaan transaksi dan command sementara sebelum membuat snapshot final.
5. Buat backup data VPS, simpan salinan di luar VPS, dan pastikan kunci enkripsinya tersedia.
6. Cocokkan perubahan skema dengan database live. Jika perlu migrasi, tinjau terpisah.

## Pemasangan

Ekstrak paket ke folder staging baru. Periksa manifest dan daftar file lebih dulu.
Salin hanya file yang ada dalam manifest; jangan gunakan penghapusan menyeluruh
atau menyalin folder runtime dari laptop. Konfigurasi dan data di VPS harus tetap
berada di path yang sama. Simpan versi kode sebelumnya untuk rollback.

Gunakan install sesuai lockfile pada root, dashboard, dan bot. Jangan menyalakan
impor legacy paksa, restore backup lama, atau seeding otomatis. Jalankan proses
dengan konfigurasi VPS yang sudah ada, bukan `.env.example`.

Setelah restart, periksa login owner/reseller, halaman mobile, rental yang dijeda,
balasan list terbaru, saldo, pembelian, dan garansi. Uji integrasi eksternal dengan
transaksi percobaan yang disetujui; tes lokal tidak membuktikan WhatsApp/Pakasir
live sehat. Buka kembali transaksi hanya setelah pemeriksaan selesai.

## Rollback

Kembalikan kode sebelumnya jika pemeriksaan gagal. Jangan otomatis mengembalikan
database lama: transaksi dan edit list yang masuk setelah snapshot bisa hilang.
Restore data hanya untuk pemulihan kerusakan, setelah membandingkan perubahan
terakhir dan menghentikan semua penulis data.

## Batas Keamanan

Audit dependensi produksi saat ini bersih. Toolchain Tailwind 3 masih memiliki
advisory build-only pada rantai `braces`; jangan menganggap full audit sudah nol.
Migrasi mayor Tailwind perlu pekerjaan dan pemeriksaan tampilan terpisah.
Password/token yang pernah dibagikan atau masuk riwayat Git perlu dirotasi
langsung di penyedia terkait. Menghapus literal dari kode tidak membatalkan token.
