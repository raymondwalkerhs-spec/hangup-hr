/**
 * Agent self-registration: daily 4-digit PIN + pending approval workflow.
 */
const bcrypt = require("bcrypt");
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const { isEgyptianNationality, normalizeNationality } = require("./employee-compliance");
const { BCRYPT_ROUNDS } = require("./auth-supabase");

const MIN_REG_PASSWORD_LENGTH = 8;

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

function registrationUnitsForCompany(company) {
  const companyContext = require("./company-context");
  return companyContext.unitsForCompanyContext(company);
}

function assertUnitForRegistrationCompany(unit, company) {
  const u = normalizeRegistrationUnit(unit);
  const allowed = registrationUnitsForCompany(company);
  if (!allowed.includes(u)) {
    throw new Error(`Unit ${u} is not allowed for this company`);
  }
  return u;
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

async function getOrCreateDailyPin(date = todayDate(), company = "hangup") {
  requireSupabase();
  const { data: existing } = await db()
    .from("registration_daily_pins")
    .select("*")
    .eq("pin_date", date)
    .eq("company", company)
    .maybeSingle();
  if (existing?.pin) return { date, pin: existing.pin, company };

  const pin = generatePin();
  const { data, error } = await db()
    .from("registration_daily_pins")
    .upsert({ pin_date: date, pin, company }, { onConflict: "pin_date,company" })
    .select()
    .single();
  if (error) {
    // Fallback: if company column doesn't exist yet, try without company
    if (/company.*column.*not.*exist|column.*company/i.test(error.message)) {
      const { data: existing2 } = await db()
        .from("registration_daily_pins")
        .select("*")
        .eq("pin_date", date)
        .maybeSingle();
      if (existing2?.pin) return { date, pin: existing2.pin, company };
      const pin2 = generatePin();
      const { data: d2, error: e2 } = await db()
        .from("registration_daily_pins")
        .upsert({ pin_date: date, pin: pin2 }, { onConflict: "pin_date" })
        .select()
        .single();
      if (e2) throw new Error(e2.message);
      return { date, pin: d2.pin, company };
    }
    throw new Error(error.message);
  }
  return { date, pin: data.pin, company };
}

async function verifyDailyPin(pin, date = todayDate(), company = "hangup") {
  requireSupabase();
  const { data } = await db()
    .from("registration_daily_pins")
    .select("pin")
    .eq("pin_date", date)
    .eq("company", company)
    .maybeSingle();
  if (data?.pin && String(data.pin) === String(pin).trim()) return true;
  // Fallback: if company column doesn't exist yet, try without company filter
  const { data: fallback } = await db()
    .from("registration_daily_pins")
    .select("pin")
    .eq("pin_date", date)
    .maybeSingle();
  return fallback?.pin && String(fallback.pin) === String(pin).trim();
}

async function lookupCompanyByPin(pin, date = todayDate()) {
  requireSupabase();
  const trimmed = String(pin).trim();
  let { data, error } = await db()
    .from("registration_daily_pins")
    .select("company, pin")
    .eq("pin_date", date)
    .eq("pin", trimmed);
  if (error && /company.*column/i.test(error.message)) {
    const { data: fallback } = await db()
      .from("registration_daily_pins")
      .select("pin")
      .eq("pin_date", date)
      .eq("pin", trimmed)
      .maybeSingle();
    return fallback?.pin ? "hangup" : null;
  }
  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  if (data.length > 1) return null;
  return data[0].company || "hangup";
}

async function createRegistrationRequest(payload) {
  requireSupabase();
  const identity = validateIdentityFields(payload);
  const company = String(payload.company || "hangup").trim();
  const legalName = String(payload.fullName || "").trim();
  const legalWords = legalName.split(/\s+/).filter(Boolean);
  if (legalWords.length < 3) throw new Error("Legal name must match your ID and contain at least 3 words");
  const americanName = String(payload.americanName || "").trim().replace(/\s+/g, " ");
  const americanWords = americanName.split(" ").filter(Boolean);
  if (americanWords.length !== 2) throw new Error("American name must be exactly 2 words (First and Last name)");
  const password = String(payload.password || "");
  if (password.length < MIN_REG_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_REG_PASSWORD_LENGTH} characters`);
  }
  if (payload.passwordConfirm != null && password !== String(payload.passwordConfirm)) {
    throw new Error("Password confirmation does not match");
  }
  // If company is hs2, auto-assign unit to HS-2
  const resolvedUnit = company === "hs2" ? "HS-2" : normalizeRegistrationUnit(payload.unit);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const row = {
    american_name: americanName || null,
    arabic_name: legalName || null,
    phone: String(payload.phone || "").trim() || null,
    email: String(payload.email || "").trim() || null,
    unit: resolvedUnit,
    team: null,
    nationality: identity.nationality,
    national_id: identity.nationalId,
    passport_number: identity.passportNumber,
    company: company,
    username: null,
    status: "pending",
    password_hash: passwordHash,
  };
  if (!row.american_name) throw new Error("American name is required");
  if (!row.arabic_name) throw new Error("Legal name is required");

  const { data: dup } = await db()
    .from("agent_registration_requests")
    .select("id")
    .eq("american_name", row.american_name)
    .eq("status", "pending")
    .maybeSingle();
  if (dup) throw new Error("A pending registration already exists for this name");

  let { data, error } = await db().from("agent_registration_requests").insert(row).select().single();
  if (error && /password_hash/i.test(error.message)) {
    throw new Error(
      "Registration password support requires migration 20260801_v220_registration_password_hash.sql. Apply migrations and retry."
    );
  }
  if (error) throw new Error(error.message);
  const mapped = mapRequest(data);
  try {
    const notifyRouting = require("./notify-routing");
    await notifyRouting.notifyRegistrationSubmitted(mapped);
  } catch (err) {
    console.warn("registration notify failed:", err?.message || err);
  }
  return mapped;
}

async function listPendingRegistrations(company) {
  requireSupabase();
  let q = db()
    .from("agent_registration_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (company) q = q.eq("company", company);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(mapRequest);
}

function mapRequest(r) {
  return {
    id: r.id,
    fullName: r.arabic_name,
    legalName: r.arabic_name,
    americanName: r.american_name,
    arabicName: r.arabic_name,
    phone: r.phone,
    email: r.email,
    unit: r.unit,
    team: r.team,
    nationality: r.nationality,
    nationalId: r.national_id,
    passportNumber: r.passport_number,
    company: r.company || "hangup",
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
  const payload = buildEmployeeFromRequest(req, employeeId || "pending", finalUnit, finalTeam);
  if (employeeId) {
    const chosen = String(employeeId).trim();
    await store.createEmployee({ ...payload, id: chosen }, actor, { skipLoginSync: true });
    return chosen;
  }

  const reservedIds = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    const suggestedId = await store.allocateNextAvailableIdAsync(finalUnit, null, reservedIds);
    try {
      await store.createEmployee({ ...payload, id: suggestedId }, actor, { skipLoginSync: true });
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
  if (req.status === "approved") {
    return {
      ok: true,
      alreadyApproved: true,
      employeeId: req.employee_id,
      username: req.username || req.employee_id,
      loginActive: true,
      usedAgentPassword: true,
      tempPassword: null,
    };
  }
  if (req.status !== "pending") throw new Error("Registration is not pending");

  const finalUnit = assertUnitForRegistrationCompany(unit || req.unit || "HS-3", req.company);
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

  // One approval creates employee + active login (agent chose password at registration).
  const loginStatus = "active";
  const passwordHash = String(req.password_hash || "").trim();
  const fallbackTemp = `Hr${String(Math.floor(100000 + Math.random() * 900000))}`;
  const userPayload = {
    role: "agent",
    status: loginStatus,
    email: req.email || "",
  };
  if (passwordHash.startsWith("$2")) {
    userPayload.passwordHash = passwordHash;
  } else {
    userPayload.password = fallbackTemp;
  }

  if (existingUser) {
    await usersAdmin.updateAppUser(loginUsername, userPayload, actor, {
      allowActivate: true,
      skipActivateGate: true,
    });
  } else {
    await usersAdmin.createAppUser(
      {
        username: loginUsername,
        ...userPayload,
      },
      actor
    );
  }
  // Registration email is claimed only — confirmed Gmail comes from Google link later
  const claimed = String(req.email || "").trim().toLowerCase() || null;
  const claimedPatch = {
    employee_id: empId,
    updated_at: new Date().toISOString(),
  };
  if (claimed) {
    claimedPatch.email_claimed = claimed;
    claimedPatch.email = claimed;
  }
  await db()
    .from("app_users")
    .update(claimedPatch)
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
      password_hash: null,
    })
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);

  return {
    ok: true,
    employeeId: empId,
    username: loginUsername,
    loginActive: true,
    usedAgentPassword: Boolean(passwordHash.startsWith("$2")),
    tempPassword: passwordHash.startsWith("$2") ? null : fallbackTemp,
  };
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

async function updatePendingRegistration(id, patch = {}) {
  requireSupabase();
  const { data: req, error } = await db()
    .from("agent_registration_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!req) throw new Error("Registration not found");
  if (req.status !== "pending") throw new Error("Registration is not pending");

  const row = {};
  if (patch.unit !== undefined) {
    row.unit = assertUnitForRegistrationCompany(patch.unit, req.company);
  }
  if (patch.team !== undefined) row.team = String(patch.team || "").trim();
  if (patch.americanName !== undefined || patch.american_name !== undefined) {
    row.american_name = String(patch.americanName ?? patch.american_name ?? "").trim();
  }
  if (patch.legalName !== undefined || patch.arabicName !== undefined || patch.arabic_name !== undefined) {
    row.arabic_name = String(patch.legalName ?? patch.arabicName ?? patch.arabic_name ?? "").trim();
  }
  if (patch.phone !== undefined) row.phone = String(patch.phone || "").trim();
  if (patch.email !== undefined) row.email = String(patch.email || "").trim();
  if (!Object.keys(row).length) {
    return mapRequest(req);
  }

  const { data, error: updErr } = await db()
    .from("agent_registration_requests")
    .update(row)
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single();
  if (updErr) throw new Error(updErr.message);
  return mapRequest(data);
}

module.exports = {
  PIN_VIEW_ROLES,
  canViewDailyPin,
  canApproveRegistration,
  canActivateUser,
  getOrCreateDailyPin,
  verifyDailyPin,
  lookupCompanyByPin,
  createRegistrationRequest,
  listPendingRegistrations,
  approveRegistration,
  rejectRegistration,
  updatePendingRegistration,
  normalizeRegistrationUnit,
  registrationUnitsForCompany,
};
