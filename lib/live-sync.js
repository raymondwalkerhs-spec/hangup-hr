/**
 * Live data sync — server-side realtime hub (Supabase Realtime + SSE).
 *
 * One shared Supabase Realtime subscription per server process listens to
 * Postgres changes on the `attendance_events` and `payroll_adjustments` tables.
 * When any user's edit lands in Supabase, we receive the change and push it to
 * every connected Electron client over Server-Sent Events.
 *
 * The local SQLite cache is intentionally NOT the source of truth for these two
 * tables anymore: reads go straight to Supabase (single source of truth) and
 * Realtime delivers edits to all clients within milliseconds — the "shared
 * Google Sheet" behaviour. This also removes the stale-cache clobber that used
 * to revert attendance edits during sync.
 *
 * Clients connect via GET /api/live/stream. The Broadcaster is a tiny in-process
 * pub/sub; no external message broker required. Clients that cannot reach SSE
 * transparently fall back to the existing polling path.
 */
const { getSupabaseAdmin, isSupabaseConfigured, hasSupabaseAdminKey } = require("../lib/supabase-client");

const TABLES = {
  attendance: "attendance_events",
  payroll: "payroll_adjustments",
};

const clients = new Set();
let channel = null;
let started = false;

function mapAttendance(payload) {
  const row = payload?.new || payload || {};
  return {
    employeeId: row.employee_id || row.employeeId || null,
    date: String(row.date || row.event_date || "").slice(0, 10),
    status: row.status || "",
    transportOverride: row.transport_override || row.transportOverride || "",
    updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

function mapPayroll(payload) {
  const row = payload?.new || payload || {};
  return {
    employeeId: row.employee_id || row.employeeId || null,
    yearMonth: row.year_month || row.yearMonth || "",
    monthlySalaryOverride:
      row.monthly_salary_override ?? row.monthlySalaryOverride ?? null,
    netSalaryOverride: row.net_salary_override ?? row.netSalaryOverride ?? null,
    payrollStatus: row.payroll_status || row.payrollStatus || "",
    updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

const MAPPERS = { attendance: mapAttendance, payroll: mapPayroll };

function broadcast(event) {
  const msg = `event: live\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(msg);
    } catch {
      clients.delete(res);
    }
  }
}

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

function clientCount() {
  return clients.size;
}

async function ensureStarted() {
  if (started) return started;
  started = true; // guard against double-start even if setup fails

  if (!isSupabaseConfigured() || !hasSupabaseAdminKey()) {
    console.warn("[live-sync] Supabase admin not configured — realtime disabled, polling fallback active.");
    return false;
  }
  try {
    const sb = getSupabaseAdmin();
    channel = sb
      .channel("hangup-live-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLES.attendance },
        (payload) => broadcast({ type: "attendance_update", change: mapAttendance(payload) })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLES.payroll },
        (payload) => broadcast({ type: "payroll_update", change: mapPayroll(payload) })
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[live-sync] realtime channel status:", status);
        }
      });
    console.log("[live-sync] realtime subscription started (attendance_events, payroll_adjustments).");
    return true;
  } catch (err) {
    console.warn("[live-sync] failed to start realtime:", err?.message || err);
    return false;
  }
}

module.exports = {
  addClient,
  removeClient,
  clientCount,
  broadcast,
  ensureStarted,
  TABLES,
  MAPPERS,
};
