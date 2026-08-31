/**
 * Minimal Airtable REST client (no npm dependency).
 * Multi-target: createAirtableTarget({ getBaseId, getTableName, getEnabled }) for MLA vs RPM.
 * Default exports keep MLA behavior (AIRTABLE_BASE_ID / AIRTABLE_TABLE_NAME).
 */
const API_ROOT = "https://api.airtable.com/v0";
const META_ROOT = "https://api.airtable.com/v0/meta";
const SCHEMA_TTL_MS = 10 * 60 * 1000;

function apiKey() {
  return String(process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT || "").trim();
}

function rpmApiKey() {
  return String(
    process.env.AIRTABLE_RPM_TOKEN || process.env.AIRTABLE_RPM_API_KEY || process.env.AIRTABLE_RPM_PAT || ""
  ).trim();
}

function encodeTableSegment(name) {
  return encodeURIComponent(name);
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

function normalizeFieldsForSchema(fields, schema, { typecast = false } = {}) {
  if (!schema || !schema.size) return fields;
  const out = {};
  for (const [key, val] of Object.entries(fields)) {
    const def = schema.get(key);
    if (!def) continue;
    if (def.type === "multipleAttachments") {
      if (Array.isArray(val)) out[key] = normalizeAttachmentFieldValue(val);
      continue;
    }
    if ((key === "Portal Sale ID" || key === "Portal Check ID") && val === "") {
      out[key] = "";
      continue;
    }
    if (def.type === "multipleRecordLinks") {
      if (Array.isArray(val)) {
        const ids = val.map((v) => (typeof v === "string" ? v : v?.id)).filter(Boolean);
        out[key] = ids;
      }
      continue;
    }
    if (val == null || val === "") continue;
    if (def.type === "singleSelect" || def.type === "multipleSelects") {
      if (def.type === "multipleSelects") {
        const arr = Array.isArray(val) ? val : [val];
        const matched = arr
          .map((v) => matchSelectChoice(def.choices, v) || (typecast ? String(v ?? "").trim() : null))
          .filter(Boolean);
        if (matched.length) out[key] = matched;
        continue;
      }
      const choice = matchSelectChoice(def.choices, val);
      if (choice) out[key] = choice;
      else if (typecast) {
        const raw = String(val).trim();
        if (raw) out[key] = raw;
      }
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

function parseAirtableError(res, data) {
  const msg = data?.error?.message || data?.error?.type || res.statusText || `HTTP ${res.status}`;
  const err = new Error(msg);
  err.status = res.status;
  err.response = data;
  return err;
}

async function parseJsonResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return data;
}

async function metaRequest(method, path, body, token) {
  const url = path.startsWith("http") ? path : `${META_ROOT}${path}`;
  const key = String(token || apiKey()).trim();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) throw parseAirtableError(res, data);
  return data;
}

function createAirtableTarget(opts = {}) {
  const getBaseId =
    opts.getBaseId ||
    (() => String(opts.baseId || process.env.AIRTABLE_BASE_ID || "").trim());
  const getTableName =
    opts.getTableName ||
    (() => String(opts.tableName || process.env.AIRTABLE_TABLE_NAME || "Sales All Data").trim());
  const getEnabled =
    opts.getEnabled ||
    (() => {
      const envName = opts.syncEnabledEnv || "AIRTABLE_SYNC_ENABLED";
      return String(process.env[envName] ?? "true").toLowerCase() !== "false";
    });

  const getApiKey = opts.getApiKey || apiKey;
  const typecast = Boolean(opts.typecast);

  let tableFieldNames = null;
  let tableSchema = null;
  let tableSchemaAt = 0;

  function isConfigured() {
    if (!getEnabled()) return false;
    return Boolean(getApiKey() && getBaseId());
  }

  function baseId() {
    return getBaseId();
  }

  function tableName() {
    return getTableName();
  }

  async function airtableRequest(method, path, body) {
    const url = `${API_ROOT}/${baseId()}/${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw parseAirtableError(res, data);
    return data;
  }

  async function getTableSchema(force = false) {
    if (!force && tableSchema && Date.now() - tableSchemaAt < SCHEMA_TTL_MS) {
      return tableSchema;
    }
    const res = await fetch(`${META_ROOT}/bases/${baseId()}/tables`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });
    if (!res.ok) return tableSchema;
    const data = await res.json();
    const table = (data.tables || []).find((t) => t.name === tableName());
    const map = new Map();
    for (const f of table?.fields || []) {
      const choices = new Set((f.options?.choices || []).map((c) => c.name));
      map.set(f.name, { type: f.type, choices, id: f.id, options: f.options || {} });
    }
    tableSchema = map;
    tableSchemaAt = Date.now();
    tableFieldNames = new Set(map.keys());
    return tableSchema;
  }

  async function getTableFieldNames(force = false) {
    await getTableSchema(force);
    return tableFieldNames;
  }

  function clearTableSchemaCache() {
    tableSchema = null;
    tableFieldNames = null;
    tableSchemaAt = 0;
  }

  async function prepareFields(fields) {
    const schema = await getTableSchema();
    const allowed = schema ? new Set(schema.keys()) : tableFieldNames;
    return normalizeFieldsForSchema(filterFieldsToSchema(fields, allowed), schema, { typecast });
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

  async function findRecordByField(fieldName, value, table) {
    const all = await findAllRecordsByField(fieldName, value, table);
    return all[0] || null;
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
    const body = { fields: payload };
    if (typecast) body.typecast = true;
    const data = await airtableRequest("POST", tbl, body);
    return data?.id || null;
  }

  async function updateRecord(recordId, fields, table) {
    const payload = await prepareFields(fields);
    const tbl = encodeTableSegment(table || tableName());
    const seg = `${tbl}/${encodeURIComponent(recordId)}`;
    const body = { fields: payload };
    if (typecast) body.typecast = true;
    const data = await airtableRequest("PATCH", seg, body);
    return data?.id || recordId;
  }

  async function deleteRecord(recordId, table) {
    const tbl = encodeTableSegment(table || tableName());
    const seg = `${tbl}/${encodeURIComponent(recordId)}`;
    await airtableRequest("DELETE", seg);
    return true;
  }

  return {
    isConfigured,
    baseId,
    tableName,
    getTableSchema,
    getTableFieldNames,
    clearTableSchemaCache,
    filterFieldsToSchema,
    findRecordByField,
    findAllRecordsByField,
    listAllRecords,
    deleteRecordsBatch,
    createRecord,
    updateRecord,
    deleteRecord,
  };
}

const mla = createAirtableTarget({
  getBaseId: () => String(process.env.AIRTABLE_BASE_ID || "").trim(),
  getTableName: () => String(process.env.AIRTABLE_TABLE_NAME || "Sales All Data").trim(),
  getEnabled: () => String(process.env.AIRTABLE_SYNC_ENABLED || "true").toLowerCase() !== "false",
});

module.exports = {
  API_ROOT,
  META_ROOT,
  apiKey,
  rpmApiKey,
  createAirtableTarget,
  metaRequest,
  escapeFormulaString,
  matchSelectChoice,
  normalizeFieldsForSchema,
  filterFieldsToSchema,
  isConfigured: (...args) => mla.isConfigured(...args),
  tableName: (...args) => mla.tableName(...args),
  getTableSchema: (...args) => mla.getTableSchema(...args),
  getTableFieldNames: (...args) => mla.getTableFieldNames(...args),
  clearTableSchemaCache: (...args) => mla.clearTableSchemaCache(...args),
  findRecordByField: (...args) => mla.findRecordByField(...args),
  findAllRecordsByField: (...args) => mla.findAllRecordsByField(...args),
  listAllRecords: (...args) => mla.listAllRecords(...args),
  deleteRecordsBatch: (...args) => mla.deleteRecordsBatch(...args),
  createRecord: (...args) => mla.createRecord(...args),
  updateRecord: (...args) => mla.updateRecord(...args),
  deleteRecord: (...args) => mla.deleteRecord(...args),
};
