/** Mirrors legacy `canManageOrgStructure` + `canManagePayrollEvents` for org editing. */
export function canManageOrgPage(user: Record<string, unknown> | undefined | null): boolean {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase();
  if (user.canManageOrg === true) return true;
  if (user.canManageEmployees === true) return true;
  return ["admin", "ceo", "hr"].includes(role);
}
