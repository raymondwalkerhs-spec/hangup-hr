/**
 * Minimal Airtable REST client (no npm dependency).
 */
const API_ROOT = "https://api.airtable.com/v0";
const META_ROOT = "https://api.airtable.com/v0/meta";
const SCHEMA_TTL_MS = 10 * 60 * 1000;
let tableFieldNames = null;
let tableFieldNamesAt = 0;
let tableSchema = null;
let tableSchemaAt = 0;

function apiKey() {
  return String(process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT || "").trim();
}

function baseId() {
  return String(process.env.AIRTABLE_BASE_ID || "").trim();
}

function tableName() {
  return String(process.env.AIRTABLE_TABLE_NAME || "Sales All Data").trim();
}

function isConfigured() {
  if (String(process.env.AIRTABLE_SYNC_ENABLED || "true").toLowerCase() === "false") return false;
  return Boolean(apiKey() && baseId());
}

function encodeTableSegment(name) {
  return encodeURIComponent(name);
}

async function airtableRequest(method, path, body) {
  const url = `${API_ROOT}/${baseId()}/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.type || res.statusText || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.response = data;
    throw err;
  }
  return data;
}

async function getTableSchema(force = false) {
  if (!force && tableSchema && Date.now() - tableSchemaAt < SCHEMA_TTL_MS) {
    return tableSchema;
  }
  const res = await fetch(`${META_ROOT}/bases/${baseId()}/tables`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) return tableSchema;
  const data = await res.json();
  const table = (data.tables || []).find((t) => t.name === tableName());
  const map = new Map();
  for (const f of table?.fields || []) {
    const choices = new Set((f.options?.choices || []).map((c) => c.name));
    map.set(f.name, { type: f.type, choices });
  }
  tableSchema = map;
  tableSchemaAt = Date.now();
  tableFieldNames = new Set(map.keys());
  tableFieldNamesAt = tableSchemaAt;
  return tableSchema;
}

async function getTableFieldNames(force = false) {
  await getTableSchema(force);
  return tableFieldNames;
}

function matchSelectChoice(choices, value) {
  const raw = String(value || "").trim();
  if (!raw || !choices?.size) return null;
  const candidates = new Set([raw]);
  candidates.add(raw.replace(/^HS(\d+)$/i, "HS $1"));
  candidates.add(raw.replace(/^HS\s*(\d+)$/i, "HS$1"));
  if (/^team\s+/i.test(raw)) candidates.add(raw.replace(/^team\s+/i, "Team "));
  for (const candidate of candidates) {
    if (choices.has(candidate)) return candidate;
    const lower = candidate.toLowerCase();
    for (const c of choices) {
      if (String(c).toLowerCase() === lower) return c;
    }
  }
  return null;
}

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeAttachmentFieldValue(val) {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const url = item.url || item.Url;
      if (!url) return null;
      const entry = { url: String(url) };
      const filename = item.filename || item.fileName;
      if (filename) entry.filename = String(filename);
      return entry;
    })
    .filter(Boolean);
}

function normalizeFieldsForSchema(fields, schema) {
  if (!schema || !schema.size) return fields;
  const out = {};
  for (const [key, val] of Object.entries(fields)) {
    const def = schema.get(key);
    if (!def) continue;
    if (def.type === "multipleAttachments") {
      if (Array.isArray(val)) out[key] = normalizeAttachmentFieldValue(val);
      continue;
    }
    if (val == null || val === "") continue;
    if (def.type === "singleSelect" || def.type === "multipleSelects") {
      if (def.type === "multipleSelects") {
        const arr = Array.isArray(val) ? val : [val];
        const matched = arr.map((v) => matchSelectChoice(def.choices, v)).filter(Boolean);
        if (matched.length) out[key] = matched;
        continue;
      }
      const choice = matchSelectChoice(def.choices, val);
      if (choice) out[key] = choice;
      continue;
    }
    if (def.type === "singleCollaborator" || def.type === "multipleCollaborators") {
      continue;
    }
    if (key === "Card Number") {
      const digits = String(val).replace(/\D/g, "");
      if (!digits) continue;
      if (def.type === "number") {
        const num = Number(digits);
        if (!Number.isSafeInteger(num)) continue;
        out[key] = num;
      } else {
        out[key] = digits;
      }
      continue;
    }
    if (key === "CVV") {
      const s = String(val).trim();
      if (s) out[key] = s;
      continue;
    }
    if (def.type === "number") {
      if (typeof val === "number" && Number.isFinite(val)) {
        out[key] = val;
      } else {
        const parsed = parseFloat(String(val).replace(/[^0-9.+-]/g, ""));
        if (Number.isFinite(parsed)) out[key] = parsed;
      }
      continue;
    }
    if (Array.isArray(val)) {
      out[key] = val;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function filterFieldsToSchema(fields, allowed) {
  if (!allowed || !allowed.size) return fields;
  const out = {};
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.has(key)) out[key] = val;
  }
  return out;
}

async function prepareFields(fields) {
  const schema = await getTableSchema();
  const allowed = schema ? new Set(schema.keys()) : tableFieldNames;
  return normalizeFieldsForSchema(filterFieldsToSchema(fields, allowed), schema);
}

async function findRecordByField(fieldName, value, table) {
  const all = await findAllRecordsByField(fieldName, value, table);
  return all[0] || null;
}

async function findAllRecordsByField(fieldName, value, table) {
  const name = String(fieldName || "").trim();
  const needle = String(value ?? "").trim();
  if (!name || !needle) return [];
  const tbl = encodeTableSegment(table || tableName());
  const formula = `{${name}} = "${escapeFormulaString(needle)}"`;
  const records = [];
  let offset = "";
  for (;;) {
    const qs = offset
      ? `filterByFormula=${encodeURIComponent(formula)}&offset=${encodeURIComponent(offset)}`
      : `filterByFormula=${encodeURIComponent(formula)}`;
    const data = await airtableRequest("GET", `${tbl}?${qs}`);
    records.push(...(data?.records || []));
    offset = data?.offset || "";
    if (!offset) break;
  }
  return records.map((r) => ({ id: r.id, fields: r.fields || {} }));
}

async function listAllRecords(table, { fields = [] } = {}) {
  const tbl = encodeTableSegment(table || tableName());
  const records = [];
  let offset = "";
  for (;;) {
    let qs = "";
    if (fields.length) qs += `fields[]=${fields.map((f) => encodeURIComponent(f)).join("&fields[]=")}`;
    if (offset) qs += `${qs ? "&" : ""}offset=${encodeURIComponent(offset)}`;
    const path = qs ? `${tbl}?${qs}` : tbl;
    const data = await airtableRequest("GET", path);
    records.push(...(data?.records || []));
    offset = data?.offset || "";
    if (!offset) break;
  }
  return records.map((r) => ({ id: r.id, fields: r.fields || {} }));
}

async function deleteRecordsBatch(recordIds, table) {
  const ids = (recordIds || []).filter(Boolean);
  if (!ids.length) return 0;
  const tbl = encodeTableSegment(table || tableName());
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const qs = chunk.map((id) => `records[]=${encodeURIComponent(id)}`).join("&");
    await airtableRequest("DELETE", `${tbl}?${qs}`);
    deleted += chunk.length;
  }
  return deleted;
}

async function createRecord(fields, table) {
  const payload = await prepareFields(fields);
  const tbl = encodeTableSegment(table || tableName());
  const data = await airtableRequest("POST", tbl, { fields: payload });
  return data?.id || null;
}

async function updateRecord(recordId, fields, table) {
  const payload = await prepareFields(fields);
  const tbl = encodeTableSegment(table || tableName());
  const seg = `${tbl}/${encodeURIComponent(recordId)}`;
  const data = await airtableRequest("PATCH", seg, { fields: payload });
  return data?.id || recordId;
}

async function deleteRecord(recordId, table) {
  const tbl = encodeTableSegment(table || tableName());
  const seg = `${tbl}/${encodeURIComponent(recordId)}`;
  await airtableRequest("DELETE", seg);
  return true;
}

module.exports = {
  isConfigured,
  tableName,
  getTableSchema,
  getTableFieldNames,
  clearTableSchemaCache: () => {
    tableSchema = null;
    tableFieldNames = null;
    tableSchemaAt = 0;
    tableFieldNamesAt = 0;
  },
  filterFieldsToSchema,
  findRecordByField,
  findAllRecordsByField,
  listAllRecords,
  deleteRecordsBatch,
  createRecord,
  updateRecord,
  deleteRecord,
};
