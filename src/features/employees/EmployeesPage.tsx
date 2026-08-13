import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { filterEmployees, type EmployeeFilters } from "@/lib/employeeSearch";
import { PAYMENT_METHOD_FILTER_OPTIONS, paymentMethodLabel } from "@/lib/paymentMethods";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { DataGrid } from "@/ui/DataGrid";
import { PageToolbar, SearchField, FilterSelect } from "@/ui/PageToolbar";
import { StatusPill } from "@/ui/StatusPill";
import { EmployeeEditDialog } from "./EmployeeEditDialog";
import { AddAgentDialog } from "./AddAgentDialog";
import { EmployeeDocsDialog, EmployeeWarningsDialog, EmployeeQualityNotesDialog } from "./EmployeeSidecarDialogs";
import styles from "./EmployeesPage.module.css";

function isEgyptianNationality(nationality: unknown) {
  const n = String(nationality || "").toLowerCase();
  return n === "egyptian" || n === "egyptain" || n === "egypt";
}

function complianceLabel(emp: Record<string, unknown>) {
  if (isEgyptianNationality(emp.nationality)) {
    const ins = emp.insurance_status || emp.social_insurance_status;
    if (ins === "insured") return "Insured";
    if (ins === "not_insured") return "Not insured";
    return "—";
  }
  if (emp.nationality) {
    const wp = emp.work_permit || emp.work_permit_status;
    if (wp === "have_permit") return "Have permit";
    if (wp === "no_permit") return "No permit";
    return "—";
  }
  return "—";
}

type Emp = Record<string, unknown>;
type Meta = {
  employees: Emp[];
  units?: string[];
  teams?: string[];
  positions?: string[];
  statuses?: string[];
  paymentMethods?: { value: string; label: string }[];
  nationalities?: string[];
  hideOutEmployees?: boolean;
};

export function EmployeesPage() {
  const qc = useQueryClient();
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<EmployeeFilters>({});
  const [editEmp, setEditEmp] = useState<Emp | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [hideOut, setHideOut] = useState(true);
  const [docsEmp, setDocsEmp] = useState<string | null>(null);
  const [warnEmp, setWarnEmp] = useState<string | null>(null);
  const [qnoteEmp, setQnoteEmp] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["employees-list", hideOut, companyContext, month],
    queryFn: () =>
      api<Meta>(
        path("/employees", {
          month,
          hideOut: hideOut ? "true" : "false",
          showLegacy: "false",
        })
      ),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const { user: statusUser } = useAppStatus();

  const hideOutMut = useMutation({
    mutationFn: (hide: boolean) => api("/settings/hide-out", { method: "PUT", body: JSON.stringify({ hide }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees-list"] }),
  });

  const canEdit = statusUser?.canManageEmployees === true || ["admin", "ceo", "hr"].includes(String(statusUser?.role || ""));
  const canAdd = statusUser?.canAddEmployee === true;
  const myEmpId = statusUser?.employeeId as string | undefined;
  const username = statusUser?.username as string | undefined;
  const canViewNotes = statusUser?.canViewEmployeeNotes === true;
  const canWriteNotes = statusUser?.canWriteEmployeeNotes === true;
  const canViewQNotes = statusUser?.canViewQualityNotes === true;
  const canWriteQNotes = statusUser?.canWriteQualityNotes === true;
  const showComplianceCol = statusUser?.canViewEmployeeCompliance === true;
  const showComplianceFilters = statusUser?.canViewEmployeeComplianceFilters === true;
  const showNatCol = statusUser?.canViewEmployeeNationality === true;
  const showFilters = statusUser?.canUseEmployeeFilters === true;
  const meta = data;
  const rows = useMemo(
    () => filterEmployees(meta?.employees || [], search, filters),
    [meta?.employees, search, filters]
  );

  const columns = useMemo<ColumnDef<Emp>[]>(
    () => [
      {
        id: "name",
        header: "Employee",
        accessorFn: (r) => r.american_name || r.arabic_name || r.id,
        cell: (c) => (
          <div className={styles.nameCell}>
            <strong>{String(c.getValue() || "—")}</strong>
            {!(c.row.original.fp_number || c.row.original.fpNumber) && (
              <StatusPill variant="warn">No FP</StatusPill>
            )}
          </div>
        ),
      },
      { accessorKey: "id", header: "ID", cell: (c) => <code>{String(c.getValue())}</code> },
      { accessorKey: "unit", header: "Unit", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "team", header: "Team", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "position", header: "Position", cell: (c) => String(c.getValue() ?? "—") },
      {
        id: "paymentMethod",
        header: "Payment",
        cell: ({ row }) => {
          const label = paymentMethodLabel(row.original.payment_method || row.original.paymentMethod);
          return label === "—" ? <span className="muted">—</span> : label;
        },
      },
      ...(showNatCol
        ? [{ accessorKey: "nationality", header: "Nationality", cell: (c: { getValue: () => unknown }) => String(c.getValue() || "—") } as ColumnDef<Emp>]
        : []),
      ...(showComplianceCol
        ? [{
            id: "compliance",
            header: "Permit / Insurance",
            cell: ({ row }: { row: { original: Emp } }) => complianceLabel(row.original),
          } as ColumnDef<Emp>]
        : []),
      {
        accessorKey: "status",
        header: "Status",
        cell: (c) => <StatusPill variant={c.getValue() === "Active" ? "ok" : "muted"}>{String(c.getValue() || "—")}</StatusPill>,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const id = String(row.original.id);
          const isSelf = myEmpId === id;
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
              {(canEdit || isSelf) && (
                <Button size="sm" variant="secondary" onClick={() => setDocsEmp(id)}>{isSelf && !canEdit ? "My docs" : "Docs"}</Button>
              )}
              {(canViewNotes || canWriteNotes) && (
                <Button size="sm" variant="secondary" onClick={() => setWarnEmp(id)}>HR notes</Button>
              )}
              {(canViewQNotes || canWriteQNotes) && (
                <Button size="sm" variant="secondary" onClick={() => setQnoteEmp(id)}>Quality</Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setEditEmp(row.original)}>{canEdit ? "Edit" : "View"}</Button>
            </div>
          );
        },
      },
    ],
    [canEdit, showNatCol, showComplianceCol, myEmpId, canViewNotes, canWriteNotes, canViewQNotes, canWriteQNotes]
  );

  const setFilter = <K extends keyof EmployeeFilters>(k: K, v: EmployeeFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const toggleHideOut = (checked: boolean) => {
    setHideOut(checked);
    hideOutMut.mutate(checked);
  };

  return (
    <div>
      <SectionHeader
        title="Employees"
        subtitle={`${rows.length} shown`}
        actions={canAdd ? <Button onClick={() => setAddOpen(true)}>+ Add agent</Button> : undefined}
      />
      <PageToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search name, Arabic name, or ID…" />
        {showFilters && (
          <>
        <FilterSelect label="Status" value={filters.status || ""} onChange={(v) => setFilter("status", v)} options={meta?.statuses || []} allLabel="All statuses" />
        <FilterSelect label="Unit" value={filters.unit || ""} onChange={(v) => setFilter("unit", v)} options={meta?.units || []} allLabel="All units" />
        <FilterSelect label="Team" value={filters.team || ""} onChange={(v) => setFilter("team", v)} options={meta?.teams || []} allLabel="All teams" />
        <FilterSelect label="Position" value={filters.position || ""} onChange={(v) => setFilter("position", v)} options={meta?.positions || []} allLabel="All positions" />
        <FilterSelect label="Payment" value={filters.paymentMethod || ""} onChange={(v) => setFilter("paymentMethod", v)} options={PAYMENT_METHOD_FILTER_OPTIONS} allLabel="All payment methods" />
        <label className={styles.fpFilter}>
          <span className="muted">FP</span>
          <select value={filters.fpStatus || ""} onChange={(e) => setFilter("fpStatus", e.target.value as EmployeeFilters["fpStatus"])}>
            <option value="">All</option>
            <option value="has_fp">Has FP</option>
            <option value="no_fp">No FP</option>
          </select>
        </label>
        <FilterSelect label="Nationality" value={filters.nationality || ""} onChange={(v) => setFilter("nationality", v)} options={meta?.nationalities || ["Egyptian", "Sudanese"]} allLabel="All nationalities" />
        {showComplianceFilters && (
          <>
            <FilterSelect label="Work permit" value={filters.workPermit || ""} onChange={(v) => setFilter("workPermit", v)} options={["have_permit", "no_permit"]} allLabel="All permits" />
            <FilterSelect label="Insurance" value={filters.insuranceStatus || ""} onChange={(v) => setFilter("insuranceStatus", v)} options={["insured", "not_insured"]} allLabel="All insurance" />
          </>
        )}
          </>
        )}
        <label className={styles.hideOutToggle}>
          <input
            type="checkbox"
            checked={hideOut}
            onChange={(e) => toggleHideOut(e.target.checked)}
          />
          <span>Hide OUT (left previous month)</span>
        </label>
      </PageToolbar>

      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        {!isLoading && !error && (
          <DataGrid
            data={rows}
            columns={columns}
            onRowClick={(row) => setEditEmp(row)}
            emptyMessage="No employees match filters"
          />
        )}
      </Card>

      <AddAgentDialog open={addOpen} onOpenChange={setAddOpen} meta={meta} />
      <EmployeeDocsDialog
        employeeId={docsEmp}
        open={!!docsEmp}
        onOpenChange={(o) => !o && setDocsEmp(null)}
        canUpload={canEdit || docsEmp === myEmpId}
        selfServiceUpload={!canEdit && docsEmp === myEmpId}
        canExportZip={canEdit}
      />
      <EmployeeWarningsDialog
        employeeId={warnEmp}
        open={!!warnEmp}
        onOpenChange={(o) => !o && setWarnEmp(null)}
        canRead={canViewNotes}
        canWrite={canWriteNotes}
        canManage={canEdit}
      />
      <EmployeeQualityNotesDialog
        employeeId={qnoteEmp}
        open={!!qnoteEmp}
        onOpenChange={(o) => !o && setQnoteEmp(null)}
        canRead={canViewQNotes}
        canWrite={canWriteQNotes}
        canManage={canEdit}
        username={username}
      />
      <EmployeeEditDialog
        employee={editEmp}
        meta={meta}
        open={!!editEmp}
        onOpenChange={(o) => !o && setEditEmp(null)}
        canEdit={canEdit}
      />
    </div>
  );
}
