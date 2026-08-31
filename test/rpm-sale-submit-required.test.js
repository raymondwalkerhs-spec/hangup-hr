const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRpmSaleSubmitPayload } = require("../lib/sales-rpm-submit-required");
const routingConfig = require("../lib/notification-routing-config");

function baseBody(overrides = {}) {
  return {
    agentId: "AG001",
    closerId: "CL001",
    formData: {
      client: "Acme",
      fullName: "Jane Doe",
      phoneNumber: "5551234567",
      alternativePhone: "5559876543",
      dateOfBirth: "1990-01-01",
      memberId: "1A23CD4EF56",
      email: "jane@example.com",
      address: "1 Main St",
      gender: "Female",
      medicalConditions: ["Diabetes"],
      emergencyFullName: "John Doe",
      emergencyPhone: "5551112222",
      emergencyRelation: "Spouse",
    },
    ...overrides,
  };
}

test("empty alternativePhone and emergencyPhone fail", () => {
  const body = baseBody();
  body.formData.alternativePhone = "";
  body.formData.emergencyPhone = "";
  const r = validateRpmSaleSubmitPayload(body);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === "alternativePhone"));
  assert.ok(r.errors.some((e) => e.field === "emergencyPhone"));
});

test("Wrong MCN fails", () => {
  const body = baseBody();
  body.formData.memberId = "1L23CD4EF56";
  const r = validateRpmSaleSubmitPayload(body);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === "memberId" && e.message === "Wrong MCN"));
});

test("digits in fullName fail", () => {
  const body = baseBody();
  body.formData.fullName = "Jane 2";
  const r = validateRpmSaleSubmitPayload(body);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === "fullName"));
});

test("digits in emergencyFullName fail", () => {
  const body = baseBody();
  body.formData.emergencyFullName = "John9";
  const r = validateRpmSaleSubmitPayload(body);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === "emergencyFullName"));
});

test("valid payload passes", () => {
  const r = validateRpmSaleSubmitPayload(baseBody());
  assert.equal(r.ok, true);
});

test("rpm_sale_duplicate default roles include quality, rtm, admin", () => {
  const rules = routingConfig.DEFAULT_RULES || routingConfig.listDefaultRules?.() || [];
  const rule = rules.find((r) => r.actionKey === "rpm_sale_duplicate");
  assert.ok(rule, "rpm_sale_duplicate rule missing");
  assert.deepEqual(rule.recipientRoles, ["quality", "rtm", "admin"]);
});
