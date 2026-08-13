export type LeaveRequest = {
  id: string;
  employeeId: string;
  startDate?: string;
  endDate?: string;
  leaveType?: string;
  requestKind?: string;
  status?: string;
  notes?: string;
  dayFraction?: number;
  halfDay?: boolean;
  quarterDay?: boolean;
  requestedBy?: string;
};

export type LeaveEmployee = {
  id: string;
  american_name?: string;
  employment_date?: string;
  team?: string;
  unit?: string;
};

export const KIND_LABELS: Record<string, string> = {
  annual: "Annual leave (paid)",
  unpaid: "Unpaid day off",
  medical: "Medical / sick",
  same_day: "Same-day off",
  pause: "Pause request (Mon–Fri week)",
  exam: "Exam leave",
};

export const FRACTION_OPTIONS = [
  { value: "1", label: "Full day" },
  { value: "0.5", label: "Half day" },
  { value: "0.25", label: "Quarter day (2 hours)" },
] as const;

export function fractionLabel(frac?: number) {
  if (frac === 0.5) return "Half day";
  if (frac === 0.25) return "Quarter day";
  return null;
}

export function canSubmitLeaveForOthers(opts: { role?: string; leadTeams?: { team?: string }[] }) {
  if (isHrRole(opts.role)) return true;
  if (isTlOrOpRole(opts.role)) return true;
  return (opts.leadTeams || []).length > 0;
}

/** @deprecated use canSubmitLeaveForOthers */
export function canSubmitForOthers(role?: string) {
  return canSubmitLeaveForOthers({ role });
}

export function isHrRole(role?: string) {
  return ["hr", "admin", "ceo"].includes(String(role || "").toLowerCase());
}

export function isTlOrOpRole(role?: string) {
  return ["tl", "op"].includes(String(role || "").toLowerCase());
}

export function daysEmployed(emp?: LeaveEmployee) {
  if (!emp?.employment_date) return 0;
  return Math.floor(
    (Date.now() - new Date(emp.employment_date).getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function isTenuredEmployee(emp?: LeaveEmployee) {
  return daysEmployed(emp) >= 180;
}

/** Annual option when target agent has 180+ days, or HR/Admin (any agent). */
export function canShowAnnualLeaveOption(opts: {
  role?: string;
  selectedEmp?: LeaveEmployee;
  editing?: boolean;
  currentKind?: string;
}) {
  const { role, selectedEmp, editing, currentKind } = opts;
  if (isHrRole(role)) return true;
  if (editing && currentKind === "annual") return isTenuredEmployee(selectedEmp);
  return isTenuredEmployee(selectedEmp);
}

export function isMedicalLeaveKind(kind?: string) {
  return ["medical", "exam", "same_day"].includes(String(kind || "").toLowerCase());
}

export function canOwnerModifyLeave(
  request: LeaveRequest,
  selfId?: string,
  username?: string,
) {
  if (String(request.status || "").toLowerCase() !== "pending") return false;
  if (selfId && String(request.employeeId) === String(selfId)) return true;
  const u = String(username || "").toLowerCase();
  const by = String(request.requestedBy || "").toLowerCase();
  return Boolean(u && by && by === u);
}

function getWeekKey(dateStr?: string) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
  return mon.toISOString().slice(0, 10);
}

function getMonthKey(dateStr?: string) {
  return String(dateStr || "").slice(0, 7);
}

export type RequestGroup = { label: string; items: LeaveRequest[] };

export function groupRequestsByFrequency(
  reqs: LeaveRequest[],
  freq: "daily" | "weekly" | "monthly",
): RequestGroup[] {
  if (freq === "daily") return [{ label: "All requests", items: reqs }];
  const map = new Map<string, LeaveRequest[]>();
  for (const r of reqs) {
    const key = freq === "weekly" ? getWeekKey(r.startDate) : getMonthKey(r.startDate);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([label, items]) => ({ label, items }));
}

export type RequestFilters = {
  team: string;
  unit: string;
  leaveType: string;
  status: string;
};

export function filterLeaveRequests(
  requests: LeaveRequest[],
  employees: LeaveEmployee[],
  filters: RequestFilters,
) {
  const empById = (id: string) => employees.find((e) => e.id === id);
  let out = requests;
  if (filters.team) {
    const teamIds = new Set(employees.filter((e) => e.team === filters.team).map((e) => e.id));
    out = out.filter((r) => teamIds.has(r.employeeId));
  }
  if (filters.unit) {
    out = out.filter((r) => (empById(r.employeeId)?.unit || "") === filters.unit);
  }
  if (filters.leaveType) {
    out = out.filter((r) => (r.requestKind || r.leaveType || "") === filters.leaveType);
  }
  if (filters.status) {
    out = out.filter((r) => (r.status || "") === filters.status);
  }
  return out;
}

export const EMPTY_LEAVE_FORM = {
  employeeId: "",
  startDate: "",
  endDate: "",
  leaveType: "unpaid",
  dayFraction: "1",
  notes: "",
};
