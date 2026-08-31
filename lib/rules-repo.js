const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

async function readRulesContent(company) {
  requireSupabase();
  const { data, error } = await db()
    .from("rules_content")
    .select("*")
    .eq("company", company || "hangup")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data || []).map(mapRuleRow);
}

/**
 * Update existing section content (or insert if missing).
 * Partial upsert without title fails Postgres NOT NULL on title — so update first.
 */
async function upsertRulesContent(company, sectionKey, patch, updatedBy) {
  requireSupabase();
  const co = company || "hangup";
  const key = String(sectionKey || "").trim();
  if (!key) throw new Error("sectionKey required");

  const updates = {
    updated_by: updatedBy || "",
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) updates.title = String(patch.title);
  if (patch.content !== undefined) updates.content = String(patch.content);
  if (patch.sortOrder !== undefined) updates.sort_order = patch.sortOrder;

  if (Object.keys(updates).length <= 2 && patch.content === undefined && patch.title === undefined) {
    throw new Error("Nothing to update");
  }

  const { data: updated, error: updateErr } = await db()
    .from("rules_content")
    .update(updates)
    .eq("company", co)
    .eq("section_key", key)
    .select()
    .maybeSingle();

  if (updateErr) throw new Error(updateErr.message);
  if (updated) return mapRuleRow(updated);

  // No existing row — insert with required title
  const insertRow = {
    company: co,
    section_key: key,
    title: patch.title != null && String(patch.title).trim() ? String(patch.title).trim() : key,
    content: patch.content != null ? String(patch.content) : "",
    sort_order: patch.sortOrder != null ? patch.sortOrder : 0,
    updated_by: updatedBy || "",
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error: insertErr } = await db()
    .from("rules_content")
    .insert(insertRow)
    .select()
    .single();
  if (insertErr) throw new Error(insertErr.message);
  return mapRuleRow(inserted);
}

function mapRuleRow(r) {
  return {
    id: r.id,
    company: r.company,
    sectionKey: r.section_key,
    title: r.title,
    content: r.content,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

module.exports = {
  readRulesContent,
  upsertRulesContent,
};
