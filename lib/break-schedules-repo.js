const { getSupabaseAdmin } = require("./supabase-client");
const { bumpRevision } = require("./settings-revision");

function db() {
  return getSupabaseAdmin();
}

function mapBreak(r) {
  return {
    id: r.id,
    name: r.name,
    startTime: r.start_time,
    endTime: r.end_time,
    durationMinutes: Number(r.duration_minutes) || 15,
    message: r.message || "",
    active: r.active !== false,
    units: r.units || [],
    roles: r.roles || [],
    daysOfWeek: r.days_of_week || [1, 2, 3, 4, 5, 6, 7],
    sortOrder: r.sort_order || 0,
  };
}

function parseHm(hm) {
  const m = String(hm || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function nowMinutesInTz() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function dayOfWeek1Sun() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

function breakAppliesToUser(brk, user) {
  if (!brk.active) return false;
  const days = brk.daysOfWeek || [1, 2, 3, 4, 5, 6, 7];
  if (!days.includes(dayOfWeek1Sun())) return false;
  const units = brk.units || [];
  const roles = brk.roles || [];
  if (units.length && user?.unit && !units.includes(user.unit)) return false;
  if (units.length && !user?.unit) return false;
  if (roles.length && user?.role && !roles.map((r) => String(r).toLowerCase()).includes(String(user.role).toLowerCase())) {
    return false;
  }
  if (roles.length && !user?.role) return false;
  const start = parseHm(brk.startTime);
  const end = parseHm(brk.endTime);
  if (start == null || end == null) return false;
  const now = nowMinutesInTz();
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end;
}

async function readBreakSchedules() {
  const { data, error } = await db().from("break_schedules").select("*").order("sort_order").order("start_time");
  if (error) throw new Error(error.message);
  return (data || []).map(mapBreak);
}

async function upsertBreakSchedule(payload) {
  const row = {
    name: String(payload.name || "").trim(),
    start_time: payload.startTime,
    end_time: payload.endTime,
    duration_minutes: Number(payload.durationMinutes) || 15,
    message: payload.message || "",
    active: payload.active !== false,
    units: payload.units || [],
    roles: payload.roles || [],
    days_of_week: payload.daysOfWeek || [1, 2, 3, 4, 5, 6, 7],
    sort_order: Number(payload.sortOrder) || 0,
    updated_at: new Date().toISOString(),
  };
  let data, error;
  if (payload.id) {
    ({ data, error } = await db().from("break_schedules").update(row).eq("id", payload.id).select().single());
  } else {
    ({ data, error } = await db().from("break_schedules").insert(row).select().single());
  }
  if (error) throw new Error(error.message);
  await bumpRevision();
  return mapBreak(data);
}

async function deleteBreakSchedule(id) {
  const { error } = await db().from("break_schedules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await bumpRevision();
}

function activeBreakForUser(breaks, user) {
  return (breaks || []).find((b) => breakAppliesToUser(b, user)) || null;
}

module.exports = {
  readBreakSchedules,
  upsertBreakSchedule,
  deleteBreakSchedule,
  activeBreakForUser,
  breakAppliesToUser,
};
