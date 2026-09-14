const { getSupabaseAdmin } = require("./supabase-client");
const { bumpRevision } = require("./settings-revision");
const { partsInCairo, egyptTodayDate } = require("./egypt-datetime");
const { isDialingAgent } = require("./dialing-agents");

function db() {
  return getSupabaseAdmin();
}

/** Canonical unit tags: HS1 / HS 1 → HS-1 */
function canonicalizeUnit(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  const m = s.match(/^HS\s*-?\s*(\d+)$/i);
  if (m) return `HS-${m[1]}`;
  return s;
}

function canonicalizeUnits(list) {
  return [...new Set((list || []).map(canonicalizeUnit).filter(Boolean))];
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
    units: canonicalizeUnits(r.units || []),
    roles: r.roles || [],
    daysOfWeek: r.days_of_week || [1, 2, 3, 4, 5, 6, 7],
    sortOrder: r.sort_order || 0,
    company: String(r.company || "hangup").toLowerCase(),
    dialingOnly: r.dialing_only !== false,
    effectiveFrom: r.effective_from || null,
    effectiveTo: r.effective_to || null,
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

/** Minutes since midnight in Africa/Cairo. */
function nowMinutesInCairo(date = new Date()) {
  const p = partsInCairo(date);
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0;
  return hour * 60 + parseInt(p.minute, 10);
}

/** Mon=1 … Sun=7 in Africa/Cairo (matches days_of_week storage). */
function dayOfWeekMon1Cairo(date = new Date()) {
  const p = partsInCairo(date);
  const utcGuess = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 12, 0, 0);
  const dow = new Date(utcGuess).getUTCDay(); // 0 Sun … 6 Sat
  return dow === 0 ? 7 : dow;
}

function inEffectiveRange(brk, egyptDate = egyptTodayDate()) {
  const from = brk.effectiveFrom ? String(brk.effectiveFrom).slice(0, 10) : null;
  const to = brk.effectiveTo ? String(brk.effectiveTo).slice(0, 10) : null;
  if (from && egyptDate < from) return false;
  if (to && egyptDate > to) return false;
  return true;
}

/**
 * Schedule audience match (units/roles/dialing/time window).
 * @param {object} brk
 * @param {object} user - enriched userRole
 * @param {object|null} emp - employee row for dialing check
 * @param {{ now?: Date }} opts
 */
function breakAppliesToUser(brk, user, emp = null, opts = {}) {
  if (!brk || brk.active === false) return false;
  const now = opts.now || new Date();
  const egyptDate = egyptTodayDate(now);
  if (!inEffectiveRange(brk, egyptDate)) return false;

  const days = brk.daysOfWeek || [1, 2, 3, 4, 5, 6, 7];
  if (!days.includes(dayOfWeekMon1Cairo(now))) return false;

  const units = canonicalizeUnits(brk.units || []);
  const roles = brk.roles || [];
  const userUnit = canonicalizeUnit(user?.unit);
  const userRole = String(user?.role || "").toLowerCase();

  if (units.length) {
    if (!userUnit || !units.includes(userUnit)) return false;
  }
  if (roles.length) {
    if (!userRole || !roles.map((r) => String(r).toLowerCase()).includes(userRole)) return false;
  }

  if (brk.dialingOnly !== false) {
    if (!emp || !isDialingAgent(emp)) return false;
  }

  const start = parseHm(brk.startTime);
  const end = parseHm(brk.endTime);
  if (start == null || end == null) return false;
  const mins = nowMinutesInCairo(now);
  if (start <= end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

/** Global notifier gate: dialing agent OR role in extraRoles. */
function userPassesNotifierGate(user, emp, extraRoles = []) {
  const role = String(user?.role || "").toLowerCase();
  const extras = (extraRoles || []).map((r) => String(r).toLowerCase()).filter(Boolean);
  if (extras.includes(role)) return true;
  return Boolean(emp && isDialingAgent(emp));
}

function activeBreakForUser(breaks, user, emp = null, opts = {}) {
  const extraRoles = opts.extraRoles || [];
  if (!userPassesNotifierGate(user, emp, extraRoles)) return null;
  return (breaks || []).find((b) => breakAppliesToUser(b, user, emp, opts)) || null;
}

async function readBreakSchedules(company = null) {
  let q = db().from("break_schedules").select("*").order("sort_order").order("start_time");
  if (company) {
    q = q.eq("company", String(company).toLowerCase());
  }
  const { data, error } = await q;
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
  const company = String(payload.company || "hangup").toLowerCase();
  const dialingOnly = payload.dialingOnly !== false && payload.dialing_only !== false;
  const row = {
    name,
    start_time: startTime,
    end_time: endTime,
    duration_minutes: durationMinutes,
    message: payload.message || "",
    active: payload.active !== false,
    units: canonicalizeUnits(payload.units || []),
    roles: Array.isArray(payload.roles) ? payload.roles.map((r) => String(r).trim()).filter(Boolean) : [],
    days_of_week: payload.daysOfWeek || [1, 2, 3, 4, 5, 6, 7],
    sort_order: Number(payload.sortOrder) || 0,
    company,
    dialing_only: dialingOnly,
    effective_from: payload.effectiveFrom || payload.effective_from || null,
    effective_to: payload.effectiveTo || payload.effective_to || null,
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

async function getNotifierExtraRoles() {
  const { data, error } = await db().from("break_config").select("value").eq("key", "notifier_extra_roles").maybeSingle();
  if (error) {
    if (/break_config|does not exist/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  const v = data?.value;
  if (Array.isArray(v)) return v.map(String);
  if (v && Array.isArray(v.roles)) return v.roles.map(String);
  return [];
}

async function setNotifierExtraRoles(roles) {
  const list = [...new Set((roles || []).map((r) => String(r).trim().toLowerCase()).filter(Boolean))];
  const { error } = await db()
    .from("break_config")
    .upsert(
      { key: "notifier_extra_roles", value: list, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw new Error(error.message);
  await bumpRevision();
  return list;
}

module.exports = {
  readBreakSchedules,
  upsertBreakSchedule,
  deleteBreakSchedule,
  activeBreakForUser,
  breakAppliesToUser,
  userPassesNotifierGate,
  canonicalizeUnit,
  canonicalizeUnits,
  nowMinutesInCairo,
  dayOfWeekMon1Cairo,
  inEffectiveRange,
  getNotifierExtraRoles,
  setNotifierExtraRoles,
  calcEndTime,
  normalizeTime24,
};
