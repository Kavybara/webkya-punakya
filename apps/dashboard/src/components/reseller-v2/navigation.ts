import type { LucideIcon } from "lucide-react";
import {
  BadgeHelp,
  BookOpenCheck,
  Grid2X2,
  KeyRound,
  LayoutDashboard,
  PackageCheck,
  ReceiptText,
} from "lucide-react";

export type ResellerNavigationItem = {
  label: string;
  shortLabel: string;
  path: string;
  legacyPath?: string;
  icon: LucideIcon;
};

export type ResellerNavigationGroup = {
  label: string;
  items: ResellerNavigationItem[];
};

export const resellerNavigation: ResellerNavigationGroup[] = [
  {
    label: "Beranda",
    items: [
      {
        label: "Ringkasan",
        shortLabel: "Ringkasan",
        path: "/reseller-v2/ringkasan",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "Transaksi",
    items: [
      {
        label: "Katalog",
        shortLabel: "Katalog",
        path: "/reseller-v2/catalog",
        legacyPath: "/reseller/catalog",
        icon: Grid2X2,
      },
      {
        label: "Pesanan",
        shortLabel: "Pesanan",
        path: "/reseller-v2/orders",
        legacyPath: "/reseller/history",
        icon: ReceiptText,
      },
    ],
  },
  {
    label: "Akun",
    items: [
      {
        label: "Akun Saya",
        shortLabel: "Akun",
        path: "/reseller-v2/accounts",
        legacyPath: "/reseller/manage-account",
        icon: PackageCheck,
      },
      {
        label: "Akses & Kode",
        shortLabel: "Akses",
        path: "/reseller-v2/access",
        legacyPath: "/reseller/accounts",
        icon: KeyRound,
      },
    ],
  },
  {
    label: "Bantuan",
    items: [
      {
        label: "Panduan",
        shortLabel: "Panduan",
        path: "/reseller-v2/guides",
        icon: BookOpenCheck,
      },
      {
        label: "Garansi",
        shortLabel: "Bantuan",
        path: "/reseller-v2/warranty",
        legacyPath: "/reseller/warranty",
        icon: BadgeHelp,
      },
    ],
  },
];

export const resellerAuditMap = [
  {
    existing: "/reseller",
    next: "/reseller-v2/ringkasan",
    group: "Ringkasan",
    apis: ["/resellers", "/orders", "/accounts?view=overview"],
    sensitivity: "Saldo, identitas akun, dan histori transaksi milik reseller.",
    risk: "Endpoint wajib tetap membatasi data berdasarkan sesi reseller.",
  },
  {
    existing: "/reseller/catalog",
    next: "/reseller-v2/catalog",
    group: "Transaksi",
    apis: ["/public/catalog", "/resellers"],
    sensitivity: "Harga reseller dan saldo sendiri.",
    risk: "Adapter sementara tetap memakai UI katalog lama.",
  },
  {
    existing: "/reseller/history",
    next: "/reseller-v2/orders",
    group: "Transaksi",
    apis: ["/orders", "/payments/:ref"],
    sensitivity: "Order ID, pembayaran, dan customer milik reseller.",
    risk: "Adapter sementara; tab status belum dipindahkan.",
  },
  {
    existing: "/reseller/manage-account",
    next: "/reseller-v2/accounts",
    group: "Akun",
    apis: ["/accounts?view=full"],
    sensitivity: "Identitas, kredensial, profil, PIN, dan masa aktif akun.",
    risk: "Credential dimasking di client dan kepemilikan tetap wajib diverifikasi server.",
  },
  {
    existing: "/reseller/accounts",
    next: "/reseller-v2/access",
    group: "Akun",
    apis: ["/accounts?view=light", "/account-access/lookup"],
    sensitivity: "Kode akses, link, dan identitas akun.",
    risk: "Lookup wajib tetap diverifikasi server-side.",
  },
  {
    existing: "-",
    next: "/reseller-v2/guides",
    group: "Bantuan",
    apis: [],
    sensitivity: "Tidak memuat data akun atau transaksi reseller.",
    risk: "Rekaman panel produksi wajib memasking credential dan identitas sensitif sebelum dipublikasikan.",
  },
  {
    existing: "/reseller/warranty",
    next: "/reseller-v2/warranty",
    group: "Bantuan",
    apis: ["/accounts?view=light", "/health"],
    sensitivity: "Identitas akun dan detail kendala.",
    risk: "Saat ini klaim membuka WhatsApp dan belum berupa tiket internal.",
  },
] as const;
