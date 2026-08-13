const { normalizePaymentMethodValue } = require("./hr-constants");

async function syncPayrollAdjustmentsPaymentMethod(employeeId, paymentMethod, backend, cache) {
  const normalized = normalizePaymentMethodValue(paymentMethod) || "";
  if (backend.syncPayrollAdjustmentsPaymentMethod) {
    const updated = await backend.syncPayrollAdjustmentsPaymentMethod(employeeId, normalized);
    for (const rec of updated || []) {
      cache.upsertPayrollAdjustment(rec);
    }
    return updated?.length || 0;
  }
  if (cache.syncPayrollAdjustmentsPaymentMethodInCache) {
    return cache.syncPayrollAdjustmentsPaymentMethodInCache(employeeId, normalized);
  }
  return 0;
}

/** Keep employee record and all payroll month profiles on the same payment method. */
async function applyUnifiedPaymentMethod({
  employeeId,
  method,
  backend,
  cache,
  username,
  getEmployeeById,
}) {
  const normalized = normalizePaymentMethodValue(method) || "";
  const emp = getEmployeeById(employeeId);
  if (!emp) return { normalized, employee: null, payrollRows: 0 };

  let employee = emp;
  if (normalizePaymentMethodValue(emp.payment_method) !== normalized) {
    employee = { ...emp, payment_method: normalized || null };
    await backend.updateEmployee(employeeId, employee, username);
    cache.upsertEmployee(employee);
  }

  const payrollRows = await syncPayrollAdjustmentsPaymentMethod(
    employeeId,
    normalized,
    backend,
    cache
  );
  return { normalized, employee, payrollRows };
}

module.exports = {
  syncPayrollAdjustmentsPaymentMethod,
  applyUnifiedPaymentMethod,
  normalizePaymentMethodValue,
};
