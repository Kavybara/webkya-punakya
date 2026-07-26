import {
  CANVA_POOL_HEADERS,
  CANVA_SHEET_NAME,
  CANVA_USAGE_HEADERS,
  SHEET_HEADERS,
} from "./schema.js";

export function createGoogleSheetsTemplateService(deps) {
  const {
    batchUpdate,
    canvaPool,
    ensureOrderHistorySheet,
    ensureSheetExists,
    findCanvaPoolLocation,
    getSheetId,
    getSheetProperties,
    googleSheetsConfigured,
    googleSheetsSettings,
    normalize,
    normalizeLower,
    poolHeaders,
    POOLS,
    quoteSheetName,
    readSheetValuesByName,
    SHEET_CONFIGS,
    updateValues,
    a1Column,
  } = deps;

  async function ensureNetflixSheetsTemplate(db) {
    if (!googleSheetsConfigured(db)) {
      const error = new Error("Google Sheets belum dikonfigurasi");
      error.status = 400;
      throw error;
    }
    const { sheetName } = googleSheetsSettings(db);
    await ensureSheetExists(db, sheetName);
    await updateValues(db, [
      { range: `${quoteSheetName(sheetName)}!A1`, values: [[NETFLIX_SHEETS_SNK]] },
      { range: `${quoteSheetName(sheetName)}!A11:L12`, values: [[POOLS.NETFLIX_SHARED.label, "", "", "", "", "", "", "", "", "", "", ""], SHEET_HEADERS] },
      { range: `${quoteSheetName(sheetName)}!N11:Y12`, values: [[POOLS.NETFLIX_2U.label, "", "", "", "", "", "", "", "", "", "", ""], SHEET_HEADERS] },
    ]);
    const sheetId = await getSheetId(db, sheetName);
    if (sheetId !== null) {
      await batchUpdate(db, [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 12 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 12 },
            cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
            fields: "userEnteredFormat.wrapStrategy",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 10, endRowIndex: 12 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
            fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
          },
        },
      ]);
    }
    return { ok: true, sheetName, frozenRowCount: 12 };
  }

  async function ensurePoolSheetsTemplate(db, config, title) {
    if (!googleSheetsConfigured(db)) {
      const error = new Error("Google Sheets belum dikonfigurasi");
      error.status = 400;
      throw error;
    }
    const sheetName = config.sheetName(db);
    const sheetId = await ensureSheetExists(db, sheetName);
    const requiredColumns = Math.max(...config.pools.map((pool) => pool.startColumn + poolHeaders(pool).length), SHEET_HEADERS.length);
    if (sheetId !== null) {
      const currentColumns = Number((await getSheetProperties(db, sheetName))?.gridProperties?.columnCount || 0);
      if (currentColumns < requiredColumns) {
        await batchUpdate(db, [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { columnCount: requiredColumns } },
              fields: "gridProperties.columnCount",
            },
          },
        ]).catch(() => null);
      }
    }
    const data = [
      { range: `${quoteSheetName(sheetName)}!A1`, values: [[title || `${config.summaryName.toUpperCase()} STOCK POOL`]] },
    ];
    for (const pool of config.pools) {
      const headers = poolHeaders(pool);
      const start = a1Column(pool.startColumn);
      const end = a1Column(pool.startColumn + headers.length - 1);
      data.push({
        range: `${quoteSheetName(sheetName)}!${start}11:${end}12`,
        values: [[pool.label, ...Array(headers.length - 1).fill("")], headers],
      });
    }
    await updateValues(db, data);
    if (sheetId !== null) {
      await batchUpdate(db, [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 12 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 12 },
            cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
            fields: "userEnteredFormat.wrapStrategy",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 10, endRowIndex: 12 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
            fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
          },
        },
      ]);
    }
    return { ok: true, sheetName, frozenRowCount: 12, pools: config.pools.map((pool) => pool.key) };
  }

  async function ensureViuSheetsTemplate(db) {
    return ensurePoolSheetsTemplate(db, SHEET_CONFIGS.viu, "VIU STOCK POOL");
  }

  async function ensureVidioSheetsTemplate(db) {
    return ensurePoolSheetsTemplate(db, SHEET_CONFIGS.vidio, "VIDIO PLATINUM STOCK POOL");
  }

  async function ensureCanvaSheetsTemplate(db) {
    if (!googleSheetsConfigured(db)) {
      const error = new Error("Google Sheets belum dikonfigurasi");
      error.status = 400;
      throw error;
    }
    const sheetId = await ensureSheetExists(db, CANVA_SHEET_NAME);
    const pool = canvaPool(db);
    const values = await readSheetValuesByName(db, CANVA_SHEET_NAME).catch(() => []);
    const isBlankRow = (row = []) => !row.some((cell) => normalize(cell));
    const hasCanvaPoolMarker = values.some((row) => (row || []).some((cell) => {
      const text = normalizeLower(cell);
      return text === "canva pool" || (text.includes("pool") && text.includes("canva"));
    }));
    const hasCanvaUsageMarker = values.some((row) => (row || []).some((cell) => {
      const text = normalizeLower(cell);
      return text === "canva usage" || (text.includes("usage") && text.includes("canva"));
    }));
    const poolLocation = findCanvaPoolLocation(values);
    const poolHeader = values[poolLocation.headerIndex] || [];
    const poolData = values[poolLocation.dataIndex] || [];
    const canvaUsageMarkerIndex = values.findIndex((row) => (row || []).some((cell) => {
      const text = normalizeLower(cell);
      return text === "canva usage" || (text.includes("usage") && text.includes("canva"));
    }));
    const usageHeaderIndex = canvaUsageMarkerIndex >= 0 ? canvaUsageMarkerIndex + 1 : 7;
    const usageHeader = values[usageHeaderIndex] || [];
    const writes = [];

    if (!hasCanvaPoolMarker && !normalize(values[0]?.[0])) {
      writes.push({ range: `${quoteSheetName(CANVA_SHEET_NAME)}!A1`, values: [["CANVA POOL"]] });
    }
    if (isBlankRow(poolHeader)) {
      writes.push({ range: `${quoteSheetName(CANVA_SHEET_NAME)}!A${poolLocation.headerIndex + 1}:F${poolLocation.headerIndex + 1}`, values: [CANVA_POOL_HEADERS] });
    }
    if (isBlankRow(poolData)) {
      writes.push({
        range: `${quoteSheetName(CANVA_SHEET_NAME)}!A${poolLocation.dataIndex + 1}:F${poolLocation.dataIndex + 1}`,
        values: [[pool.link || "", pool.quota || 0, "", "", pool.status || "active", pool.notes || ""]],
      });
    }
    if (!hasCanvaUsageMarker && !normalize(values[6]?.[0])) {
      writes.push({ range: `${quoteSheetName(CANVA_SHEET_NAME)}!A7`, values: [["CANVA USAGE"]] });
    }
    if (isBlankRow(usageHeader)) {
      writes.push({ range: `${quoteSheetName(CANVA_SHEET_NAME)}!A${usageHeaderIndex + 1}:H${usageHeaderIndex + 1}`, values: [CANVA_USAGE_HEADERS] });
    }
    if (writes.length) await updateValues(db, writes);
    if (sheetId !== null) {
      await batchUpdate(db, [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 8 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 8 },
            cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
            fields: "userEnteredFormat.wrapStrategy",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 2, endRowIndex: 4 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
            fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 6, endRowIndex: 8 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
            fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
          },
        },
      ]);
    }
    return { ok: true, sheetName: CANVA_SHEET_NAME, frozenRowCount: 8 };
  }

  async function ensureGoogleSheetsTemplate(db) {
    const netflix = await ensureNetflixSheetsTemplate(db);
    const viu = await ensureViuSheetsTemplate(db);
    const vidio = await ensureVidioSheetsTemplate(db);
    const canva = await ensureCanvaSheetsTemplate(db);
    const orderHistory = await ensureOrderHistorySheet(db);
    return { ok: true, netflix, viu, vidio, canva, orderHistory };
  }

  return {
    ensureCanvaSheetsTemplate,
    ensureGoogleSheetsTemplate,
    ensureNetflixSheetsTemplate,
    ensureVidioSheetsTemplate,
    ensureViuSheetsTemplate,
  };
}
