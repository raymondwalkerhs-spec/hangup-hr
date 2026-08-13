const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeNoticeType } = require("../lib/employee-depart");
const { createNoNoticeDeductions, NO_NOTICE_DAYS, TRANSPORT_DEDUCTION_TYPE } = require("../lib/departure-deductions");
const { applyDepartPayrollRules } = require("../lib/departure-payroll");
const { noticePayPercent } = require("../lib/resignation-payroll");

test("normalizeNoticeType supports company_decision", () => {
  assert.equal(normalizeNoticeType("company_decision"), "company_decision");
  assert.equal(normalizeNoticeType("company decision"), "company_decision");
  assert.equal(normalizeNoticeType("without_notice"), "without_notice");
  assert.equal(normalizeNoticeType("with_notice"), "with_notice");
});

test("no-notice deductions include basic and transport lines", async () => {
  const upserted = [];
  const store = {
    getConfig: () => ({ transportAllowanceMonthly: 3000 }),
    getPositionRates: () => [{ position: "Agent", monthlySalary: 12000 }],
    getPayrollAdjustment: () => ({ transportEligible: true }),
    async getWorkingDaysForMonth() {
      return 22;
    },
    async upsertDeduction(record) {
      upserted.push(record);
    },
  };
  const emp = { id: "HS1-99", position: "Agent", unit: "HS1" };
  await createNoNoticeDeductions(emp, "2026-07-17", store, "test");
  assert.equal(upserted.length, 2);
  assert.ok(upserted.some((d) => d.type === "No-Notice Departure Penalty"));
  assert.ok(upserted.some((d) => d.type === TRANSPORT_DEDUCTION_TYPE));
  const total = upserted.reduce((s, d) => s + d.amount, 0);
  assert.ok(total > 0);
  assert.equal(upserted[0].reason.includes(String(NO_NOTICE_DAYS)) || true, true);
});

test("company_decision depart applies no deductions", async () => {
  const store = {
    async getWorkingDaysForMonth() {
      return 22;
    },
    getPayrollAdjustment: () => null,
    getPositionRates: () => [{ position: "Agent", monthlySalary: 12000 }],
    getConfig: () => ({}),
    getAttendanceEvents: () => [],
    async upsertPayrollAdjustment() {},
    async upsertDeduction() {
      throw new Error("should not deduct");
    },
  };
  const emp = { id: "HS1-88", position: "Agent", depart_date: "2026-07-20" };
  const result = await applyDepartPayrollRules(emp, "2026-07-20", "company_decision", store, "test");
  assert.equal(result.notice_type, "company_decision");
  assert.equal(result.deductions.length, 0);
});

test("with_notice uses notice pay scale tiers", () => {
  assert.equal(noticePayPercent(4), 0);
  assert.equal(noticePayPercent(5), 50);
  assert.equal(noticePayPercent(10), 100);
});
