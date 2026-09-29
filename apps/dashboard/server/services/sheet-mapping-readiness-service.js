const PROTECTED_OPERATIONAL_HEADERS = new Set([
  "EXPIRED",
  "NOMOR WA",
  "KONDISI AKUN",
]);

function normalizeHeader(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function columnFromRange(range = "") {
  const match = String(range || "").match(/!([A-Z]+)\d+(?::[A-Z]+\d+)?$/i);
  return match?.[1]?.toUpperCase() || "";
}

export function summarizeSheetMappingPreview(preview = {}, context = {}) {
  if (!preview.ok) {
    return {
      ...context,
      status: "UNRESOLVED",
      reason: preview.reason || "preview_failed",
      sheetName: preview.sheetName || "",
      rowNumber: Number(preview.rowNumber || 0),
      updateColumns: [],
      protectedWrites: [],
    };
  }

  const headersByColumn = new Map(
    (preview.columns || []).map((column) => [
      Number(column.index || 0),
      normalizeHeader(column.header),
    ]),
  );
  const updateColumns = (preview.updates || []).map((update) => columnFromRange(update.range)).filter(Boolean);
  const protectedWrites = (preview.updates || []).flatMap((update) => {
    const column = columnFromRange(update.range);
    const index = (column || "").split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
    const header = headersByColumn.get(index) || "";
    return PROTECTED_OPERATIONAL_HEADERS.has(header) ? [{ column, header }] : [];
  });

  return {
    ...context,
    status: protectedWrites.length ? "BLOCKED_PROTECTED_COLUMN" : "READY",
    reason: protectedWrites.length ? "protected_operational_column" : "",
    sheetName: preview.sheetName || "",
    rowNumber: Number(preview.rowNumber || 0),
    pool: preview.schema?.key || preview.target?.accountType || "",
    updateColumns,
    protectedWrites,
  };
}
