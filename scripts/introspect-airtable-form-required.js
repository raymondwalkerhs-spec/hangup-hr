#!/usr/bin/env node
/**
 * Print Airtable form/table required fields for mapping to sales-submit-required.js
 *
 * Usage: node scripts/introspect-airtable-form-required.js [baseId] [formOrTableId]
 */
require("dotenv").config();
const { CSV_TO_FORM } = require("../lib/airtable-sales-field-map");

const baseId = process.argv[2] || process.env.AIRTABLE_BASE_ID || "appptafwwB9xRYajw";
const formId = process.argv[3] || "pagaFuQilS41dmoCr";
const key = process.env.AIRTABLE_API_KEY;

async function main() {
  const tablesRes = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const tablesData = await tablesRes.json();
  if (!tablesRes.ok) throw new Error(tablesData?.error?.message || tablesRes.statusText);

  console.log(`Base ${baseId} tables:\n`);
  for (const t of tablesData.tables || []) {
    console.log(`  ${t.name} (${t.id}) — ${t.fields?.length || 0} fields`);
  }

  const table = (tablesData.tables || []).find((t) => t.id === formId || t.name === formId);
  if (table) {
    console.log(`\nFields on "${table.name}":\n`);
    for (const f of table.fields || []) {
      console.log(`  ${f.name}\t${f.type}`);
    }
  }

  console.log("\nCSV_TO_FORM keys for cross-reference:\n");
  for (const [col, formKey] of CSV_TO_FORM) {
    console.log(`  ${col} → ${formKey}`);
  }
  console.log("\nSee lib/sales-submit-required.js for portal required rules.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
