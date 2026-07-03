#!/usr/bin/env node
/** Seed sales_field_permissions from lib/sales-field-catalog.js */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const catalog = require("../lib/sales-field-catalog");

async function main() {
  const db = getSupabaseAdmin();
  await catalog.seedDefaultPermissions(db);
  const { data, error } = await db.from("sales_field_permissions").select("field_key");
  if (error) throw new Error(error.message);
  console.log(`Seeded ${(data || []).length} sales field permissions.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
