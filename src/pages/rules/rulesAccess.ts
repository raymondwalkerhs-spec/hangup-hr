export type RulesUser = {
  role?: string;
  unit?: string;
  canManageHs2Company?: boolean;
  canAccessHs2Company?: boolean;
};

function isHs2Unit(unit?: string) {
  const u = String(unit || "").trim();
  return u === "HS-2" || u === "HS2-PT" || /^HS2/i.test(u);
}

/** Who may switch between Main Hangup and HS-2 rules tabs (managers with HS-2 switcher). */
export function canShowRulesCompanyTabs(user?: RulesUser) {
  return user?.canManageHs2Company === true;
}

/** Single company context when the user must not see a company switcher. */
export function soleRulesCompany(user?: RulesUser): "hangup" | "hs2" {
  return isHs2Unit(user?.unit) ? "hs2" : "hangup";
}

export function resolveRulesCompany(
  selected: "hangup" | "hs2",
  user?: RulesUser,
): "hangup" | "hs2" {
  if (canShowRulesCompanyTabs(user)) return selected;
  return soleRulesCompany(user);
}

export function rulesCompanyLabel(company: "hangup" | "hs2") {
  return company === "hs2" ? "HS-2" : "Main Hangup";
}
