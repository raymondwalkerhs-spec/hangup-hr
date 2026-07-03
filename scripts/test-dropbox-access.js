#!/usr/bin/env node
/** Quick Dropbox scope check — run after enabling permissions + regenerating token. */
require("dotenv").config();
const dropbox = require("../lib/dropbox");

async function main() {
  if (!dropbox.isConfigured()) {
    console.error("DROPBOX_ACCESS_TOKEN not set in .env");
    process.exit(1);
  }
  const result = await dropbox.verifyAccess();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
  console.log("\nDropbox ready for sales attachment import.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
