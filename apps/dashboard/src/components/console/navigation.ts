import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Boxes,
  CircleGauge,
  Layers3,
  MessageCircle,
  PackageCheck,
  PlugZap,
  ReceiptText,
  Users,
} from "lucide-react";

export type ConsoleNavigationItem = {
  label: string;
  path: string;
  icon: LucideIcon;
};

export type ConsoleNavigationGroup = {
  label: string;
  items: ConsoleNavigationItem[];
};

export const consoleNavigation: ConsoleNavigationGroup[] = [
  {
    label: "Ringkasan",
    items: [{ label: "Overview", path: "/owner-v2", icon: CircleGauge }],
  },
  {
    label: "Penjualan",
    items: [{ label: "Pesanan & QRIS", path: "/owner-v2/orders", icon: ReceiptText }],
  },
  {
    label: "Katalog",
    items: [
      { label: "Produk", path: "/owner-v2/products", icon: Layers3 },
      { label: "Stok Akun", path: "/owner-v2/stock", icon: Boxes },
    ],
  },
  {
    label: "Pelanggan",
    items: [
      { label: "Manajemen Akun", path: "/owner-v2/accounts", icon: PackageCheck },
      { label: "Reseller", path: "/owner-v2/resellers", icon: Users },
    ],
  },
  {
    label: "Operasional",
    items: [
      { label: "Operations Center", path: "/owner-v2/operations", icon: Activity },
      { label: "WhatsApp", path: "/owner-v2/whatsapp", icon: MessageCircle },
    ],
  },
  {
    label: "Sistem",
    items: [
      { label: "Activity Log", path: "/owner-v2/activities", icon: ReceiptText },
      { label: "Status Integrasi", path: "/owner-v2/integrations", icon: PlugZap },
    ],
  },
];

export const ownerConsoleAuditMap = [
  { existing: "/dashboard", group: "Ringkasan", apis: ["/orders", "/stock", "/resellers", "/activities", "/system/status"], risk: "Memuat beberapa dataset penuh; Console menghapus activity feed dari Overview." },
  { existing: "/dashboard/search", group: "Global search", apis: ["/owner-search"], risk: "Hasil dapat memuat identitas akun; endpoint owner-only dan tidak mengembalikan password." },
  { existing: "/dashboard/orders", group: "Penjualan", apis: ["/orders", "/orders/:id"], risk: "Detail fulfillment dapat berisi kredensial; Console memasking kredensial secara default." },
  { existing: "/dashboard/products", group: "Katalog", apis: ["/products"], risk: "Aksi tulis mengubah katalog live dan selalu memakai konfirmasi." },
  { existing: "/dashboard/stock", group: "Katalog", apis: ["/stock", "/products", "/resellers", "/google-sheets/status"], risk: "Respons owner berisi password/link stok; tidak dirender oleh Console." },
  { existing: "/dashboard/accounts", group: "Pelanggan", apis: ["/accounts", "/products", "/resellers", "/stock"], risk: "Password, OTP, PIN, dan reset link sangat sensitif; tidak dipanggil dari Overview." },
  { existing: "/dashboard/resellers", group: "Pelanggan", apis: ["/resellers", "/orders", "/activities", "/resellers/deposit-requests"], risk: "PII reseller dan mutasi saldo memerlukan otorisasi owner dan konfirmasi." },
  { existing: "/dashboard/operations", group: "Operasional", apis: ["/operations/center", "/orders", "/resellers", "/google-sheets/status"], risk: "Repair dan recovery hanya dijalankan setelah konfirmasi eksplisit." },
  { existing: "/dashboard/whatsapp", group: "Operasional", apis: ["/whatsapp/rentals", "/whatsapp/status"], risk: "Group JID dan data sewa hanya tersedia untuk owner." },
  { existing: "/dashboard/activities", group: "Sistem", apis: ["/activities"], risk: "Log dapat memuat identitas pelanggan dan tidak ditampilkan di Overview." },
  { existing: "/dashboard/settings", group: "Sistem", apis: ["/owner-settings", "/system/status"], risk: "Token dan credential integrasi tidak pernah dirender oleh Console." },
] as const;
