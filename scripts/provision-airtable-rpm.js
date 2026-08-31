#!/usr/bin/env node
/**
 * Create or update the Hangup RPM Airtable base (RPM Sales + Q Feedback).
 *
 * Usage:
 *   node scripts/provision-airtable-rpm.js
 *   node scripts/provision-airtable-rpm.js --write-env
 *
 * If AIRTABLE_RPM_BASE_ID is unset, tries POST /meta/bases in AIRTABLE_RPM_WORKSPACE_ID
 * (needs schema.bases:create). On 403, prints instructions to create a blank base.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { metaRequest } = require("../lib/airtable-client");
const {
  rpmBaseId,
  rpmWorkspaceId,
  rpmSalesTableName,
  rpmQFeedbackTableName,
  rpmNqChecksTableName,
  rpmToken,
} = require("../lib/airtable-rpm-targets");
const {
  RPM_SALES_COLUMNS,
  Q_FEEDBACK_COLUMNS,
  NQ_CHECKS_COLUMNS,
  RPM_SALE_LINK_FIELD,
  fieldCreateBody,
} = require("../lib/airtable-rpm-canonical-columns");

function tok() {
  return rpmToken();
}

async function meta(method, path, body) {
  return metaRequest(method, path, body, tok());
}

async function listTables(baseId) {
  const data = await meta("GET", `/bases/${baseId}/tables`);
  return data.tables || [];
}

async function createBase(workspaceId) {
  return meta("POST", "/bases", {
    name: "Hangup RPM",
    workspaceId,
    tables: [
      {
        name: rpmSalesTableName(),
        description: "Portal RPM PH sales (live upsert by Portal Sale ID)",
        fields: RPM_SALES_COLUMNS.slice(0, 2).map(fieldCreateBody),
      },
    ],
  });
}

async function createTable(baseId, name, columns, description) {
  return meta("POST", `/bases/${baseId}/tables`, {
    name,
    description,
    fields: columns.slice(0, 2).map(fieldCreateBody),
  });
}

async function addMissingFields(baseId, table, specs) {
  const existing = new Set((table.fields || []).map((f) => f.name));
  let added = 0;
  for (const spec of specs) {
    if (existing.has(spec.name)) {
      console.log(`  exists: ${spec.name}`);
      continue;
    }
    try {
      await meta("POST", `/bases/${baseId}/tables/${table.id}/fields`, fieldCreateBody(spec));
      console.log(`  added: ${spec.name}`);
      existing.add(spec.name);
      added += 1;
    } catch (err) {
      console.warn(`  skip ${spec.name}: ${err.message}`);
    }
  }
  return added;
}

async function ensureSelectChoices(baseId, table, specs) {
  for (const spec of specs) {
    if (spec.type !== "singleSelect" && spec.type !== "multipleSelects") continue;
    const wanted = (spec.options?.choices || []).map((c) => c.name).filter(Boolean);
    if (!wanted.length) continue;
    const field = (table.fields || []).find((f) => f.name === spec.name);
    if (!field || (field.type !== "singleSelect" && field.type !== "multipleSelects")) continue;
    const existing = field.options?.choices || [];
    const have = new Set(existing.map((c) => String(c.name)));
    const missing = wanted.filter((n) => !have.has(n));
    if (!missing.length) continue;
    const choices = [
      ...existing.map((c) => {
        const row = { id: c.id, name: c.name };
        if (c.color) row.color = c.color;
        return row;
      }),
      ...missing.map((name) => ({ name })),
    ];
    try {
      await meta("PATCH", `/bases/${baseId}/tables/${table.id}/fields/${field.id}`, {
        options: { choices },
      });
      console.log(`  choices: ${spec.name} + ${missing.join(", ")}`);
    } catch (err) {
      console.warn(`  skip choices ${spec.name}: ${err.message}`);
    }
  }
}

async function ensureLinkedField(baseId, qTable, salesTable) {
  const existing = (qTable.fields || []).find((f) => f.name === RPM_SALE_LINK_FIELD);
  if (existing) {
    console.log(`  exists: ${RPM_SALE_LINK_FIELD}`);
    return;
  }
  try {
    await meta("POST", `/bases/${baseId}/tables/${qTable.id}/fields`, {
      name: RPM_SALE_LINK_FIELD,
      type: "multipleRecordLinks",
      options: { linkedTableId: salesTable.id },
    });
    console.log(`  added: ${RPM_SALE_LINK_FIELD} → ${salesTable.name}`);
  } catch (err) {
    console.warn(`  skip ${RPM_SALE_LINK_FIELD}: ${err.message}`);
  }
}

function appendEnvBaseId(baseId) {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    console.warn("No .env file to write. Add AIRTABLE_RPM_BASE_ID manually.");
    return;
  }
  const raw = fs.readFileSync(envPath, "utf8");
  if (/^AIRTABLE_RPM_BASE_ID=/m.test(raw)) {
    const next = raw.replace(/^AIRTABLE_RPM_BASE_ID=.*$/m, `AIRTABLE_RPM_BASE_ID=${baseId}`);
    fs.writeFileSync(envPath, next);
    console.log(`Updated AIRTABLE_RPM_BASE_ID in .env`);
    return;
  }
  fs.appendFileSync(envPath, `\nAIRTABLE_RPM_BASE_ID=${baseId}\n`);
  console.log(`Appended AIRTABLE_RPM_BASE_ID to .env`);
}

async function main() {
  if (!tok()) throw new Error("Set AIRTABLE_RPM_TOKEN (or AIRTABLE_API_KEY) in .env");

  let baseId = rpmBaseId();
  if (!baseId) {
    const workspaceId = rpmWorkspaceId();
    console.log(`Creating Hangup RPM base in workspace ${workspaceId}…`);
    try {
      const created = await createBase(workspaceId);
      baseId = created.id;
      console.log(`Created base ${baseId}`);
      if (WRITE_ENV) appendEnvBaseId(baseId);
      else console.log(`Add to .env: AIRTABLE_RPM_BASE_ID=${baseId}  (or re-run with --write-env)`);
    } catch (err) {
      console.error(`Could not create base: ${err.message}`);
      console.error(
        "Create a blank base in Airtable (workspace wspElJw1rTpyIogEE), then set AIRTABLE_RPM_BASE_ID=app… and re-run this script."
      );
      console.error("The PAT needs schema.bases:create to create a base via API.");
      process.exit(1);
    }
  } else {
    console.log(`Using existing base ${baseId}`);
  }

  let tables = await listTables(baseId);
  let salesTable = tables.find((t) => t.name === rpmSalesTableName());
  if (!salesTable) {
    console.log(`Creating table "${rpmSalesTableName()}"`);
    salesTable = await createTable(
      baseId,
      rpmSalesTableName(),
      RPM_SALES_COLUMNS,
      "Portal RPM PH sales (live upsert by Portal Sale ID)"
    );
    tables = await listTables(baseId);
    salesTable = tables.find((t) => t.name === rpmSalesTableName()) || salesTable;
  }

  let qTable = tables.find((t) => t.name === rpmQFeedbackTableName());
  if (!qTable) {
    console.log(`Creating table "${rpmQFeedbackTableName()}"`);
    qTable = await createTable(
      baseId,
      rpmQFeedbackTableName(),
      Q_FEEDBACK_COLUMNS,
      "Completed Q Feedback (live upsert by Portal Check ID)"
    );
    tables = await listTables(baseId);
    qTable = tables.find((t) => t.name === rpmQFeedbackTableName()) || qTable;
  }

  let nqTable = tables.find((t) => t.name === rpmNqChecksTableName());
  if (!nqTable) {
    console.log(`Creating table "${rpmNqChecksTableName()}"`);
    nqTable = await createTable(
      baseId,
      rpmNqChecksTableName(),
      NQ_CHECKS_COLUMNS,
      "NQ / Age limit / Duplicate / Under Age (live upsert by Portal Check ID)"
    );
    tables = await listTables(baseId);
    nqTable = tables.find((t) => t.name === rpmNqChecksTableName()) || nqTable;
  }

  console.log(`Fields on "${rpmSalesTableName()}":`);
  await addMissingFields(baseId, salesTable, RPM_SALES_COLUMNS);
  await ensureSelectChoices(baseId, salesTable, RPM_SALES_COLUMNS);

  tables = await listTables(baseId);
  salesTable = tables.find((t) => t.name === rpmSalesTableName());
  qTable = tables.find((t) => t.name === rpmQFeedbackTableName());

  console.log(`Fields on "${rpmQFeedbackTableName()}":`);
  await addMissingFields(baseId, qTable, Q_FEEDBACK_COLUMNS);
  await ensureSelectChoices(baseId, qTable, Q_FEEDBACK_COLUMNS);
  tables = await listTables(baseId);
  qTable = tables.find((t) => t.name === rpmQFeedbackTableName());
  salesTable = tables.find((t) => t.name === rpmSalesTableName());
  await ensureLinkedField(baseId, qTable, salesTable);

  tables = await listTables(baseId);
  nqTable = tables.find((t) => t.name === rpmNqChecksTableName());
  console.log(`Fields on "${rpmNqChecksTableName()}":`);
  await addMissingFields(baseId, nqTable, NQ_CHECKS_COLUMNS);
  await ensureSelectChoices(baseId, nqTable, NQ_CHECKS_COLUMNS);

  console.log(
    `Done. Base ${baseId} tables: ${rpmSalesTableName()}, ${rpmQFeedbackTableName()}, ${rpmNqChecksTableName()}`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
