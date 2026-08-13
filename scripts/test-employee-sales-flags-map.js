const assert = require("assert");
const { mapEmployeeRow } = require("../lib/entity-mappers");
const m = require("../lib/supabase/mappers");

const row = mapEmployeeRow({
  id: "HS1-10",
  sales_mla_enabled: true,
  sales_rpm_enabled: true,
});
assert.equal(row.sales_mla_enabled, true);
assert.equal(row.sales_rpm_enabled, true);

const fromDb = m.mapEmployeeFromDb({
  id: "HS1-10",
  american_name: "Test",
  sales_mla_enabled: true,
  sales_rpm_enabled: false,
});
assert.equal(fromDb.sales_mla_enabled, true);
assert.equal(fromDb.sales_rpm_enabled, false);

console.log("employee sales flags mapping tests passed");
