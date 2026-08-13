/**
 * Persistent in-app notifications (Supabase app_notifications).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function isMissingTableError(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  return (
    code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

function mapRow(r) {
  return {
    id: r.id,
    company: r.company || "hangup",
    username: r.username,
    type: r.type,
    title: r.title,
    body: r.body || "",
    entityType: r.entity_type || "",
    entityId: r.entity_id || "",
    readAt: r.read_at || null,
    createdAt: r.created_at,
  };
}

async function createNotification({ username, type, title, body, entityType, entityId, company }) {
  if (!useSupabase() || !username) return null;
  const co = String(company || "hangup").trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
  const row = {
    company: co,
    username: String(username).trim().toLowerCase(),
    type,
    title,
    body: body || "",
    entity_type: entityType || null,
    entity_id: entityId || null,
  };
  const { data, error } = await db().from("app_notifications").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

async function createNotificationsForUsers(usernames, payload) {
  const out = [];
  for (const u of usernames) {
    try {
      const n = await createNotification({ ...payload, username: u });
      if (n) out.push(n);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function readNotifications(username, { limit = 50, unreadOnly = false, company } = {}) {
  if (!useSupabase()) return [];
  const co = company ? (String(company).trim().toLowerCase() === "hs2" ? "hs2" : "hangup") : null;
  let q = db()
    .from("app_notifications")
    .select("*")
    .eq("username", String(username).trim().toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (co) q = q.eq("company", co);
  if (unreadOnly) q = q.is("read_at", null);
  const { data, error } = await q;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapRow);
}

async function markNotificationRead(id, username) {
  if (!useSupabase()) return { ok: true };
  const { error } = await db()
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("username", String(username).trim().toLowerCase());
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function markEntityRead(username, entityType, entityId, { company } = {}) {
  if (!useSupabase() || !username || !entityId) return { ok: true };
  let q = db()
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("username", String(username).trim().toLowerCase())
    .eq("entity_type", String(entityType || ""))
    .eq("entity_id", String(entityId))
    .is("read_at", null);
  if (company) {
    const co = String(company).trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
    q = q.eq("company", co);
  }
  const { error } = await q;
  if (error) {
    if (isMissingTableError(error)) return { ok: true };
    throw new Error(error.message);
  }
  return { ok: true };
}

async function markAllRead(username, { company } = {}) {
  if (!useSupabase()) return { ok: true };
  let q = db()
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("username", String(username).trim().toLowerCase())
    .is("read_at", null);
  if (company) {
    const co = String(company).trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
    q = q.eq("company", co);
  }
  const { error } = await q;
  if (error) throw new Error(error.message);
  return { ok: true };
}

module.exports = {
  createNotification,
  createNotificationsForUsers,
  readNotifications,
  markNotificationRead,
  markEntityRead,
  markAllRead,
};
