/**
 * Agent self-registration: daily 4-digit PIN + pending approval workflow.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const { isEgyptianNationality, normalizeNationality } = require("./employee-compliance");

const PIN_VIEW_ROLES = new Set(["op", "rtm", "hr", "admin", "ceo", "quality"]);
const APPROVE_ROLES = new Set(["op", "admin", "hr", "ceo"]);
const ACTIVATE_OWNERS = new Set(
  String(process.env.ACTIVATE_USERNAMES || process.env.OWNER_USERNAMES || "Mark,Raymond")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function canViewDailyPin(role) {
  return PIN_VIEW_ROLES.has(String(role || "").toLowerCase());
}

function canApproveRegistration(role) {
  return APPROVE_ROLES.has(String(role || "").toLowerCase());
}

function canActivateUser(username) {
  return ACTIVATE_OWNERS.has(String(username || "").trim().toLowerCase());
}

function normalizeRegistrationUnit(unit) {
  const raw = String(unit || "").trim();
  const key = raw.toUpperCase().replace(/\s+/g, "");
  if (key === "HS1" || key === "HS-1") return "HS-1";
  if (key === "HS2" || key === "HS-2") return "HS-2";
  if (key === "HS3" || key === "HS-3") return "HS-3";
  if (key === "HSBACKEND" || key === "HS-BACKEND" || key === "HS-BACK-END") return "HS-Back-End";
  if (key === "HSMGMT" || key === "HS-MGMT") return "HS-MGMT";
  return raw || "HS-3";
}

function validateIdentityFields(payload) {
  const nationality = normalizeNationality(payload.nationality);
  if (!nationality) throw new Error("Nationality is required");
  const nationalId = String(payload.nationalId || "").trim();
  const passport = String(payload.passportNumber || "").trim();
  if (isEgyptianNationality(nationality)) {
    if (!nationalId) throw new Error("National ID is required for Egyptian applicants");
    if (!/^\d{14}$/.test(nationalId)) throw new Error("National ID must be 14 digits");
    return { nationality, nationalId, passportNumber: null };
  }
  if (!passport) throw new Error("Passport number is required for non-Egyptian applicants");
  return { nationality, nationalId: null, passportNumber: passport };
}

async function getOrCreateDailyPin(date = todayDate()) {
  requireSupabase();
  const { data: existing } = await db()
    .from("registration_daily_pins")
    .select("*")
    .eq("pin_date", date)
    .maybeSingle();
  if (existing?.pin) return { date, pin: existing.pin };

  const pin = generatePin();
  const { data, error } = await db()
    .from("registration_daily_pins")
    .upsert({ pin_date: date, pin }, { onConflict: "pin_date" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { date, pin: data.pin };
}

async function verifyDailyPin(pin, date = todayDate()) {
  requireSupabase();
  const { data } = await db()
    .from("registration_daily_pins")
    .select("pin")
    .eq("pin_date", date)
    .maybeSingle();
  return data?.pin && String(data.pin) === String(pin).trim();
}

async function createRegistrationRequest(payload) {
  requireSupabase();
  const identity = validateIdentityFields(payload);
  const row = {
    american_name: String(payload.americanName || "").trim(),
    arabic_name: String(payload.fullName || payload.arabicName || "").trim() || null,
    phone: String(payload.phone || "").trim() || null,
    email: String(payload.email || "").trim() || null,
    unit: normalizeRegistrationUnit(payload.unit),
    team: null,
    nationality: identity.nationality,
    national_id: identity.nationalId,
    passport_number: identity.passportNumber,
    username: null,
    status: "pending",
  };
  if (!row.american_name) throw new Error("American name is required");
  if (!row.arabic_name) throw new Error("Full name is required");

  const { data: dup } = await db()
    .from("agent_registration_requests")
    .select("id")
    .eq("american_name", row.american_name)
    .eq("status", "pending")
    .maybeSingle();
  if (dup) throw new Error("A pending registration already exists for this name");

  const { data, error } = await db().from("agent_registration_requests").insert(row).select().single();
  if (error) throw new Error(error.message);
  const mapped = mapRequest(data);
  try {
    const notifyRouting = require("./notify-routing");
    await notifyRouting.notifyRegistrationSubmitted(mapped);
  } catch {
    /* non-fatal */
  }
  return mapped;
}

async function listPendingRegistrations() {
  requireSupabase();
  const { data, error } = await db()
    .from("agent_registration_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapRequest);
}

function mapRequest(r) {
  return {
    id: r.id,
    fullName: r.arabic_name,
    americanName: r.american_name,
    arabicName: r.arabic_name,
    phone: r.phone,
    email: r.email,
    unit: r.unit,
    team: r.team,
    nationality: r.nationality,
    nationalId: r.national_id,
    passportNumber: r.passport_number,
    username: r.username,
    status: r.status,
    employeeId: r.employee_id,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
  };
}

function buildEmployeeFromRequest(req, empId, finalUnit, finalTeam) {
  return {
    id: empId,
    american_name: req.american_name,
    arabic_name: req.arabic_name || "",
    unit: finalUnit,
    team: finalTeam,
    position: req.inTraining ? "Trainee" : "Agent",
    status: "Active",
    phone: req.phone || "",
    email: req.email || "",
    nationality: req.nationality || "",
    national_id: req.national_id || null,
    passport_number: req.passport_number || null,
    identification: req.national_id || null,
    training_passed: false,
  };
}

function isIdAlreadyExistsError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("already exists") || msg.includes("already reserved") || msg.includes("duplicate");
}

async function createEmployeeForRegistration(store, req, actor, { employeeId, finalUnit, finalTeam }) {
  if (employeeId) {
    const chosen = String(employeeId).trim();
    await store.createEmployee(buildEmployeeFromRequest(req, chosen, finalUnit, finalTeam), actor);
    return chosen;
  }

  const reservedIds = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    const suggestedId = await store.allocateNextAvailableIdAsync(finalUnit, null, reservedIds);
    try {
      await store.createEmployee(buildEmployeeFromRequest(req, suggestedId, finalUnit, finalTeam), actor);
      return suggestedId;
    } catch (err) {
      if (!isIdAlreadyExistsError(err)) throw err;
      reservedIds.push(suggestedId);
    }
  }
  throw new Error(`Could not allocate a free employee ID for unit ${finalUnit}. Sync from cloud and retry.`);
}

async function approveRegistration(id, actor, { employeeId, unit, team } = {}) {
  requireSupabase();
  const store = require("./data-store");
  const usersAdmin = require("./users-admin");

  const { data: req, error } = await db()
    .from("agent_registration_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!req) throw new Error("Registration not found");
  if (req.status !== "pending") throw new Error("Registration is not pending");

  const finalUnit = normalizeRegistrationUnit(unit || req.unit || "HS-3");
  const finalTeam = team !== undefined ? team : "";
  const empId = await createEmployeeForRegistration(store, req, actor, {
    employeeId,
    finalUnit,
    finalTeam,
  });

  const loginUsername = empId;
  const existingUser = await usersAdmin.getAppUser(loginUsername);
  if (existingUser && String(existingUser.status || "").toLowerCase() === "active") {
    throw new Error(`Login username ${loginUsername} is already active on another account`);
  }

  const tempPassword = `Hr${String(Math.floor(100000 + Math.random() * 900000))}`;
  if (existingUser) {
    await usersAdmin.updateAppUser(
      loginUsername,
      { password: tempPassword, role: "agent", status: "inactive", email: req.email || "" },
      actor
    );
  } else {
    await usersAdmin.createAppUser(
      {
        username: loginUsername,
        password: tempPassword,
        role: "agent",
        status: "inactive",
        email: req.email || "",
      },
      actor
    );
  }
  await db()
    .from("app_users")
    .update({ employee_id: empId, updated_at: new Date().toISOString() })
    .eq("username", loginUsername);

  const { error: updErr } = await db()
    .from("agent_registration_requests")
    .update({
      status: "approved",
      employee_id: empId,
      username: loginUsername,
      unit: finalUnit,
      team: finalTeam,
      reviewed_by: actor,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);

  return { ok: true, employeeId: empId, username: loginUsername, tempPassword };
}

async function rejectRegistration(id, actor) {
  requireSupabase();
  const { error } = await db()
    .from("agent_registration_requests")
    .update({
      status: "rejected",
      reviewed_by: actor,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return { ok: true };
}

module.exports = {
  PIN_VIEW_ROLES,
  canViewDailyPin,
  canApproveRegistration,
  canActivateUser,
  getOrCreateDailyPin,
  verifyDailyPin,
  createRegistrationRequest,
  listPendingRegistrations,
  approveRegistration,
  rejectRegistration,
  normalizeRegistrationUnit,
};
