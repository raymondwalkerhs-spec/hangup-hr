/**
 * Archive-table recycle bin. Live rows are DELETE'd so old EXEs / SQLite sync drop them.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const storage = require("./storage");

const RETENTION_DAYS = 20;

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    company: r.company || "hangup",
    sourceTable: r.source_table,
    sourceId: r.source_id,
    snapshot: r.snapshot || {},
    storagePaths: r.storage_paths || [],
    deletedBy: r.deleted_by || "",
    deletedAt: r.deleted_at,
  };
}

async function archiveLiveRow({ table, id, company, storagePaths, deletedBy }) {
  requireSupabase();
  const { data, error } = await db().from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, error: "Not found" };
  const paths = storagePaths || [];
  const { error: insErr } = await db().from("recycle_bin").insert({
    company: company || data.company || "hangup",
    source_table: table,
    source_id: String(id),
    snapshot: data,
    storage_paths: paths,
    deleted_by: deletedBy || "",
  });
  if (insErr) throw new Error(insErr.message);
  const { error: delErr } = await db().from(table).delete().eq("id", id);
  if (delErr) throw new Error(delErr.message);
  return { ok: true };
}

async function listRecycle({ company, sourceTable } = {}) {
  requireSupabase();
  await purgeExpired().catch(() => {});
  let q = db()
    .from("recycle_bin")
    .select("id, company, source_table, source_id, storage_paths, deleted_by, deleted_at, snapshot")
    .order("deleted_at", { ascending: false });
  if (company) q = q.eq("company", company === "hs2" ? "hs2" : "hangup");
  if (sourceTable) q = q.eq("source_table", sourceTable);
  const { data, error } = await q;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapRow);
}

async function restore(id) {
  requireSupabase();
  const { data, error } = await db().from("recycle_bin").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Recycle item not found");
  const snap = data.snapshot || {};
  const { error: insErr } = await db().from(data.source_table).insert(snap);
  if (insErr) throw new Error(insErr.message);
  const { error: delErr } = await db().from("recycle_bin").delete().eq("id", id);
  if (delErr) throw new Error(delErr.message);
  return { ok: true, sourceTable: data.source_table, sourceId: data.source_id };
}

async function purgeExpired() {
  if (!useSupabase()) return { purged: 0 };
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db().from("recycle_bin").select("*").lt("deleted_at", cutoff);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return { purged: 0 };
    throw new Error(error.message);
  }
  let purged = 0;
  for (const row of data || []) {
    for (const p of row.storage_paths || []) {
      await storage.deleteStorageFile(p).catch(() => {});
    }
    await db().from("recycle_bin").delete().eq("id", row.id);
    purged += 1;
  }
  return { purged };
}

function canRestoreKind(userRole, sourceTable) {
  const role = String(userRole?.role || "").toLowerCase();
  if (sourceTable === "coaching_tickets") return role === "admin" || role === "ceo";
  if (sourceTable === "announcements") return ["hr", "admin", "ceo", "rtm"].includes(role);
  if (sourceTable === "leave_requests") return ["hr", "admin", "ceo"].includes(role);
  if (sourceTable === "it_requests") return ["it", "admin", "ceo", "rtm"].includes(role);
  if (
    sourceTable === "employee_documents" ||
    sourceTable === "sales_attachments" ||
    sourceTable === "rpm_sales_attachments"
  ) {
    return ["hr", "admin", "ceo", "rtm"].includes(role);
  }
  return role === "admin" || role === "ceo";
}

module.exports = {
  RETENTION_DAYS,
  archiveLiveRow,
  listRecycle,
  restore,
  purgeExpired,
  canRestoreKind,
};
