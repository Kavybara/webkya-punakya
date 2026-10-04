# Restore Kavya dari File Backup

Dokumen ini ada untuk satu situasi: **VPS mati, hilang, atau database rusak, dan
kamu harus menyalakan lagi tanpa data sebelumnya.**

Bukan panduan harian. Kalau tidak sedang dalam situasi pemulihan, tidak perlu
buka file ini.

---

## 0. Yang perlu kamu punya sebelum mulai

| Kebutuhan | Kenapa | Di mana biasanya |
|---|---|---|
| File `File Backup.tar.gz.enc` | Arsip terenkripsi berisi seluruh data | WhatsApp kamu (dikirim otomatis) |
| `BACKUP_ENCRYPTION_KEY` | Tanpa ini arsip **tidak bisa dibuka sama sekali** | `~/.ssh/kavya_backup_encryption_key.txt` di komputermu, atau `.env` proyek |
| Kredensial Google Sheets | Stok & akun sold disinkron dari sini | Sudah ikut **di dalam** arsip sebagai `.env` |
| Akses root VPS | Untuk menaruh arsip kembali | SSH ke `root@178.83.188.210` |

> **PENTING.** Tanpa `BACKUP_ENCRYPTION_KEY`, file `.enc` itu tidak bisa dipulihkan
> oleh siapa pun, termasuk kamu. Kalau kamu tidak tahu di mana key-nya disimpan,
> itu penting untuk dicari sekarang: temukan dulu sebelum kejadian. Arsip
> tidak berguna tanpa key.

---

## 1. Yang kembali, dan yang tidak

Supaya tidak ada kejutan: Sheets adalah sumber kebenaran untuk sebagian data,
tapi **tidak semuanya ada di Sheets**.

Kehilangan VPS berarti kehilangan `apps/dashboard/runtime/kavya-db.json`.
Setelah restore, website akan berjalan dan **sync otomatis ke Sheets** dalam
20 detik, dan beberapa hal kembali sendiri:

| Data | Kembali sendiri dari Sheets? |
|---|---|
| Stok, status sold, SELLER | ✅ Ya — sync otomatis tiap 3 menit |
| Managed Account (email/password, reseller, buyer) | ✅ Ya — dibangun ulang dari baris Sheet yang `sold` |
| Produk dan harga | ✅ Ya — `db.products` ditulis ulang dari Sheet |
| **Daftar reseller** | ❌ **Tidak** — hanya ada di `kavya-db.json` |
| **Order dan riwayat pembayaran** | ❌ **Tidak** — hanya ada di `kavya-db.json` |
| **Saldo wallet / deposit** | ❌ **Tidak** — hanya ada di `kavya-db.json` |
| Sesi login WhatsApp | ❌ Tidak — harus scan QR ulang |

Jadi: **Restore tetap wajib.** Sync Sheets saja tidak memulihkan order, saldo,
dan daftar reseller.

### Koreksi 2026-10-04 — baris "daftar reseller" sebelumnya salah

Versi dokumen ini menulis "Produk, harga, daftar reseller — Ya". Baris reseller
itu **salah**, dan salahnya berbahaya: kalimat tepat di atasnya menyatakan Sheet
tidak menyimpan semua data, jadi tabel ini dipercaya tanpa diperiksa ulang.

Kenyataannya `server/google-sheets.js` **tidak pernah membaca baris reseller
untuk mengisi `db.resellers`.** Semua kemunculan `db.resellers` di file itu
adalah pembacaan, kecuali satu loop yang hanya menandai status sinkron pada
objek yang sudah ada. Sync reseller berjalan satu arah: database ke Sheet.
Tidak ada jalur sebaliknya. Sheet `Data Reseller` memang berisi kolom SELLER
dan WHATSAPP, tapi tidak ada kode yang membacanya kembali.

Konsekuensinya kalau restore dilewat: kamu melihat aplikasi yang tampak normal
dengan tabel reseller kosong. Produk lengkap, login jalan, nol error. Kehilangan
total tidak terlihat sebagai kegagalan.

### Kenapa kehilangan total tidak terdengar

`server/store.js` menjawab `kavya-db.json` yang hilang dengan `defaultData`,
lalu **menulis ulang file itu**. Hasilnya bukan file yang hilang, melainkan file
yang berisi katalog 31 produk lengkap dan seluruh array data operasional kosong
(termasuk `resellers: []`, `default-data.js:841`). Prosesnya tidak gagal — ia
berhasil. Tidak ada error di log, dan halaman tetap terbuka.

### Cara mengenali restore yang terlewat

Kondisi ini sekarang terdeteksi. `/api/health` memeriksa ketidaklaianan yang
tidak mungkin terjadi pada operasi normal, dan halaman Reseller menampilkan
banner merah kalau terdeteksi.

`orders` dan `payments` hanya pernah ada di `kavya-db.json` — Sheets tidak
menyimpannya dan tidak ada sync yang membangunnya — dan setiap order membawa
`resellerId`. Jadi "order ada, reseller tidak ada" tidak mungkin terjadi lewat
operasi normal. Order milik owner sendiri (`resellerId` kosong) tidak dihitung,
jadi database yang hanya berisi order owner tetap diam.

Kalau banner itu muncul: **jangan langsung membuat akun reseller baru untuk
mengisi ulang.** Itu akan menimpa data lama kalau file backup ternyata masih ada
di WhatsApp. Pulihkan `kavya-db.json` dari backup dulu, baru jalankan ulang
sync Sheets.

---

## 2. Ambil file backup dari WhatsApp

Backup dikirim otomatis ke nomor owner sebagai `File Backup.tar.gz.enc`.
Buka chat WA kamu, cari file-nya, download ke komputer.

Kalau tidak ada file baru, cek dulu apakah backup-nya memang pernah jalan —
lihat bagian **Catatan: kenapa backup tidak dikirim** di bawah.

---

## 3. Buka enkripsi

Di komputer yang sudah punya proyek ini, dari **root repo**:

```bash
npm run runtime:backup:decrypt -- "/path/ke/download/File Backup.tar.gz.enc"
```

Perintah ini mencetak path file `.tar.gz` yang sudah terbuka. Kalau error
`BACKUP_ENCRYPTION_KEY minimal 16 karakter`, berarti `.env` di repo lokalmu belum
memiliki key — pakai key yang benar, atau taruh dulu di `.env`:

```
BACKUP_ENCRYPTION_KEY=<isi key yang benar>
```

Kalau muncul `Format backup terenkripsi tidak dikenali`, file-nya rusak atau
bukan backup Kavya — download ulang dari WhatsApp.

---

## 4. Naikkan file ke VPS

```bash
scp "File Backup.tar.gz" root@178.83.188.210:/root/kavya-restore.tar.gz
```

---

## 5. Simpan data lama dulu — jangan ditimpa langsung

**Jangan pernah skip langkah ini.** Data di VPS sekarang mungkin berisi
transaksi yang lebih baru daripada isi backup.

```bash
ssh root@178.83.188.210
cd /path/ke/proyek          # direktori yang berisi .env
tar czf /root/kavya-sebelum-restore-$(date +%F-%H%M).tar.gz \
  apps/dashboard/runtime/kavya-db.json
```

Kalau file tidak ada, VPS-nya memang sudah kosong — lanjut saja ke langkah 6.

---

## 6. Ekstrak dan pasang kembali

```bash
cd /path/ke/proyek
tar xzf /root/kavya-restore.tar.gz -C .
```

Yang dipulihkan, dan di mana:

```
apps/dashboard/runtime/kavya-db.json          ← order, saldo, akun, stok
apps/dashboard/runtime/whatsapp-database/      ← data bot
apps/dashboard/runtime/baileys-auth/           ← sesi WhatsApp (kalau ada)
.env                                            ← kredensial produksi
<seluruh source project>
```

**Periksa `.env` dulu sebelum start.** Arsip menyertakan `.env` lama, dan itu
*akan* menimpa konfigurasi yang sekarang kalau ada yang berubah sejak backup
dibuat. Kalau `.env` di VPS sekarang lebih baru, keep yang sekarang:

```bash
cp .env /root/env-sekarang-backup
# bandingkan keduanya sebelum memutuskan mana yang dipakai
```

---

## 7. Jalankan

```bash
npm install
npm run web:build          # atau nama script build produksi yang dipakai
npm start                  # atau systemctl restart kavya
```

Kalau `RUNTIME_PATH` dan `RUNTIME_DIR` di `.env` menunjuk folder berbeda,
tabel di `DEPLOYMENT.md` menjelaskan mana yang dipakai proses mana — **cek ini
dulu**, karena salah tempat berarti database yang dipulihkan tidak dibaca.

---

## 8. Verifikasi setelah hidup

Jangan percaya website sudah benar hanya karena sudah nyala.

Urutannya penting: **cek yang paling merusak lebih dulu.** Restore yang gagal
total tidak selalu terlihat, dan kalau kamu lanjutkan ke langkah yang lebih
lambat, kamu bisa menghabiskan waktu lama menyalakan sesuatu yang berdiri di atas database kosong.

### A. Yang harus Dicek Dulu

1. **Login owner** bisa masuk.
2. **Tidak ada banner merah di halaman Reseller.** Kalau banner "database
   reseller kosong" muncul, restore-nya gagal total — berhenti di sini dan ulangi
   langkah 6. Jangan lanjutkan, jangan buat akun reseller baru.
3. **Daftar reseller** ada dan jumlahnya sesuai seperti yang kamu ingat. Kalau 0
   padahal backup jelas berisi reseller, berarti `kavya-db.json` yang dipasang
   bukan yang benar.

Tiga langkah ini hampir selalu selesai dalam dua menit, dan tiga-tiganya
menangkap kegagalan yang paling mahal.

### B. Data yang Hanya Ada di Backup

Empat data ini **tidak ada di Google Sheets** dan tidak bisa dibangun ulang oleh
sync. Kalau restore-nya salah, tidak ada sumber kedua:

| Data | Halaman owner | Kalau kosong |
|---|---|---|
| Order & riwayat pembayaran | Operations | Setiap transaksi hilang permanen |
| Saldo wallet / deposit | Reseller | Saldo salah = uang pelanggan salah |
| Klaim garansi | Warranty | Klaim lama tidak bisa dilacak |
| Rental & daftar grup WhatsApp | Rental / Group sync | Nomor & grup harus diisi ulang manual |

Cek angkanya masuk akal — tidak harus cocok sampai satuan, tapi harus **tidak
nol** dan tidak jauh lebih kecil dari yang kamu ingat.

### C. Yang Bisapulih dari Sheets

Ini boleh terlihat aneh selama beberapa menit pertama, karena sync butuh waktu:

5. **Angka stok** ada. Kalau 0 setelah 1 menit, berarti Sheet belum ter-configure
   — cek `GOOGLE_SHEETS_*` di `.env`.
6. **Sync Sheets** — tunggu 1 menit, lalu pastikan log tidak complaint.
7. **Produk dan harga** tampil di katalog.

### D. Setelah Semua Berjalan

8. **WhatsApp bot** — kalau `baileys-auth` tidak ikut ter-restore, kamu perlu scan
   QR lagi. Normal, bukan tanda data hilang.
9. **Backup — cek Health Center.** Lihat bagian **Cara cek backup hari ini**. Ini
   yang paling sering terlewat setelah restore, dan akibatnya fatal: file
   `kavya-db.json` yang baru saja kamu pasang **tidak punya salinan di mana pun**.
   Kalau VPS-nya mati lagi sebelum jadwal backup berikutnya jalan, kamu kembali
   ke titik nol. Jalankan backup manual dan pastikan file benar-benar terkirim
   ke WhatsApp kamu — bukan cuma "dibuat".
10. **Saldo reseller** cocok dengan catatanmu. Ini yang paling penting — kalau
    salah, ada transaksi yang tidak tercatat, dan tidak ada yang mengabarimu.

---

### Kalau sesuatu terasa salah

| Gejala | Kemungkinan | Yang harus dilakukan |
|---|---|---|
| Banner merah di halaman Reseller | `kavya-db.json` tidak terbaca, jadi `defaultData` menimpanya | Ulangi langkah 6. **Jangan** buat akun reseller baru |
| Tabel reseller kosong, tapi tidak ada banner | Backup memang tidak punya reseller — atau banner belum ter-deploy | Bandingkan isi `kavya-db.json` dengan backup |
| Stok 0 tapi order ada | `kavya-db.json` terbaca, `.env` Sheets salah | Cek `GOOGLE_SHEETS_*`; sync akan menyusul |
| Order 0 tapi reseller ada | Database terbaca tapi bukan file yang benar | Ulangi langkah 6 dengan arsip yang berbeda |
| Saldo tidak sesuai | transactions hilang | Berhenti. Pulihkan dari backup terbaru, jangan menebak |

Baris terakhir intentional: **menebak saldo adalah cara tercepat membuat
kerugian irreversible.** Kalau angkanya tidak cocok, tidak ada yang perlu
diperbaiki sekarang — yang perlu diperbaiki adalah file-nya.

---

## Catatan: kenapa backup tidak dikirim

> **Koreksi 2026-10-01.** Versi dokumen ini sebelumnya menyatakan backup "hanya
> jalan saat server start, tidak terjadwal", dan mengarahkan cek ke `crontab -l`.
> **Itu salah.** Jadwal 24 jam memang ada dan memang berjalan (lihat di bawah).
> Kalau kamu sudah mengecek `crontab` dan tidak menemukan apa-apa, itu normal —
> memang tidak ada cron. Jangan menyimpulkan backup rusak dari sana.

Backup otomatis punya **dua** pemicu, dan keduanya sudah ada di repo:

| Pemicu | Yang meng-arm | Default |
|---|---|---|
| Sekali saat start | `scripts/startup/kavya-start.mjs:670` | **mati** (`AUTO_BACKUP_ON_START=false`) |
| Tiap 24 jam | `apps/bot/handle/connection.js:886` | **nyala** (`AUTO_BACKUP_SCHEDULE_ENABLED=true`) |

Jadi pada konfigurasi yang sekarang, **yang benar-benar bekerja adalah timer
24 jam di proses bot WhatsApp** — bukan `kavya-start.mjs`.

> **Catatan 2026-10-04.** Nomor baris di tabel ini ikut geser setiap kali
> `connection.js` diubah. Kalau angkanya tidak cocok dengan filemu, cari
> `function startScheduledBackup` — itu penandanya, bukan angka baris.

### Konsekuensi yang harus kamu tahu

Tiga hal ini yang membuat backup diam-diam tidak jalan, dan ketiganya **tidak
akan muncul di `crontab`**:

1. **Bot WhatsApp mati → tidak ada backup sama sekali.** Timer-nya hidup di
   proses bot (`connection.js:893`), bukan di cron sistem. Kalau proses bot
   stop atau crash, tidak ada yang menjadwalkan apa pun. Ini titik kegagalan
   tunggal, dan tidak tertulis di `.env.example`.
2. **WhatsApp tidak connect → backup dilewati, arsip pun tidak dibuat.**
   `runScheduledBackup` mengecek `isSocketOpen` (`connection.js:843`) dan
   `return` **sebelum** arsipnya dibangun. Jadi bukan "saja tidak terkirim" —
   tidak ada file sama sekali.
3. **Back-to-back backup di-throttle 30 menit** (`AUTO_BACKUP_MIN_INTERVAL_MS`).
   Kalau kamu tes manual berulang kali, yang berikutnya ditolak dengan
   `auto_backup_throttled`. Itu perilaku yang benar, bukan bug.

Poin 1 punya konsekuensi yang menyakitkan: **proses yang ought to melaporkan
backup rusak adalah proses yang sudah mati.** Itu sebabnya setiap hasil backup
sekarang ikut ditulis ke `kavya-db.json` — lihat di bawah.

## Cara cek backup hari ini (Health Center)

Sebelum deploy versi ini, satu-satunya cara tahu backup jalan atau tidak adalah
`curl` ke proses bot — dan kalau proses bot mati, `curl` itu juga tidak
menjawab. Sekarang Health Center bisa menjawabnya sendiri.

Buka **Owner → Health Center**, kartu **Backup**. Yang ditampilkan bukan jumlah
file di `runtime/backups`, melainkan hasil run terakhir:

| Status di kartu | Artinya | Yang harus kamu lakukan |
|---|---|---|
| `sehat` + "Terkirim ..." | Backup terakhir sampai ke owner | Tidak ada |
| "Backup otomatis dilewati..." | Jadwal berjalan, tapi tidak ada file dibuat | Cek koneksi WhatsApp di Health Center |
| "Backup dibuat tapi tidak terkirim..." | Arsip ada di VPS, tapi owner tidak punya | Kirim manual; file ini hilang bersama VPS |
| "Backup otomatis gagal..." | Run meledak | Cek log proses bot |
| "terlalu lama ... jam lalu" | Tidak ada run baru dalam 2× jadwal | Proses bot kemungkinan mati |
| "Belum pernah ada catatan" | Tidak ada run yang pernah tercatat | Proses bot versi lama, atau jadwal mati |

Pesan lengkapnya muncul sebagai banner di atas Health Center, bukan cuma di
kartu — ini kegagalan yang baru ketahuan setelah kamu butuh file-nya.

**Penting:** "Backup otomatis dilewati" **bukan**kolom kosong. Itu artinya
jadwal hidup tapi tidak menghasilkan apa pun. Backup yang hanya ada di VPS yang
sama bukan backup dari sudut pandangmu, karena disk itu ikut hilang kalau
servernya hilang.

### Cara tambangnya dicatat

Bot menulis setiap hasil run ke `settings.backupState` di `kavya-db.json`
(`apps/bot/lib/backup-state-writer.js`), termasuk saat run **dilewati** atau
**gagal** — bukan cuma saat sukses. Timestamp sengaja disimpan dalam format
`YYYY-MM-DD HH:MM` supaya bisa langsung dibaca `formatDateTime` di dashboard.

Bot jadi penulis kedua file itu, jadi penulisnya memakai optimistic
concurrency: baca, hitung, lalu verifikasi file di disk masih identik sebelum
menimpanya, dan retry dari versi terbaru kalau ada yang berubah di tengah jalan.
Tanpa itu, satu tumpang-tindih dengan dashboard bisa menghapus order pelanggan.

### Cara cek yang benar

**Cek Health Center dulu.** Kalau bot masih hidup, `curl` dan dashboard
memberi jawaban yang sama; kalau bot mati, hanya dashboard yang masih bisa
jawab. `curl` tetap berguna sebagai sumber kedua karena tidak bergantung pada
isi database.

Jangan pakai `crontab`. Tanya langsung ke proses bot:

```bash
# di VPS — butuh token bot, bukan password root
curl -s -H "Authorization: Bearer $WHATSAPP_BOT_TOKEN" \
  http://127.0.0.1:4016/session/status | jq '.auto_backup'
```

`4016` adalah `WHATSAPP_PORT` di `.env.example`; kalau di `.env`mu berbeda, pakai
yang tertulis di situ. Balasannya memuat `enabled`, `scheduled`, `interval_ms`,
`owner_configured`, `running`, `last_run_at`, `last_status`, dan `last_error` —
cukup untuk tahu backup terakhir jalan atau tidak, tanpa menebak.

| Yang dilihat di `last_status` | Artinya |
|---|---|
| `sent` | Backup terbaru terkirim ke WhatsApp |
| `created` | Arsip dibuat, tapi gagal dikirim |
| `skipped` | Dilewati — cek `last_error` |
| `failed` | Error; `last_error` berisi alasannya |
| `disabled` | `AUTO_BACKUP` atau `AUTO_BACKUP_SCHEDULE_ENABLED`=false |

Kalau `curl` tidak menjawab sama sekali, itu bukan berarti backup baik-baik
aja — itu berarti proses bot tidak hidup, dan tidak ada yang menjadwalkan apa
pun. Health Center akan menandai ini sebagai "terlalu lama" dalam satu atau dua
siklus jadwal.

Kalau `last_run_at` kosong jauh lebih lama dari 24 jam, timer-nya tidak pernah
senang — periksa proses bot dulu, bukan jadwal.

### Sisanya

| Gejala | Penyebab | Cara cek di VPS |
|---|---|---|
| Backup jalan tapi tidak terkirim | `BACKUP_OWNER_NUMBER` atau `WHATSAPP_BOT_TOKEN` kosong | `grep -E 'BACKUP_OWNER_NUMBER\|WHATSAPP_BOT_TOKEN' .env` |
| `owner_configured: false` di status | `BACKUP_OWNER_NUMBER` kosong, atau tidak ada owner yang bisa dibaca | sama seperti di atas |
| File `.enc` tapi tidak bisa dibuka | `BACKUP_ENCRYPTION_KEY` berbeda dari yang dipakai saat enkripsi | bandingkan dengan key yang tersimpan |
| Tidak ada backup sama sekali | Proses bot WhatsApp tidak jalan | `systemctl status <unit-bot>` / `ps aux \| grep bot` |
