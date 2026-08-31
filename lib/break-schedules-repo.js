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

function calcEndTime(startTime, durationMinutes) {
  const m = String(startTime || "10:00").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "10:15";
  let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (Number(durationMinutes) || 15);
  mins = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(mins / 60);
  const mi = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

function normalizeTime24(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const mi = parseInt(ampm[2], 10);
    const isPm = ampm[3].toUpperCase() === "PM";
    if (h < 1 || h > 12 || mi < 0 || mi > 59) return null;
    if (h === 12) h = isPm ? 12 : 0;
    else if (isPm) h += 12;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  const h24 = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!h24) return null;
  const h = parseInt(h24[1], 10);
  const mi = parseInt(h24[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

function parseHm(hm) {
  const normalized = normalizeTime24(hm);
  if (!normalized) return null;
  const m = normalized.match(/^(\d{1,2}):(\d{2})/);
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
  const durationMinutes = Number(payload.durationMinutes) || 15;
  const startTime = normalizeTime24(payload.startTime);
  if (!startTime) throw new Error("Invalid start time (use HH:MM or h:mm AM/PM)");
  const endTime = normalizeTime24(payload.endTime) || calcEndTime(startTime, durationMinutes);
  const name = String(payload.name || "").trim();
  if (!name) throw new Error("Break name is required");
  const row = {
    name,
    start_time: startTime,
    end_time: endTime,
    duration_minutes: durationMinutes,
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
