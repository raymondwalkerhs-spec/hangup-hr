import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { StatusPill } from "@/ui/StatusPill";
import { PageToolbar, FilterSelect } from "@/ui/PageToolbar";
import { Select } from "@/ui/Select";
import { useDeferredDelete } from "@/ui/useDeferredDelete";
import { LeaveDocsDialog } from "./LeaveDocsDialog";
import { LeaveDocsPanel, uploadPendingLeaveDocs, type PendingLeaveDoc } from "./LeaveDocsPanel";
import {
  type LeaveRequest,
  type LeaveEmployee,
  KIND_LABELS,
  FRACTION_OPTIONS,
  fractionLabel,
  canSubmitForOthers,
  canSubmitLeaveForOthers,
  isHrRole,
  isTenuredEmployee,
  canShowAnnualLeaveOption,
  daysEmployed,
  isMedicalLeaveKind,
  canOwnerModifyLeave,
  groupRequestsByFrequency,
  filterLeaveRequests,
  EMPTY_LEAVE_FORM,
} from "./leaveRequestHelpers";
import styles from "./RequestsPage.module.css";

type LeaveListResponse = {
  requests?: LeaveRequest[];
  canApprove?: boolean;
  employees?: LeaveEmployee[];
  statuses?: string[];
  teams?: string[];
  units?: string[];
  leaveTypes?: string[];
};

export function RequestsPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [filters, setFilters] = useState({ team: "", unit: "", leaveType: "", status: "" });
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("daily");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveRequest | null>(null);
  const [docsTarget, setDocsTarget] = useState<LeaveRequest | null>(null);
  const [form, setForm] = useState({ ...EMPTY_LEAVE_FORM });
  const [pendingDocs, setPendingDocs] = useState<PendingLeaveDoc[]>([]);
  const [submitError, setSubmitError] = useState("");

  const { user: appUser } = useAppStatus();

  const userRole = appUser?.role as string | undefined;
  const leadTeams = (appUser?.leadTeams as { team?: string }[] | undefined) || [];
  const selfId = String(appUser?.employeeId || "");
  const username = String(appUser?.username || "");
  const forOthers = canSubmitLeaveForOthers({ role: userRole, leadTeams });
  const canViewFilters = Boolean(appUser?.canViewRequestFilters);

  const isSingleDay =
    Boolean(form.startDate) &&
    (!form.endDate || form.endDate === form.startDate);
  const showFraction = isSingleDay && form.leaveType !== "pause";
  const showDocs = isMedicalLeaveKind(form.leaveType);

  const { data, isLoading, error } = useQuery({
    queryKey: ["leave-requests", companyContext],
    queryFn: () => api<LeaveListResponse>(path("/hrms/leave")),
  });

  const employees = data?.employees || [];
  const deferred = useDeferredDelete({
    items: data?.requests || [],
    commit: async (id) => {
      await api(path(`/hrms/leave/${id}`), { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["attendance-grid"] });
      qc.invalidateQueries({ queryKey: ["employees-list"] });
    },
    message: "Request deleted",
  });
  const filteredRequests = useMemo(() => {
    const base = (data?.requests || []).filter((r) => !deferred.hiddenIds.has(r.id));
    const filtered = canViewFilters
      ? filterLeaveRequests(base, employees, filters)
      : filters.status
        ? base.filter((r) => (r.status || "") === filters.status)
        : base;
    return filtered;
  }, [data?.requests, employees, filters, canViewFilters, deferred.hiddenIds]);

  const grouped = useMemo(
    () => groupRequestsByFrequency(filteredRequests, frequency),
    [filteredRequests, frequency],
  );

  const empName = (id: string) => {
    const e = employees.find((x) => x.id === id);
    return e?.american_name || id;
  };

  const openNewRequest = () => {
    setEditing(null);
    setForm({ ...EMPTY_LEAVE_FORM, employeeId: forOthers ? "" : selfId });
    setPendingDocs([]);
    setSubmitError("");
    setFormOpen(true);
  };

  const openEditRequest = (r: LeaveRequest) => {
    const kind = r.requestKind || r.leaveType || "unpaid";
    setEditing(r);
    setForm({
      employeeId: r.employeeId,
      startDate: r.startDate || "",
      endDate: r.endDate || r.startDate || "",
      leaveType: kind,
      dayFraction: String(r.dayFraction ?? 1),
      notes: r.notes || "",
    });
    setPendingDocs([]);
    setSubmitError("");
    setFormOpen(true);
  };

  useEffect(() => {
    if (!formOpen || editing || forOthers || !selfId) return;
    setForm((prev) => (prev.employeeId === selfId ? prev : { ...prev, employeeId: selfId }));
  }, [formOpen, editing, forOthers, selfId]);

  const selectedEmp = employees.find((e) => e.id === form.employeeId);
  const showAnnualOption = canShowAnnualLeaveOption({
    role: userRole,
    selectedEmp,
    editing: Boolean(editing),
    currentKind: editing ? (editing.requestKind || editing.leaveType) : form.leaveType,
  });
  const tenureDays = daysEmployed(selectedEmp);
  const showTenureNote =
    Boolean(selectedEmp) &&
    !isHrRole(userRole) &&
    !isTenuredEmployee(selectedEmp);

  useEffect(() => {
    if (!formOpen) return;
    if (!showAnnualOption && form.leaveType === "annual") {
      setForm((prev) => ({ ...prev, leaveType: "unpaid" }));
    }
  }, [formOpen, showAnnualOption, form.leaveType]);

  const submitBody = useMemo(() => {
    const endDate = form.endDate || form.startDate;
    const dayFraction = showFraction ? Number(form.dayFraction || 1) : 1;
    return {
      employeeId: forOthers ? form.employeeId : selfId || form.employeeId,
      startDate: form.startDate,
      endDate,
      leaveType: form.leaveType,
      requestKind: form.leaveType,
      notes: form.notes,
      dayFraction,
      halfDay: dayFraction === 0.5,
      quarterDay: dayFraction === 0.25,
    };
  }, [form, showFraction, forOthers, selfId]);

  const submit = useMutation({
    mutationFn: async () => {
      setSubmitError("");
      if (editing) {
        return api(path(`/hrms/leave/${editing.id}`), {
          method: "PUT",
          body: JSON.stringify(submitBody),
        });
      }
      const created = await api<{ request?: { id?: string } }>(path("/hrms/leave"), {
        method: "POST",
        body: JSON.stringify(submitBody),
      });
      const leaveId = created?.request?.id;
      if (leaveId && pendingDocs.length && isMedicalLeaveKind(form.leaveType)) {
        await uploadPendingLeaveDocs(leaveId, pendingDocs, form.leaveType, path);
      }
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      setFormOpen(false);
      setEditing(null);
      setForm({ ...EMPTY_LEAVE_FORM });
      setPendingDocs([]);
    },
    onError: (e: Error) => setSubmitError(e.message),
  });

  const invalidateAttendance = () => {
    qc.invalidateQueries({ queryKey: ["attendance-grid"] });
    qc.invalidateQueries({ queryKey: ["employees-list"] });
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(path(`/hrms/leave/${id}`), { method: "PUT", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      invalidateAttendance();
    },
  });


  const renderRow = (r: LeaveRequest) => {
    const kind = r.requestKind || r.leaveType || "annual";
    const isMedical = isMedicalLeaveKind(kind);
    const canApprove = Boolean(data?.canApprove);
    const canSubmitterModify = canOwnerModifyLeave(r, selfId, username);
    const canApproverModify = canApprove;
    const showEditDelete = canSubmitterModify || canApproverModify;

    return (
      <tr key={r.id}>
        <td>
          <strong>{empName(r.employeeId)}</strong>
          <br />
          <span className="muted">{r.employeeId}</span>
        </td>
        <td>
          {r.startDate}
          {r.endDate && r.endDate !== r.startDate ? ` – ${r.endDate}` : ""}
        </td>
        <td>{fractionLabel(r.dayFraction) || "Full day"}</td>
        <td>{KIND_LABELS[kind] || kind}</td>
        <td>
          <StatusPill variant={r.status === "approved" ? "ok" : r.status === "pending" ? "warn" : "muted"}>
            {r.status}
          </StatusPill>
        </td>
        <td className="muted">{r.notes || "—"}</td>
        <td>
          <span className={styles.actions}>
            {isMedical && (
              <Button size="sm" variant="secondary" onClick={() => setDocsTarget(r)} title="Upload / view sick note">
                📎 Docs
              </Button>
            )}
            {canApprove && r.status === "pending" && (
              <>
                <Button size="sm" onClick={() => setStatus.mutate({ id: r.id, status: "approved" })}>Approve</Button>
                <Button size="sm" variant="danger" onClick={() => setStatus.mutate({ id: r.id, status: "rejected" })}>Reject</Button>
              </>
            )}
            {showEditDelete && (
              <>
                <Button size="sm" variant="secondary" onClick={() => openEditRequest(r)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => deferred.requestDelete(r.id)}
                    >
                  Delete
                </Button>
              </>
            )}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <SectionHeader
        title="Leave requests"
        subtitle="Annual, unpaid, medical, and same-day off · Approvers: Mark, Raymond, Phoebe"
        actions={<Button onClick={openNewRequest}>+ Request leave</Button>}
      />

      <PageToolbar>
        {canViewFilters ? (
          <>
            <FilterSelect
              label="Team"
              value={filters.team}
              onChange={(team) => setFilters((f) => ({ ...f, team }))}
              options={data?.teams || []}
              allLabel="All teams"
            />
            <FilterSelect
              label="Unit"
              value={filters.unit}
              onChange={(unit) => setFilters((f) => ({ ...f, unit }))}
              options={data?.units || []}
              allLabel="All units"
            />
            <FilterSelect
              label="Type"
              value={filters.leaveType}
              onChange={(leaveType) => setFilters((f) => ({ ...f, leaveType }))}
              options={data?.leaveTypes || []}
              allLabel="All types"
            />
            <FilterSelect
              label="Status"
              value={filters.status}
              onChange={(status) => setFilters((f) => ({ ...f, status }))}
              options={data?.statuses || ["pending", "approved", "rejected"]}
              allLabel="All statuses"
            />
            <label className={styles.field}>
              <span className="muted">Group by</span>
              <Select
                value={frequency}
                onChange={(v) => setFrequency(v as "daily" | "weekly" | "monthly")}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
            </label>
          </>
        ) : (
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(status) => setFilters((f) => ({ ...f, status }))}
            options={data?.statuses || ["pending", "approved", "rejected"]}
            allLabel="All statuses"
          />
        )}
      </PageToolbar>

      {isLoading && <Card><p className="muted">Loading…</p></Card>}
      {error && <Card><p style={{ color: "var(--err)" }}>{(error as Error).message}</p></Card>}

      {!isLoading && !error && grouped.map((group) => (
        <Card key={group.label} className={styles.groupCard}>
          {group.label !== "All requests" && (
            <h3 className={styles.groupTitle}>{group.label}</h3>
          )}
          <div className="table-wrap">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Dates</th>
                  <th>Duration</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {group.items.map(renderRow)}
                {!group.items.length && (
                  <tr><td colSpan={7} className="muted">No leave requests</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? "Edit leave request" : "Leave request"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              onClick={() => submit.mutate()}
              disabled={!(forOthers || editing ? form.employeeId : selfId) || !form.startDate || submit.isPending}
            >
              {submit.isPending ? "Saving…" : editing ? "Save" : "Submit"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          {forOthers && !editing ? (
            <label>
              <span className="muted">Employee</span>
              <Select
                value={form.employeeId}
                onChange={(employeeId) => setForm({ ...form, employeeId })}
                options={[
                  { value: "", label: "— Select —" },
                  ...employees.map((e) => ({
                    value: e.id,
                    label: `${e.american_name || e.id} (${e.id})`,
                  })),
                ]}
                placeholder="— Select —"
              />
            </label>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Requesting for: <strong>{empName(form.employeeId) || selfId || "your account"}</strong>
            </p>
          )}
          <label>
            <span className="muted">Start</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => {
                const startDate = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  startDate,
                  endDate: !prev.endDate || prev.endDate < startDate ? startDate : prev.endDate,
                }));
              }}
            />
          </label>
          <label>
            <span className="muted">End</span>
            <input
              type="date"
              value={form.endDate}
              min={form.startDate || undefined}
              onChange={(e) => {
                const endDate = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  endDate,
                  dayFraction: prev.startDate && endDate && endDate !== prev.startDate ? "1" : prev.dayFraction,
                }));
              }}
            />
          </label>
          <label>
            <span className="muted">Type</span>
            <Select
              value={form.leaveType}
              onChange={(leaveType) => {
                setForm({
                  ...form,
                  leaveType,
                  dayFraction: leaveType === "pause" ? "1" : form.dayFraction,
                });
              }}
              options={[
                ...(showAnnualOption ? [{ value: "annual", label: "Annual leave (paid)" }] : []),
                { value: "unpaid", label: "Unpaid day off" },
                { value: "medical", label: "Medical / sick" },
                { value: "exam", label: "Exam leave" },
                { value: "same_day", label: "Same-day off" },
                { value: "pause", label: "Pause request (Mon–Fri week)" },
              ]}
            />
          </label>
          {showFraction && (
            <label>
              <span className="muted">Duration</span>
              <Select
                value={form.dayFraction}
                onChange={(dayFraction) => setForm({ ...form, dayFraction })}
                options={FRACTION_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
              />
            </label>
          )}
          <label>
            <span className="muted">Notes</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </label>
          {showTenureNote && (
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem", color: "var(--warn, #a05000)" }}>
              Annual leave requires 180+ days of employment ({tenureDays} day{tenureDays !== 1 ? "s" : ""} on record).
              HR/Admin can add or edit annual leave without this rule. Unpaid, medical, half-day, and quarter-day are still available.
            </p>
          )}
          {showFraction && (
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              Half-day and quarter-day apply to single-day unpaid, medical, same-day, and annual requests.
            </p>
          )}
          {showDocs && (
            <LeaveDocsPanel
              leaveId={editing?.id}
              employeeId={form.employeeId || selfId}
              requestKind={form.leaveType}
              path={path}
              pendingFiles={pendingDocs}
              onPendingFilesChange={setPendingDocs}
            />
          )}
          {submitError && <p style={{ color: "var(--err)", margin: 0 }}>{submitError}</p>}
        </div>
      </Dialog>

      {docsTarget && (
        <LeaveDocsDialog
          open={Boolean(docsTarget)}
          onOpenChange={(open) => { if (!open) setDocsTarget(null); }}
          leaveId={docsTarget.id}
          employeeId={docsTarget.employeeId}
          requestKind={docsTarget.requestKind || docsTarget.leaveType || "medical"}
          path={path}
        />
      )}
      <ConfirmDialog
        open={Boolean(deferred.confirmId)}
        onOpenChange={(o) => !o && deferred.setConfirmId(null)}
        title="Delete this request?"
        message="Pending requests go to the recycle bin. Approved leave is removed and attendance is cleared. You can undo for 6 seconds."
        danger
        onConfirm={deferred.confirmDelete}
      />
    </div>
  );
}
