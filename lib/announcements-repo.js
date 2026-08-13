/**
 * Company-scoped announcements (Hangup vs HS-2).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const storage = require("./storage");
const audience = require("./announcements-audience");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function sanitizeHtml(html) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/javascript:/gi, "");
  s = s.replace(/<\/?(?:iframe|object|embed|link|meta|form|input|button)[^>]*>/gi, "");
  return s;
}

function mapRow(r, { includeBody = true } = {}) {
  if (!r) return null;
  const out = {
    id: r.id,
    company: r.company,
    title: r.title || "",
    imageName: r.image_name || "",
    hasImage: Boolean(r.image_path),
    imagePlacement: audience.normalizePlacement(r.image_placement),
    audioName: r.audio_name || "",
    hasAudio: Boolean(r.audio_path),
    audienceUnits: audience.normalizeList(r.audience_units),
    audienceTeams: audience.normalizeList(r.audience_teams),
    audienceRoles: audience.normalizeRoles(r.audience_roles),
    audienceSummary: "",
    createdBy: r.created_by || "",
    updatedBy: r.updated_by || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  out.companyWide = audience.isCompanyWide(out);
  out.audienceSummary = audience.audienceSummary(out);
  if (includeBody) {
    out.bodyHtml = r.body_html || "";
    out.imagePath = r.image_path || "";
    out.audioPath = r.audio_path || "";
  }
  return out;
}

function publicAnnouncement(row) {
  if (!row) return null;
  const { imagePath: _imagePath, audioPath: _audioPath, ...rest } = row;
  return rest;
}

async function listAnnouncements(company) {
  requireSupabase();
  const { data, error } = await db()
    .from("announcements")
    .select("id, company, title, image_name, image_path, image_placement, audio_name, audio_path, audience_units, audience_teams, audience_roles, created_by, updated_by, created_at, updated_at")
    .eq("company", company || "hangup")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => mapRow(r, { includeBody: false }));
}

async function getAnnouncement(id) {
  requireSupabase();
  const { data, error } = await db().from("announcements").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return mapRow(data, { includeBody: true });
}

async function createAnnouncement({ company, title, bodyHtml, audienceUnits, audienceTeams, audienceRoles, imagePlacement }, actor) {
  requireSupabase();
  const t = String(title || "").trim();
  if (!t) throw new Error("Title is required");
  const row = {
    company: company === "hs2" ? "hs2" : "hangup",
    title: t,
    body_html: sanitizeHtml(bodyHtml),
    audience_units: audience.normalizeList(audienceUnits),
    audience_teams: audience.normalizeList(audienceTeams),
    audience_roles: audience.normalizeRoles(audienceRoles),
    image_placement: audience.normalizePlacement(imagePlacement),
    created_by: actor || "",
    updated_by: actor || "",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("announcements").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapRow(data, { includeBody: true });
}

async function updateAnnouncement(id, patch, actor) {
  requireSupabase();
  const row = {
    updated_by: actor || "",
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) {
    const t = String(patch.title || "").trim();
    if (!t) throw new Error("Title is required");
    row.title = t;
  }
  if (patch.bodyHtml !== undefined) row.body_html = sanitizeHtml(patch.bodyHtml);
  if (patch.audienceUnits !== undefined) row.audience_units = audience.normalizeList(patch.audienceUnits);
  if (patch.audienceTeams !== undefined) row.audience_teams = audience.normalizeList(patch.audienceTeams);
  if (patch.audienceRoles !== undefined) row.audience_roles = audience.normalizeRoles(patch.audienceRoles);
  if (patch.imagePlacement !== undefined) row.image_placement = audience.normalizePlacement(patch.imagePlacement);
  const { data, error } = await db().from("announcements").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapRow(data, { includeBody: true });
}

async function deleteAnnouncement(id) {
  requireSupabase();
  const existing = await getAnnouncement(id);
  if (!existing) return { ok: false };
  if (existing.imagePath) await storage.deleteStorageFile(existing.imagePath).catch(() => {});
  if (existing.audioPath) await storage.deleteStorageFile(existing.audioPath).catch(() => {});
  const { error } = await db().from("announcements").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

function safeFileName(name) {
  return String(name || "file").replace(/[^\w.\-() ]+/g, "_");
}

async function uploadAnnouncementMedia(id, kind, { fileName, buffer, mimeType }, actor) {
  requireSupabase();
  const existing = await getAnnouncement(id);
  if (!existing) throw new Error("Announcement not found");
  const prefix = `announcements/${existing.company}/${id}`;
  const objectPath = `${prefix}/${kind}/${Date.now()}-${safeFileName(fileName)}`;
  const { error } = await require("./supabase-client")
    .getSupabaseAdmin()
    .storage.from(storage.BUCKET)
    .upload(objectPath, buffer, { upsert: true, contentType: mimeType || storage.guessMime(fileName) });
  if (error) throw new Error(`Storage upload: ${error.message}`);

  const prevPath = kind === "image" ? existing.imagePath : existing.audioPath;
  if (prevPath && prevPath !== objectPath) await storage.deleteStorageFile(prevPath).catch(() => {});

  const patch =
    kind === "image"
      ? { image_path: objectPath, image_name: fileName || "image" }
      : { audio_path: objectPath, audio_name: fileName || "audio" };
  patch.updated_by = actor || "";
  patch.updated_at = new Date().toISOString();
  const { data, error: upErr } = await db().from("announcements").update(patch).eq("id", id).select().single();
  if (upErr) throw new Error(upErr.message);
  return mapRow(data, { includeBody: true });
}

async function clearAnnouncementMedia(id, kind, actor) {
  requireSupabase();
  const existing = await getAnnouncement(id);
  if (!existing) throw new Error("Announcement not found");
  const prevPath = kind === "image" ? existing.imagePath : existing.audioPath;
  if (prevPath) await storage.deleteStorageFile(prevPath).catch(() => {});
  const patch =
    kind === "image"
      ? { image_path: null, image_name: null }
      : { audio_path: null, audio_name: null };
  patch.updated_by = actor || "";
  patch.updated_at = new Date().toISOString();
  const { data, error } = await db().from("announcements").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapRow(data, { includeBody: true });
}

module.exports = {
  sanitizeHtml,
  mapRow,
  publicAnnouncement,
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  uploadAnnouncementMedia,
  clearAnnouncementMedia,
};
