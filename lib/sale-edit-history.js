/**
 * Portal-owned sale edit history (MLA + RPM). Not synced from Airtable.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const { normalizeRole } = require("./roles");
const workingDay = require("./sales-working-day");

const HISTORY_ROLES = new Set(["quality", "rtm", "admin", "ceo"]);

const TOP_LEVEL_FIELDS = [
  { key: "phoneNumber", label: "Phone" },
  { key: "fullName", label: "Customer name" },
  { key: "client", label: "Client" },
  { key: "memberId", label: "Member ID" },
  { key: "device", label: "Device" },
  { key: "price", label: "Price" },
  { key: "status", label: "Status" },
  { key: "feedback", label: "Feedback" },
  { key: "agentId", label: "Agent", employee: true },
  { key: "closerId", label: "Closer", employee: true },
  { key: "team", label: "Team" },
  { key: "unit", label: "Unit" },
  { key: "effectiveDate", label: "Effective date" },
  { key: "submissionDate", label: "Submission date & time" },
  { key: "submissionTime", label: "Submission time" },
  { key: "workingDay", label: "Working day" },
];

const SKIP_FORM_KEYS = new Set([
  "agentName",
  "closerName",
  "priceTier",
  "priceTierLabel",
]);

function canViewSaleHistory(userRole) {
  return HISTORY_ROLES.has(normalizeRole(userRole?.role));
}

function db() {
  return getSupabaseAdmin();
}

function stringifyValue(v) {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.map(stringifyValue).join(", ");
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function employeeDisplay(id, employeesById) {
  const emp = employeesById?.get(String(id || ""));
  const name = emp?.american_name || emp?.americanName || "";
  if (!id) return "";
  return name ? `${id} — ${name}` : String(id);
}

function fieldLabel(key, program) {
  try {
    const catalog =
      program === "rpm"
        ? require("./sales-rpm-field-catalog")
        : require("./sales-field-catalog");
    const fields = catalog.FIELDS || catalog.fields || [];
    const hit = fields.find((f) => f.key === key);
    if (hit?.label) return hit.label;
  } catch {
    /* ignore */
  }
  const top = TOP_LEVEL_FIELDS.find((f) => f.key === key);
  return top?.label || key;
}

function flattenSale(sale) {
  const out = {};
  for (const f of TOP_LEVEL_FIELDS) {
    if (sale?.[f.key] !== undefined && sale?.[f.key] !== null && sale?.[f.key] !== "") {
      out[f.key] = sale[f.key];
    } else if (sale?.[f.key] === "" || sale?.[f.key] === null) {
      out[f.key] = sale[f.key];
    }
  }
  const fd = sale?.formData && typeof sale.formData === "object" ? sale.formData : {};
  for (const [k, v] of Object.entries(fd)) {
    if (SKIP_FORM_KEYS.has(k)) continue;
    if (TOP_LEVEL_FIELDS.some((f) => f.key === k)) continue;
    out[`form.${k}`] = v;
  }
  return out;
}

function buildEntries({ program, saleId, before, after, changedBy, source, employees }) {
  const employeesById = new Map((employees || []).map((e) => [String(e.id), e]));
  const beforeFlat = flattenSale(before || {});
  const afterFlat = flattenSale(after || {});
  const keys = new Set([...Object.keys(beforeFlat), ...Object.keys(afterFlat)]);

  // Prefer a single submission date/time line when both date and time change together.
  const beforeSub = workingDay.combineSubmissionDateTime(before?.submissionDate, before?.submissionTime);
  const afterSub = workingDay.combineSubmissionDateTime(after?.submissionDate, after?.submissionTime);
  if (source === "submission_correction" || beforeSub !== afterSub) {
    keys.delete("submissionDate");
    keys.delete("submissionTime");
    keys.delete("form.submissionDate");
  }

  const entries = [];
  const now = new Date().toISOString();

  if (source === "submission_correction" || beforeSub !== afterSub) {
    if (stringifyValue(beforeSub) !== stringifyValue(afterSub)) {
      entries.push({
        program,
        sale_id: saleId,
        changed_at: now,
        changed_by: changedBy,
        field_key: "submissionDateTime",
        field_label: "Submission date & time",
        old_value: stringifyValue(beforeSub),
        new_value: stringifyValue(afterSub),
        old_display: stringifyValue(beforeSub),
        new_display: stringifyValue(afterSub),
        source: source || "edit",
      });
    }
    if (stringifyValue(before?.workingDay) !== stringifyValue(after?.workingDay)) {
      entries.push({
        program,
        sale_id: saleId,
        changed_at: now,
        changed_by: changedBy,
        field_key: "workingDay",
        field_label: "Working day",
        old_value: stringifyValue(before?.workingDay),
        new_value: stringifyValue(after?.workingDay),
        old_display: stringifyValue(before?.workingDay),
        new_display: stringifyValue(after?.workingDay),
        source: source || "submission_correction",
      });
    }
  }

  for (const key of keys) {
    if (key === "submissionDate" || key === "submissionTime") continue;
    const oldVal = beforeFlat[key];
    const newVal = afterFlat[key];
    if (stringifyValue(oldVal) === stringifyValue(newVal)) continue;

    const bareKey = key.startsWith("form.") ? key.slice(5) : key;
    const meta = TOP_LEVEL_FIELDS.find((f) => f.key === bareKey);
    let oldDisplay = stringifyValue(oldVal);
    let newDisplay = stringifyValue(newVal);
    if (meta?.employee || bareKey === "agentId" || bareKey === "closerId" || bareKey === "reviewedBy") {
      oldDisplay = employeeDisplay(oldVal, employeesById) || oldDisplay;
      newDisplay = employeeDisplay(newVal, employeesById) || newDisplay;
    }

    entries.push({
      program,
      sale_id: saleId,
      changed_at: now,
      changed_by: changedBy,
      field_key: bareKey,
      field_label: fieldLabel(bareKey, program),
      old_value: stringifyValue(oldVal),
      new_value: stringifyValue(newVal),
      old_display: oldDisplay,
      new_display: newDisplay,
      source: source || "edit",
    });
  }

  return entries;
}

async function recordSaleDiff(opts) {
  if (!useSupabase()) return [];
  const entries = buildEntries(opts);
  if (!entries.length) return [];
  const { error } = await db().from("sale_edit_history").insert(entries);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      console.warn("sale_edit_history missing:", error.message);
      return [];
    }
    throw new Error(error.message);
  }
  return entries;
}

function mapHistoryRow(r) {
  return {
    id: r.id,
    program: r.program,
    saleId: r.sale_id,
    changedAt: r.changed_at,
    changedBy: r.changed_by,
    fieldKey: r.field_key,
    fieldLabel: r.field_label || r.field_key,
    oldValue: r.old_value,
    newValue: r.new_value,
    oldDisplay: r.old_display ?? r.old_value,
    newDisplay: r.new_display ?? r.new_value,
    source: r.source || "edit",
  };
}

async function listSaleHistory(program, saleId) {
  if (!useSupabase()) return [];
  const { data, error } = await db()
    .from("sale_edit_history")
    .select("*")
    .eq("program", program)
    .eq("sale_id", saleId)
    .order("changed_at", { ascending: false });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapHistoryRow);
}

async function redactHistoryForRole(entries, userRole, program) {
  const role = normalizeRole(userRole?.role);
  let catalog;
  let perms = {};
  try {
    if (program === "rpm") {
      catalog = require("./sales-rpm-field-catalog");
      const business = require("./business-repo");
      const rows = await business.readRpmSalesFieldPermissions();
      perms = Object.fromEntries((rows || []).map((p) => [p.fieldKey, p]));
    } else {
      catalog = require("./sales-field-catalog");
      const business = require("./business-repo");
      const rows = await business.readSalesFieldPermissions();
      perms = Object.fromEntries((rows || []).map((p) => [p.fieldKey, p]));
    }
  } catch {
    return entries;
  }

  return (entries || []).filter((e) => {
    if (["submissionDateTime", "submissionDate", "submissionTime", "workingDay", "status", "agentId", "closerId", "team", "unit"].includes(e.fieldKey)) {
      return true;
    }
    const field = (catalog.FIELDS || []).find((f) => f.key === e.fieldKey);
    if (!field) return true;
    if (typeof catalog.canViewFieldOnSurface === "function") {
      return catalog.canViewFieldOnSurface(field, role, perms[field.key], "main", { user: userRole });
    }
    return true;
  });
}

function sourceLabel(source) {
  switch (String(source || "")) {
    case "submission_correction":
      return "Submission correction";
    case "quality_ticket":
      return "Quality ticket";
    case "create":
      return "Create sale";
    case "delete":
      return "Delete";
    case "attachment":
      return "Attachment";
    default:
      return "Edit sale";
  }
}

module.exports = {
  canViewSaleHistory,
  recordSaleDiff,
  listSaleHistory,
  redactHistoryForRole,
  buildEntries,
  sourceLabel,
  HISTORY_ROLES,
};
