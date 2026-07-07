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

async function upsertRulesContent(company, sectionKey, patch, updatedBy) {
  requireSupabase();
  const row = {
    company: company || "hangup",
    section_key: sectionKey,
    updated_by: updatedBy || "",
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;

  const { data, error } = await db()
    .from("rules_content")
    .upsert(row, { onConflict: "company, section_key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRuleRow(data);
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
