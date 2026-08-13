import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStore } from "@/stores/theme-store";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import styles from "./EmployeeHrmsLifecycle.module.css";

type Emp = Record<string, unknown>;

type Period = { id?: string; startDate?: string; endDate?: string; notes?: string };
type ActionPlan = { id: string; weekStart?: string; weekEnd?: string; status?: string };
type ClearanceItem = { itemKey: string; status?: string; notes?: string };
type EquipmentAssignment = {
  id?: string;
  assetTag?: string;
  description?: string;
  itemType?: string;
  returnedAt?: string | null;
};

const CLEARANCE_KEYS = ["clearance_form", "equipment_handover", "files_handover"] as const;

const CLEARANCE_LABELS: Record<string, string> = {
  clearance_form: "Clearance form handed over",
  equipment_handover: "Equipment handover complete",
  files_handover: "Files / documents handover",
};

function clearanceLabel(key: string) {
  return CLEARANCE_LABELS[key] || labelKey(key);
}
type TrainingPhase = {
  id: string;
  phaseNumber?: number;
  weekStart?: string;
  weekEnd?: string;
  status?: string;
  salesPassed?: number;
  salesTotal?: number;
};

function labelKey(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function EmployeeHrmsLifecycle({
  employee,
  canEdit,
  focus,
  onUpdated,
}: {
  employee: Emp;
  canEdit?: boolean;
  focus?: "offboarding" | "clearance" | "all";
  onUpdated?: () => void;
}) {
  const month = useAppStore((s) => s.month);
  const qc = useQueryClient();
  const { path } = useCompanyScope();
  const id = String(employee.id);
  const [rehireOpen, setRehireOpen] = useState(false);
  const [departOpen, setDepartOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [aipOpen, setAipOpen] = useState(false);
  const [rehireForm, setRehireForm] = useState({ startDate: "", status: "Active", notes: "" });
  const [departForm, setDepartForm] = useState({ departDate: "", useCustomDate: false, notice_type: "with_notice", notes: "" });
  const [periodForm, setPeriodForm] = useState({ startDate: "", endDate: "", notes: "" });
  const [aipForm, setAipForm] = useState({ weekStart: "", weekEnd: "", notes: "" });
  const [phase1Start, setPhase1Start] = useState("");
  const [outcomeForm, setOutcomeForm] = useState({
    outcome: "active",
    promotionEffectiveDate: "",
    passedOnDate: "",
    exitNotes: "",
    exceptionFlag: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["hrms-lifecycle", id] });
    onUpdated?.();
  };

  const { data, isLoading } = useQuery({
    queryKey: ["hrms-lifecycle", id],
    queryFn: async () => {
      const [periods, plans, onboard, offboard, training] = await Promise.all([
        api<{ periods?: Period[] }>(path(`/hrms/employment-periods/${id}`)).catch(() => ({ periods: [] })),
        api<{ plans?: ActionPlan[] }>(path(`/hrms/action-plans/${id}`)).catch(() => ({ plans: [] })),
        api<{ checklist?: Record<string, boolean> }>(path(`/hrms/onboarding/${id}`)).catch(() => ({ checklist: null })),
        api<{ offboarding?: Record<string, boolean>; clearance?: ClearanceItem[] }>(path(`/hrms/offboarding/${id}`)).catch(() => ({})),
        api<{ program?: Record<string, unknown> & { phases?: TrainingPhase[] } }>(path(`/hrms/training/${id}`)).catch(() => ({ program: null })),
      ]);
      return { periods, plans, onboard, offboard, training };
    },
    enabled: !!id,
  });

  const periods = data?.periods?.periods || [];
  const plans = data?.plans?.plans || [];
  const onboard = data?.onboard?.checklist || {};
  const off = data?.offboard?.offboarding || {};
  const clearance = data?.offboard?.clearance || [];
  const clearanceItems = useMemo(
    () =>
      CLEARANCE_KEYS.map((key) => {
        const found = clearance.find((c) => c.itemKey === key);
        return found || { itemKey: key, status: "pending", notes: "" };
      }),
    [clearance]
  );
  const program = data?.training?.program as (Record<string, unknown> & { phases?: TrainingPhase[]; active?: boolean }) | null;

  const needsComplianceData = focus === "offboarding" || focus === "clearance" || focus === "all";

  const { data: equipmentData } = useQuery({
    queryKey: ["hrms-equipment-employee", id],
    queryFn: () => api<{ assignments?: EquipmentAssignment[] }>(path(`/hrms/equipment/${id}`)),
    enabled: !!id && needsComplianceData,
  });

  const { data: gateData } = useQuery({
    queryKey: ["payroll-gates", id, month],
    queryFn: () =>
      api<{
        blocked?: boolean;
        payslipNotes?: string[];
        unreturnedEquipment?: EquipmentAssignment[];
      }>(path(`/hrms/payroll-gates/${id}`, { month })),
    enabled: !!id && needsComplianceData,
  });

  const equipmentAssignments = equipmentData?.assignments || [];
  const unreturnedEquipment = equipmentAssignments.filter((a) => !a.returnedAt);

  const saveOnboarding = useMutation({
    mutationFn: (body: Record<string, boolean>) =>
      api(path(`/hrms/onboarding/${id}`), { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });

  const saveOffboarding = useMutation({
    mutationFn: (body: Record<string, boolean>) =>
      api(path(`/hrms/offboarding/${id}`), { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });

  const saveClearance = useMutation({
    mutationFn: ({ itemKey, status, notes }: { itemKey: string; status: string; notes?: string }) =>
      api(path(`/hrms/clearance/${id}/${encodeURIComponent(itemKey)}`), {
        method: "PUT",
        body: JSON.stringify({ status, notes: notes ?? "" }),
      }),
    onSuccess: invalidate,
  });

  const depart = useMutation({
    mutationFn: () =>
      api(path(`/hrms/employment-periods/${id}/depart`), {
        method: "POST",
        body: JSON.stringify({
          departDate: departForm.useCustomDate ? departForm.departDate : undefined,
          skipDepartDate: !departForm.useCustomDate,
          status: "out",
          notice_type: departForm.notice_type,
        }),
      }),
    onSuccess: () => {
      setDepartOpen(false);
      invalidate();
      qc.invalidateQueries({ queryKey: ["employees-compliance"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["attendance-grid"] });
    },
  });

  const rehire = useMutation({
    mutationFn: () => api(path(`/hrms/employment-periods/${id}/rehire`), { method: "POST", body: JSON.stringify(rehireForm) }),
    onSuccess: () => { setRehireOpen(false); invalidate(); },
  });

  const clearDepart = useMutation({
    mutationFn: () => api(path(`/hrms/employment-periods/${id}/clear-depart`), { method: "POST", body: "{}" }),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["employees-compliance"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees-list"] });
      qc.invalidateQueries({ queryKey: ["attendance-grid"] });
    },
  });

  const addPeriod = useMutation({
    mutationFn: () => api(path(`/hrms/employment-periods/${id}`), { method: "POST", body: JSON.stringify(periodForm) }),
    onSuccess: () => { setPeriodOpen(false); invalidate(); },
  });

  const addAip = useMutation({
    mutationFn: () => api(path("/hrms/action-plans"), { method: "POST", body: JSON.stringify({ employeeId: id, ...aipForm }) }),
    onSuccess: () => { setAipOpen(false); invalidate(); },
  });

  const cancelAip = useMutation({
    mutationFn: (planId: string) => api(path(`/hrms/action-plans/${planId}/cancel`), { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });

  const startTraining = useMutation({
    mutationFn: () => api(path(`/hrms/training/${id}`), { method: "POST", body: JSON.stringify({ phase1Start }) }),
    onSuccess: invalidate,
  });

  const savePhase = useMutation({
    mutationFn: (p: TrainingPhase) =>
      api(path(`/hrms/training/phases/${p.id}`), {
        method: "PATCH",
        body: JSON.stringify({
          weekStart: p.weekStart,
          weekEnd: p.weekEnd,
          status: p.status,
          recalculateFollowing: false,
        }),
      }),
    onSuccess: invalidate,
  });

  const recalcTraining = useMutation({
    mutationFn: () => api(path(`/hrms/training/${id}/recalculate`), { method: "POST", body: JSON.stringify({ fromPhase: 1 }) }),
    onSuccess: invalidate,
  });

  const toggleTrainingActive = useMutation({
    mutationFn: (active: boolean) =>
      api(path(`/hrms/training/${id}/active`), { method: "PUT", body: JSON.stringify({ active }) }),
    onSuccess: invalidate,
  });

  const saveOutcome = useMutation({
    mutationFn: () =>
      api(path(`/hrms/training/${id}/outcome`), { method: "PATCH", body: JSON.stringify(outcomeForm) }),
    onSuccess: invalidate,
  });

  const promoteTraining = useMutation({
    mutationFn: () => api(path(`/hrms/training/${id}/promote`), { method: "POST", body: JSON.stringify({ effectiveFromMonth: month }) }),
    onSuccess: invalidate,
  });

  const { data: payPreview, refetch: refetchPayPreview } = useQuery({
    queryKey: ["train-pay-preview", id, month],
    queryFn: () => api<Record<string, unknown>>(path(`/hrms/training/${id}/pay-preview`, { month })),
    enabled: !!program,
  });

  if (!canEdit && focus === "all") return null;
  if (isLoading) return <p className="muted">Loading HR lifecycle…</p>;

  const showOffboardingSection = focus === "all" || focus === "offboarding";
  const showClearanceSection = focus === "all" || focus === "clearance";
  const showEmploymentPeriods = focus === "all" || focus === "offboarding";
  const showTraining = focus === "all";
  const showFullLifecycle = focus === "all";
  const empStatus = String(employee.status || "—");
  const departDate = String(employee.depart_date || "").slice(0, 10);
  const noticeType = String(employee.notice_type || "").replace(/_/g, " ");
  const noticeLabel =
    employee.notice_type === "company_decision"
      ? "Company decision"
      : employee.notice_type === "without_notice"
        ? "Without notice"
        : employee.notice_type === "with_notice"
          ? "With notice"
          : noticeType;

  return (
    <div className={styles.wrap}>
      {showEmploymentPeriods && (
        <section className={styles.section}>
          <h4>Employment periods</h4>
          {(focus === "offboarding" || focus === "clearance") && (
            <p className="muted" style={{ marginBottom: "0.5rem" }}>
              Status: <strong>{empStatus}</strong>
              {departDate ? ` · Depart: ${departDate}` : ""}
              {noticeLabel ? ` · ${noticeLabel}` : ""}
            </p>
          )}
          <ul className={styles.list}>
            {periods.map((p, i) => (
              <li key={p.id || i}>{p.startDate}{p.endDate ? ` → ${p.endDate}` : " (current)"}</li>
            ))}
            {!periods.length && <li className="muted">No periods recorded</li>}
          </ul>
          {canEdit && (
            <div className={styles.row}>
              <Button size="sm" variant="secondary" onClick={() => setRehireOpen(true)}>Re-hire</Button>
              <Button size="sm" variant="secondary" onClick={() => setDepartOpen(true)}>Mark depart</Button>
              {departDate && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={clearDepart.isPending}
                  onClick={() => {
                    if (confirm(`Clear depart date (${departDate})? Post-depart OUT days will be removed and status set to Active.`)) {
                      clearDepart.mutate();
                    }
                  }}
                >
                  Clear depart date
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={() => setPeriodOpen(true)}>Add period</Button>
            </div>
          )}
        </section>
      )}

      {showFullLifecycle && (
        <section className={styles.section}>
          <h4>Action Plan Week</h4>
          <ul className={styles.list}>
            {plans.map((p) => (
              <li key={p.id} className={styles.row}>
                <span>{p.weekStart} – {p.weekEnd} <span className="muted">({p.status})</span></span>
                {canEdit && p.status === "active" && (
                  <Button size="sm" variant="secondary" onClick={() => cancelAip.mutate(p.id)}>Cancel</Button>
                )}
              </li>
            ))}
            {!plans.length && <li className="muted">No plans</li>}
          </ul>
          {canEdit && <Button size="sm" onClick={() => setAipOpen(true)}>+ Add Action Plan Week</Button>}
        </section>
      )}

      {showFullLifecycle && (
        <section className={styles.section}>
          <h4>Onboarding checklist</h4>
          {(["adUser", "idScanned", "contract"] as const).map((k) => (
            <label key={k} className={styles.check}>
              <input
                type="checkbox"
                checked={!!onboard[k]}
                disabled={!canEdit}
                onChange={(e) => saveOnboarding.mutate({ ...onboard, [k]: e.target.checked } as Record<string, boolean>)}
              />
              {labelKey(k)}
            </label>
          ))}
        </section>
      )}

      {showTraining && canEdit && (
        <section className={styles.section} id="hrms-training-section">
          <h4>Training program (4 weeks)</h4>
          {!program ? (
            <>
              {employee.training_passed && <p className={styles.badgeOk}>Baseline training passed</p>}
              <FormGrid>
                <FormField label="Phase 1 week starts (Monday)">
                  <input type="date" value={phase1Start} onChange={(e) => setPhase1Start(e.target.value)} />
                </FormField>
                <Button size="sm" onClick={() => startTraining.mutate()} disabled={!phase1Start}>Start training program</Button>
              </FormGrid>
            </>
          ) : (
            <>
              <p className="muted">{program.active ? "Active program" : "Paused program"}</p>
              <div className={styles.row} style={{ marginBottom: "0.5rem" }}>
                <Button size="sm" variant="secondary" onClick={() => refetchPayPreview()}>Refresh pay preview</Button>
                <Button size="sm" onClick={() => promoteTraining.mutate()}>Promote to Agent</Button>
                <Button size="sm" variant="secondary" onClick={() => toggleTrainingActive.mutate(!program.active)}>
                  {program.active ? "Pause program" : "Resume program"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => recalcTraining.mutate()}>Recalc phases 2–4</Button>
              </div>
              {payPreview && (
                <p className="muted" style={{ fontSize: "0.85rem" }}>
                  Pay preview: training days {String(payPreview.trainingDayCount ?? "—")}, agent days {String(payPreview.agentDayCount ?? "—")}
                </p>
              )}
              <table className={styles.table}>
                <thead><tr><th>Phase</th><th>Week</th><th>Status</th><th>Sales</th><th /></tr></thead>
                <tbody>
                  {(program.phases || []).map((p) => (
                    <TrainingPhaseRow key={p.id} phase={p} canEdit={!!canEdit} onSave={(patch) => savePhase.mutate({ ...p, ...patch })} />
                  ))}
                </tbody>
              </table>
              <FormGrid wide>
                <FormField label="Outcome">
                  <select value={outcomeForm.outcome} onChange={(e) => setOutcomeForm({ ...outcomeForm, outcome: e.target.value })}>
                    {["active", "passed", "failed", "dropped", "cancelled"].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </FormField>
                <FormField label="Promotion date"><input type="date" value={outcomeForm.promotionEffectiveDate} onChange={(e) => setOutcomeForm({ ...outcomeForm, promotionEffectiveDate: e.target.value })} /></FormField>
                <FormField label="Passed on"><input type="date" value={outcomeForm.passedOnDate} onChange={(e) => setOutcomeForm({ ...outcomeForm, passedOnDate: e.target.value })} /></FormField>
                <FormField label="Exit notes" span="full"><input value={outcomeForm.exitNotes} onChange={(e) => setOutcomeForm({ ...outcomeForm, exitNotes: e.target.value })} /></FormField>
              </FormGrid>
              <Button size="sm" style={{ marginTop: "0.5rem" }} onClick={() => saveOutcome.mutate()}>Save outcome</Button>
            </>
          )}
        </section>
      )}

      {showOffboardingSection && (
        <section className={styles.section} id="hrms-offboarding-section">
          <h4>Offboarding checklist</h4>
          {focus === "offboarding" && (
            <p className="muted">
              <Link to={`/employees?highlight=${id}`}>← Employees</Link>
              {" · "}
              <Link to={`/clearance?employee=${id}`}>Clearance</Link>
              {" · "}
              <Link to={`/equipment?employee=${id}`}>Equipment</Link>
            </p>
          )}
          {gateData?.payslipNotes?.length ? (
            <ul className={styles.warnList}>
              {gateData.payslipNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={!!off.revokeAccess}
              disabled={!canEdit}
              onChange={(e) => saveOffboarding.mutate({ revokeAccess: e.target.checked, finalPay: !!off.finalPay })}
            />
            Revoke system access
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={!!off.finalPay}
              disabled={!canEdit}
              onChange={(e) => saveOffboarding.mutate({ finalPay: e.target.checked, revokeAccess: !!off.revokeAccess })}
            />
            Final pay processed
          </label>
          {focus === "offboarding" && clearanceItems.some((c) => c.status === "pending") && (
            <p className={styles.warnBanner}>
              {clearanceItems.filter((c) => c.status === "pending").length} clearance item(s) still pending —{" "}
              <Link to={`/clearance?employee=${id}`}>Open clearance</Link>
            </p>
          )}
        </section>
      )}

      {showClearanceSection && (
        <section className={styles.section} id="hrms-clearance-section">
          <h4>Clearance items</h4>
          {(focus === "clearance") && (
            <p className="muted">
              <Link to={`/employees?highlight=${id}`}>← Employees</Link>
              {" · "}
              <Link to={`/offboarding?employee=${id}`}>Offboarding</Link>
              {" · "}
              <Link to={`/equipment?employee=${id}`}>Equipment</Link>
            </p>
          )}
          {clearanceItems.map((c) => (
            <div key={c.itemKey} className={styles.clearanceCard}>
              <FormField label={clearanceLabel(c.itemKey)}>
                <select
                  value={c.status || "pending"}
                  disabled={!canEdit}
                  onChange={(e) => saveClearance.mutate({ itemKey: c.itemKey, status: e.target.value, notes: c.notes })}
                >
                  <option value="pending">Pending</option>
                  <option value="done">Done</option>
                  <option value="not_needed">Not needed</option>
                </select>
              </FormField>
              <FormField label="Notes">
                <input
                  type="text"
                  defaultValue={c.notes || ""}
                  disabled={!canEdit}
                  placeholder="Optional handover notes"
                  onBlur={(e) => {
                    const next = e.target.value;
                    if (next !== (c.notes || "")) {
                      saveClearance.mutate({ itemKey: c.itemKey, status: c.status || "pending", notes: next });
                    }
                  }}
                />
              </FormField>
            </div>
          ))}
          <div className={styles.equipmentBlock}>
            <h5>Equipment assignments</h5>
            {unreturnedEquipment.length ? (
              <ul className={styles.warnList}>
                {unreturnedEquipment.map((a) => (
                  <li key={String(a.id)}>
                    {a.assetTag || a.description || "Item"} ({a.itemType || "device"}) — not returned
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No outstanding equipment assignments.</p>
            )}
            <Link to={`/equipment?employee=${id}`} className={styles.inlineLink}>Manage equipment →</Link>
          </div>
        </section>
      )}

      <Dialog open={departOpen} onOpenChange={setDepartOpen} title="Mark depart" footer={
        <>
          <Button variant="secondary" onClick={() => setDepartOpen(false)}>Cancel</Button>
          <Button onClick={() => depart.mutate()}>Save</Button>
        </>
      }>
        <p className="muted" style={{ marginTop: 0 }}>
          Leave the date unchecked to use today. Attendance after the depart date is locked until re-hire.
        </p>
        <FormGrid>
          <FormField label="Depart date">
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
              <input
                type="checkbox"
                checked={departForm.useCustomDate}
                onChange={(e) => setDepartForm({
                  ...departForm,
                  useCustomDate: e.target.checked,
                  departDate: e.target.checked ? (departForm.departDate || new Date().toISOString().slice(0, 10)) : "",
                })}
              />
              Choose a specific depart date
            </label>
            {departForm.useCustomDate ? (
              <input type="date" value={departForm.departDate} onChange={(e) => setDepartForm({ ...departForm, departDate: e.target.value })} />
            ) : (
              <span className="muted">Today ({new Date().toISOString().slice(0, 10)})</span>
            )}
          </FormField>
          <FormField label="Leaving type">
            <select value={departForm.notice_type} onChange={(e) => setDepartForm({ ...departForm, notice_type: e.target.value })}>
              <option value="with_notice">Leaving with two weeks notice</option>
              <option value="without_notice">Leaving without two weeks notice</option>
              <option value="company_decision">Leaving — company decision</option>
            </select>
          </FormField>
          <FormField label="Notes" span="full"><textarea value={departForm.notes} onChange={(e) => setDepartForm({ ...departForm, notes: e.target.value })} /></FormField>
        </FormGrid>
      </Dialog>

      <Dialog open={rehireOpen} onOpenChange={setRehireOpen} title="Re-hire" footer={
        <>
          <Button variant="secondary" onClick={() => setRehireOpen(false)}>Cancel</Button>
          <Button onClick={() => rehire.mutate()} disabled={!rehireForm.startDate}>Re-hire</Button>
        </>
      }>
        <FormGrid>
          <FormField label="Start date"><input type="date" value={rehireForm.startDate} onChange={(e) => setRehireForm({ ...rehireForm, startDate: e.target.value })} /></FormField>
          <FormField label="Status">
            <select value={rehireForm.status} onChange={(e) => setRehireForm({ ...rehireForm, status: e.target.value })}>
              <option value="Active">Active</option>
              <option value="Paused">Paused</option>
            </select>
          </FormField>
          <FormField label="Notes" span="full"><textarea value={rehireForm.notes} onChange={(e) => setRehireForm({ ...rehireForm, notes: e.target.value })} /></FormField>
        </FormGrid>
      </Dialog>

      <Dialog open={periodOpen} onOpenChange={setPeriodOpen} title="Add employment period" footer={
        <>
          <Button variant="secondary" onClick={() => setPeriodOpen(false)}>Cancel</Button>
          <Button onClick={() => addPeriod.mutate()} disabled={!periodForm.startDate}>Add</Button>
        </>
      }>
        <FormGrid>
          <FormField label="Start"><input type="date" value={periodForm.startDate} onChange={(e) => setPeriodForm({ ...periodForm, startDate: e.target.value })} /></FormField>
          <FormField label="End (optional)"><input type="date" value={periodForm.endDate} onChange={(e) => setPeriodForm({ ...periodForm, endDate: e.target.value })} /></FormField>
          <FormField label="Notes" span="full"><textarea value={periodForm.notes} onChange={(e) => setPeriodForm({ ...periodForm, notes: e.target.value })} /></FormField>
        </FormGrid>
      </Dialog>

      <Dialog open={aipOpen} onOpenChange={setAipOpen} title="Add Action Plan Week" footer={
        <>
          <Button variant="secondary" onClick={() => setAipOpen(false)}>Cancel</Button>
          <Button onClick={() => addAip.mutate()} disabled={!aipForm.weekStart}>Add</Button>
        </>
      }>
        <FormGrid>
          <FormField label="Week start"><input type="date" value={aipForm.weekStart} onChange={(e) => setAipForm({ ...aipForm, weekStart: e.target.value })} /></FormField>
          <FormField label="Week end"><input type="date" value={aipForm.weekEnd} onChange={(e) => setAipForm({ ...aipForm, weekEnd: e.target.value })} /></FormField>
          <FormField label="Notes" span="full"><input value={aipForm.notes} onChange={(e) => setAipForm({ ...aipForm, notes: e.target.value })} /></FormField>
        </FormGrid>
      </Dialog>
    </div>
  );
}

function TrainingPhaseRow({
  phase,
  canEdit,
  onSave,
}: {
  phase: TrainingPhase;
  canEdit: boolean;
  onSave: (patch: Partial<TrainingPhase>) => void;
}) {
  const [draft, setDraft] = useState(phase);
  return (
    <tr>
      <td>Phase {phase.phaseNumber}</td>
      <td>
        <input type="date" value={draft.weekStart || ""} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, weekStart: e.target.value })} />
        {" – "}
        <input type="date" value={draft.weekEnd || ""} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, weekEnd: e.target.value })} />
      </td>
      <td>
        <select value={draft.status || ""} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
          {["scheduled", "active", "passed", "failed", "skipped", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td>{phase.salesPassed ?? 0} / {phase.salesTotal ?? 0}</td>
      <td>{canEdit && <Button size="sm" onClick={() => onSave(draft)}>Save</Button>}</td>
    </tr>
  );
}
