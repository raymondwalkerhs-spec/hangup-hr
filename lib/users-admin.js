const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { getSupabaseAdmin } = require("./supabase-client");
const { normalizeRole } = require("./roles");
const changelog = require("./changelog");

const VALID_STATUSES = ["active", "inactive", "terminated"];
const ASSIGNABLE_ROLES = ["ceo", "admin", "superadmin", "hr", "finance", "op", "tl", "quality", "rtm", "public_relations", "office_assistant", "agent"];

const OWNER_USERNAMES = new Set(
  String(process.env.OWNER_USERNAMES || "Mark,Phoebe,Raymond,Eva")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function isOwnerUsername(username) {
  return OWNER_USERNAMES.has(String(username || "").trim().toLowerCase());
}

function isOwnerEmployee(emp) {
  if (!emp) return false;
  const names = [emp.american_name, emp.arabic_name, emp.email]
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean);
  for (const n of names) {
    if (OWNER_USERNAMES.has(n)) return true;
  }
  return false;
}

function db() {
  return getSupabaseAdmin();
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

function normalizeEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return e || null;
}

function validateEmail(email) {
  if (email === undefined || email === null || email === "") return null;
  const e = normalizeEmail(email);
  if (!e) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw new Error("Enter a valid email address or leave blank");
  }
  return e;
}

function validateStatus(status) {
  const s = String(status || "active").trim().toLowerCase();
  if (!VALID_STATUSES.includes(s)) {
    throw new Error(`Status must be one of: ${VALID_STATUSES.join(", ")}`);
  }
  return s;
}

function validateRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (!ASSIGNABLE_ROLES.includes(r)) {
    throw new Error(`Role must be one of: ${ASSIGNABLE_ROLES.join(", ")}`);
  }
  return r;
}

async function listAppUsers() {
  const { data, error } = await db()
    .from("app_users")
    .select("id, username, email, role, status, employee_id, last_login_at, created_at, updated_at")
    .order("username");
  if (error) throw new Error(error.message);
  return data || [];
}

async function getAppUser(username) {
  const want = normalizeUsername(username).toLowerCase();
  if (!want) return null;
  const { data, error } = await db()
    .from("app_users")
    .select("id, username, email, role, status, employee_id, last_login_at, created_at, updated_at");
  if (error) throw new Error(error.message);
  return (data || []).find((u) => String(u.username).toLowerCase() === want) || null;
}

function inferRoleFromEmployeeId(employeeId) {
  const s = String(employeeId || "").trim().toUpperCase();
  if (s.startsWith("HR")) return "hr";
  if (s.startsWith("RTM")) return "rtm";
  if (s.startsWith("TL")) return "tl";
  if (s.startsWith("OP")) return "op";
  if (s.startsWith("CL")) return "tl";
  if (s.startsWith("QA")) return "quality";
  if (s.startsWith("MG")) return "admin";
  return "agent";
}

async function syncMissingEmployeeLogins(actor) {
  const store = require("./data-store");
  const employees = store.getEmployees({ hideOut: false });
  const users = await listAppUsers();
  const linked = new Set(
    users.map((u) => String(u.employee_id || u.username || "").trim()).filter(Boolean)
  );
  let created = 0;
  for (const emp of employees) {
    if (!emp?.id || linked.has(emp.id)) continue;
    if (isOwnerEmployee(emp)) continue;
    await upsertEmployeeLogin({ employeeId: emp.id, role: inferRoleFromEmployeeId(emp.id) }, actor);
    linked.add(emp.id);
    created += 1;
  }
  return { created, total: employees.length };
}

async function upsertEmployeeLogin({ employeeId, role }, actor) {
  const id = String(employeeId || "").trim();
  if (!id) throw new Error("employeeId is required");
  const appRole = role ? validateRole(role) : inferRoleFromEmployeeId(id);

  const existing = await getAppUser(id);
  if (existing) {
    const patch = { updated_at: new Date().toISOString() };
    if (!existing.employee_id) patch.employee_id = id;
    if (patch.employee_id || Object.keys(patch).length > 1) {
      const { data, error } = await db()
        .from("app_users")
        .update(patch)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return sanitizeUser(data);
    }
    return sanitizeUser(existing);
  }

  const row = {
    username: id,
    employee_id: id,
    email: null,
    password_hash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
    role: appRole,
    status: "inactive",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db().from("app_users").insert(row).select().single();
  if (error) throw new Error(error.message);

  await changelog.logChange({
    username: actor,
    entity: "app_user",
    entityId: id,
    action: "create",
    field: "username",
    newValue: id,
    summary: `Auto-created inactive login for employee ${id}`,
  });

  return sanitizeUser(data);
}

async function touchLastLogin(username) {
  const name = normalizeUsername(username);
  if (!name) return;
  const existing = await getAppUser(name);
  if (!existing) return;
  const now = new Date().toISOString();
  const { error } = await db()
    .from("app_users")
    .update({ last_login_at: now, updated_at: now })
    .eq("id", existing.id);
  if (error) throw new Error(error.message);
}

async function createAppUser({ username, password, role, status, email }, actor) {
  const name = normalizeUsername(username);
  if (!name) throw new Error("Username is required");
  if (!password || String(password).length < 4) {
    throw new Error("Password must be at least 4 characters");
  }

  const existing = await getAppUser(name);
  if (existing) throw new Error(`User "${name}" already exists`);

  const row = {
    username: name,
    email: validateEmail(email),
    password_hash: await bcrypt.hash(String(password), 10),
    role: validateRole(role),
    status: validateStatus(status),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db().from("app_users").insert(row).select().single();
  if (error) throw new Error(error.message);

  await changelog.logChange({
    username: actor,
    entity: "app_user",
    entityId: name,
    action: "create",
    field: "username",
    newValue: name,
    summary: `Created user ${name} (${row.role}, ${row.status})`,
  });

  return sanitizeUser(data);
}

async function updateAppUser(username, { password, role, status, email }, actor) {
  const name = normalizeUsername(username);
  const existing = await getAppUser(name);
  if (!existing) throw new Error("User not found");

  const patch = { updated_at: new Date().toISOString() };
  const changes = [];

  if (email !== undefined) {
    patch.email = validateEmail(email);
    const prev = existing.email || "";
    const next = patch.email || "";
    if (prev !== next) changes.push(`email: ${prev || "(none)"} → ${next || "(none)"}`);
  }

  if (role !== undefined) {
    patch.role = validateRole(role);
    if (patch.role !== existing.role) changes.push(`role: ${existing.role} → ${patch.role}`);
  }
  if (password !== undefined && String(password).length > 0) {
    if (String(password).length < 4) throw new Error("Password must be at least 4 characters");
    patch.password_hash = await bcrypt.hash(String(password), 10);
    changes.push("password: (updated)");
    const actorNorm = normalizeUsername(actor).toLowerCase();
    if (name.toLowerCase() !== actorNorm) {
      const { destroySessionsForUser } = require("./session-store");
      destroySessionsForUser(name);
    }
  }

  if (status !== undefined) {
    patch.status = validateStatus(status);
    if (patch.status !== existing.status) {
      if (patch.status === "active" && existing.status === "inactive") {
        const registration = require("./registration");
        if (!registration.canActivateUser(actor)) {
          throw new Error("Only Mark or Raymond may activate employee logins.");
        }
      }
      changes.push(`status: ${existing.status} → ${patch.status}`);
      if (patch.status !== "active") {
        const { destroySessionsForUser } = require("./session-store");
        destroySessionsForUser(name);
      }
    }
  }

  if (!changes.length) return sanitizeUser(existing);

  const { data, error } = await db()
    .from("app_users")
    .update(patch)
    .eq("id", existing.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await changelog.logChange({
    username: actor,
    entity: "app_user",
    entityId: name,
    action: "update",
    field: "*",
    summary: `Updated user ${name}: ${changes.join("; ")}`,
  });

  return sanitizeUser(data);
}

async function deleteAppUser(username, actor) {
  const name = normalizeUsername(username);
  const actorName = normalizeUsername(actor);

  if (name.toLowerCase() === actorName.toLowerCase()) {
    throw new Error("You cannot delete your own account");
  }

  const existing = await getAppUser(name);
  if (!existing) throw new Error("User not found");

  const { error } = await db().from("app_users").delete().eq("id", existing.id);
  if (error) throw new Error(error.message);

  await changelog.logChange({
    username: actor,
    entity: "app_user",
    entityId: name,
    action: "delete",
    field: "username",
    oldValue: name,
    summary: `Deleted user ${name}`,
  });

  return { ok: true, username: name };
}

async function findAppUserByEmployeeId(employeeId) {
  const id = String(employeeId || "").trim();
  if (!id) return null;
  const users = await listAppUsers();
  return (
    users.find(
      (u) =>
        String(u.employee_id || "").trim() === id ||
        String(u.username || "").trim().toLowerCase() === id.toLowerCase()
    ) || null
  );
}

async function purgeAppUserAndReleaseId(username, actor) {
  const name = normalizeUsername(username);
  const actorName = normalizeUsername(actor);

  if (name.toLowerCase() === actorName.toLowerCase()) {
    throw new Error("You cannot purge your own account");
  }
  if (isOwnerUsername(name)) {
    throw new Error("Owner accounts cannot be purged");
  }

  let existing = await getAppUser(name);
  if (!existing) {
    existing = await findAppUserByEmployeeId(name);
  }
  if (!existing) throw new Error("User not found");

  const store = require("./data-store");
  const employeeIdentity = require("./employee-identity");
  const userPermissions = require("./user-permissions");
  const { destroySessionsForUser } = require("./session-store");

  let releasedAppId = null;
  let placeholderId = null;

  const employeeId = String(existing.employee_id || existing.username || "").trim();
  if (employeeId) {
    const emp = store.getEmployeeById(employeeId);
    if (emp && isOwnerEmployee(emp)) {
      throw new Error("Owner employee records cannot be purged");
    }
    if (emp && !employeeIdentity.isDeletedEmployee(emp)) {
      const result = await store.releaseEmployeeAppId(employeeId, actor);
      releasedAppId = result.releasedAppId || result.archivedAppId || employeeId;
      placeholderId = result.placeholderId || null;
    } else if (emp && employeeIdentity.isDeletedEmployee(emp)) {
      releasedAppId = emp.archived_app_id || employeeId;
      placeholderId = emp.id;
    }
  }

  try {
    await userPermissions.clearForUser(name);
  } catch {
    /* optional */
  }

  destroySessionsForUser(name);
  if (employeeId && employeeId.toLowerCase() !== name.toLowerCase()) {
    destroySessionsForUser(employeeId);
  }

  const { error } = await db().from("app_users").delete().eq("id", existing.id);
  if (error) throw new Error(error.message);

  await store.refreshCache();

  await changelog.logChange({
    username: actor,
    entity: "app_user",
    entityId: name,
    action: "purge",
    field: "username",
    oldValue: name,
    summary: `Purged user ${name}${releasedAppId ? ` — released ID ${releasedAppId}` : ""}`,
  });

  return {
    ok: true,
    username: name,
    releasedAppId,
    placeholderId,
    employeeId: employeeId || null,
  };
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email || "",
    role: row.role || "",
    status: row.status || "active",
    employeeId: row.employee_id || "",
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  VALID_STATUSES,
  ASSIGNABLE_ROLES,
  OWNER_USERNAMES,
  isOwnerUsername,
  isOwnerEmployee,
  listAppUsers,
  getAppUser,
  createAppUser,
  updateAppUser,
  deleteAppUser,
  purgeAppUserAndReleaseId,
  upsertEmployeeLogin,
  touchLastLogin,
  inferRoleFromEmployeeId,
  syncMissingEmployeeLogins,
};
