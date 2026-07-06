/**
 * Sales action permissions (approve/deny/callback).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

const DEFAULT_ACTIONS = [
  {
    actionKey: "approve_sale",
    label: "Approve / deny / callback sales",
    allowedRoles: ["quality", "rtm", "admin", "ceo", "hr"],
  },
];

let cache = null;
let cacheAt = 0;

function db() {
  return getSupabaseAdmin();
}

function normalizeRole(role) {
  return String(role || "agent").trim().toLowerCase();
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
  const { data, error } = await db().from("sales_action_permissions").select("*");
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
  return map;
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
    .from("sales_action_permissions")
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
      .from("sales_action_permissions")
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
  cache = null;
  return { count: DEFAULT_ACTIONS.length };
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = {
  DEFAULT_ACTIONS,
  canPerformAction,
  canPerformActionSync,
  upsertActionPermission,
  seedDefaults,
  loadMap,
  invalidateCache,
};
