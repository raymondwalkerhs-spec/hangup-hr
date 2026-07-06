/**
 * DB-backed sales attachment kind permissions.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const catalog = require("./sales-field-catalog");

const CACHE_MS = 60_000;
let cache = null;
let cacheAt = 0;

function db() {
  return getSupabaseAdmin();
}

function defaultMap() {
  return Object.fromEntries(
    catalog.ATTACHMENT_KINDS.map((k) => [
      k.key,
      {
        attachmentKey: k.key,
        label: k.label,
        viewRoles: [...k.viewRoles],
        editRoles: [...k.editRoles],
      },
    ])
  );
}

async function loadMap() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  if (!useSupabase()) {
    cache = defaultMap();
    cacheAt = now;
    return cache;
  }
  const { data, error } = await db().from("sales_attachment_permissions").select("*");
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
    map[row.attachment_key] = {
      attachmentKey: row.attachment_key,
      label: row.label || map[row.attachment_key]?.label,
      viewRoles: row.view_roles || [],
      editRoles: row.edit_roles || [],
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

async function upsert(attachmentKey, patch) {
  if (!useSupabase()) throw new Error("Requires supabase");
  const row = {
    attachment_key: attachmentKey,
    label: patch.label,
    view_roles: patch.viewRoles || patch.view_roles || [],
    edit_roles: patch.editRoles || patch.edit_roles || [],
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("sales_attachment_permissions")
    .upsert(row, { onConflict: "attachment_key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  invalidateCache();
  return {
    attachmentKey: data.attachment_key,
    label: data.label,
    viewRoles: data.view_roles || [],
    editRoles: data.edit_roles || [],
  };
}

async function seedDefaults() {
  if (!useSupabase()) return { count: catalog.ATTACHMENT_KINDS.length };
  for (const k of catalog.ATTACHMENT_KINDS) {
    await db()
      .from("sales_attachment_permissions")
      .upsert(
        {
          attachment_key: k.key,
          label: k.label,
          view_roles: k.viewRoles,
          edit_roles: k.editRoles,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "attachment_key" }
      );
  }
  invalidateCache();
  return { count: catalog.ATTACHMENT_KINDS.length };
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = {
  loadMap,
  listAll,
  upsert,
  seedDefaults,
  invalidateCache,
  defaultMap,
};
