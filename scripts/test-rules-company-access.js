const assert = require("assert");
const roles = require("../lib/roles");

function main() {
  const admin = { role: "admin", username: "admin1", employeeId: "ADMIN1" };
  const agent = { role: "agent", username: "agent1", employeeId: "AGENT1" };
  const hr = { role: "hr", username: "hr1", employeeId: "HR1" };

  assert.strictEqual(roles.canAccessRulesCompany(admin, "hs2"), true, "admin should access HS2 rules");
  assert.strictEqual(roles.canAccessRulesCompany(admin, "hangup"), true, "admin should access HS3 rules");
  assert.strictEqual(roles.canAccessRulesCompany(agent, "hangup"), true, "agent should access HS3 rules");
  assert.strictEqual(roles.canAccessRulesCompany(agent, "hs2"), false, "agent should not access HS2 rules by default");
  assert.strictEqual(roles.canAccessRulesCompany(hr, "hs2"), true, "hr should access HS2 rules");

  console.log("rules company access checks passed");
}

main();
