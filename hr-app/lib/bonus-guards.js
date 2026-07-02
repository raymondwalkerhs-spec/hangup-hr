const { isOutStatus } = require("./employee-status");

function assertBonusAllowedForEmployee(emp, bonusDate) {
  if (!emp || !isOutStatus(emp.status)) return;
  const depart = String(emp.depart_date || "").slice(0, 10);
  const date = String(bonusDate || "").slice(0, 10);
  if (!depart) {
    throw new Error("Cannot add bonus for departed employee without a depart date on file");
  }
  if (date > depart) {
    throw new Error(`Cannot add bonus after depart date (${depart}) for this employee`);
  }
}

module.exports = {
  assertBonusAllowedForEmployee,
};
