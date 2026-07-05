#!/usr/bin/env node
/** Pre-ship debug smoke — writes NDJSON to debug-d741f0.log */
const fs = require("fs");
const path = require("path");
const LOG = path.join(__dirname, "..", "debug-d741f0.log");

function log(hypothesisId, location, message, data = {}) {
  const line = JSON.stringify({
    sessionId: "d741f0",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
    runId: process.env.DEBUG_RUN_ID || "pre-ship",
  });
  fs.appendFileSync(LOG, line + "\n");
}

const roles = require("../lib/roles");
const salesScope = require("../lib/sales-scope");
const teamDashboard = require("../lib/team-dashboard");

const orgTeams = [
  { name: "Ayla", unit: "HS-3", tlEmployeeId: "HS1-05", dialsSales: true },
  { name: "Phoenix", unit: "HS-1", tlEmployeeId: "", dialsSales: true },
];
const employees = [
  { id: "HS1-05", unit: "HS-1", team: "Phoenix", american_name: "Dual" },
  { id: "HS1-10", unit: "HS-1", team: "Phoenix", american_name: "Peer" },
  { id: "HS3-20", unit: "HS-3", team: "Ayla", american_name: "Led" },
];

// H1: sub-router re-enrich without orgTeams wipes leadTeams
const authEnriched = roles.enrichUserRole(
  roles.resolveUserRole("hs1-05", "agent"),
  employees,
  { employee_id: "HS1-05" },
  orgTeams
);
const loanRewritten = roles.enrichUserRole(
  roles.resolveUserRole("hs1-05", "agent"),
  employees
);
log("H1", "debug-pre-ship.js:loan-middleware", "leadTeams after auth vs loan-style re-enrich", {
  authLeadTeams: authEnriched.leadTeams?.length || 0,
  loanLeadTeams: loanRewritten.leadTeams?.length || 0,
  wiped: (authEnriched.leadTeams?.length || 0) > 0 && (loanRewritten.leadTeams?.length || 0) === 0,
});

// H2: scopedEmployees filter path
const scoped = roles.filterEmployeesForUser(employees, authEnriched).map((e) => e.id).sort();
log("H2", "debug-pre-ship.js:scope", "filterEmployeesForUser dual-role", {
  scoped,
  expected: ["HS1-05", "HS3-20"],
  pass: JSON.stringify(scoped) === JSON.stringify(["HS1-05", "HS3-20"]),
});

// H3: export/approve defaults without DB (legacy fn only)
const tlExport = roles.canExportSales({ role: "tl", username: "tl1" });
const adminExport = roles.canExportSales({ role: "admin", username: "admin1" });
log("H3", "debug-pre-ship.js:export", "exportSales defaults", {
  tlExport,
  adminExport,
  tlBlocked: tlExport === false,
  adminAllowed: adminExport === true,
});

// H4: batch list-columns module export
const cols = require("../lib/sales-list-columns");
log("H4", "debug-pre-ship.js:columns", "upsertColumnsBatch exists", {
  hasBatch: typeof cols.upsertColumnsBatch === "function",
});

// H5: weekend DAY-OFF row
const sat = "2026-07-04";
const day = teamDashboard.buildDayDashboard({
  date: sat,
  sales: [],
  employees,
  attendanceRecords: [],
  teamsMeta: orgTeams,
});
const phoenixOff = day.agentRows.some((r) => r.teamKey === "Phoenix" && r.agentName === "DAY-OFF");
log("H5", "debug-pre-ship.js:weekend", "weekend DAY-OFF row", {
  phoenixOff,
  rowCount: day.agentRows.length,
});

// H6: canApproveSales wired through salesScope
const qualityApprove = salesScope.canApproveSale({ role: "quality", username: "q" });
const agentApprove = salesScope.canApproveSale({ role: "agent", username: "a" });
log("H6", "debug-pre-ship.js:approve", "canApproveSale", {
  qualityApprove,
  agentApprove,
});

console.log("Debug smoke written to", LOG);
