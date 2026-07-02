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

async function createNotification({ username, type, title, body, entityType, entityId }) {
  if (!useSupabase() || !username) return null;
  const row = {
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

async function readNotifications(username, { limit = 50, unreadOnly = false } = {}) {
  if (!useSupabase()) return [];
  let q = db()
    .from("app_notifications")
    .select("*")
    .eq("username", String(username).trim().toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);
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

async function markAllRead(username) {
  if (!useSupabase()) return { ok: true };
  const { error } = await db()
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("username", String(username).trim().toLowerCase())
    .is("read_at", null);
  if (error) throw new Error(error.message);
  return { ok: true };
}

module.exports = {
  createNotification,
  createNotificationsForUsers,
  readNotifications,
  markNotificationRead,
  markAllRead,
};
