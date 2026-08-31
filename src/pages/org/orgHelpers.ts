import type { Employee, TeamMeta } from "./orgTypes";

export function normTeam(name: string | undefined | null) {
  return String(name || "").replace(/^team\s+/i, "").trim();
}

export function isTlEmployee(emp: Employee | undefined, allTeams: TeamMeta[]) {
  if (!emp) return false;
  const lead = String(emp.lead_role || emp.role || "").toUpperCase();
  const tlOnTeam = allTeams.some(
    (t) => t.tlEmployeeId === emp.id || (t.tlEmployeeIds || []).includes(emp.id)
  );
  return /^TL/i.test(String(emp.id || "")) || lead === "TL" || tlOnTeam;
}

export function tlCandidates(teamName: string, employees: Employee[], allTeams: TeamMeta[]) {
  const onTeam = employees.filter((e) => normTeam(e.team) === normTeam(teamName) && isTlEmployee(e, allTeams));
  const otherTls = employees.filter((e) => isTlEmployee(e, allTeams) && normTeam(e.team) !== normTeam(teamName));
  const agents = employees.filter(
    (e) => !isTlEmployee(e, allTeams) && String(e.status || "").toLowerCase() !== "out"
  );
  return { onTeam, otherTls, agents: agents.slice(0, 80) };
}

export function opIdsForUnit(
  unit: string,
  unitOps: Record<string, string[]>,
  managers: { unit: string; opEmployeeId?: string }[] = []
) {
  const key = String(unit || "").trim();
  const ids: string[] = [];
  for (const [u, list] of Object.entries(unitOps || {})) {
    if (String(u || "").trim() === key) ids.push(...(list || []));
  }
  const fromMgr = managers.find((m) => String(m.unit || "").trim() === key)?.opEmployeeId;
  if (fromMgr) ids.push(fromMgr);
  return [...new Set(ids.filter(Boolean))];
}

export function checkerIdsForUnit(unit: string, unitCheckers: Record<string, string[]>) {
  const key = String(unit || "").trim();
  const ids: string[] = [];
  for (const [u, list] of Object.entries(unitCheckers || {})) {
    if (String(u || "").trim() === key) ids.push(...(list || []));
  }
  return [...new Set(ids.filter(Boolean))];
}

export function opCandidates(unit: string, employees: Employee[]) {
  const unitKey = String(unit || "").replace(/\s+/g, "").toUpperCase();
  const inUnit = employees.filter((e) => String(e.unit || "").replace(/\s+/g, "").toUpperCase() === unitKey);
  const ops = employees.filter(
    (e) => /^OP/i.test(String(e.id || "")) || String(e.role || "").toLowerCase() === "op"
  );
  const seen = new Set<string>();
  const out: Employee[] = [];
  for (const e of [...ops, ...inUnit]) {
    if (!e?.id || seen.has(e.id)) continue;
    if (String(e.status || "").toLowerCase() === "out" || String(e.status || "").toLowerCase() === "deleted") continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function checkerCandidates(unit: string, employees: Employee[]) {
  const unitKey = String(unit || "").replace(/\s+/g, "").toUpperCase();
  const inUnit = employees.filter((e) => String(e.unit || "").replace(/\s+/g, "").toUpperCase() === unitKey);
  const checkers = employees.filter(
    (e) =>
      String(e.role || "").toLowerCase() === "checker" ||
      /^CHK/i.test(String(e.id || ""))
  );
  const seen = new Set<string>();
  const out: Employee[] = [];
  for (const e of [...checkers, ...inUnit]) {
    if (!e?.id || seen.has(e.id)) continue;
    if (String(e.status || "").toLowerCase() === "out" || String(e.status || "").toLowerCase() === "deleted") continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function closerCandidates(teamName: string, teamUnit: string | undefined, employees: Employee[]) {
  const unit = String(teamUnit || "").trim();
  return employees
    .filter((e) => String(e.status || "").toLowerCase() !== "deleted")
    .filter((e) => String(e.status || "").toLowerCase() !== "out")
    .filter((e) => !unit || e.unit === unit)
    .sort((a, b) => String(a.american_name || a.id).localeCompare(String(b.american_name || b.id)));
}

export function confirmAddCloser(employeeId: string, teamName: string, employees: Employee[]): boolean {
  const emp = employees.find((e) => e.id === employeeId);
  if (!emp) return false;
  return confirm(`Assign ${employeeId} as closer for team "${teamName}"? They can submit sales and IT tickets for agents on that team.`);
}

export function confirmAddTl(
  employeeId: string,
  teamName: string,
  employees: Employee[],
  allTeams: TeamMeta[]
): boolean {
  const emp = employees.find((e) => e.id === employeeId);
  const isAgentPick = !isTlEmployee(emp, allTeams);
  const crossTeam = isTlEmployee(emp, allTeams) && normTeam(emp?.team) !== normTeam(teamName);
  if (!emp || isAgentPick || crossTeam) {
    const msg = !emp
      ? `Assign ${employeeId} as TL for "${teamName}"?`
      : isAgentPick
        ? `Assign agent ${employeeId} as TL for team "${teamName}"? This is unusual.`
        : `Assign TL ${employeeId} from team "${emp?.team || "?"}" to lead "${teamName}"?`;
    if (!confirm(msg) || !confirm("Please confirm again — this changes team leadership.")) {
      return false;
    }
  }
  return true;
}
