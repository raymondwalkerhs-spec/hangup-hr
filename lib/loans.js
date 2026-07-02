function parseYearMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return { year: y, month: m };
}

function nextMonth(ym) {
  const { year, month } = parseYearMonth(ym);
  const d = new Date(year, month, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function computeStartYearMonth(createdYearMonth, skipCurrentMonth) {
  return skipCurrentMonth ? nextMonth(createdYearMonth) : createdYearMonth;
}

function remainingLoanAmount(loan) {
  const paid = (loan.installmentsPaid || 0) * (loan.installmentAmount || 0);
  return Math.max(0, (loan.totalAmount || 0) - paid);
}

function installmentsRemaining(loan) {
  return Math.max(0, (loan.installmentsCount || 0) - (loan.installmentsPaid || 0));
}

function getLoanDeductionForMonth(loan, yearMonth, paymentsForMonth = []) {
  if (!loan || loan.status === "completed") {
    const paidThisMonth = paymentsForMonth.find(
      (p) => p.loanId === loan?.id && p.yearMonth === yearMonth
    );
    if (paidThisMonth) {
      return {
        loanId: loan.id,
        employeeId: loan.employeeId,
        amount: paidThisMonth.amount,
        installmentNumber: paidThisMonth.installmentNumber,
        installmentsTotal: loan.installmentsCount,
        remainingAfter: 0,
        notes: loan.notes || "",
        recorded: true,
      };
    }
    return null;
  }
  if (loan.status !== "active") return null;
  if (yearMonth < loan.startYearMonth) return null;

  const paidThisMonth = paymentsForMonth.find(
    (p) => p.loanId === loan.id && p.yearMonth === yearMonth
  );
  if (paidThisMonth) {
    return {
      loanId: loan.id,
      employeeId: loan.employeeId,
      amount: paidThisMonth.amount,
      installmentNumber: paidThisMonth.installmentNumber,
      installmentsTotal: loan.installmentsCount,
      remainingAfter: Math.max(0, remainingLoanAmount(loan) - paidThisMonth.amount),
      notes: loan.notes || "",
      recorded: true,
    };
  }

  if (installmentsRemaining(loan) <= 0) return null;

  const remaining = remainingLoanAmount(loan);
  if (remaining <= 0) return null;

  const amount = Math.min(loan.installmentAmount || 0, remaining);
  if (amount <= 0) return null;

  return {
    loanId: loan.id,
    employeeId: loan.employeeId,
    amount: Math.round(amount * 100) / 100,
    installmentNumber: (loan.installmentsPaid || 0) + 1,
    installmentsTotal: loan.installmentsCount,
    remainingAfter: Math.round((remaining - amount) * 100) / 100,
    notes: loan.notes || "",
  };
}

function getEmployeeLoanDeductions(loans, employeeId, yearMonth, payments = []) {
  const monthPayments = payments.filter((p) => p.yearMonth === yearMonth);
  return loans
    .filter((l) => l.employeeId === employeeId)
    .map((loan) => getLoanDeductionForMonth(loan, yearMonth, monthPayments))
    .filter(Boolean);
}

function totalLoanDeduction(deductions) {
  return Math.round(deductions.reduce((s, d) => s + d.amount, 0) * 100) / 100;
}

module.exports = {
  nextMonth,
  computeStartYearMonth,
  remainingLoanAmount,
  installmentsRemaining,
  getLoanDeductionForMonth,
  getEmployeeLoanDeductions,
  totalLoanDeduction,
};
