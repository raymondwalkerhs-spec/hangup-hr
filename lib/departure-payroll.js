/**
 * Payroll rules applied when an employee departs (notice type drives deductions / notice pay).
 */
const { normalizeNoticeType } = require("./employee-depart");
const { createNoNoticeDeductions } = require("./departure-deductions");
const { applyNoticePeriodPayAdjustment, countPassedSalesInNoticeWindow } = require("./resignation-payroll");

async function applyDepartPayrollRules(emp, departDate, noticeTypeInput, store, username) {
  const notice_type = normalizeNoticeType(noticeTypeInput);
  const departYm = String(departDate || "").slice(0, 7);
  const result = { notice_type, deductions: [], transportDeductions: [], scale: null, passedSalesInNotice: 0 };

  if (notice_type === "company_decision") {
    return result;
  }

  if (notice_type === "without_notice") {
    const created = await createNoNoticeDeductions(emp, departDate, store, username);
    result.deductions = created.filter((d) => d.penaltyKind !== "transport");
    result.transportDeductions = created.filter((d) => d.penaltyKind === "transport");
    return result;
  }

  if (notice_type === "with_notice" && departYm) {
    result.passedSalesInNotice = await countPassedSalesInNoticeWindow(emp, departDate, store);
    result.scale = await applyNoticePeriodPayAdjustment(emp, departYm, {
      passedSalesInNotice: result.passedSalesInNotice,
      store,
      username,
    });
  }

  return result;
}

module.exports = {
  applyDepartPayrollRules,
};
