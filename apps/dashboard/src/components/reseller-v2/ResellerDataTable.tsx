import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { ResellerEmptyState, ResellerErrorState, ResellerLoadingSkeleton } from "./ResellerResource";

export type ResellerColumn<Row> = { id: string; header: string; value: (row: Row) => string | number; cell?: (row: Row) => ReactNode };

export function ResellerDataTable<Row>({ rows, columns, rowKey, renderCard, loading, error, pageSize = 10 }: { rows: Row[]; columns: Array<ResellerColumn<Row>>; rowKey: (row: Row) => string; renderCard: (row: Row) => ReactNode; loading?: boolean; error?: string; pageSize?: number }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? rows.filter((row) => columns.some((column) => String(column.value(row)).toLowerCase().includes(needle))) : rows;
  }, [columns, query, rows]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  return <div className="reseller-v2-data"><label className="reseller-v2-data-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Cari data..." /></label>{loading ? <ResellerLoadingSkeleton lines={5} /> : error ? <ResellerErrorState message={error} /> : !visible.length ? <ResellerEmptyState title="Belum ada data" description="Data yang sesuai akan tampil di sini." /> : <><div className="reseller-v2-table-scroll"><table><thead><tr>{columns.map((column) => <th key={column.id}>{column.header}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.id}>{column.cell ? column.cell(row) : column.value(row)}</td>)}</tr>)}</tbody></table></div><div className="reseller-v2-card-list">{visible.map((row) => <article key={rowKey(row)}>{renderCard(row)}</article>)}</div><footer><span>{filtered.length} data</span><div><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Halaman sebelumnya"><ChevronLeft size={16} /></button><span>{safePage} / {pageCount}</span><button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Halaman berikutnya"><ChevronRight size={16} /></button></div></footer></> }</div>;
}
