/** Infer / normalize expense categories from free-text descriptions. */

const EXPENSE_CATEGORIES = [
  "office",
  "travel",
  "meals",
  "utilities",
  "equipment",
  "marketing",
  "rent",
  "supplies",
  "other",
];

const RULES = [
  {
    category: "utilities",
    re: /(land\s*line|landline|internet|electric|electricity|water\b|cellphone|mobile|wifi|adsl|vodafone|orange|\bwe\b|etisalat|router|socket)/i,
  },
  { category: "supplies", re: /\b(print|printer|toner|paper|stationery|ink|copy|steel wool)\b/i },
  {
    category: "meals",
    re: /\b(etoile|patis|pastry|food|meal|lunch|dinner|cater|orientation|coffee|restaurant|cafe|boufet|buffet|entertainment)\b/i,
  },
  {
    category: "equipment",
    re: /\b(screw|screwdriver|scredriver|tool|equip|cable|cord|mouse|keyboard|monitor|laptop|charger|adapter|hardware|\bit\b|pc\b|fridge|dispenser|router)\b/i,
  },
  {
    category: "office",
    re: /\b(trash|clean|cleaning|office|maintenance|maintain|repair|courier|delivery|shipping|carpet)\b/i,
  },
  { category: "travel", re: /\b(uber|careem|taxi|transport|travel|fuel|petrol|gas)\b/i },
  { category: "rent", re: /\b(rent|lease)\b/i },
  { category: "marketing", re: /\b(ads|advert|marketing|facebook|google ads|promo)\b/i },
];

function normalizeCategory(raw) {
  const cat = String(raw || "").trim().toLowerCase();
  if (EXPENSE_CATEGORIES.includes(cat)) return cat;
  if (cat === "others") return "other";
  return "";
}

function inferExpenseCategory(description, vendorName = "", fallback = "other") {
  const text = `${description || ""} ${vendorName || ""}`.trim();
  if (!text) return fallback;
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.category;
  }
  return fallback;
}

function resolveExpenseCategory({ category, description, vendorName } = {}) {
  const explicit = normalizeCategory(category);
  if (explicit && explicit !== "other") return explicit;
  const inferred = inferExpenseCategory(description, vendorName, "other");
  if (explicit === "other" && inferred !== "other") return inferred;
  return explicit || inferred || "other";
}

module.exports = {
  EXPENSE_CATEGORIES,
  normalizeCategory,
  inferExpenseCategory,
  resolveExpenseCategory,
};
