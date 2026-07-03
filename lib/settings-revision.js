const { getSupabaseAdmin } = require("./supabase-client");

const KEY = "global";
let memoryRevision = 1;

function db() {
  return getSupabaseAdmin();
}

async function getRevision() {
  try {
    const { data, error } = await db().from("app_settings_revision").select("revision").eq("key", KEY).maybeSingle();
    if (error || !data) return memoryRevision;
    memoryRevision = Number(data.revision) || 1;
    return memoryRevision;
  } catch {
    return memoryRevision;
  }
}

async function bumpRevision() {
  const next = (await getRevision()) + 1;
  const { error } = await db()
    .from("app_settings_revision")
    .upsert({ key: KEY, revision: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  memoryRevision = next;
  return next;
}

module.exports = { getRevision, bumpRevision };
