/**
 * Per-company slices of global app_config (tax rules, FP import rules).
 */
const DEFAULT_TAX = { incomeTaxRate: 0, socialInsuranceRate: 0 };

function normalizeCompany(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "hs2" || raw === "hs-2" ? "hs2" : "hangup";
}

function getTaxRules(config, company) {
  const co = normalizeCompany(company);
  const byCo = config?.taxRulesByCompany;
  if (byCo && byCo[co]) return { ...DEFAULT_TAX, ...byCo[co] };
  if (config?.taxRules && co === "hangup") return { ...DEFAULT_TAX, ...config.taxRules };
  return { ...DEFAULT_TAX };
}

function applyTaxRulesToConfig(config, company, taxRules) {
  const co = normalizeCompany(company);
  const next = { ...(config || {}) };
  const byCo = { ...(next.taxRulesByCompany || {}) };
  byCo[co] = { ...DEFAULT_TAX, ...taxRules };
  next.taxRulesByCompany = byCo;
  if (co === "hangup") next.taxRules = byCo[co];
  return next;
}

function getFpRulesByMonthForCompany(config, company) {
  const co = normalizeCompany(company);
  const byCo = config?.attendanceFpRulesByCompany;
  if (byCo && byCo[co]) return byCo[co];
  if (co === "hangup" && config?.attendanceFpRulesByMonth) return config.attendanceFpRulesByMonth;
  return {};
}

function setFpRulesForMonthInConfig(config, company, month, rules) {
  const co = normalizeCompany(company);
  const next = { ...(config || {}) };
  const byCo = { ...(next.attendanceFpRulesByCompany || {}) };
  const byMonth = { ...(byCo[co] || {}) };
  byMonth[month] = rules;
  byCo[co] = byMonth;
  next.attendanceFpRulesByCompany = byCo;
  if (co === "hangup") next.attendanceFpRulesByMonth = byMonth;
  return next;
}

function configForCompany(config, company) {
  const co = normalizeCompany(company);
  return {
    ...(config || {}),
    taxRules: getTaxRules(config, co),
    attendanceFpRulesByMonth: getFpRulesByMonthForCompany(config, co),
  };
}

module.exports = {
  normalizeCompany,
  DEFAULT_TAX,
  getTaxRules,
  applyTaxRulesToConfig,
  getFpRulesByMonthForCompany,
  setFpRulesForMonthInConfig,
  configForCompany,
};
