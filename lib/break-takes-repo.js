const { getSupabaseAdmin } = require("./supabase-client");
const { egyptTodayDate } = require("./egypt-datetime");
const breaksRepo = require("./break-schedules-repo");

function db() {
  return getSupabaseAdmin();
}

function mapTake(r) {
  return {
    id: r.id,
    scheduleId: r.schedule_id || null,
    employeeId: r.employee_id,
    username: r.username || null,
    unit: r.unit || null,
    company: r.company || "hangup",
    breakName: r.break_name || "",
    allowedMinutes: Number(r.allowed_minutes) || 15,
    startedAt: r.started_at || null,
    endedAt: r.ended_at || null,
    dismissedAt: r.dismissed_at || null,
    egyptDate: r.egypt_date,
    status: r.status,
    americanName: r.american_name || null,
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
  };
}

function takenMinutes(take) {
  if (!take.startedAt) return 0;
  const end = take.endedAt ? new Date(take.endedAt).getTime() : Date.now();
  const start = new Date(take.startedAt).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

function deriveStatusOnEnd(take, endedAt = new Date()) {
  if (!take.startedAt) return "completed";
  const allowedMs = (Number(take.allowedMinutes) || 15) * 60000;
  const elapsed = new Date(endedAt).getTime() - new Date(take.startedAt).getTime();
  return elapsed > allowedMs + 5000 ? "exceeded" : "completed";
}

function isOverdue(take, now = Date.now()) {
  if (!take.startedAt || !["in_progress", "overdue"].includes(take.status)) return false;
  const allowedMs = (Number(take.allowedMinutes) || 15) * 60000;
  return now - new Date(take.startedAt).getTime() > allowedMs;
}

async function getOpenTakeForEmployee(employeeId, scheduleId = null, egyptDate = egyptTodayDate()) {
  let q = db()
    .from("break_takes")
    .select("*")
    .eq("employee_id", String(employeeId))
    .eq("egypt_date", egyptDate)
    .in("status", ["in_progress", "overdue"]);
  if (scheduleId) q = q.eq("schedule_id", scheduleId);
  const { data, error } = await q.order("started_at", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const row = (data || [])[0];
  if (!row) return null;
  const take = mapTake(row);
  if (isOverdue(take) && take.status === "in_progress") {
    return markOverdue(take.id);
  }
  return take;
}

async function markOverdue(takeId) {
  const { data, error } = await db()
    .from("break_takes")
    .update({ status: "overdue", updated_at: new Date().toISOString() })
    .eq("id", takeId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapTake(data);
}

async function startTake({ schedule, employeeId, username, unit, company }) {
  const egyptDate = egyptTodayDate();
  const existing = await getOpenTakeForEmployee(employeeId, schedule.id, egyptDate);
  if (existing) {
    const err = new Error("You already have an open break for this schedule today");
    err.code = "take_open";
    throw err;
  }
  const anyOpen = await getOpenTakeForEmployee(employeeId, null, egyptDate);
  if (anyOpen) {
    const err = new Error("End your current break before starting another");
    err.code = "take_open";
    throw err;
  }
  const row = {
    schedule_id: schedule.id,
    employee_id: String(employeeId),
    username: username || null,
    unit: unit || null,
    company: String(company || schedule.company || "hangup").toLowerCase(),
    break_name: schedule.name || "Break",
    allowed_minutes: Number(schedule.durationMinutes) || 15,
    started_at: new Date().toISOString(),
    egypt_date: egyptDate,
    status: "in_progress",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("break_takes").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapTake(data);
}

async function dismissTake({ schedule, employeeId, username, unit, company }) {
  const egyptDate = egyptTodayDate();
  const open = await getOpenTakeForEmployee(employeeId, schedule.id, egyptDate);
  if (open) {
    const err = new Error("End your in-progress break first");
    err.code = "take_open";
    throw err;
  }
  const { data: existing } = await db()
    .from("break_takes")
    .select("id")
    .eq("employee_id", String(employeeId))
    .eq("schedule_id", schedule.id)
    .eq("egypt_date", egyptDate)
    .eq("status", "dismissed")
    .limit(1);
  if (existing?.length) return mapTake(existing[0]);

  const row = {
    schedule_id: schedule.id,
    employee_id: String(employeeId),
    username: username || null,
    unit: unit || null,
    company: String(company || schedule.company || "hangup").toLowerCase(),
    break_name: schedule.name || "Break",
    allowed_minutes: Number(schedule.durationMinutes) || 15,
    dismissed_at: new Date().toISOString(),
    egypt_date: egyptDate,
    status: "dismissed",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("break_takes").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapTake(data);
}

async function endTake({ takeId, employeeId }) {
  const { data: row, error: readErr } = await db().from("break_takes").select("*").eq("id", takeId).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error("Break take not found");
  if (String(row.employee_id) !== String(employeeId)) {
    const err = new Error("You can only end your own break");
    err.code = "forbidden";
    throw err;
  }
  if (!["in_progress", "overdue"].includes(row.status)) {
    return mapTake(row);
  }
  const take = mapTake(row);
  const endedAt = new Date();
  const status = deriveStatusOnEnd(take, endedAt);
  const { data, error } = await db()
    .from("break_takes")
    .update({
      ended_at: endedAt.toISOString(),
      status,
      updated_at: endedAt.toISOString(),
    })
    .eq("id", takeId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapTake(data);
}

async function listTakes({ egyptDate, company, employeeIds = null, q = "" }) {
  let query = db().from("break_takes").select("*").eq("egypt_date", egyptDate).order("started_at", { ascending: true });
  if (company) query = query.eq("company", String(company).toLowerCase());
  if (Array.isArray(employeeIds)) {
    if (!employeeIds.length) return [];
    query = query.in("employee_id", employeeIds);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let takes = (data || []).map(mapTake);
  for (const t of takes) {
    if (isOverdue(t) && t.status === "in_progress") {
      try {
        const updated = await markOverdue(t.id);
        Object.assign(t, updated);
      } catch {
        /* ignore */
      }
    }
  }
  const needle = String(q || "").trim().toLowerCase();
  if (needle) {
    takes = takes.filter(
      (t) =>
        String(t.americanName || "").toLowerCase().includes(needle) ||
        String(t.employeeId || "").toLowerCase().includes(needle) ||
        String(t.breakName || "").toLowerCase().includes(needle)
    );
  }
  return takes.map((t) => ({ ...t, takenMinutes: takenMinutes(t) }));
}

/** Attach american_name from employees list. */
function enrichTakesWithNames(takes, employees) {
  const byId = new Map((employees || []).map((e) => [String(e.id), e]));
  return (takes || []).map((t) => {
    const emp = byId.get(String(t.employeeId));
    return {
      ...t,
      americanName: emp?.american_name || emp?.americanName || t.americanName || null,
      takenMinutes: takenMinutes(t),
    };
  });
}

module.exports = {
  mapTake,
  takenMinutes,
  deriveStatusOnEnd,
  isOverdue,
  getOpenTakeForEmployee,
  startTake,
  dismissTake,
  endTake,
  listTakes,
  enrichTakesWithNames,
  markOverdue,
};
