const assert = require("assert");
const {
  collectLeadershipEmployeeIds,
  resolveSalesProgramFlags,
  isSalesLeadershipEmployee,
} = require("../lib/sale-program-employee");

const orgTeams = [
  {
    tlEmployeeId: "TL100",
    tlEmployeeIds: ["TL101"],
    closerEmployeeIds: ["CL50", "AG200"],
  },
];

const leadershipIds = collectLeadershipEmployeeIds(orgTeams);
assert(leadershipIds.has("TL100"));
assert(leadershipIds.has("TL101"));
assert(leadershipIds.has("CL50"));
assert(leadershipIds.has("AG200"));

assert(isSalesLeadershipEmployee({ id: "OP22" }, leadershipIds));
assert(isSalesLeadershipEmployee({ id: "AG200" }, leadershipIds));
assert(!isSalesLeadershipEmployee({ id: "AG300" }, leadershipIds));

const tlFlags = resolveSalesProgramFlags(
  { id: "TL100", status: "Active", unit: "HS-1", team: "A", position: "Team Leader" },
  { leadershipIds }
);
assert.deepStrictEqual(tlFlags, { sales_mla_enabled: true, sales_rpm_enabled: true });

const dialerFlags = resolveSalesProgramFlags(
  { id: "AG300", status: "Active", unit: "HS-1", team: "A", position: "Agent" },
  { leadershipIds }
);
assert.deepStrictEqual(dialerFlags, { sales_mla_enabled: false, sales_rpm_enabled: true });

const outFlags = resolveSalesProgramFlags(
  { id: "AG301", status: "Out", unit: "HS-1", team: "A", position: "Agent" },
  { leadershipIds }
);
assert.strictEqual(outFlags, null);

const pausedDialer = resolveSalesProgramFlags(
  { id: "AG302", status: "Paused", unit: "HS-1", team: "A", position: "Agent" },
  { leadershipIds }
);
assert.deepStrictEqual(pausedDialer, { sales_mla_enabled: false, sales_rpm_enabled: true });

console.log("sale-program-employee tests passed");
