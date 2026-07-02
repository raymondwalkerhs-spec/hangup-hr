const { dateInRange } = require("./employment-periods");

const AIP_LATENESS_A_AMOUNT = 75;

function getActivePlansForEmployee(plans, employeeId) {
  return (plans || []).filter(
    (p) => p.employeeId === employeeId && (p.status || "active") === "active"
  );
}

function isDateInAnyPlan(date, plans) {
  return plans.some((p) => dateInRange(date, p.weekStart, p.weekEnd));
}

function calcLatenessWithAip(records, config, plans) {
  let a = 0;
  let b = 0;
  let aipNotes = [];
  for (const r of records) {
    if (r.status === "Lateness A") {
      if (isDateInAnyPlan(r.date, plans)) {
        a += 1;
        aipNotes.push(`AIP: Lateness A on ${r.date} — 75 EGP`);
      } else {
        a += 1;
      }
    } else if (r.status === "Lateness B") {
      b += 1;
      if (isDateInAnyPlan(r.date, plans)) {
        aipNotes.push(`AIP: Lateness B on ${r.date} — tripled`);
      }
    }
  }
  const tierA = isDateInAnyPlan(records.find((r) => r.status === "Lateness A")?.date, plans)
    ? AIP_LATENESS_A_AMOUNT
    : config.latenessRules.tierA.amount;
  let amount = 0;
  for (const r of records) {
    if (r.status === "Lateness A") {
      amount += isDateInAnyPlan(r.date, plans) ? AIP_LATENESS_A_AMOUNT : config.latenessRules.tierA.amount;
    } else if (r.status === "Lateness B") {
      const base = config.latenessRules.tierB.amount;
      amount += isDateInAnyPlan(r.date, plans) ? base * 3 : base;
    }
  }
  const aCount = records.filter((r) => r.status === "Lateness A").length;
  const bCount = records.filter((r) => r.status === "Lateness B").length;
  return {
    amount,
    detail: `${aCount} Lateness before 3:00PM\n${bCount} Lateness After 3:00PM`,
    aipNotes,
  };
}

function calcAipDayOffPenalty(records, dailyRate, plans) {
  let penalty = 0;
  const notes = [];
  for (const r of records) {
    if (r.status === "Day-OFF" && isDateInAnyPlan(r.date, plans)) {
      penalty += dailyRate * 3;
      notes.push(`AIP: Day-OFF on ${r.date} — 3 salary days deducted`);
    }
  }
  return { penalty, notes };
}

function applyAipToDeductionEvents(deductions, plans) {
  if (!plans.length) return { deductions, notes: [] };
  const notes = [];
  const adjusted = deductions.map((d) => {
    if (!isDateInAnyPlan(d.date, plans)) return d;
    if (d.type === "Lateness Deduction") return d;
    const mult = 3;
    notes.push(`AIP: ${d.type} on ${d.date} — tripled (${d.amount} → ${d.amount * mult})`);
    return { ...d, amount: (Number(d.amount) || 0) * mult, reason: `${d.reason || ""} [AIP ×3]`.trim() };
  });
  return { deductions: adjusted, notes };
}

function buildAipPayslipSection(plans, notes = []) {
  if (!plans.length && !notes.length) return "";
  const lines = ["Action Improvement Plan:"];
  for (const p of plans) {
    lines.push(`Week ${p.weekStart} – ${p.weekEnd}${p.notes ? ` — ${p.notes}` : ""}`);
  }
  for (const n of notes) lines.push(n);
  return lines.join("\n");
}

module.exports = {
  AIP_LATENESS_A_AMOUNT,
  getActivePlansForEmployee,
  isDateInAnyPlan,
  calcLatenessWithAip,
  calcAipDayOffPenalty,
  applyAipToDeductionEvents,
  buildAipPayslipSection,
};
