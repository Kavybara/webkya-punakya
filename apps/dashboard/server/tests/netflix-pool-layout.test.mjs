import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeNetflixPoolLayout,
} from "../google-sheets.js";
import {
  planStockIdBackfill,
} from "../services/stock-id-backfill-service.js";

function netflixRows({
  firstMarker = "POOL: NETFLIX_1U",
  firstStockId = "STOCK ID",
  secondStockId = "STOCK ID",
  singleStockId = "STOCK ID",
} = {}) {
  const marker = [];
  marker[0] = firstMarker;
  marker[14] = "POOL: NETFLIX_2U";
  marker[28] = "POOL: NETFLIX_SINGLESCREEN";
  const header = [];
  [
    "ACCOUNT & PASSWORD",
    "PROFIL",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "PIN",
    "DEVICE CUSTOMER",
    "SELLER",
    "NOMOR WA",
    "ORDER ID/ID MANUAL",
    "KONDISI AKUN",
    "CATATAN",
  ].forEach((value, index) => {
    header[index] = value;
  });
  header[12] = firstStockId;
  header[13] = "";
  [
    "ACCOUNT",
    "PROFIL",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "PIN",
    "DEVICE CUSTOMER",
    "SELLER",
    "NOMOR WA",
    "ORDER ID/ID MANUAL",
    "KONDISI AKUN",
    "CATATAN",
  ].forEach((value, index) => {
    header[14 + index] = value;
  });
  header[26] = secondStockId;
  header[27] = "";
  [
    "ACCOUNT",
    "PROFIL",
    "TANGGAL",
    "DURASI",
    "EXPIRED",
    "PIN",
    "DEVICE CUSTOMER",
    "SELLER",
    "NOMOR WA",
    "ORDER ID/ID MANUAL",
    "KONDISI AKUN",
    "CATATAN",
  ].forEach((value, index) => {
    header[28 + index] = value;
  });
  header[40] = singleStockId;
  header[41] = "";
  return [[], marker, header];
}

const markerMerges = [
  { startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 13 },
  { startRowIndex: 1, endRowIndex: 2, startColumnIndex: 14, endColumnIndex: 27 },
  { startRowIndex: 1, endRowIndex: 2, startColumnIndex: 28, endColumnIndex: 42 },
];

test("layout produksi membaca STOCK ID M3, AA3, dan AO3", () => {
  const audit = analyzeNetflixPoolLayout(netflixRows(), markerMerges);
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_1U").stockIdCell, "M3");
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_SHARED").stockIdCell, "M3");
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_2U").stockIdCell, "AA3");
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_SINGLESCREEN").stockIdCell, "AO3");
});

test("separator produksi N, AB, dan AP tidak dianggap sebagai header", () => {
  const audit = analyzeNetflixPoolLayout(netflixRows(), markerMerges);
  assert.deepEqual(
    audit.stockIdHeaders.map((item) => item.cell),
    ["M3", "AA3", "AO3"],
  );
  assert.equal(audit.headers.some((item) => ["N3", "AB3", "AP3"].includes(item.cell)), false);
});

test("Pool Shared tanpa marker Shared maupun alias 1U tidak diproses", () => {
  const values = netflixRows({ firstMarker: "" });
  const audit = analyzeNetflixPoolLayout(values, markerMerges);
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_SHARED").status, "MISSING_MARKER");
});

test("Pool Shared dengan marker exact yang didukung terbaca", () => {
  const audit = analyzeNetflixPoolLayout(netflixRows({ firstMarker: "POOL: NETFLIX_SHARED" }), markerMerges);
  const shared = audit.pools.find((pool) => pool.pool === "NETFLIX_SHARED");
  assert.equal(shared.markerCell, "A2");
  assert.equal(shared.stockIdCell, "M3");
  assert.equal(shared.status, "VALID");
});

test("Pool 1U tanpa STOCK ID dilaporkan missing", () => {
  const audit = analyzeNetflixPoolLayout(netflixRows({ firstStockId: "" }), markerMerges);
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_1U").status, "MISSING_STOCK_ID");
});

test("2U dimulai dari O dan header pool tidak terbaca oleh pool lain", () => {
  const audit = analyzeNetflixPoolLayout(netflixRows(), markerMerges);
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_2U").markerCell, "O2");
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_2U").startColumn, "O");
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_1U").stockIdCell, "M3");
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_2U").stockIdCell, "AA3");
  assert.equal(audit.pools.find((pool) => pool.pool === "NETFLIX_SINGLESCREEN").stockIdCell, "AO3");
  assert.deepEqual(audit.wrongPoolHeaders, []);
});

test("AN adalah CATATAN dan bukan STOCK ID Single Screen", () => {
  const audit = analyzeNetflixPoolLayout(netflixRows(), markerMerges);
  assert.equal(audit.headers.find((item) => item.cell === "AN3")?.text, "CATATAN");
  assert.equal(audit.stockIdHeaders.some((item) => item.cell === "AN3"), false);
});

test("setiap pool gagal aman ketika header STOCK ID miliknya hilang", () => {
  const cases = [
    ["NETFLIX_1U", { firstStockId: "" }],
    ["NETFLIX_2U", { secondStockId: "" }],
    ["NETFLIX_SINGLESCREEN", { singleStockId: "" }],
  ];
  for (const [poolKey, options] of cases) {
    const audit = analyzeNetflixPoolLayout(netflixRows(options), markerMerges);
    const pool = audit.pools.find((item) => item.pool === poolKey);
    assert.equal(pool.stockIdCell, "");
    assert.equal(pool.status, "MISSING_STOCK_ID");
  }
});

test("NETFLIX_SHARED adalah alias fisik exact NETFLIX_1U", () => {
  const audit = analyzeNetflixPoolLayout(netflixRows(), markerMerges);
  const oneUser = audit.pools.find((pool) => pool.pool === "NETFLIX_1U");
  const shared = audit.pools.find((pool) => pool.pool === "NETFLIX_SHARED");
  assert.equal(shared.aliasOf, "NETFLIX_1U");
  assert.equal(shared.markerCell, oneUser.markerCell);
  assert.equal(shared.stockIdCell, oneUser.stockIdCell);
  assert.equal(
    new Set([oneUser.stockIdCell, shared.stockIdCell]).size,
    1,
  );
});

test("credential multiline ditolak sebagai Stock ID", () => {
  const unsafe = "account@example.com\nsecret";
  const plan = planStockIdBackfill({
    db: {
      stock: [{
        id: unsafe,
        productId: "prod-netflix",
        sheetName: "Netflix",
        sheetPool: "NETFLIX_SHARED",
        sheetRow: 8,
        email: "account@example.com",
        profile: "A",
      }],
    },
    inventory: [{
      sheetName: "Netflix",
      pool: "NETFLIX_SHARED",
      productId: "prod-netflix",
      rowNumber: 8,
      stockIdCell: "M8",
      account: "account@example.com",
      profile: "A",
      profileRequired: true,
    }],
  });
  assert.equal(plan.rows[0].status, "INVALID_STOCK_ID_REQUIRES_MANUAL_REVIEW");
  assert.doesNotMatch(JSON.stringify(plan), /secret/);
});

test("audit parser bersifat pure dan tidak menulis Sheet", () => {
  const values = netflixRows();
  const before = structuredClone(values);
  analyzeNetflixPoolLayout(values, markerMerges);
  assert.deepEqual(values, before);
});
