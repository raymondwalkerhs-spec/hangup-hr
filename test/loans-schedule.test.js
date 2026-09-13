const {
  generateScheduleLines,
  skipScheduleMonth,
  shiftScheduleStartMonth,
  getLoanDeductionForMonth,
  remainingLoanAmount,
  backfillScheduleFromLoan,
} = require("../lib/loans");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const loan = {
  id: "L-sched-1",
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
  const lines = generateScheduleLines(loan);
  assert(lines.length === 5, `expected 5 lines, got ${lines.length}`);
  assert(lines[0].yearMonth === "2026-01", "first month Jan");
  assert(lines[4].yearMonth === "2026-05", "last month May");
  assert(lines.every((l) => l.status === "scheduled"), "all scheduled");
  assert(
    lines.reduce((s, l) => s + l.dueAmount, 0) === 1000,
    "dues sum to principal"
  );
}

{
  // Uneven last installment
  const uneven = { ...loan, totalAmount: 1000, installmentAmount: 300, installmentsCount: 4 };
  const lines = generateScheduleLines(uneven);
  assert(lines.length === 4, `expected 4 lines for 1000/300, got ${lines.length}`);
  assert(lines[3].dueAmount === 100, `last due 100, got ${lines[3].dueAmount}`);
}

{
  let lines = generateScheduleLines(loan);
  const { skipped, deferred, lines: after } = skipScheduleMonth(lines, {
    loanId: loan.id,
    yearMonth: "2026-02",
    reason: "vacation",
  });
  assert(skipped.status === "skipped", "marked skipped");
  assert(skipped.skipReason === "vacation", "reason saved");
  assert(deferred.yearMonth === "2026-06", `deferred to Jun, got ${deferred.yearMonth}`);
  assert(deferred.deferredFromLineId === skipped.id, "defer link from");
  assert(skipped.deferredToLineId === deferred.id, "defer link to");
  assert(deferred.dueAmount === skipped.dueAmount, "same due amount");
  const activeMonths = after
    .filter((l) => l.status === "scheduled")
    .map((l) => l.yearMonth);
  assert(!activeMonths.includes("2026-02"), "Feb not scheduled");
  assert(activeMonths.includes("2026-06"), "Jun scheduled");
}

{
  const lines = generateScheduleLines(loan);
  const { created, cancelled, lines: after } = shiftScheduleStartMonth(
    loan,
    lines,
    "2026-03",
    []
  );
  assert(cancelled.length === 5, `cancelled unlocked originals, got ${cancelled.length}`);
  assert(created[0].yearMonth === "2026-03", `new start Mar, got ${created[0].yearMonth}`);
  assert(created.length === 5, `5 new lines, got ${created.length}`);
  const active = after.filter((l) => l.status === "scheduled");
  assert(active.every((l) => l.yearMonth >= "2026-03"), "all active from Mar");
}

{
  // Dual-read: no schedule → legacy
  const d = getLoanDeductionForMonth(loan, "2026-02", [], []);
  assert(d && d.amount === 200 && d.fromSchedule === false, "legacy path");
}

{
  // Dual-read: schedule present → schedule due (+ override)
  const lines = generateScheduleLines(loan);
  const d = getLoanDeductionForMonth(loan, "2026-02", [], [], lines);
  assert(d && d.fromSchedule === true, "schedule path");
  assert(d.amount === 200, "schedule due 200");
  assert(d.scheduleLineId === lines[1].id, "line id attached");

  const overrides = [{ loanId: loan.id, yearMonth: "2026-02", amount: 350 }];
  const adj = getLoanDeductionForMonth(loan, "2026-02", [], overrides, lines);
  assert(adj && adj.amount === 350 && adj.adjusted === true, "override on schedule");
}

{
  // Skip month → no deduction that month; deferred month has due
  let lines = generateScheduleLines(loan);
  const result = skipScheduleMonth(lines, { loanId: loan.id, yearMonth: "2026-01" });
  lines = result.lines;
  const jan = getLoanDeductionForMonth(loan, "2026-01", [], [], lines);
  assert(jan == null, "skipped month has no deduction");
  const jun = getLoanDeductionForMonth(loan, "2026-06", [], [], lines);
  assert(jun && jun.amount === 200, "deferred month deducts");
}

{
  // Start shift + payroll remaining after partial payments
  const payments = [
    { loanId: loan.id, yearMonth: "2026-01", amount: 200 },
    { loanId: loan.id, yearMonth: "2026-02", amount: 200 },
  ];
  const paidLines = backfillScheduleFromLoan(loan, payments);
  assert(paidLines.filter((l) => l.status === "paid").length === 2, "2 paid lines");
  assert(remainingLoanAmount(loan, payments) === 600, "600 remaining");
  const future = paidLines.filter((l) => l.status === "scheduled");
  assert(future[0].yearMonth === "2026-03", "future starts Mar");
  const d = getLoanDeductionForMonth(loan, "2026-03", payments, [], paidLines);
  assert(d && d.amount === 200 && d.fromSchedule === true, "due from backfilled schedule");
}

{
  // Paused loan → no deduction even with schedule
  const lines = generateScheduleLines(loan);
  const d = getLoanDeductionForMonth({ ...loan, paused: true }, "2026-01", [], [], lines);
  assert(d == null, "paused blocks deduction");
}

console.log("loan-schedule tests OK");
