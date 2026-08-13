#!/usr/bin/env node
/**
 * Seed RPM sales field + attachment + list-column permissions.
 */
require("dotenv").config();

const { getSupabaseAdmin } = require("../lib/supabase-client");
const catalog = require("../lib/sales-rpm-field-catalog");
const rpmListColumns = require("../lib/rpm-sales-list-columns");

async function main() {
  const db = getSupabaseAdmin();
  await catalog.seedDefaultPermissions(db);
  await rpmListColumns.seedDefaultColumns();
  console.log("RPM sales permissions seeded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
