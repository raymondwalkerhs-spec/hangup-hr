const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { BCRYPT_ROUNDS } = require("./auth-supabase");
const { getSupabaseAdmin } = require("./supabase-client");
const { normalizeRole } = require("./roles");
const changelog = require("./changelog");

const VALID_STATUSES = ["active", "inactive", "terminated"];
const { MANAGEABLE_ROLES } = require("./permission-catalog");
/** Roles assignable on App Users (includes superadmin alias; IT from permission catalog). */
const ASSIGNABLE_ROLES = [
  "ceo",
  "admin",
  "superadmin",
  ...MANAGEABLE_ROLES.filter((r) => r !== "ceo" && r !== "admin"),
];

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

const APP_USER_COLUMNS = "id, username, email, role, status, employee_id, is_it, last_login_at, created_at, updated_at";
const APP_USER_COLUMNS_FALLBACK = "id, username, email, role, status, employee_id, last_login_at, created_at, updated_at";

function db() {
  return getSupabaseAdmin();
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

async function selectAppUsers(includeIsIt = true) {
  const columns = includeIsIt ? APP_USER_COLUMNS : APP_USER_COLUMNS_FALLBACK;
  const q = db().from("app_users").select(columns).order("username");
  const { data, error } = await q;
  if (error) {
    if (includeIsIt && /is_it|column.*not.*exist/i.test(error.message)) {
      return selectAppUsers(false);
    }
    throw new Error(error.message);
  }
  return (data || []).map((row) => ({
    ...row,
    is_it: row.is_it === true,
  }));
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
  return selectAppUsers(true);
}

async function getAppUser(username) {
  const want = normalizeUsername(username).toLowerCase();
  if (!want) return null;
  const users = await selectAppUsers(true);
  return users.find((u) => String(u.username || "").toLowerCase() === want) || null;
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

async function syncEmployeeLeadRoleFromAppUser(appUser, actor = "system") {
  const employeeId = String(appUser?.employee_id || "").trim();
  if (!employeeId) return;
  const store = require("./data-store");
  const employeeIdentity = require("./employee-identity");
  const emp = store.getEmployeeById(employeeId);
  if (!emp || employeeIdentity.isDeletedEmployee(emp)) return;
  const role = normalizeRole(appUser.role);
  const leadByRole = { tl: "TL", op: "OP", hr: "HR", rtm: "RTM", quality: "QA" };
  const patch = {};
  const wantLead = leadByRole[role] || null;
  if (wantLead && String(emp.lead_role || "").toUpperCase() !== wantLead) {
    patch.lead_role = wantLead;
  }
  if (role === "tl" && !String(emp.position || "").toLowerCase().includes("leader")) {
    patch.position = "Team Leader";
  }
  if (!wantLead && emp.lead_role && !/^TL|^OP|^HR|^RTM|^QA/i.test(String(emp.id || ""))) {
    patch.lead_role = null;
  }
  if (Object.keys(patch).length) {
    await store.updateEmployee(employeeId, patch, actor);
  }
}

async function syncMissingEmployeeLogins(actor, { employees } = {}) {
  const store = require("./data-store");
  const list = employees || store.getEmployees({ hideOut: false });
  const users = await listAppUsers();
  const linked = new Set(
    users.map((u) => String(u.employee_id || u.username || "").trim()).filter(Boolean)
  );
  let created = 0;
  for (const emp of list) {
    if (!emp?.id || linked.has(emp.id)) continue;
    if (isOwnerEmployee(emp)) continue;
    await upsertEmployeeLogin({ employeeId: emp.id, role: inferRoleFromEmployeeId(emp.id) }, actor);
    linked.add(emp.id);
    created += 1;
  }
  return { created, total: list.length };
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
    password_hash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), BCRYPT_ROUNDS),
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

  return sanitizeUser(result.data);
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

async function createAppUser({ username, password, passwordHash, role, status, email }, actor) {
  const name = normalizeUsername(username);
  if (!name) throw new Error("Username is required");
  const hash = String(passwordHash || "").trim();
  if (hash) {
    if (!hash.startsWith("$2")) throw new Error("Invalid password hash");
  } else if (!password || String(password).length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const existing = await getAppUser(name);
  if (existing) throw new Error(`User "${name}" already exists`);

  const row = {
    username: name,
    email: validateEmail(email),
    password_hash: hash || (await bcrypt.hash(String(password), BCRYPT_ROUNDS)),
    role: validateRole(role),
    status: validateStatus(status),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db().from("app_users").insert(row).select().single();
  if (error) throw new Error(error.message);

  await syncEmployeeLeadRoleFromAppUser(data, actor);

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

async function updateAppUser(username, { password, passwordHash, role, status, email, isIt }, actor, options = {}) {
  const name = normalizeUsername(username);
  const existing = await getAppUser(name);
  if (!existing) throw new Error("User not found");

  const patch = { updated_at: new Date().toISOString() };
  const changes = [];
  const hrms = require("./hrms-repo");
  const { destroySessionsForUser } = require("./session-store");
  const actorNorm = normalizeUsername(actor).toLowerCase();
  const isSelf = name.toLowerCase() === actorNorm;

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
  const incomingHash = String(passwordHash || "").trim();
  if (incomingHash) {
    if (!incomingHash.startsWith("$2")) throw new Error("Invalid password hash");
    patch.password_hash = incomingHash;
    patch.password_changed_at = new Date().toISOString();
    changes.push("password: (updated)");
    destroySessionsForUser(name, isSelf ? options.keepSessionId || null : null);
    try {
      await hrms.revokeOtherSessionsForUser(name, isSelf ? options.keepSessionId || null : null);
    } catch (err) {
      console.warn("[users-admin] revokeOtherSessionsForUser failed:", err.message);
    }
  } else if (password !== undefined && String(password).length > 0) {
    if (String(password).length < 8) throw new Error("Password must be at least 8 characters");
    patch.password_hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    patch.password_changed_at = new Date().toISOString();
    changes.push("password: (updated)");
    if (isSelf) {
      destroySessionsForUser(name, options.keepSessionId || null);
      if (options.keepSessionId) {
        try {
          await hrms.revokeOtherSessionsForUser(name, options.keepSessionId);
        } catch (err) {
          console.warn("[users-admin] revokeOtherSessionsForUser failed:", err.message);
        }
      }
    } else {
      destroySessionsForUser(name);
      try {
        await hrms.revokeOtherSessionsForUser(name, null);
      } catch (err) {
        console.warn("[users-admin] revokeOtherSessionsForUser failed:", err.message);
      }
    }
  }

  if (status !== undefined) {
    patch.status = validateStatus(status);
    if (patch.status !== existing.status) {
      if (patch.status === "active" && existing.status === "inactive" && !options.skipActivateGate && !options.allowActivate) {
        const registration = require("./registration");
        if (!registration.canActivateUser(actor)) {
          throw new Error("Only Mark or Raymond may activate employee logins.");
        }
      }
      changes.push(`status: ${existing.status} → ${patch.status}`);
      if (patch.status !== "active") {
        destroySessionsForUser(name);
        try {
          await hrms.revokeOtherSessionsForUser(name, null);
        } catch (err) {
          console.warn("[users-admin] revoke sessions on status change failed:", err.message);
        }
      }
    }
  }

  // IT Access flag — independent of role
  if (isIt !== undefined) {
    patch.is_it = Boolean(isIt);
    const prev = existing.is_it === true;
    const next = patch.is_it;
    if (prev !== next) changes.push(`IT access: ${prev} → ${next}`);
  }

  if (!changes.length) return sanitizeUser(existing);

  let result = await db().from("app_users").update(patch).eq("id", existing.id).select().single();
  if (result.error && patch.is_it !== undefined && /is_it|column.*not.*exist/i.test(result.error.message)) {
    delete patch.is_it;
    result = await db().from("app_users").update(patch).eq("id", existing.id).select().single();
  }
  if (result.error) throw new Error(result.error.message);

  await syncEmployeeLeadRoleFromAppUser(result.data, actor);

  if (patch.role && patch.role !== existing.role) {
    try {
      const store = require("./data-store");
      store.rememberAppUserRole({
        employeeId: result.data.employee_id || existing.employee_id,
        username: name,
        role: patch.role,
      });
    } catch {
      /* cache optional */
    }
    try {
      require("./session-store").updateSessionsRoleForUser(name, patch.role);
    } catch {
      /* in-memory sessions optional */
    }
    try {
      await require("./user-permissions").clearForUser(name);
    } catch (err) {
      console.warn("[users-admin] clear user permission overrides on role change failed:", err.message);
    }
  }

  await changelog.logChange({
    username: actor,
    entity: "app_user",
    entityId: name,
    action: "update",
    field: "*",
    summary: `Updated user ${name}: ${changes.join("; ")}`,
  });

  return sanitizeUser(result.data);
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
  try {
    await require("./hrms-repo").revokeOtherSessionsForUser(name, null);
  } catch (err) {
    console.warn("[users-admin] purge revoke sessions failed:", err.message);
  }
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
    isIt: row.is_it === true,
    lastLoginAt: row.last_login_at || null,
    passwordChangedAt: row.password_changed_at || null,
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
