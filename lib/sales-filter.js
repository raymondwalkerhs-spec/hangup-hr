/**
 * Advanced sales log filter evaluation (AND / OR / NOT groups).
 */

function norm(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function saleFieldValue(sale, field) {
  if (!sale) return "";
  const fd = sale.formData || {};
  switch (field) {
    case "agentId":
      return sale.agentId || "";
    case "closerId":
      return sale.closerId || "";
    case "client":
      return sale.client || fd.client || "";
    case "device":
      return sale.device || fd.deviceType || "";
    case "team":
      return sale.team || fd.team || "";
    case "unit":
      return sale.unit || fd.unit || "";
    case "status":
      return sale.status || "";
    case "customer":
      return sale.fullName || "";
    case "phoneNumber":
      return sale.phoneNumber || fd.phoneNumber || "";
    case "workingDay":
      return sale.workingDay || String(sale.submissionDate || "").slice(0, 10);
    case "submissionTime":
      return sale.submissionTime || "";
    default:
      return fd[field] != null ? fd[field] : sale[field] != null ? sale[field] : "";
  }
}

function evalRule(sale, rule) {
  const field = rule.field || rule.column;
  const op = String(rule.op || rule.operator || "IS").toUpperCase();
  const rawVal = rule.value;
  const val = saleFieldValue(sale, field);
  const nVal = norm(val);
  const targets = Array.isArray(rawVal) ? rawVal : [rawVal];

  if (op === "IS EMPTY") return !nVal;
  if (op === "IS NOT EMPTY") return !!nVal;

  if (op === "CONTAINS") {
    const needle = norm(rawVal);
    return nVal.includes(needle);
  }

  if (op === "IS NOT") {
    return targets.every((t) => nVal !== norm(t));
  }

  if (op === "IS") {
    return targets.some((t) => nVal === norm(t));
  }

  if (op === "ON") {
    const day = String(val).slice(0, 10);
    return day === String(rawVal).slice(0, 10);
  }
  if (op === "BEFORE") {
    return String(val).slice(0, 10) < String(rawVal).slice(0, 10);
  }
  if (op === "AFTER") {
    return String(val).slice(0, 10) > String(rawVal).slice(0, 10);
  }

  return true;
}

function evalGroup(sale, group) {
  if (!group) return true;
  const rules = group.rules || group.conditions || [];
  const op = String(group.op || group.logic || "AND").toUpperCase();

  if (op === "NOT") {
    const inner = rules.length ? evalGroup(sale, { op: "AND", rules }) : evalRule(sale, group);
    return !inner;
  }

  if (op === "OR") {
    return rules.length ? rules.some((r) => (r.rules ? evalGroup(sale, r) : evalRule(sale, r))) : true;
  }

  return rules.length ? rules.every((r) => (r.rules ? evalGroup(sale, r) : evalRule(sale, r))) : true;
}

function applySalesFilter(sales, filterJson) {
  if (!filterJson) return sales || [];
  let filter = filterJson;
  if (typeof filterJson === "string") {
    try {
      filter = JSON.parse(filterJson);
    } catch {
      return sales || [];
    }
  }
  if (!filter.rules && !filter.field) return sales || [];
  return (sales || []).filter((s) => evalGroup(s, filter));
}

module.exports = {
  saleFieldValue,
  evalRule,
  evalGroup,
  applySalesFilter,
};
