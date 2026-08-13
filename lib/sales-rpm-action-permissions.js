/**
 * RPM sales action permissions.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

const DEFAULT_ACTIONS = [
  {
    actionKey: "approve_sale",
    label: "Approve / deny / callback RPM sales",
    allowedRoles: ["quality", "rtm", "admin", "ceo", "hr"],
  },
  {
    actionKey: "work_quality_ticket",
    label: "Open RPM quality ticket",
    allowedRoles: ["quality", "rtm", "admin", "ceo", "hr", "tl", "op", "agent"],
  },
  {
    actionKey: "submit_sale",
    label: "Submit new RPM sale",
    allowedRoles: ["agent", "tl", "op", "admin", "ceo", "hr", "quality", "rtm"],
  },
  {
    actionKey: "edit_sale",
    label: "Edit RPM sale",
    allowedRoles: ["agent", "tl", "op", "admin", "ceo", "hr", "quality", "rtm"],
  },
];

let cache = null;
let cacheAt = 0;

function normalizeRole(role) {
  return String(role || "agent").trim().toLowerCase();
}

function db() {
  return getSupabaseAdmin();
}

function defaultMap() {
  return Object.fromEntries(DEFAULT_ACTIONS.map((a) => [a.actionKey, { ...a }]));
}

async function loadMap() {
  const now = Date.now();
  if (cache && now - cacheAt < 60_000) return cache;
  if (!useSupabase()) {
    cache = defaultMap();
    cacheAt = now;
    return cache;
  }
  const { data, error } = await db().from("rpm_sales_action_permissions").select("*");
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      cache = defaultMap();
      cacheAt = now;
      return cache;
    }
    throw new Error(error.message);
  }
  const map = defaultMap();
  for (const row of data || []) {
    map[row.action_key] = {
      actionKey: row.action_key,
      label: row.label,
      allowedRoles: row.allowed_roles || [],
    };
  }
  cache = map;
  cacheAt = now;
  return cache;
}

async function listAll() {
  const map = await loadMap();
  return Object.values(map);
}

function canPerformActionSync(actionKey, role) {
  const map = cache || defaultMap();
  const def = map[actionKey] || DEFAULT_ACTIONS.find((a) => a.actionKey === actionKey);
  const roles = def?.allowedRoles || [];
  return roles.map(normalizeRole).includes(normalizeRole(role));
}

async function canPerformAction(actionKey, role) {
  await loadMap();
  return canPerformActionSync(actionKey, role);
}

async function upsertActionPermission(actionKey, patch) {
  if (!useSupabase()) throw new Error("Requires supabase");
  const row = {
    action_key: actionKey,
    label: patch.label,
    allowed_roles: patch.allowedRoles || patch.allowed_roles || [],
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("rpm_sales_action_permissions")
    .upsert(row, { onConflict: "action_key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  invalidateCache();
  return {
    actionKey: data.action_key,
    label: data.label,
    allowedRoles: data.allowed_roles || [],
  };
}

async function seedDefaults() {
  if (!useSupabase()) return { count: DEFAULT_ACTIONS.length };
  for (const def of DEFAULT_ACTIONS) {
    await db()
      .from("rpm_sales_action_permissions")
      .upsert(
        {
          action_key: def.actionKey,
          label: def.label,
          allowed_roles: def.allowedRoles,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "action_key" }
      );
  }
  invalidateCache();
  return { count: DEFAULT_ACTIONS.length };
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = {
  DEFAULT_ACTIONS,
  upsertActionPermission,
  seedDefaults,
  loadMap,
  listAll,
  canPerformAction,
  canPerformActionSync,
  invalidateCache,
};
