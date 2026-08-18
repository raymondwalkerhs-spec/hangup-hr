export type ClearanceItem = { itemKey: string; status?: string; notes?: string };
export type Assignment = {
  id?: string;
  assetTag?: string;
  itemType?: string;
  description?: string;
  returnedAt?: string | null;
};
export type BoardRow = {
  employeeId: string;
  name?: string;
  arabicName?: string;
  status?: string;
  departDate?: string;
  noticeType?: string;
  unit?: string;
  team?: string;
  form?: ClearanceItem;
  files?: ClearanceItem;
  equipmentHandover?: string;
  unreturned?: Assignment[];
  offboarding?: { revokeAccess?: boolean; finalPay?: boolean };
  documents?: { docType?: string }[];
  docCounts?: Record<string, number>;
  clearanceComplete?: boolean;
  payrollReady?: boolean;
  blocked?: boolean;
  payslipNotes?: string[];
  blockers?: string[];
};

export function pillFor(status?: string, devicesOut?: boolean): "ok" | "warn" | "err" | "muted" {
  if (devicesOut) return "err";
  const s = String(status || "pending").toLowerCase();
  if (s === "done") return "ok";
  if (s === "not_needed") return "muted";
  return "warn";
}

export function statusLabel(status?: string) {
  const s = String(status || "pending").toLowerCase();
  if (s === "done") return "Done";
  if (s === "not_needed") return "Not needed";
  return "Pending";
}

export function formatNotice(value?: string) {
  const s = String(value || "").replace(/_/g, " ");
  if (!s) return "";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function toggleClearanceStatus(status?: string) {
  return String(status || "pending").toLowerCase() === "pending" ? "done" : "pending";
}

export function filterLeavers(
  rows: BoardRow[],
  {
    search,
    unit,
    team,
  }: {
    search: string;
    unit: string;
    team: string;
  }
) {
  const q = search.trim().toLowerCase();
  let list = rows.slice();
  if (q) {
    list = list.filter((r) =>
      [r.employeeId, r.name, r.arabicName, r.unit, r.team].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }
  if (unit) list = list.filter((r) => r.unit === unit);
  if (team) list = list.filter((r) => r.team === team);
  return list;
}

export function uniqueValues(rows: BoardRow[], key: "unit" | "team") {
  return [...new Set(rows.map((r) => r[key]).filter(Boolean))] as string[];
}

export function toLifecycleEmployee(row: BoardRow) {
  return {
    id: row.employeeId,
    american_name: row.name,
    arabic_name: row.arabicName,
    status: row.status,
    depart_date: row.departDate,
    notice_type: row.noticeType,
    unit: row.unit,
    team: row.team,
  };
}
