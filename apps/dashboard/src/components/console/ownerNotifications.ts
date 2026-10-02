import type {
  OperationIssue,
  OperationsCenterResult,
  WarrantyClaim,
  WhatsappRental,
} from "../../lib/api";

export type OwnerNotification = {
  id: string;
  kind: "operation" | "warranty" | "rental" | "connection";
  severity: "danger" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
  createdAt: string;
};

function notificationTime(value = "") {
  const parsed = new Date(String(value).replace(" ", "T")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function issueSeverity(issue: OperationIssue): OwnerNotification["severity"] {
  if (issue.severity === "high") return "danger";
  if (issue.severity === "medium") return "warning";
  return "info";
}

function safeHref(href = "") {
  if (!href) return "/owner-v2/operations";
  return href.startsWith("/owner-v2/") ? href : "/owner-v2/operations";
}

export function buildOwnerNotifications({
  operations,
  warranties = [],
  rentals = [],
}: {
  operations?: OperationsCenterResult | null;
  warranties?: WarrantyClaim[];
  rentals?: WhatsappRental[];
}) {
  const notifications: OwnerNotification[] = [];

  for (const issue of operations?.findings || operations?.manual?.items || []) {
    notifications.push({
      id: `operation:${issue.id}`,
      kind: "operation",
      severity: issueSeverity(issue),
      title: issue.title || "Operasional perlu diperiksa",
      detail: issue.detail || "Buka Health Center untuk melihat detail.",
      href: safeHref(issue.href),
      createdAt: issue.createdAt || operations?.generatedAt || "",
    });
  }

  if (operations?.whatsapp && !operations.whatsapp.connection?.connected) {
    notifications.push({
      id: "connection:whatsapp",
      kind: "connection",
      severity: "danger",
      title: "WhatsApp terputus",
      detail: operations.whatsapp.connection?.error || operations.whatsapp.connection?.state || "Bot tidak terhubung ke WhatsApp.",
      href: "/owner-v2/health",
      createdAt: operations.generatedAt || "",
    });
  }

  const activeWarrantyStatuses = new Set(["submitted", "reviewing", "waiting_evidence"]);
  for (const claim of warranties) {
    if (!activeWarrantyStatuses.has(String(claim.status || "").toLowerCase())) continue;
    notifications.push({
      id: `warranty:${claim.id}`,
      kind: "warranty",
      severity: claim.status === "waiting_evidence" ? "warning" : "danger",
      title: "Garansi perlu diproses",
      detail: `${claim.product || "Produk"} / ${claim.resellerName || claim.orderId || "reseller"}`,
      href: "/owner-v2/warranty",
      createdAt: claim.updatedAt || claim.createdAt || "",
    });
  }

  for (const rental of rentals) {
    const daysLeft = Number(rental.daysLeft);
    const expired = rental.status === "expired" || (Number.isFinite(daysLeft) && daysLeft <= 0);
    if (!expired && (rental.status !== "active" || !Number.isFinite(daysLeft) || daysLeft > 5)) continue;
    notifications.push({
      id: `rental:${rental.id}:${expired ? "expired" : daysLeft}`,
      kind: "rental",
      severity: expired ? "danger" : "warning",
      title: expired ? "Rental sudah berakhir" : "Rental hampir berakhir",
      detail: `${rental.name || "Grup WhatsApp"} / ${expired ? "0 hari tersisa" : `${daysLeft} hari tersisa`}`,
      href: "/owner-v2/rental",
      createdAt: rental.endsAt || rental.startedAt || "",
    });
  }

  const unique = new Map<string, OwnerNotification>();
  for (const notification of notifications) unique.set(notification.id, notification);
  const severityRank = { danger: 3, warning: 2, info: 1 };
  return [...unique.values()]
    .sort((left, right) => severityRank[right.severity] - severityRank[left.severity]
      || notificationTime(right.createdAt) - notificationTime(left.createdAt))
    .slice(0, 30);
}
