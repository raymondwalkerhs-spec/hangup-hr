import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card, StatTile } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { StatusPill } from "@/ui/StatusPill";
import { PageToolbar, SearchField, FilterSelect } from "@/ui/PageToolbar";
import { DataGrid } from "@/ui/DataGrid";
import { FormField, FormGrid, FormSection } from "@/ui/FormGrid";
import { DepartDateDialog } from "@/features/employees/DepartDateDialog";
import { defaultDepartForm, departRequestBody, type DepartFormState } from "@/lib/employeeStatus";
import type { ColumnDef } from "@tanstack/react-table";
import styles from "./ComplianceBoard.module.css";
import {
  type BoardRow,
  filterLeavers,
  formatNotice,
  uniqueValues,
} from "./leavers-board";

type Queue = "all" | "revoke" | "final" | "ready";

export function OffboardingPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [params, setParams] = useSearchParams();
  const employeeId = params.get("employee") || "";
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const [team, setTeam] = useState("");
  const [queue, setQueue] = useState<Queue>("all");
  const [departOpen, setDepartOpen] = useState(false);
  const [rehireOpen, setRehireOpen] = useState(false);
  const [departForm, setDepartForm] = useState<DepartFormState>(defaultDepartForm());
  const [rehireForm, setRehireForm] = useState({ startDate: "", status: "Active", notes: "" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["clearance-board", companyContext],
    queryFn: () => api<{ rows: BoardRow[]; counts: Record<string, number> }>(path("/hrms/clearance-board")),
  });

  const rows = data?.rows || [];
  const units = useMemo(() => uniqueValues(rows, "unit"), [rows]);
  const teams = useMemo(() => uniqueValues(rows, "team"), [rows]);

  const revokePending = rows.filter((r) => !r.offboarding?.revokeAccess).length;
  const finalPending = rows.filter((r) => !r.offboarding?.finalPay).length;
  const payrollReady = rows.filter((r) => r.payrollReady).length;

  const visible = useMemo(() => {
    let list = filterLeavers(rows, { search, unit, team });
    if (queue === "revoke") list = list.filter((r) => !r.offboarding?.revokeAccess);
    else if (queue === "final") list = list.filter((r) => !r.offboarding?.finalPay);
    else if (queue === "ready") list = list.filter((r) => r.payrollReady);
    list.sort((a, b) => {
      const pa = a.offboarding?.finalPay ? 1 : 0;
      const pb = b.offboarding?.finalPay ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const ra = a.offboarding?.revokeAccess ? 1 : 0;
      const rb = b.offboarding?.revokeAccess ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return String(b.departDate || "").localeCompare(String(a.departDate || ""));
    });
    return list;
  }, [rows, search, unit, team, queue]);

  const selected = rows.find((r) => r.employeeId === employeeId) || null;

  const openRow = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set("employee", id);
      setParams(next, { replace: true });
    },
    [params, setParams]
  );
  const closeSidecar = () => {
    const next = new URLSearchParams(params);
    next.delete("employee");
    setParams(next, { replace: true });
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["clearance-board"] });
    qc.invalidateQueries({ queryKey: ["hrms-offboarding"] });
    qc.invalidateQueries({ queryKey: ["employees-list"] });
  };

  const saveOff = useMutation({
    mutationFn: ({ id, revokeAccess, finalPay }: { id: string; revokeAccess: boolean; finalPay: boolean }) =>
      api(path(`/hrms/offboarding/${encodeURIComponent(id)}`), {
        method: "PUT",
        body: JSON.stringify({ revokeAccess, finalPay }),
      }),
    onSuccess: invalidate,
  });

  const depart = useMutation({
    mutationFn: () =>
      api(path(`/hrms/employment-periods/${encodeURIComponent(employeeId)}/depart`), {
        method: "POST",
        body: JSON.stringify(departRequestBody(departForm)),
      }),
    onSuccess: () => {
      setDepartOpen(false);
      invalidate();
    },
  });

  const rehire = useMutation({
    mutationFn: () =>
      api(path(`/hrms/employment-periods/${encodeURIComponent(employeeId)}/rehire`), {
        method: "POST",
        body: JSON.stringify(rehireForm),
      }),
    onSuccess: () => {
      setRehireOpen(false);
      closeSidecar();
      invalidate();
    },
  });

  const clearDepart = useMutation({
    mutationFn: () =>
      api(path(`/hrms/employment-periods/${encodeURIComponent(employeeId)}/clear-depart`), {
        method: "POST",
        body: "{}",
      }),
    onSuccess: invalidate,
  });

  const setQueueTile = (next: Queue) => setQueue((cur) => (cur === next ? "all" : next));

  const columns = useMemo<ColumnDef<BoardRow>[]>(
    () => [
      {
        id: "name",
        header: "Employee",
        accessorFn: (r) => r.name || r.arabicName || r.employeeId,
        cell: ({ row, getValue }) => (
          <div className={styles.nameCell}>
            <strong>{String(getValue() || "—")}</strong>
            {row.original.blocked ? <StatusPill variant="warn">Blocked</StatusPill> : null}
          </div>
        ),
      },
      {
        accessorKey: "employeeId",
        header: "ID",
        cell: (c) => <code>{String(c.getValue())}</code>,
      },
      { accessorKey: "unit", header: "Unit", cell: (c) => String(c.getValue() ?? "—") },
      { accessorKey: "team", header: "Team", cell: (c) => String(c.getValue() ?? "—") },
      {
        id: "left",
        header: "Left",
        cell: ({ row }) => row.original.departDate ? String(row.original.departDate).slice(0, 10) : "—",
      },
      {
        id: "notice",
        header: "Notice",
        cell: ({ row }) => formatNotice(row.original.noticeType) || "—",
      },
      {
        id: "revoke",
        header: "Revoke access",
        cell: ({ row }) => {
          const done = !!row.original.offboarding?.revokeAccess;
          return (
            <button
              type="button"
              className={styles.pillBtn}
              title={done ? "Click to mark pending" : "Click to mark revoked"}
              disabled={saveOff.isPending}
              onClick={(e) => {
                e.stopPropagation();
                saveOff.mutate({
                  id: row.original.employeeId,
                  revokeAccess: !done,
                  finalPay: !!row.original.offboarding?.finalPay,
                });
              }}
            >
              <StatusPill variant={done ? "ok" : "warn"}>{done ? "Done" : "Pending"}</StatusPill>
            </button>
          );
        },
      },
      {
        id: "finalPay",
        header: "Final pay",
        cell: ({ row }) => {
          const done = !!row.original.offboarding?.finalPay;
          const blocked = !row.original.clearanceComplete && !done;
          return (
            <button
              type="button"
              className={styles.pillBtn}
              title={
                blocked
                  ? "Finish clearance before marking final pay"
                  : done
                    ? "Click to mark pending"
                    : "Click to mark processed"
              }
              disabled={saveOff.isPending || blocked}
              onClick={(e) => {
                e.stopPropagation();
                saveOff.mutate({
                  id: row.original.employeeId,
                  revokeAccess: !!row.original.offboarding?.revokeAccess,
                  finalPay: !done,
                });
              }}
            >
              <StatusPill variant={done ? "ok" : blocked ? "err" : "warn"}>
                {done ? "Done" : blocked ? "Clearance first" : "Pending"}
              </StatusPill>
            </button>
          );
        },
      },
      {
        id: "clearance",
        header: "Clearance",
        cell: ({ row }) => (
          <Link
            to={`/clearance?employee=${encodeURIComponent(row.original.employeeId)}`}
            onClick={(e) => e.stopPropagation()}
          >
            <StatusPill variant={row.original.clearanceComplete ? "ok" : "warn"}>
              {row.original.clearanceComplete ? "Complete" : "Open"}
            </StatusPill>
          </Link>
        ),
      },
    ],
    [saveOff]
  );

  return (
    <div>
      <SectionHeader
        title="Offboarding"
        subtitle={`${visible.length} shown · ${rows.length} leavers · click Revoke or Final pay in the table`}
      />

      <div className="stat-grid">
        <StatTile value={String(rows.length)} label="Leavers" />
        <StatTile
          value={String(revokePending)}
          label="Access not revoked"
          accent={revokePending > 0}
          active={queue === "revoke"}
          onClick={() => setQueueTile("revoke")}
        />
        <StatTile
          value={String(finalPending)}
          label="Final pay pending"
          accent={finalPending > 0}
          active={queue === "final"}
          onClick={() => setQueueTile("final")}
        />
        <StatTile
          value={String(payrollReady)}
          label="Payroll ready"
          active={queue === "ready"}
          onClick={() => setQueueTile("ready")}
        />
      </div>

      <PageToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search name, Arabic name, or ID…" />
        <FilterSelect label="Unit" value={unit} onChange={setUnit} options={units} allLabel="All units" />
        <FilterSelect label="Team" value={team} onChange={setTeam} options={teams} allLabel="All teams" />
        <FilterSelect
          label="Queue"
          value={queue === "all" ? "" : queue}
          onChange={(v) => setQueue((v || "all") as Queue)}
          options={[
            { value: "revoke", label: "Access not revoked" },
            { value: "final", label: "Final pay pending" },
            { value: "ready", label: "Payroll ready" },
          ]}
          allLabel="All leavers"
        />
      </PageToolbar>

      <Card className={styles.tableCard}>
        {isLoading && <p className="muted" style={{ padding: "1rem" }}>Loading…</p>}
        {error && <p style={{ color: "var(--err)", padding: "1rem" }}>{(error as Error).message}</p>}
        {saveOff.isError && (
          <p style={{ color: "var(--err)", padding: "1rem" }}>
            {(saveOff.error as Error).message || "Could not update offboarding"}
          </p>
        )}
        {!isLoading && !error && (
          <DataGrid
            className={styles.gridFlush}
            data={visible}
            columns={columns}
            onRowClick={(row) => openRow(row.employeeId)}
            emptyMessage={rows.length ? "No leavers match filters" : "No leavers in this company"}
          />
        )}
      </Card>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(o) => !o && closeSidecar()}
        title={selected ? String(selected.name || selected.employeeId) : "Offboarding"}
        size="wide"
        scrollBody
      >
        {selected && (
          <div>
            <p className="muted">
              {[selected.unit, selected.team, selected.status || "Out", selected.departDate ? `left ${String(selected.departDate).slice(0, 10)}` : "", formatNotice(selected.noticeType)]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className={styles.links}>
              <Link to={`/employees?highlight=${encodeURIComponent(selected.employeeId)}`}>Employees</Link>
              <Link to={`/clearance?employee=${encodeURIComponent(selected.employeeId)}`}>Clearance</Link>
              <Link to={`/equipment?employee=${encodeURIComponent(selected.employeeId)}`}>Equipment</Link>
            </p>

            <FormSection title="Checklist">
              <div className={styles.actions} style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className={styles.pillBtn}
                  disabled={saveOff.isPending}
                  onClick={() =>
                    saveOff.mutate({
                      id: selected.employeeId,
                      revokeAccess: !selected.offboarding?.revokeAccess,
                      finalPay: !!selected.offboarding?.finalPay,
                    })
                  }
                >
                  Revoke access{" "}
                  <StatusPill variant={selected.offboarding?.revokeAccess ? "ok" : "warn"}>
                    {selected.offboarding?.revokeAccess ? "Done" : "Pending"}
                  </StatusPill>
                </button>
                <button
                  type="button"
                  className={styles.pillBtn}
                  disabled={saveOff.isPending || (!selected.clearanceComplete && !selected.offboarding?.finalPay)}
                  title={!selected.clearanceComplete && !selected.offboarding?.finalPay ? "Finish clearance first" : undefined}
                  onClick={() =>
                    saveOff.mutate({
                      id: selected.employeeId,
                      revokeAccess: !!selected.offboarding?.revokeAccess,
                      finalPay: !selected.offboarding?.finalPay,
                    })
                  }
                >
                  Final pay{" "}
                  <StatusPill variant={selected.offboarding?.finalPay ? "ok" : selected.clearanceComplete ? "warn" : "err"}>
                    {selected.offboarding?.finalPay ? "Done" : selected.clearanceComplete ? "Pending" : "Clearance first"}
                  </StatusPill>
                </button>
              </div>
            </FormSection>

            <FormSection title="Employment">
              <div className={styles.actions} style={{ justifyContent: "flex-start" }}>
                <Button size="sm" variant="secondary" onClick={() => { setDepartForm(defaultDepartForm()); setDepartOpen(true); }}>
                  Mark depart
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setRehireOpen(true)}>
                  Re-hire
                </Button>
                {selected.departDate ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={clearDepart.isPending}
                    onClick={() => {
                      if (confirm(`Clear depart date (${String(selected.departDate).slice(0, 10)})?`)) {
                        clearDepart.mutate();
                      }
                    }}
                  >
                    Clear depart date
                  </Button>
                ) : null}
              </div>
            </FormSection>
          </div>
        )}
      </Dialog>

      <DepartDateDialog
        open={departOpen}
        onOpenChange={setDepartOpen}
        form={departForm}
        onFormChange={setDepartForm}
        onConfirm={() => depart.mutate()}
        isPending={depart.isPending}
      />

      <Dialog
        open={rehireOpen}
        onOpenChange={setRehireOpen}
        title="Re-hire"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRehireOpen(false)}>Cancel</Button>
            <Button onClick={() => rehire.mutate()} disabled={!rehireForm.startDate || rehire.isPending}>
              {rehire.isPending ? "Saving…" : "Re-hire"}
            </Button>
          </>
        }
      >
        <FormGrid>
          <FormField label="Start date">
            <input type="date" value={rehireForm.startDate} onChange={(e) => setRehireForm({ ...rehireForm, startDate: e.target.value })} />
          </FormField>
          <FormField label="Status">
            <select value={rehireForm.status} onChange={(e) => setRehireForm({ ...rehireForm, status: e.target.value })}>
              <option value="Active">Active</option>
              <option value="Paused">Paused</option>
            </select>
          </FormField>
          <FormField label="Notes" span="full">
            <textarea value={rehireForm.notes} onChange={(e) => setRehireForm({ ...rehireForm, notes: e.target.value })} />
          </FormField>
        </FormGrid>
      </Dialog>
    </div>
  );
}
