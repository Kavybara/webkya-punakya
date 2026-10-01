import { ArrowUpRight, Cloud, CreditCard, Server, Sheet, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, ErrorState, LoadingState, Notice } from "../../../components/ui";
import type { ServiceRow } from "./analytics";

const ICONS = {
  whatsapp: Wifi,
  sheets: Sheet,
  pakasir: CreditCard,
  vps: Server,
  tunnel: Cloud,
} as const;

const STATE_TONE = { ok: "success", warning: "warning", down: "danger" } as const;
const STATE_LABEL = { ok: "Aktif", warning: "Periksa", down: "Offline" } as const;

/**
 * Service health, with each row linking to the page that fixes it.
 *
 * Three of these rows are stricter than they used to be. Google Sheets is
 * reported down when the last sync *attempt* is newer than the last successful
 * sync, because a sheet whose last run failed looks healthy to every check
 * that only asks "when did we last write successfully" -- that is the failure
 * mode which hides best, since each individual screen downstream keeps
 * reporting the last known good state. Pakasir is shown as a row at all, since
 * it is the payment gateway and its absence was previously invisible here.
 *
 * The VPS row carries the PM2 restart count, which is the cheapest crash-loop
 * detector the server offers and which nothing else in the app reads. A count
 * of three or more is a process that has been recovering on its own, and the
 * owner should know that before it stops recovering.
 */
export function ServiceHealth({ rows, warnings, loading, error, onRetry }: { rows: ServiceRow[]; warnings: string[]; loading: boolean; error?: string; onRetry: () => void }) {
  if (loading) return <LoadingState label="Memuat status sistem" />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!rows.length) return <ErrorState message="Status sistem belum tersedia." onRetry={onRetry} />;

  const degraded = rows.filter((row) => row.state !== "ok");

  return (
    <>
      <div className="console-system-list">
        {rows.map((row) => {
          const Icon = ICONS[row.id as keyof typeof ICONS] ?? Server;
          return (
            <Link key={row.id} to={row.path} className="console-system-row is-link">
              <span className="console-system-icon">
                <Icon size={17} />
              </span>
              <span>
                <strong>{row.label}</strong>
                <small>{row.detail}</small>
              </span>
              <Badge tone={STATE_TONE[row.state]}>{STATE_LABEL[row.state]}</Badge>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          );
        })}
      </div>
      {warnings.length ? (
        <Notice tone="warning">
          <ul className="console-warning-list">
            {warnings.slice(0, 3).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {degraded.length ? (
        <p className="console-system-summary">{degraded.length} layanan perlu diperiksa.</p>
      ) : (
        <p className="console-system-summary is-clear">Semua layanan normal.</p>
      )}
    </>
  );
}
