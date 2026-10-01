# Rotasi kredensial yang pernah terekspos

Dokumen ini untuk **dua** kredensial yang sudah pernah masuk ke chat/log dan
karena itu harus dianggap bocor, meskipun tidak ada yang tahu pasti apakah
seseorang membacanya:

| Kredensial | Kenapa harus diganti |
|---|---|
| Password root VPS | Pernah ditulis penuh di transcript chat |
| `CLOUDFLARED_TOKEN` | Pernah ditulis penuh di transcript chat |

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
