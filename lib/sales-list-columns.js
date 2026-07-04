/**
 * Admin-configurable sales log list columns (intersected with role field view ACL).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const fieldAccess = require("./sales-field-access");
const catalog = require("./sales-field-catalog");

const SYNTHETIC_COLUMNS = [
  { columnKey: "workingDay", label: "Day", enabled: true, displayOrder: 10 },
  { columnKey: "submissionTime", label: "Time", enabled: true, displayOrder: 20 },
  { columnKey: "customer", label: "Customer", enabled: true, displayOrder: 35 },
  { columnKey: "agent", label: "Agent", enabled: true, displayOrder: 55 },
  { columnKey: "closer", label: "Closer", enabled: false, displayOrder: 56 },
];

const DEFAULT_ENABLED_KEYS = new Set([
  "workingDay",
  "submissionTime",
  "client",
  "customer",
  "deviceType",
  "agent",
  "verifierFeedback",
  "clientFeedback",
  "price",
  "phoneNumber",
  "firstName",
  "lastName",
]);

function buildDefaultColumns() {
  const seen = new Set();
  const out = [];
  for (const c of SYNTHETIC_COLUMNS) {
    seen.add(c.columnKey);
    out.push({ ...c });
  }
  let order = 100;
  for (const f of catalog.FIELDS) {
    if (seen.has(f.key)) continue;
    if (f.hideInList) continue;
    seen.add(f.key);
    out.push({
      columnKey: f.key,
      label: f.label,
      enabled: DEFAULT_ENABLED_KEYS.has(f.key),
      displayOrder: order,
      adminOnly: Boolean(f.sensitive),
    });
    order += 5;
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder);
}

const DEFAULT_COLUMNS = buildDefaultColumns();

const COLUMN_FIELD_MAP = {
  client: "client",
  customer: "phoneNumber",
  deviceType: "deviceType",
  device: "deviceType",
  agent: "agentName",
  closer: "closerName",
  team: "team",
  unit: "unit",
  price: "price",
  status: "status",
  workingDay: "submissionDate",
  submissionTime: "submissionDate",
  phoneNumber: "phoneNumber",
  firstName: "firstName",
  lastName: "lastName",
  verifierFeedback: "verifierFeedback",
  clientFeedback: "clientFeedback",
  assignVerifier: "assignVerifier",
  reviewer: "reviewer",
  paymentMethod: "paymentMethod",
  routingNumber: "routingNumber",
  bankName: "bankName",
  bankAccountNumber: "bankAccountNumber",
  bankAddress: "bankAddress",
  bankAccountChosenBy: "bankAccountChosenBy",
};

for (const f of catalog.FIELDS) {
  if (!COLUMN_FIELD_MAP[f.key]) COLUMN_FIELD_MAP[f.key] = f.key;
}

let cache = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

function db() {
  return getSupabaseAdmin();
}

function mapRow(r) {
  return {
    columnKey: r.column_key,
    label: r.label,
    enabled: r.enabled !== false,
    displayOrder: r.display_order ?? 0,
    adminOnly: r.admin_only === true,
  };
}

function columnDef(columnKey) {
  return DEFAULT_COLUMNS.find((c) => c.columnKey === columnKey) || null;
}

async function loadConfigMap() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  const map = Object.fromEntries(DEFAULT_COLUMNS.map((c) => [c.columnKey, { ...c }]));
  if (!useSupabase()) {
    cache = map;
    cacheAt = now;
    return cache;
  }
  const { data, error } = await db().from("sales_list_column_config").select("*");
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      cache = map;
      cacheAt = now;
      return cache;
    }
    throw new Error(error.message);
  }
  for (const row of data || []) {
    const def = columnDef(row.column_key);
    map[row.column_key] = mapRow(row);
    if (def && !map[row.column_key].label) map[row.column_key].label = def.label;
  }
  cache = map;
  cacheAt = now;
  return map;
}

async function listColumns() {
  const map = await loadConfigMap();
  return DEFAULT_COLUMNS.map((d) => map[d.columnKey] || d).sort((a, b) => a.displayOrder - b.displayOrder);
}

async function upsertColumn(columnKey, patch) {
  if (!useSupabase()) throw new Error("Requires Supabase");
  const def = columnDef(columnKey);
  if (!def) throw new Error("Unknown column");
  const existing = (await loadConfigMap())[columnKey];
  const row = {
    column_key: columnKey,
    label: patch.label || existing?.label || def.label,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : existing?.enabled !== false,
    display_order: patch.displayOrder ?? existing?.displayOrder ?? def.displayOrder,
    admin_only: patch.adminOnly !== undefined ? Boolean(patch.adminOnly) : existing?.adminOnly === true,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("sales_list_column_config").upsert(row).select().single();
  if (error) throw new Error(error.message);
  cache = null;
  return mapRow(data);
}

async function seedDefaultColumns() {
  for (const def of DEFAULT_COLUMNS) await upsertColumn(def.columnKey, def);
  return { count: DEFAULT_COLUMNS.length };
}

async function canViewColumn(columnKey, role, perms) {
  const fieldKey = COLUMN_FIELD_MAP[columnKey];
  if (!fieldKey) return true;
  if (columnKey === "workingDay" || columnKey === "submissionTime") return true;
  if (columnKey === "agent" || columnKey === "closer") {
    return ["tl", "op", "quality", "rtm", "admin", "ceo", "hr", "finance"].includes(String(role || "").toLowerCase());
  }
  const field = catalog.getFieldDef(fieldKey) || { key: fieldKey, viewRoles: catalog.DEFAULT_VIEW || [] };
  return catalog.canViewField(field, role, perms?.[fieldKey]);
}

async function getVisibleColumnsForUser(role) {
  const perms = await fieldAccess.loadPermissionsMap();
  const cols = await listColumns();
  const isAdmin = ["admin", "ceo", "rtm", "hr"].includes(String(role || "").toLowerCase());
  const out = [];
  for (const col of cols) {
    if (!col.enabled) continue;
    if (col.adminOnly && !isAdmin) continue;
    if (!(await canViewColumn(col.columnKey, role, perms))) continue;
    out.push(col);
  }
  return out;
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = {
  DEFAULT_COLUMNS,
  COLUMN_FIELD_MAP,
  listColumns,
  upsertColumn,
  seedDefaultColumns,
  getVisibleColumnsForUser,
  canViewColumn,
  invalidateCache,
  buildDefaultColumns,
};
