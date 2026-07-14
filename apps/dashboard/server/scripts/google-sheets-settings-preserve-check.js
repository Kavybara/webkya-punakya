import assert from "node:assert/strict";
import { mergeGoogleSheetsSettings } from "../settings-merge.js";

const STORED_SECRET_PLACEHOLDER = "[stored]";

const existing = {
  googleSheetsSpreadsheetId: "sheet-123",
  googleSheetsSheetName: "Netflix",
  googleSheetsServiceAccountEmail: "bot@example.iam.gserviceaccount.com",
  googleSheetsPrivateKey: "-----BEGIN PRIVATE KEY-----demo",
};

const preserved = mergeGoogleSheetsSettings(
  existing,
  {
    spreadsheetId: "",
    sheetName: "",
    serviceAccountEmail: "",
    privateKey: STORED_SECRET_PLACEHOLDER,
  },
  { storedSecretPlaceholder: STORED_SECRET_PLACEHOLDER },
);

assert.equal(preserved.googleSheetsSpreadsheetId, existing.googleSheetsSpreadsheetId);
assert.equal(preserved.googleSheetsSheetName, existing.googleSheetsSheetName);
assert.equal(preserved.googleSheetsServiceAccountEmail, existing.googleSheetsServiceAccountEmail);
assert.equal(preserved.googleSheetsPrivateKey, existing.googleSheetsPrivateKey);

const replaced = mergeGoogleSheetsSettings(
  existing,
  {
    spreadsheetId: "sheet-456",
    sheetName: "Stock Baru",
    serviceAccountEmail: "next@example.iam.gserviceaccount.com",
    privateKey: "-----BEGIN PRIVATE KEY-----next",
  },
  { storedSecretPlaceholder: STORED_SECRET_PLACEHOLDER },
);

assert.equal(replaced.googleSheetsSpreadsheetId, "sheet-456");
assert.equal(replaced.googleSheetsSheetName, "Stock Baru");
assert.equal(replaced.googleSheetsServiceAccountEmail, "next@example.iam.gserviceaccount.com");
assert.equal(replaced.googleSheetsPrivateKey, "-----BEGIN PRIVATE KEY-----next");

console.log("google-sheets-settings-preserve-check OK");
