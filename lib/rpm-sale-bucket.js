/**
 * Shared RPM sale quality → bucket mapping (Team Dashboard + weekly dashboard).
 */

function rpmClientBucket(sale) {
  const fd = sale.formData && typeof sale.formData === "object" ? sale.formData : {};
  const client = String(fd.clientFeedback || "").trim();
  if (client === "Retransfer" || fd.retransfer === true) return "retransfer";
  if (client === "Denied" || sale.status === "denied") return "dropped";
  if (client === "Approved" || sale.status === "passed") return "approved";
  return "pending";
}

/** @param {"passed"|"passed_pending"|"all"} mode */
function saleMatchesCountMode(sale, mode) {
  const bucket = rpmClientBucket(sale);
  const m = String(mode || "passed").toLowerCase();
  if (m === "all") return true;
  if (m === "passed_pending") return bucket === "approved" || bucket === "pending";
  return bucket === "approved";
}

function normalizeCountMode(mode) {
  const m = String(mode || "passed").toLowerCase().replace(/-/g, "_");
  if (m === "passed_pending" || m === "all") return m;
  return "passed";
}

module.exports = {
  rpmClientBucket,
  saleMatchesCountMode,
  normalizeCountMode,
};
