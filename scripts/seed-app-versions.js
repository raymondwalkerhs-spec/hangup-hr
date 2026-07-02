#!/usr/bin/env node
/**
 * One-time / idempotent seed for the App_Versions tab on the HR Access sheet.
 * Usage: node scripts/seed-app-versions.js
 */
require("dotenv").config();

const { getSheetsAuth, getSheetsClient } = require("../lib/google-auth");
const { AUTH_SHEET_ID } = require("../lib/auth-sheet");
const { VERSION_SHEET_TAB } = require("../lib/version-sheet");
const { getAppVersion } = require("../lib/app-version");

const HEADERS = [
  "Version",
  "Release Date",
  "Type",
  "Min Compatible",
  "Current",
  "Notes",
];

const SEED_ROWS = [
  ["1.0.0", "2026-01-15", "major", "1.0.0", "FALSE", "Initial desktop release"],
  [
    getAppVersion(),
    "2026-07-02",
    "minor",
    "1.0.0",
    "TRUE",
    "Roles, Changes view, version checks, local-first sync",
  ],
];

async function main() {
  const auth = await getSheetsAuth();
  const sheets = getSheetsClient(auth);

  const meta = await sheets.spreadsheets.get({ spreadsheetId: AUTH_SHEET_ID });
  const tabExists = meta.data.sheets.some((s) => s.properties.title === VERSION_SHEET_TAB);

  if (!tabExists) {
    console.log(`Creating tab "${VERSION_SHEET_TAB}" on HR Access sheet…`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: AUTH_SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: VERSION_SHEET_TAB } } }],
      },
    });
  } else {
    console.log(`Tab "${VERSION_SHEET_TAB}" already exists — updating rows…`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: AUTH_SHEET_ID,
    range: `'${VERSION_SHEET_TAB}'!A1:F${1 + SEED_ROWS.length}`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS, ...SEED_ROWS] },
  });

  const verify = await sheets.spreadsheets.values.get({
    spreadsheetId: AUTH_SHEET_ID,
    range: `'${VERSION_SHEET_TAB}'!A:F`,
  });

  console.log("App_Versions tab ready:");
  console.table((verify.data.values || []).map((row) => ({
    Version: row[0],
    Date: row[1],
    Type: row[2],
    "Min Compatible": row[3],
    Current: row[4],
    Notes: row[5],
  })));
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
