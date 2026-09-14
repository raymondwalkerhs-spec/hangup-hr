const pred = require("../lib/office-po-prediction");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  assert(pred.daysAutoInMonth("2026-09") === 22, "Sep 2026 Mon-Fri should be 22");
  assert(pred.parseYearMonth("bad") === null, "bad ym");
}

{
  const periods = [
    { employeeId: "A", startDate: "2025-01-01", endDate: null },
    { employeeId: "B", startDate: "2026-09-10", endDate: null },
    { employeeId: "C", startDate: "2024-01-01", endDate: "2026-08-31" },
    { employeeId: "WFH1", startDate: "2025-01-01", endDate: null },
  ];
  const avgAll = pred.avgEmployeesAuto("2026-09", periods);
  assert(avgAll === 3.5, `expected 3.5 with WFH included got ${avgAll}`);
  const officeOnly = new Set(["A", "B", "C"]);
  const avgExWfh = pred.avgEmployeesAuto("2026-09", periods, officeOnly);
  // A + B active; B starter → 2.5 (WFH1 excluded via employeeIds)
  assert(avgExWfh === 2.5, `expected 2.5 excluding WFH got ${avgExWfh}`);
}

{
  const { daysAuto, daysUsed, daysScale } = pred.resolveDaysUsed("2026-09", {
    daysInScopeOverride: 11,
  });
  assert(daysAuto === 22, "daysAuto");
  assert(daysUsed === 11, "daysUsed");
  assert(Math.abs(daysScale - 0.5) < 0.001, "daysScale");
}

{
  const item = {
    id: "1",
    scaleMode: "employee",
    perEmployees: 10,
    packQty: 2,
    unitPrice: 5,
    cadence: "monthly",
  };
  const qty = pred.predictQty(item, 25, 1);
  // ceil(25/10)=3 packs * 2 = 6
  assert(qty === 6, `expected 6 got ${qty}`);
  const line = pred.buildPredictedLine(item, "2026-09", 25, 22, 1);
  assert(line.predictedQty === 6 && line.predictedCost === 30, "build line");
}

{
  const item = {
    scaleMode: "office_fixed",
    officeQty: 10,
    ignoreDaysScale: false,
  };
  assert(pred.predictQty(item, 100, 0.5) === 5, "office fixed scaled");
  assert(pred.predictQty({ ...item, ignoreDaysScale: true }, 100, 0.5) === 10, "ignore days");
}

{
  assert(pred.isItemDue({ cadence: "monthly" }, "2026-09") === true, "monthly");
  assert(pred.isItemDue({ cadence: "one_time", anchorYearMonth: "2026-09" }, "2026-09") === true, "one_time due");
  assert(pred.isItemDue({ cadence: "one_time", anchorYearMonth: "2026-08" }, "2026-09") === false, "one_time not");
  assert(
    pred.isItemDue({ cadence: "every_n_months", everyNMonths: 3, anchorYearMonth: "2026-01" }, "2026-04") === true,
    "every 3"
  );
  assert(
    pred.isItemDue({ cadence: "every_n_months", everyNMonths: 3, anchorYearMonth: "2026-01" }, "2026-03") === false,
    "not every 3"
  );
}

{
  const stale = pred.isStalePrediction(
    { status: "predicted", avgEmployeesUsed: 10, daysInScopeUsed: 20 },
    12,
    20
  );
  assert(stale === true, "stale headcount");
  assert(
    pred.isStalePrediction({ status: "bought", avgEmployeesUsed: 10, daysInScopeUsed: 20 }, 12, 20) === false,
    "bought not stale"
  );
}

console.log("office-po-prediction.test.js OK");
