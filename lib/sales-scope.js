/**
 * Sales visibility: default role scope + delegated grants.
 */
const roles = require("./roles");
const salesActionPerms = require("./sales-action-permissions");

const COMPANY_VIEW_ROLES = ["quality", "rtm", "hr", "admin", "ceo", "finance"];

function saleMatchesGrant(sale, grant) {
  if (grant.scopeType === "company") return true;
  if (grant.scopeType === "unit" && grant.scopeValue) return sale.unit === grant.scopeValue;
  if (grant.scopeType === "team" && grant.scopeValue) {
    const { teamsMatch } = require("./team-names");
    return teamsMatch(sale.team, grant.scopeValue);
  }
  return false;
}

function idsMatch(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (!x || !y) return false;
  return x === y || x.toUpperCase() === y.toUpperCase();
}

/** TL of the sale's team (org leadTeams or TL home team). */
function isTeamLeadOfSale(sale, userRole) {
  const { teamsMatch } = require("./team-names");
  const leadTeams = userRole?.leadTeams || [];
  if (leadTeams.length) {
    return leadTeams.some(
      (lt) => (!lt.unit || !sale.unit || sale.unit === lt.unit) && teamsMatch(sale.team, lt.team)
    );
  }
  if (String(userRole?.role || "").toLowerCase() === "tl" && userRole?.team) {
    if (!teamsMatch(sale.team, userRole.team)) return false;
    return !userRole.unit || !sale.unit || sale.unit === userRole.unit;
  }
  return false;
}

/**
 * Sales log row visibility:
 * 1. TL of that team
 * 2. Assigned closer (sale.closerId)
 * 3. Assigned agent (sale.agentId)
 * Org closer-team membership alone does not grant view.
 */
function defaultCanViewSale(sale, userRole, employees) {
  if (COMPANY_VIEW_ROLES.includes(userRole.role)) return true;
  if (userRole.role === "op") {
    return !userRole.unit || sale.unit === userRole.unit;
  }

  const empId = userRole?.employeeId;
  if (empId && idsMatch(sale.agentId, empId)) return true;
  if (empId && idsMatch(sale.closerId, empId)) return true;
  if (isTeamLeadOfSale(sale, userRole)) return true;

  if (roles.SELF_SCOPED_ROLES?.includes(userRole.role) || userRole.role === "agent") {
    const agentEmp = (employees || []).find((e) => idsMatch(e.id, sale.agentId));
    if (agentEmp && roles.isLedTeamMember(userRole, agentEmp)) return true;
  }

  return false;
}

function filterSalesForUser(sales, userRole, employees, grants = []) {
  const now = Date.now();
  const userGrants = grants.filter(
    (g) =>
      String(g.granteeUsername).toLowerCase() === String(userRole.username || "").toLowerCase() &&
      (!g.expiresAt || new Date(g.expiresAt).getTime() > now)
  );

  return sales.filter((sale) => {
    if (defaultCanViewSale(sale, userRole, employees)) return true;
    return userGrants.some((g) => saleMatchesGrant(sale, g));
  });
}

function canGrantVisibility(granterRole, granteeRole, scopeType) {
  const granterRank = roles.ROLE_RANK?.[granterRole] ?? 0;
  const granteeRank = roles.ROLE_RANK?.[granteeRole] ?? 0;
  if (granterRank < granteeRank) return false;

  if (granterRole === "tl" && granteeRole === "agent" && scopeType !== "team") {
    return false;
  }
  if (granterRole === "tl" && scopeType === "unit") return false;

  const allowedGranters = ["op", "admin", "ceo", "hr", "rtm"];
  if (granterRole === "tl") return true;
  if (!allowedGranters.includes(granterRole)) return false;
  return roles.canGrantSalesVisibility({ role: granterRole });
}

function approverRoles() {
  return ["hr", "admin", "ceo", "quality", "rtm"];
}

function canApproveSale(userRole) {
  if (!roles.canApproveSales(userRole)) return false;
  return salesActionPerms.canPerformActionSync("approve_sale", userRole?.role);
}

function canSubmitSaleDirect(userRole) {
  return canApproveSale(userRole);
}

function initialSaleStatus(submitterRole, requestedStatus) {
  if (canApproveSale({ role: submitterRole })) {
    return requestedStatus || "passed";
  }
  if (submitterRole === "tl" || submitterRole === "op") {
    return "pending";
  }
  return "pending";
}

function countSaleForDashboard(sale, asOfDate) {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  if (sale.status === "denied") return { counted: false, note: null };
  if (sale.status === "pending" || sale.status === "callback") return { counted: false, note: null };
  if (sale.status === "postdated") {
    if (sale.effectiveDate <= asOf) {
      return {
        counted: true,
        note: sale.submissionDate !== sale.effectiveDate
          ? `Postdated from ${sale.submissionDate}`
          : null,
      };
    }
    return { counted: false, note: null };
  }
  if (sale.status === "passed") {
    const countDate = sale.effectiveDate || sale.submissionDate;
    if (countDate <= asOf) return { counted: true, note: null };
  }
  return { counted: false, note: null };
}

function saleInDateRange(sale, from, to) {
  const eff = sale.effectiveDate || "";
  const sub = sale.submissionDate || "";
  const inEff = eff >= from && eff <= to;
  const inSub = sub >= from && sub <= to;
  return inEff || inSub;
}

function buildSalesDashboard(sales, { period, date, groupBy }) {
  const d = date || new Date().toISOString().slice(0, 10);
  let from = d;
  let to = d;
  if (period === "week") {
    const dt = new Date(d + "T12:00:00");
    const day = dt.getDay();
    const monday = new Date(dt);
    monday.setDate(dt.getDate() - ((day + 6) % 7));
    from = monday.toISOString().slice(0, 10);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    to = sunday.toISOString().slice(0, 10);
  } else if (period === "month") {
    const ym = d.slice(0, 7);
    from = `${ym}-01`;
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    to = `${ym}-${String(last).padStart(2, "0")}`;
  }

  const inRange = sales.filter((s) => saleInDateRange(s, from, to));
  const groups = new Map();

  for (const sale of inRange) {
    const { counted, note } = countSaleForDashboard(sale, to);
    let key = "company";
    if (groupBy === "agent") key = sale.agentId;
    else if (groupBy === "team") key = sale.team || "—";
    else if (groupBy === "unit") key = sale.unit || "—";
    else key = "company";

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        passed: 0,
        pending: 0,
        postdated: 0,
        denied: 0,
        callback: 0,
        countedInTarget: 0,
        postdatedNotes: [],
      });
    }
    const g = groups.get(key);
    g[sale.status] = (g[sale.status] || 0) + 1;
    if (counted) {
      g.countedInTarget += 1;
      if (note) g.postdatedNotes.push({ saleId: sale.id, agentId: sale.agentId, note });
    }
  }

  return {
    period,
    from,
    to,
    groupBy: groupBy || "company",
    groups: [...groups.values()],
    total: inRange.length,
    totals: {
      passed: inRange.filter((s) => s.status === "passed" || s.status === "postdated").length,
      pending: inRange.filter((s) => s.status === "pending").length,
      callback: inRange.filter((s) => s.status === "callback").length,
      denied: inRange.filter((s) => s.status === "denied").length,
      postdated: inRange.filter((s) => s.status === "postdated").length,
    },
  };
}

module.exports = {
  defaultCanViewSale,
  isTeamLeadOfSale,
  filterSalesForUser,
  canGrantVisibility,
  canApproveSale,
  canSubmitSaleDirect,
  initialSaleStatus,
  countSaleForDashboard,
  buildSalesDashboard,
  COMPANY_VIEW_ROLES,
};
