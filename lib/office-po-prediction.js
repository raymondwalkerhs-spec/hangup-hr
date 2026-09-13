/**
 * Office PO prediction math (pure).
 */

function parseYearMonth(ym) {
  const m = String(ym || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split("-").map(Number);
  return { year: y, month: mo, ym: m };
}

/** Count Mon–Fri days in YYYY-MM. */
function daysAutoInMonth(ym) {
  const p = parseYearMonth(ym);
  if (!p) return 0;
  const last = new Date(p.year, p.month, 0).getDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const wd = new Date(p.year, p.month - 1, d).getDay();
    if (wd >= 1 && wd <= 5) n += 1;
  }
  return n;
}

/**
 * AvgAuto(M) = |ActiveDuringMonth| + 0.5 * |NewStarters|
 * periods: [{ employeeId, startDate, endDate }]
 * employeesActive: optional Set of employee ids in company
 */
function avgEmployeesAuto(ym, periods = [], employeeIds = null) {
  const p = parseYearMonth(ym);
  if (!p) return 0;
  const monthStart = `${ym}-01`;
  const last = new Date(p.year, p.month, 0).getDate();
  const monthEnd = `${ym}-${String(last).padStart(2, "0")}`;

  const byEmp = new Map();
  for (const row of periods) {
    const id = row.employeeId || row.employee_id;
    if (!id) continue;
    if (employeeIds && !employeeIds.has(id)) continue;
    const start = String(row.startDate || row.start_date || "").slice(0, 10);
    const endRaw = row.endDate || row.end_date;
    const end = endRaw ? String(endRaw).slice(0, 10) : null;
    if (!start) continue;
    if (end && end < monthStart) continue;
    if (start > monthEnd) continue;
    if (!byEmp.has(id)) byEmp.set(id, { start, end });
    else {
      const cur = byEmp.get(id);
      if (start < cur.start) cur.start = start;
      if (!end) cur.end = null;
      else if (cur.end && end > cur.end) cur.end = end;
    }
  }

  let activeDuring = 0;
  let newStarters = 0;
  for (const { start } of byEmp.values()) {
    activeDuring += 1;
    if (start >= monthStart && start <= monthEnd) newStarters += 1;
  }
  return Math.round((activeDuring + 0.5 * newStarters) * 100) / 100;
}

function resolveDaysUsed(ym, meta = {}, workingDaysOverride = null) {
  const daysAuto =
    workingDaysOverride != null && Number(workingDaysOverride) > 0
      ? Number(workingDaysOverride)
      : daysAutoInMonth(ym);
  let daysUsed = daysAuto;
  if (meta.days_in_scope_override != null && meta.days_in_scope_override !== "") {
    daysUsed = Number(meta.days_in_scope_override);
  } else if (meta.daysInScopeOverride != null && meta.daysInScopeOverride !== "") {
    daysUsed = Number(meta.daysInScopeOverride);
  }
  if (!(daysUsed >= 1)) daysUsed = 1;
  if (daysUsed > daysAuto) daysUsed = daysAuto;
  const scale = daysAuto > 0 ? daysUsed / daysAuto : 1;
  return { daysAuto, daysUsed, daysScale: scale };
}

function resolveAvgUsed(avgAuto, meta = {}) {
  if (meta.avg_employees_override != null && meta.avg_employees_override !== "") {
    return Number(meta.avg_employees_override);
  }
  if (meta.avgEmployeesOverride != null && meta.avgEmployeesOverride !== "") {
    return Number(meta.avgEmployeesOverride);
  }
  return Number(avgAuto) || 0;
}

function monthsBetween(anchorYm, targetYm) {
  const a = parseYearMonth(anchorYm);
  const t = parseYearMonth(targetYm);
  if (!a || !t) return null;
  return (t.year - a.year) * 12 + (t.month - a.month);
}

function isItemDue(item, ym) {
  const cadence = item.cadence || "monthly";
  const anchor = item.anchorYearMonth || item.anchor_year_month || ym;
  if (cadence === "monthly") return true;
  if (cadence === "one_time") return anchor === ym;
  if (cadence === "every_n_months") {
    const n = Math.max(2, parseInt(item.everyNMonths || item.every_n_months, 10) || 2);
    const diff = monthsBetween(anchor, ym);
    if (diff == null || diff < 0) return false;
    return diff % n === 0;
  }
  return true;
}

function nextDueMonth(item, fromYm) {
  const cadence = item.cadence || "monthly";
  const anchor = item.anchorYearMonth || item.anchor_year_month || fromYm;
  if (cadence === "monthly") return fromYm;
  if (cadence === "one_time") return anchor;
  const n = Math.max(2, parseInt(item.everyNMonths || item.every_n_months, 10) || 2);
  let ym = anchor;
  for (let i = 0; i < 120; i++) {
    if (ym >= fromYm && isItemDue({ ...item, cadence, everyNMonths: n, anchorYearMonth: anchor }, ym)) {
      return ym;
    }
    const p = parseYearMonth(ym);
    const d = new Date(p.year, p.month, 1);
    ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return anchor;
}

function predictQty(item, avgUsed, daysScale) {
  const scaleMode = item.scaleMode || item.scale_mode || "employee";
  const ignoreDays = item.ignoreDaysScale === true || item.ignore_days_scale === true;
  const scale = ignoreDays ? 1 : daysScale;

  if (scaleMode === "office_fixed") {
    const officeQty = Number(item.officeQty ?? item.office_qty) || 0;
    return Math.ceil(officeQty * scale);
  }

  const per = Number(item.perEmployees ?? item.per_employees) || 1;
  const pack = Number(item.packQty ?? item.pack_qty) || 1;
  const effectiveHeadcount = (Number(avgUsed) || 0) * scale;
  const packs = Math.ceil(effectiveHeadcount / per);
  return packs * pack;
}

function predictCost(qty, unitPrice) {
  if (unitPrice == null || unitPrice === "") return null;
  return Math.round(Number(qty) * Number(unitPrice) * 100) / 100;
}

function isStalePrediction(line, avgUsed, daysUsed) {
  if (!line || line.status !== "predicted") return false;
  const a = Number(line.avgEmployeesUsed ?? line.avg_employees_used);
  const d = Number(line.daysInScopeUsed ?? line.days_in_scope_used);
  if (Number.isFinite(a) && Math.abs(a - Number(avgUsed)) > 0.001) return true;
  if (Number.isFinite(d) && Math.abs(d - Number(daysUsed)) > 0.001) return true;
  return false;
}

function buildPredictedLine(item, ym, avgUsed, daysUsed, daysScale) {
  const qty = predictQty(item, avgUsed, daysScale);
  const price = item.unitPrice ?? item.unit_price;
  return {
    itemId: item.id,
    yearMonth: ym,
    company: item.company,
    status: "predicted",
    predictedQty: qty,
    predictedCost: predictCost(qty, price),
    avgEmployeesUsed: avgUsed,
    daysInScopeUsed: daysUsed,
  };
}

module.exports = {
  parseYearMonth,
  daysAutoInMonth,
  avgEmployeesAuto,
  resolveDaysUsed,
  resolveAvgUsed,
  isItemDue,
  nextDueMonth,
  predictQty,
  predictCost,
  isStalePrediction,
  buildPredictedLine,
};
