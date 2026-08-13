export type CompanySlug = "hangup" | "hs2";

export function companyForUnit(unit?: string | null): CompanySlug {
  const u = String(unit || "").trim().toUpperCase();
  if (!u) return "hangup";
  if (u === "HS-2" || u === "HS2" || u === "HS2-PT" || u.startsWith("HS2-") || u.startsWith("HS2 ")) {
    return "hs2";
  }
  return "hangup";
}

export function companyLabel(company: CompanySlug): string {
  return company === "hs2" ? "HS-2" : "Hang-Up";
}
