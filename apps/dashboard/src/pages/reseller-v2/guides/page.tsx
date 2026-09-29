import { useState, type ComponentType } from "react";
import {
  BadgeHelp,
  BookOpenCheck,
  Check,
  ChevronRight,
  Clock3,
  KeyRound,
  PackageCheck,
  Play,
  ShoppingBag,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";

type GuideId = "purchase" | "warranty" | "code" | "password";

type Guide = {
  id: GuideId;
  title: string;
  summary: string;
  duration: string;
  video: string;
  poster: string;
  action: string;
  actionLabel: string;
  result: string;
  icon: ComponentType<{ size?: number }>;
  steps: string[];
};

const guides: Guide[] = [
  {
    id: "purchase",
    title: "Membeli aplikasi",
    summary: "Pilih paket, selesaikan pembayaran, lalu buka akun yang diberikan.",
    duration: "14 detik",
    video: "/tutorials/beli-aplikasi.webm",
    poster: "/tutorials/beli-aplikasi.png",
    action: "/reseller-v2/catalog",
    actionLabel: "Buka Katalog",
    result: "Pesanan tercatat dan akun masuk ke Akun Saya setelah proses selesai.",
    icon: ShoppingBag,
    steps: [
      "Buka Katalog, lalu pilih produk, varian, dan durasi yang dibutuhkan.",
      "Periksa jumlah akun serta ringkasan harga sebelum melanjutkan checkout.",
      "Selesaikan pembayaran menggunakan saldo atau QRIS yang tersedia.",
      "Pantau proses di Pesanan dan buka hasil pembelian melalui Akun Saya.",
    ],
  },
  {
    id: "warranty",
    title: "Mengajukan garansi",
    summary: "Laporkan akun bermasalah beserta kendala dan bukti screenshot.",
    duration: "12 detik",
    video: "/tutorials/ajukan-garansi.webm",
    poster: "/tutorials/ajukan-garansi.png",
    action: "/reseller-v2/warranty",
    actionLabel: "Buka Garansi",
    result: "Klaim tersimpan dan status pemeriksaan dapat dipantau dari halaman Garansi.",
    icon: BadgeHelp,
    steps: [
      "Buka Garansi dan pilih akun aktif yang mengalami kendala.",
      "Tulis kendala secara singkat dan jelas agar Owner mudah memeriksa.",
      "Lampirkan screenshot yang memperlihatkan masalah pada akun.",
      "Kirim klaim, lalu pantau status dan Catatan Owner pada riwayat klaim.",
    ],
  },
  {
    id: "code",
    title: "Mengambil kode",
    summary: "Ambil kode atau link bantuan dari email akun yang masih aktif.",
    duration: "12 detik",
    video: "/tutorials/ambil-kode.webm",
    poster: "/tutorials/ambil-kode.png",
    action: "/reseller-v2/access",
    actionLabel: "Buka Akses & Kode",
    result: "Kode atau link terbaru dapat langsung disalin dari hasil pencarian.",
    icon: KeyRound,
    steps: [
      "Buka Akses & Kode, kemudian pilih penyedia Netflix atau Disney.",
      "Pilih Sign-in Code, Verification Code, Household, atau Disney OTP.",
      "Pilih identitas akun yang tersedia lalu tekan Cari Akun.",
      "Salin kode atau buka link yang ditemukan. Pilihan alat mengikuti izin reseller.",
    ],
  },
  {
    id: "password",
    title: "Melihat password terbaru",
    summary: "Perbarui akun lalu lihat credential terbaru secara aman.",
    duration: "11 detik",
    video: "/tutorials/password-terbaru.webm",
    poster: "/tutorials/password-terbaru.png",
    action: "/reseller-v2/accounts",
    actionLabel: "Buka Akun Saya",
    result: "Password yang ditampilkan mengikuti data akun terbaru yang tersedia di sistem.",
    icon: PackageCheck,
    steps: [
      "Buka Akun Saya dan tekan Perbarui untuk mengambil data akun terbaru.",
      "Cari produk atau identitas akun, lalu buka Detail Akun.",
      "Tekan Tampilkan pada password untuk melihat credential terbaru.",
      "Gunakan tombol Salin. Credential akan kembali dimasking secara otomatis.",
    ],
  },
];

export default function ResellerV2GuidesPage() {
  const [activeId, setActiveId] = useState<GuideId>("purchase");
  const activeGuide = guides.find((guide) => guide.id === activeId) || guides[0];
  const ActiveIcon = activeGuide.icon;

  return (
    <ResellerShell
      title="Panduan"
      description="Pelajari alur utama Kavya melalui video singkat dan langkah yang mudah diikuti."
    >
      <section className="reseller-guide-intro" aria-labelledby="guide-intro-title">
        <div className="reseller-guide-intro-icon" aria-hidden="true">
          <BookOpenCheck size={22} />
        </div>
        <div>
          <p>Pusat bantuan reseller</p>
          <h2 id="guide-intro-title">Mulai dari kebutuhan Anda</h2>
          <span>
            Direkam dari panel akun kya. Password, PIN, kode, dan identitas sensitif telah dimasking di dalam video.
          </span>
        </div>
      </section>

      <div className="reseller-guide-layout">
        <nav className="reseller-guide-selector" aria-label="Pilih video panduan">
          {guides.map((guide, index) => {
            const Icon = guide.icon;
            const active = guide.id === activeGuide.id;
            return (
              <button
                type="button"
                key={guide.id}
                className={active ? "is-active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveId(guide.id)}
              >
                <span className="reseller-guide-selector-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="reseller-guide-selector-icon"><Icon size={18} /></span>
                <span className="reseller-guide-selector-copy">
                  <strong>{guide.title}</strong>
                  <small>{guide.summary}</small>
                </span>
                <ChevronRight size={17} />
              </button>
            );
          })}
        </nav>

        <article className="reseller-guide-player-panel">
          <header>
            <div className="reseller-guide-player-title">
              <span><ActiveIcon size={18} /></span>
              <div>
                <p>Video tutorial</p>
                <h2>{activeGuide.title}</h2>
              </div>
            </div>
            <span className="reseller-guide-duration"><Clock3 size={14} /> {activeGuide.duration}</span>
          </header>

          <div className="reseller-guide-video-wrap">
            <video
              key={activeGuide.id}
              controls
              preload="metadata"
              poster={activeGuide.poster}
              aria-label={`Video panduan ${activeGuide.title}`}
            >
              <source src={activeGuide.video} type="video/webm" />
              Browser Anda belum mendukung pemutar video ini.
            </video>
            <span className="reseller-guide-demo-label"><Play size={12} /> Rekaman nyata</span>
          </div>

          <div className="reseller-guide-detail">
            <div>
              <h3>Langkah-langkah</h3>
              <ol>
                {activeGuide.steps.map((step, index) => (
                  <li key={step}>
                    <span>{index + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>
            </div>
            <aside>
              <span><Check size={15} /> Hasil akhir</span>
              <p>{activeGuide.result}</p>
              <Link to={activeGuide.action}>
                {activeGuide.actionLabel}
                <ChevronRight size={16} />
              </Link>
            </aside>
          </div>
        </article>
      </div>
    </ResellerShell>
  );
}
