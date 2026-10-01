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
| Produk, harga, daftar reseller | ✅ Ya |
| **Order & riwayat pembayaran** | ❌ **Tidak** — hanya di `kavya-db.json` |
| **Saldo wallet / deposit** | ❌ **Tidak** — hanya di `kavya-db.json` |
| Sesi login WhatsApp | ❌ Tidak — harus scan QR ulang |

Jadi: **Restore tetap wajib.** Sync Sheets saja tidak memulihkan order dan saldo.

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

Jangan percaya website sudah benar hanya karena sudah nyala. Cek:

1. **Login owner** bisa masuk.
2. **Jumlah order** di Operations cocok kira-kira dengan backup (tidak 0).
3. **Angka stok** ada. Kalau 0, berarti Sheet belum ter-configure — cek `.env`.
4. **Sync Sheets** — tunggu 1 menit, lalu pastikan log tidak complaint. Kalau
   stok masih 0, cek `GOOGLE_SHEETS_*` di `.env`.
5. **Saldo reseller** sesuai. Ini yang paling penting — kalau salah, ada transaksi
   yang tidak tercatat.
6. **WhatsApp bot** — kalau `baileys-auth` tidak ikut ter-restore, kamu perlu scan
   QR lagi. Normal, bukan tanda data hilang.

---

## Catatan: kenapa backup tidak dikirim

Kalau kamu membuka dokumen ini karena **tidak ada file baru di WhatsApp**, kemungkinan penyebabnya:

| Gejala | Penyebab | Cara cek di VPS |
|---|---|---|
| Tidak ada backup sama sekali | `AUTO_BACKUP_ON_START` dimatikan, atau proses start-nya bukan `kavya-start.mjs` | `grep AUTO_BACKUP_ON_START .env` |
| Backup jalan tapi tidak terkirim | `BACKUP_OWNER_NUMBER` atau `WHATSAPP_BOT_TOKEN` kosong | `grep -E 'BACKUP_OWNER_NUMBER\|WHATSAPP_BOT_TOKEN' .env` |
| File `.enc` tapi tidak bisa dibuka | `BACKUP_ENCRYPTION_KEY` berbeda dari yang dipakai saat enkripsi | bandingkan dengan key yang tersimpan |
| Tidak ada backup dalam berminggu-minggu | Backup hanya jalan **saat server start**, tidak terjadwal | `crontab -l` |

Yang terakhir adalah penyebab paling sering: **skripnya ada dan otomatis jalan
setiap kali server start, tapi tidak ada jadwal harian.** Kalau server tidak pernah
restart, backup tidak pernah dibuat.
