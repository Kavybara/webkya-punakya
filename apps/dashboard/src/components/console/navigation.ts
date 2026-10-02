import type { AppShellNavGroup, AppShellNavItem } from "../ui";
import {
  Boxes,
  CalendarDays,
  CircleGauge,
  HeartPulse,
  KeyRound,
  Layers3,
  ListChecks,
  MessageCircle,
  PackageCheck,
  PlugZap,
  ReceiptText,
  ShieldCheck,
  Users,
} from "lucide-react";

export type ConsoleNavigationItem = AppShellNavItem;
export type ConsoleNavigationGroup = AppShellNavGroup;

export const consoleNavigation: ConsoleNavigationGroup[] = [
  {
    label: "Ringkasan",
    items: [{ label: "Overview", path: "/owner-v2", icon: CircleGauge, end: true }],
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
      { label: "Akses & Kode", path: "/owner-v2/account-access", icon: KeyRound },
      { label: "Garansi", path: "/owner-v2/warranty", icon: ShieldCheck },
      { label: "Reseller", path: "/owner-v2/resellers", icon: Users },
    ],
  },
  {
    label: "Operasional",
    items: [
      { label: "Antrean Kerja", path: "/owner-v2/operations", icon: ListChecks },
      { label: "Health Center", path: "/owner-v2/health", icon: HeartPulse },
      { label: "WhatsApp Bot", path: "/owner-v2/whatsapp", icon: MessageCircle },
      { label: "Rental", path: "/owner-v2/rental", icon: CalendarDays },
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

/**
 * What a phone can reach without opening the menu.
 *
 * The reseller has had a bottom bar and the owner has not, which meant an
 * owner on a phone opened a drawer for every single thing. These five are the
 * destinations the overview itself points at, so the bar carries the paths a
 * reader is already walking.
 */
export const consoleBottomNavigation: AppShellNavItem[] = [
  { label: "Overview", shortLabel: "Beranda", path: "/owner-v2", icon: CircleGauge, end: true },
  { label: "Pesanan & QRIS", shortLabel: "Pesanan", path: "/owner-v2/orders", icon: ReceiptText },
  { label: "Stok Akun", shortLabel: "Stok", path: "/owner-v2/stock", icon: Boxes },
  { label: "Manajemen Akun", shortLabel: "Akun", path: "/owner-v2/accounts", icon: PackageCheck },
  { label: "Antrean Kerja", shortLabel: "Antrean", path: "/owner-v2/operations", icon: ListChecks },
];

export const ownerConsoleAuditMap = [
  { existing: "/dashboard", group: "Ringkasan", apis: ["/orders", "/stock", "/resellers", "/activities", "/system/status"], risk: "Memuat beberapa dataset penuh; Console menghapus activity feed dari Overview." },
  { existing: "/dashboard/search", group: "Global search", apis: ["/owner-search"], risk: "Hasil dapat memuat identitas akun; endpoint owner-only dan tidak mengembalikan password." },
  { existing: "/dashboard/orders", group: "Penjualan", apis: ["/orders", "/orders/:id"], risk: "Detail fulfillment dapat berisi kredensial; Console memasking kredensial secara default." },
  { existing: "/dashboard/products", group: "Katalog", apis: ["/products"], risk: "Aksi tulis mengubah katalog live dan selalu memakai konfirmasi." },
  { existing: "/dashboard/stock", group: "Katalog", apis: ["/stock", "/products", "/resellers", "/google-sheets/status"], risk: "Respons owner berisi password/link stok; tidak dirender oleh Console." },
  { existing: "/dashboard/accounts", group: "Pelanggan", apis: ["/accounts", "/products", "/resellers", "/stock"], risk: "Password, OTP, PIN, dan reset link sangat sensitif; tidak dipanggil dari Overview." },
  { existing: "/reseller-v2/account-access", group: "Pelanggan", apis: ["/owner/account-access/accounts", "/owner/account-access/lookup"], risk: "Kode dan link akses sensitif; endpoint khusus Owner, hasil tidak disimpan di client atau Activity Log." },
  { existing: "/reseller-v2/warranty", group: "Pelanggan", apis: ["/warranty-claims", "/warranty-claims/:id/replacement-candidates"], risk: "Penggantian hanya boleh memilih stok satu pool dan credential tidak dikirim melalui notifikasi." },
  { existing: "/dashboard/resellers", group: "Pelanggan", apis: ["/resellers", "/orders", "/activities", "/resellers/deposit-requests"], risk: "PII reseller dan mutasi saldo memerlukan otorisasi owner dan konfirmasi." },
  { existing: "/dashboard/operations", group: "Operasional", apis: ["/system/status", "/health", "/maintenance"], risk: "Health Center hanya membaca status teknis dan tidak menjalankan repair otomatis." },
  { existing: "/dashboard/whatsapp", group: "Operasional", apis: ["/whatsapp/rentals", "/whatsapp/status"], risk: "Group JID dan data sewa hanya tersedia untuk owner." },
  { existing: "/dashboard/activities", group: "Sistem", apis: ["/activities"], risk: "Log dapat memuat identitas pelanggan dan tidak ditampilkan di Overview." },
  { existing: "/dashboard/settings", group: "Sistem", apis: ["/owner-settings", "/system/status"], risk: "Token dan credential integrasi tidak pernah dirender oleh Console." },
] as const;
