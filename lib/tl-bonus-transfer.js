const store = require("./data-store");
const { formatTlDeductionReason } = require("./tl-bonus-link");
const { TL_BONUS_TYPE } = require("./hr-constants");

async function resolveTlPayerEmployeeId(submittedBy) {
  const username = String(submittedBy || "").trim();
  if (!username) return null;

  const usersAdmin = require("./users-admin");
  const appUser = await usersAdmin.getAppUser(username);
  if (appUser?.employee_id) return appUser.employee_id;

  const fromMeta = store.getAppUserEmployeeId(username);
  if (fromMeta) return fromMeta;

  const emp = store.getEmployeeById(username);
  return emp?.id || null;
}

async function applyTlBonusTransfer(
  { employeeId, deductFromEmployeeId, date, amount, reason, unit },
  username
) {
  if (!employeeId || !deductFromEmployeeId || !date || amount == null) {
    throw new Error("employeeId, deductFromEmployeeId, date, and amount are required");
  }
  if (deductFromEmployeeId === employeeId) {
    throw new Error("Cannot deduct from the same employee receiving the bonus");
  }

  const emp = store.getEmployeeById(employeeId);
  const fromEmp = store.getEmployeeById(deductFromEmployeeId);
  if (!emp) throw new Error("Bonus recipient not found");
  if (!fromEmp) throw new Error("TL/OP payer not found");

  const amt = Number(amount);
  await store.upsertBonus(
    {
      employeeId,
      date,
      amount: amt,
      reason: `${reason || "TL bonus"} (deducted from ${deductFromEmployeeId})`,
      type: TL_BONUS_TYPE,
      unit: unit || emp.unit || "",
    },
    username
  );
  await store.upsertDeduction(
    {
      employeeId: deductFromEmployeeId,
      date,
      amount: amt,
      reason: formatTlDeductionReason(reason, employeeId),
      type: TL_BONUS_TYPE,
      unit: fromEmp.unit || "",
    },
    username
  );
}

module.exports = {
  resolveTlPayerEmployeeId,
  applyTlBonusTransfer,
};
