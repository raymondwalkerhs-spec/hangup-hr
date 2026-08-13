#!/usr/bin/env node
require("dotenv").config();
const key = process.env.AIRTABLE_API_KEY;
const baseId = process.argv[2] || "appUgvbjLhLN6SHC7";
const tableName = process.argv[3] || "OLD MLA";

async function main() {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  console.log("Tables:", (data.tables || []).map((t) => t.name).join(", "));
  const table = (data.tables || []).find((t) => t.name === tableName);
  if (!table) {
    console.log(`Table "${tableName}" not found`);
    return;
  }
  console.log(`\n${tableName} (${table.id}) — ${table.fields.length} fields:\n`);
  for (const f of table.fields) {
    console.log(`${f.name}\t${f.type}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
