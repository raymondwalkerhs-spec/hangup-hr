/**
 * Admin-configurable sales log list columns (intersected with role field view ACL).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const fieldAccess = require("./sales-field-access");
const catalog = require("./sales-field-catalog");

const DEFAULT_COLUMNS = [
  { columnKey: "workingDay", label: "Day", enabled: true, displayOrder: 10 },
  { columnKey: "submissionTime", label: "Time", enabled: true, displayOrder: 20 },
  { columnKey: "client", label: "Client", enabled: true, displayOrder: 30 },
  { columnKey: "customer", label: "Customer", enabled: true, displayOrder: 40 },
  { columnKey: "device", label: "Device", enabled: true, displayOrder: 50 },
  { columnKey: "agent", label: "Agent", enabled: true, displayOrder: 60, adminOnly: false },
  { columnKey: "closer", label: "Closer", enabled: false, displayOrder: 65 },
  { columnKey: "team", label: "Team", enabled: false, displayOrder: 70 },
  { columnKey: "status", label: "Status", enabled: true, displayOrder: 80 },
  { columnKey: "price", label: "Price", enabled: true, displayOrder: 90, adminOnly: true },
];

const COLUMN_FIELD_MAP = {
  client: "client",
  customer: "phoneNumber",
  device: "deviceType",
  agent: "agentName",
  closer: "closerName",
  team: "team",
  price: "price",
  status: "status",
  workingDay: "submissionDate",
  submissionTime: "submissionDate",
};

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

async function loadConfigMap() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  if (!useSupabase()) {
    cache = Object.fromEntries(DEFAULT_COLUMNS.map((c) => [c.columnKey, c]));
    cacheAt = now;
    return cache;
  }
  const { data, error } = await db().from("sales_list_column_config").select("*");
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      cache = Object.fromEntries(DEFAULT_COLUMNS.map((c) => [c.columnKey, c]));
      cacheAt = now;
      return cache;
    }
    throw new Error(error.message);
  }
  const map = Object.fromEntries(DEFAULT_COLUMNS.map((c) => [c.columnKey, { ...c }]));
  for (const row of data || []) map[row.column_key] = mapRow(row);
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
  const def = DEFAULT_COLUMNS.find((c) => c.columnKey === columnKey);
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
};
