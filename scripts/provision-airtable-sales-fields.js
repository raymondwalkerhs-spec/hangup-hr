#!/usr/bin/env node
/**
 * Add missing sales columns to the configured Airtable table (Meta API).
 * Fields are provisioned in canonical order: template CSV columns first, Portal extras after.
 *
 * Usage: node scripts/provision-airtable-sales-fields.js
 */
require("dotenv").config();
const airtable = require("../lib/airtable-client");
const { allProvisionFields, TEMPLATE_COLUMNS } = require("../lib/airtable-canonical-columns");

const META_ROOT = "https://api.airtable.com/v0/meta";

async function main() {
  if (!airtable.isConfigured()) throw new Error("Airtable not configured");
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = airtable.tableName();
  const key = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT;

  const tablesRes = await fetch(`${META_ROOT}/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const tablesData = await tablesRes.json();
  if (!tablesRes.ok) throw new Error(tablesData?.error?.message || tablesRes.statusText);

  const table = (tablesData.tables || []).find((t) => t.name === tableName);
  if (!table) {
    throw new Error(`Table not found: "${tableName}". Tables: ${(tablesData.tables || []).map((t) => t.name).join(", ")}`);
  }

  const existing = new Set((table.fields || []).map((f) => f.name));
  const fieldOrder = (table.fields || []).map((f) => f.name);
  const firstExtraIdx = fieldOrder.findIndex((n) => !TEMPLATE_COLUMNS.includes(n));
  if (firstExtraIdx >= 0 && firstExtraIdx < TEMPLATE_COLUMNS.length) {
    console.warn(
      "WARNING: Some non-template columns appear before template columns in Airtable UI.",
      "Reorder manually in Airtable if CSV integration column order matters."
    );
  }

  let added = 0;
  for (const spec of allProvisionFields()) {
    if (existing.has(spec.name)) {
      console.log(`  exists: ${spec.name}`);
      continue;
    }
    const body = { name: spec.name, type: spec.type };
    if (spec.options) body.options = spec.options;
    const res = await fetch(`${META_ROOT}/bases/${baseId}/tables/${table.id}/fields`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn(`  skip ${spec.name}: ${data?.error?.message || res.statusText}`);
      continue;
    }
    console.log(`  added: ${spec.name}`);
    existing.add(spec.name);
    added += 1;
  }
  airtable.clearTableSchemaCache();
  console.log(`Provisioned ${added} field(s) on "${tableName}" (${TEMPLATE_COLUMNS.length} template + extras)`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
