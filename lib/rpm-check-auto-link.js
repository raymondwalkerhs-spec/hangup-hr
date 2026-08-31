/**
 * Bidirectional auto-link: RPM sale ↔ Q check by Member ID + same working day.
 * Prefer same agent; may overwrite disposed feedback (not_int, etc.) to sale.
 * Company is derived from the sale unit so Hang-Up / HS-2 checks stay isolated.
 */
const { stripMemberId } = require("./rpm-member-id");
const rpmChecksRepo = require("./rpm-checks-repo");
const companyContext = require("./company-context");

function companyForSale(sale, fallback) {
  const unit = sale?.unit || sale?.formData?.unit;
  if (unit) return companyContext.getCompanyForUnit(unit);
  if (fallback) return companyContext.parseCompanyContext(fallback);
  if (sale?.company) return companyContext.parseCompanyContext(sale.company);
  return "hangup";
}

async function linkSaleToMatchingCheck(sale, { company } = {}) {
  if (!sale?.id || !sale.agentId) return null;
  const memberNorm = stripMemberId(sale.memberId || sale.formData?.memberId);
  if (!memberNorm) return null;
  const workingDay = sale.workingDay || sale.working_day;
  if (!workingDay) return null;
  const open = await rpmChecksRepo.findOpenQForAutoLink({
    company: companyForSale(sale, company),
    agentId: sale.agentId,
    memberIdNormalized: memberNorm,
    workingDay,
  });
  if (!open) return null;
  return rpmChecksRepo.linkSaleToCheck(open.id, sale.id);
}

async function linkCheckToMatchingSale(check, listUnlinkedSalesFn) {
  if (!check?.id || check.checkStatus !== "q" || check.linkedRpmSaleId) return null;
  const memberNorm = stripMemberId(check.memberIdNormalized || check.memberId);
  if (!memberNorm || !check.agentId) return null;
  if (typeof listUnlinkedSalesFn !== "function") return null;
  const workingDay = check.workingDay;
  const sales = await listUnlinkedSalesFn({
    company: check.company,
    agentId: check.agentId,
    memberIdNormalized: memberNorm,
    workingDay,
  });
  const sameDay = (sales || []).filter((s) => {
    const d = s.workingDay || s.working_day;
    return !workingDay || String(d) === String(workingDay);
  });
  const preferred =
    sameDay.find((s) => String(s.agentId) === String(check.agentId)) || sameDay[0];
  if (!preferred?.id) return null;
  return rpmChecksRepo.linkSaleToCheck(check.id, preferred.id);
}

module.exports = {
  linkSaleToMatchingCheck,
  linkCheckToMatchingSale,
};
