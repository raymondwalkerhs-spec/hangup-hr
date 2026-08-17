/** Employee pickers for sales forms — mirrors legacy `employeeSelectOptions` filters. */

export type SalePickerEmployee = {
  id: string;
  american_name?: string;
  role?: string;
  team?: string;
  unit?: string;
  status?: string;
};

function inferAppRoleFromEmployeeId(id: string): string {
  const s = String(id || "").trim().toUpperCase();
  if (s.startsWith("HR")) return "hr";
  if (s.startsWith("RTM")) return "rtm";
  if (s.startsWith("TL")) return "tl";
  if (s.startsWith("OP")) return "op";
  if (s.startsWith("CL")) return "tl";
  if (s.startsWith("QA")) return "quality";
  if (s.startsWith("MG")) return "admin";
  return "agent";
}

function effectiveRole(e: SalePickerEmployee): string {
  return String(e.role || inferAppRoleFromEmployeeId(e.id)).toLowerCase();
}

export function isOutForSalePicker(emp: SalePickerEmployee): boolean {
  const s = String(emp.status || "").trim().toLowerCase();
  return s === "out" || s.includes("out");
}

export function filterEmployeesForSaleField(
  employees: SalePickerEmployee[],
  filter: string | undefined,
  selectedId = ""
): SalePickerEmployee[] {
  let list = employees.slice();
  const roleOf = (e: SalePickerEmployee) => effectiveRole(e);
  const idOf = (e: SalePickerEmployee) => String(e.id || "");

  if (filter === "reviewers") {
    list = list.filter((e) => {
      const role = roleOf(e);
      if (role === "quality" || role === "rtm" || role === "admin" || role === "ceo") return true;
      const id = idOf(e);
      if (/^(QA|RTM|MG)/i.test(id)) return true;
      const team = String(e.team || "").toLowerCase();
      if (team === "quality") return true;
      if (/^HR/i.test(id) && (role === "quality" || team === "quality")) return true;
      return false;
    });
  } else if (filter === "verifiers") {
    list = list.filter((e) => {
      const id = idOf(e);
      const role = roleOf(e);
      if (/^(TL|CL|OP)/i.test(id)) return true;
      if (["quality", "rtm", "tl", "op", "admin", "ceo"].includes(role)) return true;
      if (/^(HR|quality|rtm|MG)/i.test(id)) return true;
      return false;
    });
  } else if (filter === "leaders") {
    list = list.filter(
      (e) => /^(TL|CL|OP|HR|quality|rtm)/i.test(idOf(e)) || ["quality", "rtm"].includes(roleOf(e))
    );
  } else if (filter === "quality") {
    list = list.filter(
      (e) =>
        /^(HR|quality|rtm|MG)/i.test(idOf(e)) ||
        ["quality", "rtm", "hr", "admin", "ceo"].includes(roleOf(e))
    );
  } else if (filter === "dialing") {
    const nonDialRoles = new Set([
      "quality",
      "hr",
      "rtm",
      "admin",
      "ceo",
      "finance",
      "it",
      "public_relations",
      "office_assistant",
    ]);
    list = list.filter((e) => {
      const id = idOf(e);
      if (/^(TL|CL|OP|HR|MG|OF|NW|RTM|quality)/i.test(id)) return false;
      if (nonDialRoles.has(roleOf(e))) return false;
      return true;
    });
  }

  list = list.filter((e) => !isOutForSalePicker(e) || String(e.id) === String(selectedId));
  return list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

const QUALITY_TICKET_ROLES = new Set(["quality", "rtm", "admin", "ceo", "public_relations"]);

export function canOpenQualityTicketForSale(
  sale: Record<string, unknown>,
  user: { canWorkQualityTicket?: boolean; role?: string; employeeId?: string } | null | undefined
): boolean {
  if (user?.canWorkQualityTicket) return true;
  const role = String(user?.role || "").toLowerCase();
  if (QUALITY_TICKET_ROLES.has(role)) return true;
  if (!["op", "tl"].includes(role)) return false;
  const fd = (sale.formData as Record<string, unknown> | undefined) || {};
  const assignVerifier = fd.assignVerifier || sale.assignVerifier;
  return Boolean(
    assignVerifier && user?.employeeId && String(assignVerifier) === String(user.employeeId)
  );
}
