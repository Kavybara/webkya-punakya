# Rotasi kredensial yang pernah terekspos

Dokumen ini untuk **dua** kredensial yang sudah pernah masuk ke chat/log dan
karena itu harus dianggap bocor, meskipun tidak ada yang tahu pasti apakah
seseorang membacanya:

| Kredensial | Kenapa harus diganti |
|---|---|
| Password root VPS | Pernah ditulis penuh di transcript chat |
| `CLOUDFLARED_TOKEN` | Pernah ditulis penuh di transcript chat |

Ditambah dua yang ditemukan lewat audit source (lihat bagian 4–5): `TENOR_API_KEY`
dan password owner yang tertanam di `artifacts/merge-dashboard-backup-data.mjs`.
Keduanya **sudah dihapus dari kodenya**, tapi masih ada di riwayat git — jadi
memang harus dianggap bocor.

Yang **tidak** termasuk: password akun reseller, API key Google, token WA bot —
kalau salah satu bocor, gejalanya berbeda dan penanganannya juga berbeda.

> **Aturan.** Kredensial tidak boleh dimasukkan ke chat, ke issue, ke commit, atau
> ke file mana pun di repo ini. Kalau perlu memorize di mana, simpan di password
> manager — bukan di sini. Dokumen ini sengaja **tidak memuat nilai kredensial
> apa pun**.

---

## 0. Urutan

**Rotasi Cloudflare dulu, password root belakangan.** Alasannya: kalau root
dirotasi duluan dan ternyata ada yang salah di langkah berikutnya, kamu bisa
mengunci diri keluar dari server yang masih menyimpan tunnel milikmu. Dengan
urutan ini, selama proses rotasi token kamu masih punya akses ke server.

---

## 1. Rotasi `CLOUDFLARED_TOKEN`

### 1.1 Token ini disimpan di satu tempat saja

Sudah diverifikasi di kode: `CLOUDFLARED_TOKEN` di `.env` adalah sumber
tunggal. Nilai di database dashboard (`settings.cloudflareTunnelToken`) **selalu
ditimpa** dari `.env` saat start (`kavya-start.mjs:492`, `index.js:8135`), dan
UI tidak pernah bisa mengisinya sendiri (`settings-routes.js:150-155`).

Jadi cukup ubah `.env`. Tidak ada tempat kedua yang perlu dibersihkan.

### 1.2 Buat token baru

1. Buka Cloudflare Zero Trust dashboard → **Networks → Tunnels**.
2. Klik tunnel Kavya → **Configure → Install connector** (tab Linux).
3. Salin perintah `cloudflared service install <TOKEN>`.

### 1.3 Ganti di VPS

```bash
ssh root@178.83.188.210
cd /path/ke/proyek            # direktori yang berisi .env

# simpan yang lama dulu, jangan dihapus sebelum yang baru terbukti jalan
cp .env /root/env-backup-$(date +%F-%H%M)

# edit CLOUDFLARED_TOKEN di .env -> isi token baru
```

### 1.4 Restart, lalu verifikasi

```bash
npm start        # atau systemctl restart <unit-kavya>
```

Cek tunnel-nya hidup:

```bash
pgrep -fa cloudflared
curl -sI https://<domain-kamu> | head -1
```

Kalau `pgrep` kosong, cek log start — `kavya-start.mjs:667` akan mencetak
*"Cloudflare Tunnel token kosong"* kalau token-nya tidak terbaca.

### 1.5 Cabut token lama

Barus setelah 1.4 berhasil:

1. Cloudflare dashboard → **tunnel → Rotate token** (atau hapus token lama dari
   Connectors).
2. Restart sekali lagi di VPS.

Langkah ini yang benar-benar menutup kebocorannya. Merotasi tanpa mencabut
token lama tidak menambah keamanan apa pun.

---

## 2. Rotasi password root

### 2.1 Dari komputer kamu

```bash
ssh root@178.83.188.210
passwd
```

Masukkan password baru **dua kali**. Perintah ini selesai; tidak ada file yang
perlu diedit.

### 2.2 Verifikasi sebelum menutup sesi

```bash
# BUKA SESI KEDUA, jangan tutup yang lama
ssh root@178.83.188.210
```

Kalau sesi kedua masuk, password baru sudah berlaku. **Tutup sesi pertama
sesudahnya.** Kalau kamu menutup sesi pertama lebih dulu dan ternyata password
baru tidak ada yang tersimpan, kamu terkunci dari server.

### 2.3 Kalau password root tidak bisa dipakai sama sekali

Lewati `passwd` dan pakai recovery console provider VPS (biasanya panel
web-nya punya "Console"/"VNC"), lalu `passwd` dari sana.

---

## 3. Setelah semua selesai

- [ ] `CLOUDFLARED_TOKEN` baru jalan, `pgrep -fa cloudflared` ada output
- [ ] Website masih bisa diakses lewat domain publik (curl 200)
- [ ] **Token lama dicabut** di Cloudflare
- [ ] Password root diganti, dan sudah diuji dari sesi baru
- [ ] Sesi SSH lama sudah ditutup
- [ ] Password baru disimpan di password manager — **bukan** di chat

## Kalau ada yang salah di tengah jalan

Jangan panik, jangan hastily mengubah file lain. Urutan pemulihannya:

| Gejala | Yang terjadi | Yang harus dilakukan |
|---|---|---|
| Tunnel mati setelah rotasi | Salah tempel token | `cp /root/env-backup-* .env`, restart, ulangi 1.2 |
| Website 502 setelah restart | Tunnel belum connect | Tunggu 15 detik, cek `pgrep -fa cloudflared` lagi |
| Tidak bisa SSH setelah ganti password | Sesi lama masih terbuka | **Jangan tutup**; buka sesi kedua untuk tes |
| Bot WA tidak connect setelah restart | Proses bot ikut restart | Normal, tunggu stabil; scan QR hanya kalau memang diminta |

Yang **tidak boleh** terjadi: menghapus `apps/dashboard/runtime`, database, atau
`.env` karena ingin "mulai bersih". Semua data ada di sana.

---

# 4. Kredensial yang ditemukan lewat audit source

Bagian 1–3 menangani kredensial yang bocor lewat chat. Dua di bawah bocor lewat
**kode yang ikut ter-commit**, yang berbeda jenis: kuncinya ada di dalam
repository, jadi siapa pun yang mengkloning (atau repository publik) punya
salinannya.

Keduanya sudah tidak ada di source sekarang. Yang tersisa adalah **riwayat
git** — dan riwayat git tidak bisa dihapus tanpa rewrite, jadi rotasi tetap
wajib dilakukan.

| Kredensial | Ditemukan di | Sudah dicabut dari kode? |
|---|---|---|
| `TENOR_API_KEY` (Google API key) | `plugins/kavya/TOOLS/emoji mix.js` | Ya — dibaca dari `process.env` |
| Password owner (plaintext) | `artifacts/merge-dashboard-backup-data.mjs` | Ya — dan tidak lagi dicetak ke stdout |

## 4.1 `TENOR_API_KEY`

Tidak damaging: key ini hanya memanggil Tenor untuk membuat stiker emoji, tidak
menyentuh data uang atau akun. Tapi tetap dipublikasikan.

1. Buka Google Cloud Console → project yang punya key tersebut.
2. **APIs & Services → Credentials** → hapus key lama.
3. Buat key baru, batasi **API restriction** ke Tenor v2 saja. Batasi juga
   quota supaya tidak bisa dipakai untuk membanjiri billing.
4. Taruh di `.env`:

   ```
   TENOR_API_KEY=<nilai baru>
   ```

5. Restart bot, lalu tes di grup: `.emojimix 😅+🤔`.

Kalau `.emojimix` tidak pernah dipakai, **hapus saja key-nya** dan biarkan
variabel kosong — perintahnya akan memberi pesan jelas, bukan crash.

## 4.2 Password owner

Nilai yang tadinya tertulis di `merge-dashboard-backup-data.mjs` adalah password
login owner yang aktif, jadi ini kredensial paling serius di daftar ini.

Setelah source dibersihkan, password itu **tidak lagi ada di kode** — tapi masih
pernah ada, jadi harus diganti:

1. Login ke dashboard sebagai owner.
2. Ganti password lewat halaman pengaturan.
3. Update juga `OWNER_PASSWORD` di `.env` VPS.

Kenapa keduanya: `index.js` memprioritaskan `OWNER_PASSWORD` dari environment
dan meng-hash ulang `ownerPasswordHash` dari situ setiap start. Kalau `.env`
lama tidak diubah, password yang baru kamu set di dashboard akan **ditimpa
kembali** oleh nilai lama di `.env` pada boot berikutnya.

Setelah ganti, pastikan tidak ada sesi reseller/owner yang masih hidup dengan
password lama — `docs/RESTORE.md` bagian rotasi menjelaskan alurnya.

---

# 5. Rencanarewrite riwayat (git filter-repo)

Bagian ini **hanya rencana**. Belum dijalankan, dan tidak boleh dijalankan tanpa
persetujuan eksplisit.

## 5.1 Kenapa rewrite historis saja tidak cukup

Menghapus key dari source sekarang **tidak** menghapusnya dari riwayat:

```bash
git log -S "AIza" --oneline --all     # key lama masih ada di commit lama
```

Selama commit itu masih ada di branch mana pun, atau di fork mana pun, atau di
salinan yang sudah di-clone, kuncinya masih bocor. Karena itu urutannya:

**rotasi dulu, rewrite belakangan (kalau memang mau).** Setelah rotasi, nilai
lama sudah tidak berlaku, jadi rewrite hanya demi kerapian — bukan demi
keamanan. Urutan sebaliknya membuang effort tanpa mengubah risiko.

## 5.2 Prasyarat

- [ ] Rotasi §4.1 dan §4.2 **sudah selesai dan terverifikasi**
- [ ] Semua working tree bersih, tidak ada perubahan belum di-commit
- [ ] Semua branch sudah di-push, tidak ada commit lokal yang hanya ada di laptop
- [ ] Sudah tahu remote mana yang ada (GitHub, mirror, VPS)
- [ ] Backup: `git clone --mirror <remote> backup.git` — **lakukan ini dulu**

## 5.3 Blokir push dulu

Sambil rewrite, jangan sampai ada push yang membawa versi lama:

```bash
git push --mirror   # dari clone utama JANGAN
# sebagai gantinya, sementara nonaktifkan hook di server / block di CI
```

## 5.4 Ganti dengan placeholder

`git filter-repo` tidak bisa "menghapus nilai" tanpa tahu nilainya, dan dokumen
ini sengaja tidak memuat nilai kredensial. Jadi filenya ditulis dari nilai
tersebut di mesin kamu:

```bash
# 1. clone mirror terpisah, JANGAN di repo kerja
git clone --mirror <remote> ../kavya-rewrite.git
cd ../kavya-rewrite.git

# 2. jalankan filter untuk path yang sudah dibersihkan
git filter-repo --invert-paths \
  --path plugins/kavya/TOOLS/emoji\ mix.js \
  --path artifacts/merge-dashboard-backup-data.mjs
```

Menghapus **path** lebih aman daripada menyunting isi file: tidak ada nilai
kredensial yang perlu diketik ulang, dan tidak ada salah ketik yang bisa membuat
rewritten repo.contains secret baru.

> Kalau nanti kau butuh menyunting isi (bukan menghapus file), pakai
> `--replace-text <file>`, dengan file replacement berisi
> `literalNilaiLama==>PLACEHOLDER`. Jangan pernah menulis nilai aslinya di
> shell — terminal history akan menyimpannya.

## 5.5 Verifikasi

```bash
git log -S "AIza" --all --oneline        # harus kosong
git log -S "ownerPassword:" --all --oneline
git filter-repo --analyze                 # statistik perubahan
```

Lalu jalankan test gate di rewritten repo sebelum}squash:

```bash
cd apps/dashboard && npx tsc -b --force && node --test server/tests/
node --test --test-force-exit apps/bot/tests/
```

## 5.6 Setelah rewrite

```bash
git push --force --mirror
```

Lalu **rotasi ulang** apa pun yang masihshared, karena clone/fork lama masih
memegang nilai lama.

> Peringatan. `--force` pada shared branch membatalkan riwayat untuk semua
>`_collaborator`. Kalau repo ini publik dan sudah pernah di-fork, rewrite **tidak
> bisa ditarik kembali** — isi riwayat di fork orang tetap ada. Untuk repository
> publik, rotasi credential (bagian 4) adalah satu-satunya langkah yang benar-benar
> bekerja, dan itu sudah dilakukan.

## 5.7 Yang sengaja tidak dilakukan

Tidak ada `git gc --aggressive --prune`, tidak ada penghapusan objek, tidak ada
pengubahan timestamp commit. Semuanya tidak menambah keamanan: pada repo publik,
`git clone` biasa sudah bisa menjangkau objek lama.
