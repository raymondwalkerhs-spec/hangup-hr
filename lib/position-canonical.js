/**
 * Canonical position names from position_rates — used when saving employees,
 * not during payroll lookup (each position keeps its own salary row).
 */

function trimPosition(position) {
  return String(position || "").trim();
}

function variantKey(position) {
  return trimPosition(position).replace(/\.+$/g, "").toLowerCase();
}

function findRateRow(position, rates) {
  const key = trimPosition(position);
  if (!key) return null;
  const list = rates || [];
  return (
    list.find((r) => r.position === key) ||
    list.find((r) => r.position.toLowerCase() === key.toLowerCase()) ||
    null
  );
}

function salaryForPosition(position, rates) {
  const row = findRateRow(position, rates);
  return row != null ? Number(row.monthlySalary) : null;
}

/**
 * Resolve to the position_rates name. Merges typo variants (trim, trailing dots,
 * case) only when every matching rate row has the same monthly salary.
 */
function resolveCanonicalPosition(position, rates) {
  const key = trimPosition(position);
  if (!key) return key;
  const list = rates || [];

  const exact = findRateRow(key, list);
  if (exact) return exact.position;

  const matches = list.filter((r) => variantKey(r.position) === variantKey(key));
  if (!matches.length) return key;

  const salaries = new Set(matches.map((r) => Number(r.monthlySalary)));
  if (salaries.size !== 1) return key;

  return matches.sort((a, b) => a.position.length - b.position.length)[0].position;
}

/** After training: Trainee → Agent; otherwise canonicalize against rates. */
function agentPositionAfterTraining(position, rates) {
  const key = trimPosition(position);
  if (!key || key.toLowerCase() === "trainee") return "Agent";
  return resolveCanonicalPosition(key, rates);
}

module.exports = {
  trimPosition,
  findRateRow,
  salaryForPosition,
  resolveCanonicalPosition,
  agentPositionAfterTraining,
};
