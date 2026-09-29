import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, Search } from "lucide-react";

export type ConsoleColumn<Row> = {
  id: string;
  header: string;
  value: (row: Row) => string | number;
  cell?: (row: Row) => ReactNode;
  sortable?: boolean;
  hideOnMobile?: boolean;
};

export type ConsoleFilter<Row> = {
  id: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  value: (row: Row) => string;
};

export function ConsoleDataTable<Row>({
  rows,
  columns,
  rowKey,
  filters = [],
  loading = false,
  error = "",
  emptyText = "Belum ada data.",
  initialPageSize = 6,
  bulkAction,
}: {
  rows: Row[];
  columns: Array<ConsoleColumn<Row>>;
  rowKey: (row: Row) => string;
  filters?: Array<ConsoleFilter<Row>>;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  initialPageSize?: number;
  bulkAction?: {
    label: string;
    hint?: string;
    busy?: boolean;
    danger?: boolean;
    onClick: (rows: Row[], clearSelection: () => void) => void;
  };
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set(columns.map((column) => column.id)));
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const selectable = Boolean(bulkAction);

  const processedRows = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (wanted && !columns.some((column) => String(column.value(row) ?? "").toLowerCase().includes(wanted))) return false;
      return filters.every((filter) => !filterValues[filter.id] || filter.value(row) === filterValues[filter.id]);
    });
    if (!sort) return filtered;
    const column = columns.find((item) => item.id === sort.id);
    if (!column) return filtered;
    return [...filtered].sort((left, right) => {
      const leftValue = column.value(left);
      const rightValue = column.value(right);
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), "id", { numeric: true });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [columns, filterValues, filters, query, rows, sort]);

  const totalPages = Math.max(1, Math.ceil(processedRows.length / pageSize));
  const pageRows = processedRows.slice((page - 1) * pageSize, page * pageSize);
  const activeColumns = columns.filter((column) => visibleColumns.has(column.id));
  const pageKeys = pageRows.map(rowKey);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((key) => selected.has(key));
  const selectedRows = rows.filter((row) => selected.has(rowKey(row)));

  useEffect(() => setPage(1), [filterValues, pageSize, query, sort]);
  useEffect(() => setPage((current) => Math.min(current, totalPages)), [totalPages]);
  useEffect(() => {
    if (!selectable) setSelected(new Set());
  }, [selectable]);
  useEffect(() => {
    const liveKeys = new Set(rows.map(rowKey));
    setSelected((current) => {
      const next = new Set([...current].filter((key) => liveKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [rowKey, rows]);

  function toggleSort(column: ConsoleColumn<Row>) {
    if (!column.sortable) return;
    setSort((current) => current?.id === column.id
      ? { id: column.id, direction: current.direction === "asc" ? "desc" : "asc" }
      : { id: column.id, direction: "asc" });
  }

  return (
    <div className="console-table-shell">
      <div className="console-table-toolbar">
        <label className="console-table-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari pada tabel..." aria-label="Cari pada tabel" />
        </label>
        <div className="console-table-tools">
          {filters.map((filter) => (
            <label key={filter.id} className="console-select-wrap">
              <span className="sr-only">{filter.label}</span>
              <select value={filterValues[filter.id] || ""} onChange={(event) => setFilterValues((current) => ({ ...current, [filter.id]: event.target.value }))}>
                <option value="">{filter.label}: Semua</option>
                {filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </label>
          ))}
          <div className="console-column-menu-wrap">
            <button type="button" className="console-tool-button" onClick={() => setColumnMenuOpen((value) => !value)} aria-expanded={columnMenuOpen}>
              <Columns3 size={16} /> Kolom
            </button>
            {columnMenuOpen ? (
              <div className="console-column-menu">
                {columns.map((column) => (
                  <button
                    key={column.id}
                    type="button"
                    onClick={() => setVisibleColumns((current) => {
                      const next = new Set(current);
                      if (next.has(column.id) && next.size > 1) next.delete(column.id);
                      else next.add(column.id);
                      return next;
                    })}
                  >
                    <span className={visibleColumns.has(column.id) ? "is-checked" : ""}>{visibleColumns.has(column.id) ? <Check size={12} /> : null}</span>
                    {column.header}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {selectable && selected.size ? (
        <div className="console-selection-bar">
          <strong>{selected.size} baris dipilih</strong>
          <span>{bulkAction?.hint}</span>
          <div>
            {bulkAction ? (
              <button
                type="button"
                className={bulkAction.danger ? "is-danger" : ""}
                disabled={bulkAction.busy}
                onClick={() => bulkAction.onClick(selectedRows, () => setSelected(new Set()))}
              >
                {bulkAction.busy ? "Memproses..." : bulkAction.label}
              </button>
            ) : null}
            <button type="button" onClick={() => setSelected(new Set())}>Batalkan pilihan</button>
          </div>
        </div>
      ) : null}

      <div className="console-table-scroll">
        <table>
          <thead>
            <tr>
              {selectable ? <th className="console-checkbox-cell">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={() => setSelected((current) => {
                    const next = new Set(current);
                    for (const key of pageKeys) allPageSelected ? next.delete(key) : next.add(key);
                    return next;
                  })}
                  aria-label="Pilih semua baris halaman ini"
                />
              </th> : null}
              {activeColumns.map((column) => (
                <th key={column.id} className={column.hideOnMobile ? "console-table-mobile-hide" : ""}>
                  <button type="button" onClick={() => toggleSort(column)} disabled={!column.sortable}>
                    {column.header}
                    {sort?.id === column.id ? <span aria-label={sort.direction === "asc" ? "Urut naik" : "Urut turun"}>{sort.direction === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 5 }, (_, index) => (
              <tr key={index} className="console-table-skeleton-row">
                {selectable ? <td data-label="Pilih"><span /></td> : null}
                {activeColumns.map((column) => <td key={column.id} data-label={column.header}><span /></td>)}
              </tr>
            )) : error ? (
              <tr className="console-table-state-row"><td colSpan={activeColumns.length + (selectable ? 1 : 0)}><div className="console-table-state is-error">{error}</div></td></tr>
            ) : pageRows.length ? pageRows.map((row) => {
              const key = rowKey(row);
              return (
                <tr key={key} className={selected.has(key) ? "is-selected" : ""}>
                  {selectable ? <td className="console-checkbox-cell" data-label="Pilih"><input type="checkbox" checked={selected.has(key)} onChange={() => setSelected((current) => {
                    const next = new Set(current);
                    next.has(key) ? next.delete(key) : next.add(key);
                    return next;
                  })} aria-label={`Pilih baris ${key}`} /></td> : null}
                  {activeColumns.map((column) => <td key={column.id} data-label={column.header} className={column.hideOnMobile ? "console-table-mobile-hide" : ""}>{column.cell ? column.cell(row) : column.value(row)}</td>)}
                </tr>
              );
            }) : (
              <tr className="console-table-state-row"><td colSpan={activeColumns.length + (selectable ? 1 : 0)}><div className="console-table-state">{emptyText}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="console-table-footer">
        <span>{processedRows.length ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, processedRows.length)} dari ${processedRows.length}` : "0 baris"}</span>
        <div>
          <label>
            <span className="sr-only">Baris per halaman</span>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {[5, 10, 20].map((size) => <option key={size} value={size}>{size} / halaman</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} aria-label="Halaman sebelumnya"><ChevronLeft size={17} /></button>
          <span>{page} / {totalPages}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} aria-label="Halaman berikutnya"><ChevronRight size={17} /></button>
        </div>
      </div>
    </div>
  );
}
