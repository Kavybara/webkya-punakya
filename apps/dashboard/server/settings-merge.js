function normalizeIncomingText(value = "") {
  return String(value ?? "").trim();
}

function preserveStoredText(currentValue = "", nextValue = "", options = {}) {
  const incoming = normalizeIncomingText(nextValue);
  if (!incoming) return normalizeIncomingText(currentValue);
  const placeholder = normalizeIncomingText(options.placeholder || "");
  if (placeholder && incoming === placeholder) return normalizeIncomingText(currentValue);
  return incoming;
}

export function mergeGoogleSheetsSettings(currentSettings = {}, nextSettings = {}, options = {}) {
  return {
    googleSheetsSpreadsheetId: preserveStoredText(currentSettings.googleSheetsSpreadsheetId, nextSettings.spreadsheetId),
    googleSheetsSheetName: preserveStoredText(currentSettings.googleSheetsSheetName, nextSettings.sheetName) || "Netflix",
    googleSheetsServiceAccountEmail: preserveStoredText(currentSettings.googleSheetsServiceAccountEmail, nextSettings.serviceAccountEmail),
    googleSheetsPrivateKey: preserveStoredText(
      currentSettings.googleSheetsPrivateKey,
      nextSettings.privateKey,
      { placeholder: options.storedSecretPlaceholder || "[stored]" },
    ),
  };
}
