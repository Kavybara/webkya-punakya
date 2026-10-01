import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorState, LoadingState } from "../../../components/ui";
import { formatRupiah, formatRupiahCompact } from "../../../lib/format";
import type { RevenuePoint } from "./analytics";

/**
 * Seven days of paid revenue.
 *
 * The zero days are the point of the chart. An earlier version grouped only the
 * days that had orders, so a quiet Tuesday was simply absent and the line
 * jumped Tuesday to Wednesday -- which reads as growth. The series is built
 * over the calendar instead (see `buildRevenueSeries`), so a day with no sales
 * is drawn as a dip, which is what it is.
 */
export function RevenueChart({ data, loading, error, onRetry }: { data: RevenuePoint[]; loading: boolean; error?: string; onRetry: () => void }) {
  if (loading) return <LoadingState label="Memuat grafik pendapatan" />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  return (
    <div className="console-chart-wrap" aria-label="Grafik pendapatan tujuh hari">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 0 }}>
          {/* Every colour is a token, including the two that used to be hex. Recharts hands these straight to SVG `stroke`/`stopColor`, which browsers parse as CSS values -- so `var()` resolves, and the chart follows the palette instead of pinning itself to the violet and the zinc it was written against. The tick fill was `#71717a`, which was never any of the app's greys. */}
          <defs>
            <linearGradient id="consoleRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-violet)" stopOpacity={0.34} />
              <stop offset="100%" stopColor="var(--accent-violet)" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickFormatter={(value) => formatRupiahCompact(Number(value))} width={58} />
          <Tooltip formatter={(value) => formatRupiah(Number(value))} contentStyle={{ background: "var(--surface-glass-strong)", border: "1px solid var(--border-strong)", borderRadius: 10, color: "var(--text-primary)" }} labelStyle={{ color: "var(--text-secondary)" }} />
          {/* Straight segments, not a spline. This was `type="monotone"`, and
              monotone interpolation overshoots between points: with one strong
              day in the week the curve bulged visibly above the Rp 220 rb
              gridline, so the peak read as roughly Rp 230k on a day that
              earned Rp 220k. A smoothed curve also implies revenue was
              accruing between the points, which on a real-money dashboard is a
              number the owner cannot verify. `linear` puts the drawn height at
              each day exactly on that day's value, which is the only claim this
              chart is allowed to make. */}
          <Area type="linear" dataKey="revenue" stroke="var(--accent-violet)" strokeWidth={2.2} fill="url(#consoleRevenueFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
