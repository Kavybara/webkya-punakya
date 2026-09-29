import assert from "node:assert/strict";
import test from "node:test";

import { googleSheetsProductScope, googleSheetsProductSheetNames } from "../google-sheets.js";

test("product-scoped sync selects only the target product sheet and pools", () => {
  const db = {
    stock: [
      {
        id: "wetv-1",
        productId: "prod-wetv",
        sheetSource: "google_sheets",
        sheetName: "wetv",
        sheetPool: "WETV_6U",
      },
      {
        id: "wetv-2",
        productId: "prod-wetv",
        sheetSource: "google_sheets",
        sheetName: "wetv",
        sheetPool: "WETV_3U",
      },
      {
        id: "disney-1",
        productId: "prod-disney",
        sheetSource: "google_sheets",
        sheetName: "Disney",
        sheetPool: "DISNEY_6U",
      },
      {
        id: "local",
        productId: "prod-wetv",
        sheetSource: "local",
        sheetName: "ignored",
        sheetPool: "IGNORED",
      },
    ],
  };

  assert.deepEqual(
    googleSheetsProductScope(db, { id: "prod-wetv" }),
    {
      sheetNames: ["wetv"],
      poolKeys: ["WETV6U", "WETV3U"],
    },
  );
});

test("product-scoped sync fails safe when no exact Sheet-backed scope exists", () => {
  assert.deepEqual(
    googleSheetsProductScope({ stock: [] }, { id: "prod-missing" }),
    { sheetNames: [], poolKeys: [] },
  );
});

test("empty HBO inventory resolves only an exact product Sheet alias", () => {
  const product = { id: "prod-hbo", code: "HBO", name: "HBO Max" };

  assert.deepEqual(
    googleSheetsProductSheetNames(product, ["Netflix", "HBO", "HBO Backup", "HBO Max Archive"]),
    ["HBO"],
  );
});
