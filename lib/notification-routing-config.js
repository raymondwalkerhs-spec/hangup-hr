/**
 * Admin-configurable notification routing per action type.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const notifyRouting = require("./notify-routing");

const DEFAULT_RULES = [
  {
    actionKey: "leave_submitted",
    label: "Leave / day off submitted",
    description: "When any employee submits a leave request",
    recipientRoles: ["hr", "admin"],
    recipientUsernames: [],
  },
  {
    actionKey: "sale_agent_submitted",
    label: "Agent submitted sale",
    description: "When an agent submits a new sale for quality review",
    recipientRoles: ["rtm", "quality"],
    recipientUsernames: [],
  },
  {
    actionKey: "sale_pending",
    label: "Sale pending approval",
    description: "When a sale is pending HR/approver review",
    recipientRoles: ["hr", "admin", "quality", "rtm"],
    recipientUsernames: [],
  },
  {
    actionKey: "bonus_request_submitted",
    label: "Bonus request submitted",
    description: "When TL/OP requests a bonus for an agent",
    recipientRoles: ["hr", "admin", "op"],
    recipientUsernames: [],
  },
  {
    actionKey: "employee_note_created",
    label: "HR note on employee",
    description: "When an HR note or warning is added to an employee",
    recipientRoles: ["hr"],
    recipientUsernames: [],
  },
  {
    actionKey: "quality_note_created",
    label: "Quality note on agent",
    description: "When a quality note is added to an agent profile",
    recipientRoles: ["hr"],
    recipientUsernames: [],
  },
];

let cache = null;
let cacheAt = 0;
const CACHE_MS = 30_000;

function db() {
  return getSupabaseAdmin();
}

function mapRow(r) {
  return {
    actionKey: r.action_key,
    label: r.label,
    description: r.description || "",
    recipientRoles: r.recipient_roles || [],
    recipientUsernames: r.recipient_usernames || [],
    enabled: r.enabled !== false,
    updatedAt: r.updated_at,
  };
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

async function loadRulesMap() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  if (!useSupabase()) {
    cache = Object.fromEntries(DEFAULT_RULES.map((r) => [r.actionKey, r]));
    cacheAt = now;
    return cache;
  }
  const { data, error } = await db().from("notification_routing_rules").select("*");
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      cache = Object.fromEntries(DEFAULT_RULES.map((r) => [r.actionKey, r]));
      cacheAt = now;
      return cache;
    }
    throw new Error(error.message);
  }
  const map = Object.fromEntries(DEFAULT_RULES.map((r) => [r.actionKey, { ...r }]));
  for (const row of data || []) {
    map[row.action_key] = mapRow(row);
  }
  cache = map;
  cacheAt = now;
  return cache;
}

async function listRules() {
  const map = await loadRulesMap();
  return DEFAULT_RULES.map((d) => map[d.actionKey] || d);
}

async function getRule(actionKey) {
  const map = await loadRulesMap();
  return map[actionKey] || null;
}

async function upsertRule(actionKey, patch) {
  if (!useSupabase()) throw new Error("Notification routing requires Supabase");
  const existing = await getRule(actionKey);
  const def = DEFAULT_RULES.find((r) => r.actionKey === actionKey);
  if (!def && !existing) throw new Error("Unknown action key");
  const row = {
    action_key: actionKey,
    label: patch.label || existing?.label || def?.label || actionKey,
    description: patch.description ?? existing?.description ?? def?.description ?? "",
    recipient_roles: patch.recipientRoles ?? existing?.recipientRoles ?? def?.recipientRoles ?? [],
    recipient_usernames: patch.recipientUsernames ?? existing?.recipientUsernames ?? [],
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : existing?.enabled !== false,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("notification_routing_rules")
    .upsert(row, { onConflict: "action_key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  invalidateCache();
  return mapRow(data);
}

async function seedDefaultRules() {
  if (!useSupabase()) return { count: DEFAULT_RULES.length };
  for (const def of DEFAULT_RULES) {
    await upsertRule(def.actionKey, def);
  }
  return { count: DEFAULT_RULES.length };
}

async function getRecipients(actionKey, { actor, context = {} } = {}) {
  const rule = await getRule(actionKey);
  if (!rule || rule.enabled === false) return [];

  const roles = [...(rule.recipientRoles || [])];
  const explicit = [...(rule.recipientUsernames || [])];

  const byRole = await notifyRouting.resolveUsernamesByRoles(roles);
  const actorNorm = String(actor || "").trim().toLowerCase();
  const merged = new Set(
    [...byRole, ...explicit.map((u) => String(u || "").trim().toLowerCase())].filter(Boolean)
  );
  merged.delete(actorNorm);

  if (context.extraUsernames) {
    for (const u of context.extraUsernames) {
      const n = String(u || "").trim().toLowerCase();
      if (n && n !== actorNorm) merged.add(n);
    }
  }

  return [...merged];
}

module.exports = {
  DEFAULT_RULES,
  listRules,
  getRule,
  upsertRule,
  seedDefaultRules,
  getRecipients,
  invalidateCache,
};
