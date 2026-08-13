import type { ColumnDef } from "@tanstack/react-table";
import { fmt } from "./client";

export type Row = Record<string, unknown>;

export const col = {
  text: (key: string, header: string): ColumnDef<Row> => ({
    accessorKey: key,
    header,
    cell: (c) => String(c.getValue() ?? "—"),
  }),
  num: (key: string, header: string): ColumnDef<Row> => ({
    accessorKey: key,
    header,
    cell: (c) => fmt(c.getValue() as number),
  }),
  accessor: (header: string, fn: (row: Row) => unknown): ColumnDef<Row> => ({
    id: header,
    header,
    accessorFn: fn,
    cell: (c) => String(c.getValue() ?? "—"),
  }),
};

export const employeeCols = [
  col.text("id", "ID"),
  col.accessor("Name", (r) => r.american_name || r.arabic_name || r.name),
  col.text("status", "Status"),
  col.text("unit", "Unit"),
  col.text("team", "Team"),
  col.text("position", "Position"),
];

export const attendanceCols = [
  col.text("employeeId", "ID"),
  col.accessor("Name", (r) => r.name || r.employeeName),
  col.num("nsnc", "NSNC"),
  col.num("nsncHalf", "NSNC ½"),
  col.num("workingDays", "WD"),
];

export const payrollCols = [
  col.text("employeeId", "ID"),
  col.accessor("Name", (r) => r.name || r.employeeName),
  col.num("basicSalary", "Basic"),
  col.num("netSalary", "Net"),
];

export const bonusCols = [
  col.text("employeeId", "ID"),
  col.num("amount", "Amount"),
  col.text("type", "Type"),
  col.text("reason", "Reason"),
];

export const deductionCols = [
  col.text("employeeId", "ID"),
  col.num("amount", "Amount"),
  col.text("type", "Type"),
  col.text("reason", "Reason"),
];

export const loanCols = [
  col.text("employeeId", "ID"),
  col.num("totalAmount", "Total"),
  col.num("installmentAmount", "Installment"),
  col.text("status", "Status"),
];

export const loanRequestCols = [
  col.text("employeeId", "ID"),
  col.num("totalAmount", "Amount"),
  col.text("submittedBy", "Submitted by"),
  col.text("status", "Status"),
];

export const requestCols = [
  col.text("employeeId", "ID"),
  col.accessor("Type", (r) => r.leaveType || r.requestKind || r.type),
  col.text("status", "Status"),
  col.accessor("From", (r) => String(r.startDate || r.fromDate || "").slice(0, 10)),
  col.accessor("To", (r) => String(r.endDate || r.toDate || "").slice(0, 10)),
];

export const salaryCols = [
  col.text("position", "Position"),
  col.num("monthlySalary", "Monthly salary"),
];

export const changeCols = [
  col.accessor("When", (r) => String(r.timestamp || r.at || "").slice(0, 19).replace("T", " ")),
  col.accessor("User", (r) => r.username || r.user),
  col.text("entity", "Entity"),
  col.text("action", "Action"),
  col.text("summary", "Summary"),
];

export const interviewCols = [
  col.accessor("Date", (r) => String(r.timestamp || r.submissionDate || "").slice(0, 10)),
  col.accessor("Name", (r) => r.name || r.candidateName),
  col.text("phone", "Phone"),
  col.accessor("1st", (r) => r.firstInterviewStatus || r.status),
  col.accessor("2nd", (r) => r.secondInterviewStatus || "—"),
];

export const trainingCols = [
  col.accessor("Name", (r) => r.name || r.candidateName),
  col.text("trainer", "Trainer"),
  col.text("trainingStatus", "Status"),
  col.accessor("Start", (r) => String(r.trainingStartDate || "").slice(0, 10)),
];

export const equipmentCols = [
  col.text("employeeId", "Agent ID"),
  col.text("itemType", "Device"),
  col.text("unit", "Unit"),
  col.text("notes", "Notes"),
  col.accessor("Issued", (r) => String(r.assignedAt || "").slice(0, 10)),
];
