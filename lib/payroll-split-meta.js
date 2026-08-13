/** Strip agent split metadata so training/deferred rows do not inherit wrong split state. */
function clearPayrollSplitMeta(row) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    hasSplits: false,
    splits: [],
    deferredInSplits: [],
    deferredIn: 0,
    deferredOut: 0,
    receivedTotal: 0,
    remainingBalance: row.netSalary ?? row.calculatedNet ?? 0,
    grossPayable: row.netSalary ?? row.calculatedNet ?? 0,
    receivedSplits: [],
  };
}

module.exports = { clearPayrollSplitMeta };
