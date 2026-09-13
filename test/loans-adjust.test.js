const {
  remainingLoanAmount,
  installmentsRemaining,
  getLoanDeductionForMonth,
  getEmployeeLoanDeductions,
} = require("../lib/loans");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const loan = {
  id: "L-1",
  employeeId: "HS3-1",
  totalAmount: 1000,
  installmentAmount: 200,
  installmentsCount: 5,
  installmentsPaid: 0,
  startYearMonth: "2026-01",
  status: "active",
  notes: "",
};

{
  const rem = remainingLoanAmount(loan, []);
  assert(rem === 1000, `expected 1000 remaining, got ${rem}`);
}

{
  const payments = [{ loanId: "L-1", yearMonth: "2026-01", amount: 200 }];
  const rem = remainingLoanAmount(loan, payments);
  assert(rem === 800, `expected 800 after 200 paid, got ${rem}`);
}

{
  const d = getLoanDeductionForMonth(loan, "2026-02", [], []);
  assert(d && d.amount === 200, "default installment 200");
  assert(d.remainingAfter === 800, "remaining after default");
}

{
  const overrides = [{ loanId: "L-1", yearMonth: "2026-03", amount: 500, note: "extra" }];
  const d = getLoanDeductionForMonth(loan, "2026-03", [], overrides);
  assert(d && d.amount === 500, "extra payment 500");
  assert(d.adjusted === true, "marked adjusted");
  assert(d.remainingAfter === 500, "remaining 500 after extra");
}

{
  const overrides = [{ loanId: "L-1", yearMonth: "2026-04", amount: 50 }];
  const d = getLoanDeductionForMonth(loan, "2026-04", [], overrides);
  assert(d && d.amount === 50, "reduced payment 50");
  assert(d.remainingAfter === 950, "rest stays on loan");
}

{
  const payments = [
    { loanId: "L-1", yearMonth: "2026-01", amount: 200 },
    { loanId: "L-1", yearMonth: "2026-02", amount: 200 },
    { loanId: "L-1", yearMonth: "2026-03", amount: 500 },
  ];
  const rem = remainingLoanAmount(loan, payments);
  assert(rem === 100, `expected 100 left, got ${rem}`);
  const left = installmentsRemaining({ ...loan, installmentsPaid: 3 }, payments);
  assert(left === 1, `expected 1 installment left, got ${left}`);
  const d = getLoanDeductionForMonth({ ...loan, installmentsPaid: 3 }, "2026-05", payments, []);
  assert(d && d.amount === 100, "last month shrinks to remaining");
}

{
  // Beyond original installment count still deducts if balance remains (after reductions)
  const payments = [{ loanId: "L-1", yearMonth: "2026-01", amount: 50 }];
  const loanPaid = { ...loan, installmentsPaid: 5, installmentsCount: 5 };
  const rem = remainingLoanAmount(loanPaid, payments);
  assert(rem === 950, "balance remains after tiny payments");
  const d = getLoanDeductionForMonth(loanPaid, "2026-06", payments, []);
  assert(d && d.amount === 200, "still deducts default while balance > 0");
}

{
  const list = getEmployeeLoanDeductions(
    [loan],
    "HS3-1",
    "2026-02",
    [],
    [{ loanId: "L-1", yearMonth: "2026-02", amount: 300 }]
  );
  assert(list.length === 1 && list[0].amount === 300, "employee deductions honor override");
}

console.log("loan-adjust tests OK");
