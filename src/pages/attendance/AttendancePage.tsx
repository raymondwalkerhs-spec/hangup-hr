import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { matchesEmployeeSearch } from "@/lib/employeeSearch";
import { clearUiBlockers } from "@/lib/uiBlockers";
import { workWeekBounds, workWeekDates } from "@/lib/workWeek";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { DepartDateDialog } from "@/features/employees/DepartDateDialog";
import { defaultDepartForm, type DepartFormState } from "@/lib/employeeStatus";
import { PageToolbar, SearchField, FilterSelect } from "@/ui/PageToolbar";
import { Select } from "@/ui/Select";
import { FpImportDialog, FpRulesDialog } from "@/features/attendance/AttendanceDialogs";
import { AttendanceStatusCell } from "@/features/attendance/AttendanceStatusCell";
import { parseIsoDate, isAfterIsoDate } from "@/lib/dateIso";
import styles from "./AttendancePage.module.css";

const DEFAULT_STATUSES = [
  "Attended", "Day-OFF", "Half Day", "Quarter Day-Off", "WFH",
  "Lateness A", "Lateness B", "NSNC", "NSNC Half Day",
  "Not Approved day off", "paused", "OUT", "(--)",
];

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type AttRecord = { employeeId: string; date: string; status?: string; transportOverride?: string };
type Emp = { id: string; name?: string; team?: string; unit?: string; position?: string; depart_date?: string; lock_after?: string; status?: string };
type CalDay = { date: string; weekdayName?: string; dayOfMonth?: number; isWeekend?: boolean; isHoliday?: boolean; name?: string };
type AttData = {
  days?: string[];
  employees?: Emp[];
  records?: AttRecord[];
  summaries?: { employeeId: string; workingDays?: number; lateness?: number; latenessDeductions?: number }[];
  statuses?: string[];
  units?: string[];
  teams?: string[];
  canEdit?: boolean;
  workingDays?: number;
  calendar?: CalDay[];
  holidays?: { name: string; date?: string; holidayDate?: string; country?: string; active?: boolean }[];
};

const OUT_STATUSES = new Set(["OUT", "OUT BUT STILL GET PAID"]);

function isOutStatus(status: string) {
  return OUT_STATUSES.has(String(status || "").trim());
}

function statusClass(status: string) {
  if (!status) return "";
  if (status.includes("Attended")) return styles.stAttended;
  if (status.includes("OFF") || status === "Day-OFF") return styles.stOff;
  if (status.includes("Lateness") || status === "NSNC") return styles.stWarn;
  if (status === "OUT") return styles.stOut;
  return "";
}

function formatDayHeader(cal: CalDay | undefined, date: string) {
  if (cal?.weekdayName != null) {
    return `${cal.weekdayName} ${cal.dayOfMonth ?? Number(date.slice(8, 10))}`;
  }
  const dow = WEEKDAY_NAMES[new Date(`${date}T12:00:00`).getDay()];
  return `${dow} ${Number(date.slice(8, 10))}`;
}

export function AttendancePage() {
  const month = useAppStore((s) => s.month);
  const { path, companyContext } = useCompanyScope();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const [team, setTeam] = useState("");
  const [hideOut, setHideOut] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [fpImportOpen, setFpImportOpen] = useState(false);
  const [fpRulesOpen, setFpRulesOpen] = useState(false);
  const [workingDays, setWorkingDays] = useState("");
  const [bulkAgent, setBulkAgent] = useState("");
  const [departConfirm, setDepartConfirm] = useState<{
    employeeId: string;
    date: string;
    status: string;
    transportOverride?: string;
    form: DepartFormState;
    extraDates?: { employeeId: string; date: string }[];
  } | null>(null);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const dragRef = useRef<{ empId: string; startDate: string; moved: boolean } | null>(null);

  const { status: appStatus } = useAppStatus();

  useEffect(() => {
    if (appStatus?.hideOutEmployees !== undefined) {
      setHideOut(appStatus.hideOutEmployees !== false);
    }
  }, [appStatus?.hideOutEmployees]);

  const canManage = (appStatus?.user as { canManageEmployees?: boolean })?.canManageEmployees === true;
  const showFilters = (appStatus?.user as { canUseEmployeeFilters?: boolean })?.canUseEmployeeFilters === true;

  const attendanceQueryKey = ["attendance-grid", month, unit, team, hideOut, companyContext] as const;

  const { data, isLoading, error } = useQuery({
    queryKey: attendanceQueryKey,
    queryFn: () => {
      const q = new URLSearchParams({ month, hideOut: hideOut ? "true" : "false" });
      if (unit) q.set("unit", unit);
      if (team) q.set("team", team);
      return api<AttData>(path(`/attendance?${q}`));
    },
    // Roster data is shared across desktops; pick up team/status moves without
    // requiring the attendance user to restart or manually refresh.
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const patchAttendanceRecords = useCallback(
    (patch: { employeeId: string; date: string; status: string; transportOverride?: string }) => {
      qc.setQueryData<AttData>(attendanceQueryKey, (prev) => {
        if (!prev) return prev;
        const records = [...(prev.records || [])];
        const idx = records.findIndex((r) => r.employeeId === patch.employeeId && r.date === patch.date);
        const next: AttRecord = {
          employeeId: patch.employeeId,
          date: patch.date,
          status: patch.status,
          transportOverride: patch.transportOverride || "",
        };
        if (idx >= 0) records[idx] = { ...records[idx], ...next };
        else records.push(next);
        return { ...prev, records };
      });
    },
    [qc, attendanceQueryKey]
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["attendance-grid", month] });

  const saveCell = useMutation({
    mutationFn: (body: {
      employeeId: string;
      date: string;
      status: string;
      transportOverride?: string;
      confirmDepart?: boolean;
      notice_type?: string;
    }) =>
      api<{ record?: AttRecord; departSync?: { updated?: boolean; departDate?: string } }>("/attendance", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: attendanceQueryKey });
      const prev = qc.getQueryData<AttData>(attendanceQueryKey);
      patchAttendanceRecords(body);
      return { prev };
    },
    onError: (err, _body, ctx) => {
      if (ctx?.prev) qc.setQueryData(attendanceQueryKey, ctx.prev);
      const msg = err instanceof Error ? err.message : "Could not save attendance";
      clearUiBlockers();
      toast.error(msg);
    },
    onSuccess: (res, body) => {
      const record = res?.record;
      const status = String(record?.status || body.status || "").trim();
      if (res?.departSync?.updated) {
        toast.success(`Depart date set to ${res.departSync.departDate || body.date}`);
        qc.invalidateQueries({ queryKey: ["attendance-grid"] });
        qc.invalidateQueries({ queryKey: ["employees"] });
        qc.invalidateQueries({ queryKey: ["employees-list"] });
        return;
      }
      if (!status || status === "(--)") {
        qc.invalidateQueries({ queryKey: attendanceQueryKey });
        return;
      }
      patchAttendanceRecords({
        employeeId: body.employeeId,
        date: body.date,
        status,
        transportOverride: record?.transportOverride ?? body.transportOverride,
      });
    },
  });

  const saveBatch = useMutation({
    mutationFn: (records: { employeeId: string; date: string; status: string; transportOverride?: string }[]) =>
      api(path("/attendance/batch"), {
        method: "POST",
        body: JSON.stringify({
          records,
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance-grid", month] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Could not save attendance";
      clearUiBlockers();
      toast.error(msg);
    },
  });

  const saveWorkingDays = useMutation({
    mutationFn: () =>
      api(path("/attendance/working-days"), {
        method: "PUT",
        body: JSON.stringify({
          month,
          workingDays: Number(workingDays),
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: invalidate,
  });

  const bulkAction = useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) =>
      api(path, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });

  const recordMap = useMemo(() => {
    const m = new Map<string, AttRecord>();
    (data?.records || []).forEach((r) => m.set(`${r.employeeId}|${r.date}`, r));
    return m;
  }, [data?.records]);

  const summaryMap = useMemo(() => {
    const m = new Map<string, { workingDays?: number; lateness?: number; latenessDeductions?: number }>();
    (data?.summaries || []).forEach((s) => m.set(s.employeeId, s));
    return m;
  }, [data?.summaries]);

  const holidayByDate = useMemo(() => {
    const m = new Map<string, string>();
    (data?.holidays || []).forEach((h) => {
      if (h.active === false) return;
      const d = String(h.date || h.holidayDate || "").slice(0, 10);
      if (d) m.set(d, h.name);
    });
    return m;
  }, [data?.holidays]);

  const employees = useMemo(() => {
    let list = data?.employees || [];
    if (search) list = list.filter((e) => matchesEmployeeSearch(e as Record<string, unknown>, search));
    return list;
  }, [data?.employees, search]);

  const days = data?.days || [];
  const statuses = data?.statuses || DEFAULT_STATUSES;
  const canEdit = data?.canEdit === true;

  const bulkDayOff = useMutation({
    mutationFn: (date: string) =>
      api(path("/hrms/attendance/bulk-dayoff"), { method: "POST", body: JSON.stringify({ date, scope: "federal_active" }) }),
    onSuccess: invalidate,
  });

  const federalHolidays = useMemo(
    () => (data?.holidays || []).filter((h) => h.active !== false && h.country !== "EGY"),
    [data?.holidays]
  );

  const onStatusChange = useCallback(
    (employeeId: string, date: string, status: string, transportOverride?: string) => {
      const keys = selectedCells.size > 1 ? [...selectedCells] : [`${employeeId}|${date}`];
      const targets = keys.map((k) => {
        const [emp, d] = k.split("|");
        return { employeeId: emp, date: d };
      });
      if (isOutStatus(status)) {
        setDepartConfirm({
          employeeId,
          date,
          status,
          transportOverride,
          extraDates: targets,
          form: {
            ...defaultDepartForm(status === "OUT BUT STILL GET PAID" ? "out_still_paid" : "out"),
            departDate: date,
            useCustomDate: true,
          },
        });
        return;
      }
      if (status === "paused" && targets.length === 1) {
        const { monday, friday } = workWeekBounds(date);
        const weekDates = workWeekDates(monday, friday);
        saveBatch.mutate(weekDates.map((d) => ({ employeeId, date: d, status: "paused" })));
        setSelectedCells(new Set());
        return;
      }
      if (targets.length > 1) {
        saveBatch.mutate(targets.map((t) => ({ ...t, status, transportOverride })));
        setSelectedCells(new Set());
        return;
      }
      saveCell.mutate({ employeeId, date, status, transportOverride });
      setSelectedCells(new Set());
    },
    [saveCell, saveBatch, selectedCells]
  );

  const confirmDepartSave = useCallback(
    (asDepart: boolean) => {
      if (!departConfirm) return;
      if (departConfirm.extraDates && departConfirm.extraDates.length > 1 && !asDepart) {
        saveBatch.mutate(
          departConfirm.extraDates.map((t) => ({
            employeeId: t.employeeId,
            date: t.date,
            status: departConfirm.status,
            transportOverride: departConfirm.transportOverride,
          }))
        );
        setDepartConfirm(null);
        setSelectedCells(new Set());
        return;
      }
      saveCell.mutate({
        employeeId: departConfirm.employeeId,
        date: departConfirm.date,
        status: departConfirm.status,
        transportOverride: departConfirm.transportOverride,
        confirmDepart: asDepart,
        notice_type: asDepart ? departConfirm.form.notice_type : undefined,
      });
      setDepartConfirm(null);
      setSelectedCells(new Set());
    },
    [departConfirm, saveCell, saveBatch]
  );

  const onPointerSelect = useCallback(
    (empId: string, date: string, mode: "start" | "move" | "end") => {
      if (!canEdit) return;
      if (mode === "start") {
        dragRef.current = { empId, startDate: date, moved: false };
        setSelectedCells(new Set([`${empId}|${date}`]));
        return;
      }
      if (mode === "move" && dragRef.current && dragRef.current.empId === empId) {
        const start = dragRef.current.startDate;
        if (start !== date) dragRef.current.moved = true;
        const a = start < date ? start : date;
        const b = start < date ? date : start;
        const next = new Set<string>();
        for (const d of days) {
          if (d >= a && d <= b) next.add(`${empId}|${d}`);
        }
        setSelectedCells(next);
      }
      if (mode === "end") {
        dragRef.current = dragRef.current ? { ...dragRef.current, moved: dragRef.current.moved } : null;
      }
    },
    [canEdit, days]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedCells(new Set());
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerup", () => {
      dragRef.current = null;
    });
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const wdVal = workingDays || String(data?.workingDays || 22);

  return (
    <div>
      <SectionHeader title="Attendance" subtitle={`${employees.length} employees · ${monthLabel(month)}`} />
      <PageToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search name, Arabic name, or ID…" />
        {showFilters && (
          <>
        <FilterSelect label="Unit" value={unit} onChange={setUnit} options={data?.units || []} />
        <FilterSelect label="Team" value={team} onChange={setTeam} options={data?.teams || []} />
          </>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem" }}>
          <input
            type="checkbox"
            checked={hideOut}
            onChange={(e) => {
              const next = e.target.checked;
              setHideOut(next);
              if (canManage) {
                api("/settings/hide-out", { method: "PUT", body: JSON.stringify({ hide: next }) }).catch(() => {});
              }
            }}
          />
          Hide OUT employees (left previous month)
        </label>
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => setBulkOpen(!bulkOpen)}>
            {bulkOpen ? "Hide bulk actions" : "Bulk actions"}
          </Button>
        )}
      </PageToolbar>

      {bulkOpen && canEdit && (
        <div className={styles.bulkPanel}>
          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Working days</span>
            <input type="number" min={1} max={31} value={wdVal} onChange={(e) => setWorkingDays(e.target.value)} style={{ width: "4rem" }} />
            <Button size="sm" onClick={() => saveWorkingDays.mutate()}>Save</Button>
          </div>
          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Month tools</span>
            <Button size="sm" variant="secondary" onClick={() => bulkAction.mutate({ path: "/attendance/init-month", body: { month } })}>Init weekends</Button>
            <Button size="sm" variant="secondary" onClick={() => bulkAction.mutate({ path: "/attendance/bulk-weekdays", body: { month, status: "Attended" } })}>Mark weekdays Attended</Button>
          </div>
          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Agent month</span>
            <Select
              value={bulkAgent}
              onChange={setBulkAgent}
              options={[
                { value: "", label: "Agent…" },
                ...employees.map((e) => ({ value: e.id, label: `${e.id} — ${e.name}` })),
              ]}
              placeholder="Agent…"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!bulkAgent}
              onClick={() => bulkAction.mutate({ path: "/attendance/bulk-agent-month", body: { month, employeeId: bulkAgent, status: "Attended" } })}
            >
              Mark month Attended
            </Button>
          </div>
          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>FP import</span>
            <Button size="sm" variant="primary" onClick={() => setFpImportOpen(true)}>Import FP file</Button>
            <Button size="sm" variant="secondary" onClick={() => setFpRulesOpen(true)}>FP rules</Button>
          </div>
          {federalHolidays.length > 0 && (
            <div className={styles.bulkGroup}>
              <span className={styles.bulkLabel}>Federal holidays</span>
              {federalHolidays.map((h) => {
                const d = String(h.date || (h as { holidayDate?: string }).holidayDate || "").slice(0, 10);
                return (
                  <Button
                    key={d || h.name}
                    size="sm"
                    variant="secondary"
                    disabled={!d || bulkDayOff.isPending}
                    title="Mark Day-OFF for all active agents"
                    onClick={() => {
                      if (d && confirm(`Mark Day-OFF for all active agents on ${h.name || d}?`)) bulkDayOff.mutate(d);
                    }}
                  >
                    Federal OFF: {h.name || d}
                  </Button>
                );
              })}
            </div>
          )}
          <div className={styles.bulkGroup}>
            <span className={styles.bulkLabel}>Reset</span>
            <Button size="sm" variant="danger" disabled={!bulkAgent} onClick={() => bulkAction.mutate({ path: "/attendance/bulk-reset", body: { month, employeeId: bulkAgent } })}>Reset agent</Button>
            <Button size="sm" variant="danger" onClick={() => bulkAction.mutate({ path: "/attendance/bulk-reset-month", body: { month, scope: unit ? "unit" : "company", unit } })}>Reset {unit || "company"} month</Button>
          </div>
        </div>
      )}

      {(data?.holidays || []).filter((h) => h.active !== false).length > 0 && (
        <p className="muted" style={{ marginBottom: "0.75rem" }}>
          Holidays: {(data?.holidays || []).filter((h) => h.active !== false).map((h) => h.name).join(" · ")}
        </p>
      )}

      <Card className={styles.card}>
        {isLoading && <p className="muted">Loading…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        {!isLoading && !error && (
          <div className={styles.scroll}>
            <table className={styles.grid} onDragStart={(e) => e.preventDefault()}>
              <thead>
                <tr>
                  <th className={styles.stickyId}>ID</th>
                  <th className={styles.stickyName}>Name</th>
                  <th className={styles.stickyTeam}>Team</th>
                  <th className={styles.summaryCol}>WD</th>
                  <th className={styles.summaryCol}>Late</th>
                  <th className={styles.summaryCol}>Ded.</th>
                  {days.map((d) => {
                    const cal = (data?.calendar || []).find((c) => c.date === d);
                    const holidayName = holidayByDate.get(d);
                    const isHoliday = Boolean(holidayName);
                    return (
                      <th
                        key={d}
                        className={`${styles.dayHead} ${cal?.isWeekend ? styles.weekend : ""} ${isHoliday ? styles.holiday : ""}`}
                        title={d}
                      >
                        <span className={styles.dayHeadLabel}>{formatDayHeader(cal, d)}</span>
                        {holidayName ? <span className={styles.dayHeadHoliday}>{holidayName}</span> : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const s = summaryMap.get(emp.id) || {};
                  const lockAfter = parseIsoDate(emp.lock_after);
                  return (
                    <tr key={emp.id}>
                      <td className={styles.stickyId}>{emp.id}</td>
                      <td className={styles.stickyName} title={emp.position}>{emp.name}</td>
                      <td className={styles.stickyTeam}>{emp.team || "—"}</td>
                      <td className={styles.summaryCol}>{s.workingDays ?? 0}</td>
                      <td className={styles.summaryCol}>{s.lateness ?? 0}</td>
                      <td className={styles.summaryCol}>{s.latenessDeductions ?? 0}</td>
                      {days.map((d) => {
                        const rec = recordMap.get(`${emp.id}|${d}`);
                        const locked = Boolean(lockAfter && isAfterIsoDate(d, lockAfter));
                        const st = rec?.status || "";
                        return (
                          <td key={d} className={`${styles.cell} ${statusClass(st)}`}>
                            <AttendanceStatusCell
                              empId={emp.id}
                              date={d}
                              status={st}
                              transportOverride={rec?.transportOverride}
                              statuses={statuses}
                              canEdit={canEdit}
                              locked={locked}
                              selected={selectedCells.has(`${emp.id}|${d}`)}
                              onPointerSelect={canEdit ? onPointerSelect : undefined}
                              onChange={(newSt, transport) => onStatusChange(emp.id, d, newSt, transport)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!employees.length && <p className="muted" style={{ padding: "1rem" }}>No employees for this filter.</p>}
          </div>
        )}
      </Card>
      {saveCell.isPending && <p className="muted" style={{ marginTop: "0.5rem" }}>Saving…</p>}

      <FpImportDialog open={fpImportOpen} onOpenChange={setFpImportOpen} onDone={invalidate} />
      <FpRulesDialog open={fpRulesOpen} onOpenChange={setFpRulesOpen} />

      <DepartDateDialog
        open={departConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setDepartConfirm(null);
        }}
        title="Employee leaving"
        subtitle="Choose the leaving date and type. Set depart to lock later days as OUT and apply payroll rules."
        form={departConfirm?.form || defaultDepartForm()}
        onFormChange={(form) => {
          if (!departConfirm) return;
          setDepartConfirm({ ...departConfirm, form });
        }}
        onConfirm={() => confirmDepartSave(true)}
        confirmLabel="Set depart date"
        isPending={saveCell.isPending}
        secondaryAction={{
          label: "OUT this day only",
          onClick: () => confirmDepartSave(false),
        }}
      />
    </div>
  );
}
