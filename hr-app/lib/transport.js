const TRANSPORT_STATUSES_FULL = new Set(["Attended", "Lateness A"]);
const HALF_DAY_STATUSES = new Set(["Half Day", "NSNC Half Day"]);

function transportUnitsForRecord(record) {
  const status = record.status || "";
  const override = record.transportOverride || "";

  if (TRANSPORT_STATUSES_FULL.has(status)) return 1;

  if (HALF_DAY_STATUSES.has(status)) {
    if (override === "full") return 1;
    if (override === "half") return 0.5;
    return 0;
  }

  return 0;
}

function countTransportDays(records) {
  return records.reduce((sum, r) => sum + transportUnitsForRecord(r), 0);
}

function calcTransportAllowance(records, workingDaysInMonth, config, transportEligible = true) {
  if (!transportEligible) {
    return { amount: 0, days: 0, dailyRate: 0, monthlyBudget: 0, breakdown: [] };
  }
  const monthlyBudget = Number(config.transportAllowanceMonthly) || 3000;
  const dailyRate =
    workingDaysInMonth > 0 ? Math.round((monthlyBudget / workingDaysInMonth) * 100) / 100 : 0;

  const breakdown = [];
  let units = 0;
  for (const r of records) {
    const dayUnits = transportUnitsForRecord(r);
    if (dayUnits > 0) {
      units += dayUnits;
      breakdown.push({
        date: r.date,
        status: r.status,
        units: dayUnits,
        override: r.transportOverride || "",
        amount: Math.round(dayUnits * dailyRate * 100) / 100,
      });
    }
  }

  const amount = Math.round(units * dailyRate * 100) / 100;
  return { amount, days: units, dailyRate, monthlyBudget, breakdown };
}

module.exports = {
  TRANSPORT_STATUSES_FULL,
  HALF_DAY_STATUSES,
  transportUnitsForRecord,
  countTransportDays,
  calcTransportAllowance,
};
