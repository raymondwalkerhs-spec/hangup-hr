const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function normUser(username) {
  return String(username || "").trim().toLowerCase();
}

async function listReadIds(username, announcementIds = []) {
  requireSupabase();
  const user = normUser(username);
  const ids = [...new Set((announcementIds || []).filter(Boolean))];
  if (!user || !ids.length) return new Set();
  const { data, error } = await db()
    .from("announcement_reads")
    .select("announcement_id")
    .eq("username", user)
    .in("announcement_id", ids);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.announcement_id));
}

async function attachUnread(items, username) {
  const list = Array.isArray(items) ? items : [];
  const read = await listReadIds(username, list.map((i) => i.id));
  return list.map((item) => ({ ...item, unread: !read.has(item.id) }));
}

async function unreadCountFor(items, username) {
  const withUnread = await attachUnread(items, username);
  return withUnread.filter((i) => i.unread).length;
}

async function markAnnouncementRead(username, announcementId) {
  requireSupabase();
  const user = normUser(username);
  if (!user || !announcementId) return { ok: false };
  const { error } = await db().from("announcement_reads").upsert(
    {
      username: user,
      announcement_id: announcementId,
      read_at: new Date().toISOString(),
    },
    { onConflict: "username,announcement_id" }
  );
  if (error) throw new Error(error.message);
  try {
    const notifyStore = require("./notify-store");
    await notifyStore.markEntityRead(user, "announcement", announcementId);
  } catch {
    /* notifications optional */
  }
  return { ok: true };
}

module.exports = {
  listReadIds,
  attachUnread,
  unreadCountFor,
  markAnnouncementRead,
};
