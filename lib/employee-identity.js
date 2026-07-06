/**
 * Stable internal_id vs changeable app ID (employees.id).
 * All FK rewrites for promotion revert, app ID change, and delete-release go through here.
 */
const { getSupabaseAdmin } = require("./supabase-client");

const EMPLOYEE_ID_COLUMNS = [
  { table: "attendance_events", columns: ["employee_id"] },
  { table: "bonus_events", columns: ["employee_id"] },
  { table: "deduction_events", columns: ["employee_id"] },
  { table: "payroll_adjustments", columns: ["employee_id"] },
  { table: "employee_loans", columns: ["employee_id"] },
  { table: "loan_payments", columns: ["employee_id"] },
  { table: "loan_requests", columns: ["employee_id"] },
  { table: "payroll_splits", columns: ["employee_id"] },
  { table: "employee_documents", columns: ["employee_id"] },
  { table: "employee_warnings", columns: ["employee_id"] },
  { table: "employment_periods", columns: ["employee_id"] },
  { table: "leave_requests", columns: ["employee_id"] },
  { table: "action_improvement_plans", columns: ["employee_id"] },
  { table: "onboarding_checklists", columns: ["employee_id"] },
  { table: "offboarding_checklists", columns: ["employee_id"] },
  { table: "clearance_items", columns: ["employee_id"] },
  { table: "equipment_assignments", columns: ["employee_id"] },
  { table: "bonus_requests", columns: ["employee_id", "bonus_employee_id"] },
  { table: "sales", columns: ["agent_id", "closer_id"] },
  { table: "app_users", columns: ["employee_id"] },
];

function db() {
  return getSupabaseAdmin();
}

function deletedPlaceholderId(internalId) {
  const short = String(internalId || "").replace(/-/g, "").slice(0, 12);
  return `DEL-${short}`;
}

function isDeletedEmployee(emp) {
  if (!emp) return false;
  if (emp.deleted_at) return true;
  return String(emp.status || "").trim() === "Deleted";
}

function isUnassignedIdStub(emp) {
  if (!emp?.id || isDeletedEmployee(emp)) return false;
  if (emp.american_name || emp.arabic_name) return false;
  if (emp.promoted_to_id || emp.promoted_from_id) return false;
  return true;
}

function displayAppId(emp) {
  if (!emp) return "";
  if (emp.archived_app_id && String(emp.id || "").startsWith("DEL-")) return emp.archived_app_id;
  return emp.id || "";
}

async function reassignAppIdReferences(fromId, toId) {
  const client = db();
  for (const { table, columns } of EMPLOYEE_ID_COLUMNS) {
    for (const col of columns) {
      const { error } = await client.from(table).update({ [col]: toId }).eq(col, fromId);
      if (error && !/column|does not exist/i.test(error.message)) {
        throw new Error(`${table}.${col}: ${error.message}`);
      }
    }
  }
}

async function syncInternalIdOnRow(table, appIdColumn, appId, internalId) {
  if (!internalId) return;
  const client = db();
  const internalCol =
    table === "sales" && appIdColumn === "agent_id"
      ? "agent_internal_id"
      : table === "sales" && appIdColumn === "closer_id"
        ? "closer_internal_id"
        : "employee_internal_id";
  const { error } = await client
    .from(table)
    .update({ [internalCol]: internalId })
    .eq(appIdColumn, appId);
  if (error && !/column|does not exist/i.test(error.message)) {
    throw new Error(`${table}.${internalCol}: ${error.message}`);
  }
}

async function syncAllInternalIdsForAppId(appId, internalId) {
  for (const { table, columns } of EMPLOYEE_ID_COLUMNS) {
    for (const col of columns) {
      await syncInternalIdOnRow(table, col, appId, internalId);
    }
  }
}

async function migrateEmployeeAppId(oldId, newId) {
  const client = db();
  if (!oldId || !newId) throw new Error("Old and new app IDs are required");
  if (oldId === newId) throw new Error("New app ID must differ from current ID");

  const { data: emp, error: e1 } = await client.from("employees").select("*").eq("id", oldId).maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!emp) throw new Error("Employee not found");
  if (isDeletedEmployee(emp)) throw new Error("Cannot change app ID on a deleted employee record");

  const { data: conflict } = await client.from("employees").select("id").eq("id", newId).maybeSingle();
  if (conflict) throw new Error(`App ID ${newId} is already in use`);

  const internalId = emp.internal_id || null;
  await reassignAppIdReferences(oldId, newId);

  const { error: e2 } = await client.from("employees").update({ id: newId }).eq("id", oldId);
  if (e2) throw new Error(e2.message);

  if (internalId) {
    await syncAllInternalIdsForAppId(newId, internalId);
  }
  return { oldId, newId, internalId };
}

async function releaseEmployeeAppId(appId, username) {
  const client = db();
  const { data: emp, error: e1 } = await client.from("employees").select("*").eq("id", appId).maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!emp) throw new Error("Employee not found");
  if (isDeletedEmployee(emp)) throw new Error("Employee is already deleted");

  const internalId = emp.internal_id || null;
  const placeholder = internalId ? deletedPlaceholderId(internalId) : `DEL-${Date.now()}`;
  const archivedAppId = emp.id;

  await reassignAppIdReferences(appId, placeholder);

  const basePatch = {
    id: placeholder,
    status: "Deleted",
    promoted_to_id: null,
    promoted_from_id: null,
    updated_at: new Date().toISOString(),
  };
  const fullPatch = {
    ...basePatch,
    archived_app_id: archivedAppId,
    deleted_at: new Date().toISOString(),
  };

  let { error: e2 } = await client.from("employees").update(fullPatch).eq("id", appId);
  if (e2 && /column|archived_app_id|deleted_at/i.test(e2.message)) {
    ({ error: e2 } = await client.from("employees").update(basePatch).eq("id", appId));
  }
  if (e2) throw new Error(e2.message);

  if (internalId) {
    await syncAllInternalIdsForAppId(placeholder, internalId);
  }

  try {
    await db().from("org_teams").update({ tl_employee_id: null }).eq("tl_employee_id", appId);
  } catch {
    /* optional */
  }

  try {
    const usersAdmin = require("./users-admin");
    const login = await usersAdmin.getAppUser(archivedAppId);
    if (login) {
      await usersAdmin.deleteAppUser(archivedAppId, username || "system");
    }
  } catch {
    /* optional */
  }

  return {
    internalId,
    archivedAppId,
    placeholderId: placeholder,
    releasedAppId: archivedAppId,
  };
}

module.exports = {
  EMPLOYEE_ID_COLUMNS,
  deletedPlaceholderId,
  isDeletedEmployee,
  isUnassignedIdStub,
  displayAppId,
  reassignAppIdReferences,
  migrateEmployeeAppId,
  releaseEmployeeAppId,
  syncAllInternalIdsForAppId,
};
