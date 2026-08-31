import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import { api } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { cairoWorkingDayToday } from "@/lib/salesCells";
import { applyMemberIdInput, formatMemberId, validateMemberId } from "@/lib/rpmMemberId";
import { digitsOnlyPhone, validateDigitsPhone, validatePersonName } from "@/lib/rpmPersonFields";
import { Button } from "@/ui/Button";
import { Card, StatTile } from "@/ui/Card";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { PeriodPicker, type DateRange } from "@/ui/PeriodPicker";
import { QueryErrorCard } from "@/ui/QueryErrorCard";
import { SectionHeader } from "@/ui/SectionHeader";
import { Select } from "@/ui/Select";
import { Skeleton } from "@/ui/Skeleton";
import styles from "./QFeedbackPage.module.css";

type Disposition = "dropped_with_client" | "callback" | "not_int" | "retransfer";

type CloserEmployee = { id: string; american_name?: string; team?: string; unit?: string };

type FeedbackScope = {
  closers: CloserEmployee[];
  defaultCloserId?: string;
  lockCloser?: boolean;
};

type QCheck = {
  id: string;
  agentId?: string;
  agentName?: string;
  memberId?: string;
  fullName?: string;
  dateOfBirth?: string | null;
  phone?: string;
  checkStatus?: string;
  createdAt?: string;
  created_at?: string;
  workingDay?: string;
  disposition?: Disposition | null;
  feedbackDisposition?: Disposition | null;
  feedbackStatus?: Disposition | "sale" | null;
  closerId?: string;
  closerName?: string;
  feedbackAt?: string;
  feedback_at?: string;
  info?: string;
  team?: string;
  unit?: string;
  linkedRpmSaleId?: string | null;
};

type EditForm = {
  memberId: string;
  fullName: string;
  dateOfBirth: string;
  phone: string;
  disposition: Disposition | "";
  closerId: string;
  info: string;
  clearFeedback: boolean;
};

type EditFieldErrors = Partial<Record<"memberId" | "fullName" | "phone", string>>;

const EMPTY_EDIT: EditForm = {
  memberId: "",
  fullName: "",
  dateOfBirth: "",
  phone: "",
  disposition: "",
  closerId: "",
  info: "",
  clearFeedback: false,
};

type AnalysisRow = {
  closerId?: string;
  closer?: string;
  team?: string;
  qs: number;
  sales: number;
  open: number;
  target: number;
  salesTargetLabel?: string;
  conversionLabel?: string;
};

type AnalysisPayload = {
  source: string;
  workingDay?: string | null;
  from?: string;
  to?: string;
  closerTarget: number;
  closerRows: AnalysisRow[];
  teamRows: AnalysisRow[];
  totals?: {
    qs: number;
    sales: number;
    open: number;
    conversionLabel?: string;
  };
};

function cellVal(n?: number) {
  return n == null || n === 0 ? "" : String(n);
}

function AnalysisPanel({
  data,
  closerTargetDraft,
  onCloserTargetDraft,
  onSaveCloserTarget,
  canEditTarget,
  savingTarget,
}: {
  data: AnalysisPayload;
  closerTargetDraft: string;
  onCloserTargetDraft: (value: string) => void;
  onSaveCloserTarget: () => void;
  canEditTarget: boolean;
  savingTarget: boolean;
}) {
  const totals = data.totals || { qs: 0, sales: 0, open: 0 };
  return (
    <div className={styles.analysisPage}>
      {canEditTarget && (
        <div className={styles.analysisToolbarBar}>
          <label className={styles.targetField}>
            Closer target
            <input
              type="number"
              min={0}
              step={1}
              value={closerTargetDraft}
              disabled={savingTarget}
              onChange={(e) => onCloserTargetDraft(e.target.value)}
              aria-label="Closer target"
            />
          </label>
          <Button type="button" size="sm" disabled={savingTarget} onClick={onSaveCloserTarget}>
            {savingTarget ? "Saving…" : "Save target"}
          </Button>
          <span className={styles.analysisMeta}>
            Default 2 · Sales target % = sales ÷ closer target · TL target = active agents that day
          </span>
        </div>
      )}

      <div className={styles.dayCard}>
        <div className={styles.dayCardHead}>
          <h3>Q Feedback analysis</h3>
          <div className={styles.teamMeta}>
            <span className={styles.metaChip}>
              {data.from}
              {data.to && data.to !== data.from ? ` → ${data.to}` : ""}
            </span>
            <span className={styles.metaChip}>Qs {totals.qs}</span>
            <span className={styles.metaChip}>Sales from Qs {totals.sales}</span>
            <span className={styles.metaChip}>Open {totals.open}</span>
            <span className={styles.metaChip}>Conv {totals.conversionLabel || "—"}</span>
          </div>
        </div>
        <div className={styles.dayCardBody}>
          <div className={styles.analysisStats}>
            <div className={`${styles.kpi} ${styles.kpiQ}`}>
              <span className={styles.kpiValue}>{totals.qs}</span>
              <span className={styles.kpiLabel}>Qs to closers</span>
            </div>
            <div className={`${styles.kpi} ${styles.kpiSent}`}>
              <span className={styles.kpiValue}>{totals.sales}</span>
              <span className={styles.kpiLabel}>Sales from those Qs</span>
            </div>
            <div className={`${styles.kpi} ${styles.kpiConv}`}>
              <span className={styles.kpiValue}>{totals.conversionLabel || "—"}</span>
              <span className={styles.kpiLabel}>Conversion</span>
            </div>
            <div className={`${styles.kpi} ${styles.kpiChecks}`}>
              <span className={styles.kpiValue}>{data.closerTarget}</span>
              <span className={styles.kpiLabel}>Closer target</span>
            </div>
          </div>

          <section className={styles.analysisSection}>
            <h3>Closers · Qs received → sales from those Qs</h3>
            <div className={styles.tableWrap}>
              <table className={styles.analysisTable}>
                <thead>
                  <tr>
                    <th>Closer</th>
                    <th className={styles.thQ}>Qs</th>
                    <th className={styles.thSent}>Sales from Qs</th>
                    <th>Open</th>
                    <th>Target</th>
                    <th>Sales target</th>
                    <th>Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.closerRows || []).map((row) => (
                    <tr key={row.closerId || row.closer}>
                      <td>{row.closer}</td>
                      <td className={styles.cellQ}>{cellVal(row.qs)}</td>
                      <td className={styles.cellSent}>{cellVal(row.sales)}</td>
                      <td>{cellVal(row.open)}</td>
                      <td>{row.target}</td>
                      <td>{row.salesTargetLabel || "—"}</td>
                      <td>{row.conversionLabel || "—"}</td>
                    </tr>
                  ))}
                  {!data.closerRows?.length && (
                    <tr>
                      <td colSpan={7}>No closer Q feedback in this period</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.analysisSection}>
            <h3>Teams · TL target = active members that day</h3>
            <div className={styles.tableWrap}>
              <table className={styles.analysisTable}>
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Active (target)</th>
                    <th className={styles.thQ}>Qs</th>
                    <th className={styles.thSent}>Sales from Qs</th>
                    <th>Open</th>
                    <th>Sales target</th>
                    <th>Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.teamRows || []).map((row) => (
                    <tr key={row.team}>
                      <td>{row.team}</td>
                      <td>{row.target}</td>
                      <td className={styles.cellQ}>{cellVal(row.qs)}</td>
                      <td className={styles.cellSent}>{cellVal(row.sales)}</td>
                      <td>{cellVal(row.open)}</td>
                      <td>{row.salesTargetLabel || "—"}</td>
                      <td>{row.conversionLabel || "—"}</td>
                    </tr>
                  ))}
                  {!data.teamRows?.length && (
                    <tr>
                      <td colSpan={7}>No dialing teams in scope</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const DISPOSITIONS: { value: Disposition; label: string }[] = [
  { value: "dropped_with_client", label: "Dropped with client" },
  { value: "callback", label: "Callback" },
  { value: "not_int", label: "Not interested" },
  { value: "retransfer", label: "Retransfer" },
];

function rowsFromResponse(data: unknown): QCheck[] {
  if (Array.isArray(data)) return data as QCheck[];
  const record = (data || {}) as Record<string, unknown>;
  const rows = record.checks ?? record.rpmChecks ?? record.items ?? record.rows;
  return Array.isArray(rows) ? (rows as QCheck[]) : [];
}

function createdAt(row: QCheck) {
  return row.createdAt || row.created_at || "";
}

function displayDay(row: QCheck) {
  const day = String(row.workingDay || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Date(`${day}T12:00:00`).toLocaleDateString();
  const at = createdAt(row);
  return at ? new Date(at).toLocaleString() : "—";
}

function workingDayOf(row: QCheck) {
  return String(row.workingDay || createdAt(row) || "").slice(0, 10);
}

function isSaleRow(row: QCheck) {
  return row.feedbackStatus === "sale" || Boolean(row.linkedRpmSaleId);
}

function isHs3DailyPlaceholder(row: QCheck) {
  const info = String(row.info || "");
  return info.includes("HS3 Daily placeholder") || info.includes("[import:hs3:");
}

function rowDisposition(row: QCheck): Disposition | null {
  if (isSaleRow(row)) return null;
  const value = row.feedbackStatus ?? row.disposition ?? row.feedbackDisposition ?? null;
  if (!value || value === "sale") return null;
  return value as Disposition;
}

function isCompleted(row: QCheck) {
  return isSaleRow(row) || Boolean(rowDisposition(row));
}

function dispositionLabel(row: QCheck) {
  if (isSaleRow(row)) return "Sale";
  const value = rowDisposition(row);
  return DISPOSITIONS.find((item) => item.value === value)?.label || value || "Open";
}

function memberLabel(row: QCheck) {
  const name = row.fullName || "Unnamed member";
  const memberId = row.memberId ? ` · ${row.memberId}` : "";
  return `${name}${memberId}`;
}

function closerOptionLabel(employee: CloserEmployee) {
  const name = employee.american_name || employee.id;
  const team = employee.team ? ` · ${employee.team}` : "";
  return `${name} (${employee.id})${team}`;
}

export default function QFeedbackPage() {
  const { user } = useAuth();
  const { path, companyContext } = useCompanyScope();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<QCheck | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT);
  const [editFieldErrors, setEditFieldErrors] = useState<EditFieldErrors>({});
  const [editFormError, setEditFormError] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [disposition, setDisposition] = useState<Disposition | "">("");
  const [closerId, setCloserId] = useState("");
  const [info, setInfo] = useState("");
  const addFormRef = useRef({ selectedId: "", disposition: "" as Disposition | "", closerId: "", info: "" });
  addFormRef.current = { selectedId, disposition, closerId, info };
  const editFormRef = useRef(editForm);
  editFormRef.current = editForm;
  const editingRowRef = useRef(editingRow);
  editingRowRef.current = editingRow;
  const [search, setSearch] = useState("");
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState("feedback");
  const [closerTargetDraft, setCloserTargetDraft] = useState("2");
  const today = cairoWorkingDayToday();
  const [period, setPeriod] = useState<DateRange>({ from: today, to: today });

  const role = String(user?.role || "").toLowerCase();
  const canSubmit =
    user?.canSubmitRpmQFeedback === true ||
    ["admin", "ceo", "rtm", "quality", "tl", "op"].includes(role);
  const canEdit =
    user?.canEditRpmQFeedback === true || ["admin", "ceo", "op"].includes(role);
  const canViewAnalysis =
    user?.canViewRpmQFeedbackAnalysis === true ||
    ["op", "tl", "rtm", "quality", "hr", "admin", "ceo"].includes(role);
  const canEditCloserTarget = ["op", "rtm", "admin", "ceo"].includes(role);
  const currentCloserId = String(user?.employeeId || "");

  function resetForm(seedId = "") {
    setSelectedId(seedId);
    setDisposition("");
    setCloserId(currentCloserId);
    setInfo("");
  }

  function openForm(seedId = "") {
    resetForm(seedId);
    setFormOpen(true);
  }

  function openEdit(row: QCheck) {
    setEditFieldErrors({});
    setEditFormError("");
    setEditingRow(row);
    setEditForm({
      memberId: row.memberId || "",
      fullName: row.fullName || "",
      dateOfBirth: String(row.dateOfBirth || "").slice(0, 10),
      phone: row.phone || "",
      disposition: rowDisposition(row) || "",
      closerId: row.closerId || currentCloserId,
      info: row.info || "",
      clearFeedback: false,
    });
    setEditOpen(true);
  }

  useEffect(() => {
    if (searchParams.get("action") !== "new") return;
    if (!canSubmit) return;
    setMainTab("feedback");
    openForm();
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per action=new
  }, [searchParams, setSearchParams, canSubmit]);

  const checksQuery = useQuery({
    queryKey: ["rpm-checks", "q-feedback", companyContext, period.from, period.to],
    queryFn: () => api(path("/rpm-checks", { checkStatus: "q", from: period.from, to: period.to })),
  });

  const scopeQuery = useQuery({
    queryKey: ["rpm-checks-feedback-scope", companyContext],
    queryFn: () => api<FeedbackScope>(path("/rpm-checks/feedback-scope")),
    enabled: (formOpen || editOpen) && (canSubmit || canEdit),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const analysisQuery = useQuery({
    queryKey: ["rpm-q-feedback-analysis", companyContext, period.from, period.to],
    queryFn: () =>
      api<AnalysisPayload>(
        path("/rpm-checks/q-feedback-analysis", {
          from: period.from,
          to: period.to,
        })
      ),
    enabled: mainTab === "analysis" && canViewAnalysis,
  });

  useEffect(() => {
    if (analysisQuery.data?.closerTarget != null) {
      setCloserTargetDraft(String(analysisQuery.data.closerTarget));
    }
  }, [analysisQuery.data?.closerTarget]);

  useEffect(() => {
    if (!canViewAnalysis && mainTab === "analysis") setMainTab("feedback");
  }, [canViewAnalysis, mainTab]);

  const saveTargetMutation = useMutation({
    mutationFn: () =>
      api(path("/rpm-checks/q-feedback-analysis/closer-target"), {
        method: "PUT",
        body: JSON.stringify({ closerTarget: Number(closerTargetDraft) }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rpm-q-feedback-analysis"] });
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: ({
      id,
      disposition: nextDisposition,
      closerId: nextCloserId,
      info: nextInfo,
    }: {
      id: string;
      disposition: Disposition;
      closerId: string;
      info?: string;
    }) => {
      if (!id) throw new Error("Select an open Q before saving");
      if (!nextDisposition) throw new Error("Select a disposition");
      if (!nextCloserId) throw new Error("Select a closer before saving");
      return api(path(`/rpm-checks/${encodeURIComponent(id)}/feedback`), {
        method: "POST",
        body: JSON.stringify({
          disposition: nextDisposition,
          closerId: nextCloserId,
          info: nextInfo || null,
        }),
        headers: { "Idempotency-Key": `qf-${Date.now()}-${id}` },
      });
    },
    onMutate: ({ id }) => setPendingRowId(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rpm-checks"] });
      await queryClient.invalidateQueries({ queryKey: ["rpm-q-feedback-analysis"] });
      setFormOpen(false);
      resetForm();
    },
    onSettled: () => setPendingRowId(null),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: EditForm; saleLocked: boolean }) => {
      if (!id) throw new Error("Missing Q feedback row");
      const body: Record<string, unknown> = {
        memberId: form.memberId,
        fullName: form.fullName,
        dateOfBirth: form.dateOfBirth || null,
        phone: form.phone,
        info: form.info || null,
      };
      if (form.clearFeedback) {
        body.clearFeedback = true;
      } else if (form.disposition) {
        body.disposition = form.disposition;
        body.closerId = form.closerId || null;
      } else if (form.closerId) {
        body.closerId = form.closerId;
      }
      return api(path(`/rpm-checks/${encodeURIComponent(id)}/feedback`), {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onMutate: ({ id }) => setPendingRowId(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rpm-checks"] });
      await queryClient.invalidateQueries({ queryKey: ["rpm-q-feedback-analysis"] });
      setEditOpen(false);
      setEditingRow(null);
      setEditForm(EMPTY_EDIT);
      setEditFieldErrors({});
      setEditFormError("");
    },
    onError: (err: Error & { code?: string }) => {
      if (err.code === "MEMBER_DAY_EXISTS" || /already logged/i.test(err.message)) {
        setEditFormError(err.message);
        return;
      }
      setEditFormError(err.message || "Save failed");
    },
    onSettled: () => setPendingRowId(null),
  });

  const rows = useMemo(() => {
    const all = rowsFromResponse(checksQuery.data).filter(
      (row) => (!row.checkStatus || row.checkStatus === "q") && !isHs3DailyPlaceholder(row)
    );
    return all.filter((row) => {
      const day = workingDayOf(row);
      if (!day) return true;
      return day >= period.from && day <= period.to;
    });
  }, [checksQuery.data, period.from, period.to]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.fullName, row.memberId, row.phone, row.agentName, row.agentId, row.closerName, row.closerId].some((value) =>
        String(value || "").toLowerCase().includes(term)
      )
    );
  }, [rows, search]);

  const openRows = filteredRows.filter((row) => !isCompleted(row));
  const completedRows = filteredRows.filter((row) => isCompleted(row));
  const saleCount = filteredRows.filter((row) => isSaleRow(row)).length;
  const dispositionCounts = useMemo(() => {
    const counts: Record<Disposition, number> = {
      dropped_with_client: 0,
      callback: 0,
      not_int: 0,
      retransfer: 0,
    };
    for (const row of completedRows) {
      const value = rowDisposition(row);
      if (value && value in counts) counts[value] += 1;
    }
    return counts;
  }, [completedRows]);

  const closers = useMemo(() => {
    const list = scopeQuery.data?.closers || [];
    if (currentCloserId && !list.some((employee) => employee.id === currentCloserId)) {
      return [{ id: currentCloserId, american_name: currentCloserId }, ...list];
    }
    return list;
  }, [scopeQuery.data?.closers, currentCloserId]);

  const lockCloser = Boolean(scopeQuery.data?.lockCloser);
  const canPickCloser =
    !lockCloser && (closers.length > 1 || ["admin", "ceo", "rtm", "op", "quality"].includes(role));

  useEffect(() => {
    if (!formOpen && !editOpen) return;
    const nextDefault = scopeQuery.data?.defaultCloserId || currentCloserId;
    if (!nextDefault) return;
    if (formOpen) setCloserId((prev) => prev || nextDefault);
    if (editOpen) setEditForm((prev) => ({ ...prev, closerId: prev.closerId || nextDefault }));
  }, [formOpen, editOpen, scopeQuery.data?.defaultCloserId, currentCloserId]);

  const effectiveCloserId = canPickCloser
    ? closerId || currentCloserId
    : closerId || currentCloserId || closers[0]?.id || "";
  const canSave = Boolean(selectedId && disposition && effectiveCloserId) && !feedbackMutation.isPending;

  const saleLockedEdit = Boolean(editingRow && isSaleRow(editingRow));
  const editEffectiveCloser =
    canPickCloser
      ? editForm.closerId || currentCloserId
      : editForm.closerId || currentCloserId || closers[0]?.id || "";
  const canSaveEdit =
    Boolean(editingRow) &&
    !editMutation.isPending &&
    (saleLockedEdit ||
      editForm.clearFeedback ||
      !editForm.disposition ||
      Boolean(editEffectiveCloser));

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (feedbackMutation.isPending) return;
    const latest = addFormRef.current;
    const closer =
      canPickCloser
        ? latest.closerId || currentCloserId
        : latest.closerId || currentCloserId || closers[0]?.id || "";
    if (!latest.selectedId || !latest.disposition || !closer) return;
    feedbackMutation.mutate({
      id: latest.selectedId,
      disposition: latest.disposition as Disposition,
      closerId: closer,
      info: latest.info,
    });
  }

  function submitEdit(event?: FormEvent) {
    event?.preventDefault();
    const row = editingRowRef.current;
    const latest = editFormRef.current;
    if (!row || editMutation.isPending) return;
    setEditFormError("");
    const errors: EditFieldErrors = {};
    const member = validateMemberId(latest.memberId);
    if (!member.ok) errors.memberId = member.message || "Wrong MCN";
    const name = validatePersonName(latest.fullName, { required: true });
    if (!name.ok) errors.fullName = name.message || "Full name is required";
    const phone = validateDigitsPhone(latest.phone, { required: true });
    if (!phone.ok) errors.phone = phone.message || "Phone is required";
    setEditFieldErrors(errors);
    if (Object.keys(errors).length) {
      setEditFormError(errors.memberId ? "Wrong MCN" : "Fix highlighted fields");
      return;
    }
    const saleLocked = isSaleRow(row);
    const closer =
      canPickCloser
        ? latest.closerId || currentCloserId
        : latest.closerId || currentCloserId || closers[0]?.id || "";
    const canSave =
      saleLocked || latest.clearFeedback || !latest.disposition || Boolean(closer);
    if (!canSave) return;
    editMutation.mutate({
      id: row.id,
      form: {
        ...latest,
        closerId: closer,
        disposition: saleLocked ? "" : latest.disposition,
        clearFeedback: saleLocked ? false : latest.clearFeedback,
      },
      saleLocked,
    });
  }

  return (
    <div>
      <SectionHeader
        title="Q feedback"
        subtitle="Disposition qualified RPM checks and feedback analysis"
        actions={
          canSubmit && mainTab === "feedback" ? (
            <Button type="button" onClick={() => openForm(openRows[0]?.id || "")}>
              + Add feedback
            </Button>
          ) : undefined
        }
      />

      <div className={styles.periodBar}>
        <PeriodPicker from={period.from} to={period.to} onChange={setPeriod} />
      </div>

      <Tabs.Root value={mainTab} onValueChange={setMainTab}>
        <Tabs.List className={styles.tabs}>
          <Tabs.Trigger className={styles.tab} value="feedback">
            Feedback
          </Tabs.Trigger>
          {canViewAnalysis && (
            <Tabs.Trigger className={styles.tab} value="analysis">
              Analysis
            </Tabs.Trigger>
          )}
        </Tabs.List>

        <Tabs.Content value="feedback">
          <div className={styles.stats}>
            <StatTile value={openRows.length} label="Open Qs" accent />
            <StatTile value={saleCount} label="Sale" />
            <StatTile value={dispositionCounts.callback} label="CallBack" />
            <StatTile value={dispositionCounts.not_int} label="Not Int" />
            <StatTile value={dispositionCounts.retransfer} label="Retransfer" />
            <StatTile value={dispositionCounts.dropped_with_client} label="Dropped" />
          </div>

          <Dialog
            open={formOpen}
            onOpenChange={(open) => {
              setFormOpen(open);
              if (!open) {
                resetForm();
                feedbackMutation.reset();
              }
            }}
            title="Add Q feedback"
            scrollBody
            footer={
              <>
                <Button type="button" variant="ghost" onClick={() => setFormOpen(false)} disabled={feedbackMutation.isPending}>
                  Cancel
                </Button>
                <Button type="submit" form="q-feedback-form" disabled={!canSave}>
                  {feedbackMutation.isPending ? "Saving…" : "Save feedback"}
                </Button>
              </>
            }
          >
            <form id="q-feedback-form" onSubmit={submit}>
              <div className={styles.formGrid}>
                <label className={styles.fullWidth}>
                  Open Q
                  <select required value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                    <option value="">{openRows.length ? "Select open Q" : "No open Qs available"}</option>
                    {openRows.map((row) => (
                      <option key={row.id} value={row.id}>
                        {memberLabel(row)} · {row.agentName || row.agentId || "agent"}
                      </option>
                    ))}
                  </select>
                </label>

                <fieldset className={`${styles.statusFieldset} ${styles.fullWidth}`}>
                  <legend>Disposition</legend>
                  <div className={styles.chips}>
                    {DISPOSITIONS.map(({ value, label }) => (
                      <label
                        key={value}
                        className={`${styles.statusChip} ${styles[value]} ${disposition === value ? styles.selected : ""}`}
                      >
                        <input
                          type="radio"
                          name="disposition"
                          value={value}
                          checked={disposition === value}
                          onChange={() => setDisposition(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {canPickCloser ? (
                  <label className={styles.fullWidth}>
                    Closer
                    <Select
                      searchable
                      aria-label="Search closer"
                      value={effectiveCloserId}
                      placeholder={scopeQuery.isLoading ? "Loading closers…" : "— Select closer —"}
                      options={[
                        { value: "", label: "— Select closer —" },
                        ...closers.map((employee) => ({
                          value: employee.id,
                          label: closerOptionLabel(employee),
                        })),
                      ]}
                      onChange={(value) => setCloserId(value)}
                    />
                    <span className={styles.closerHint}>
                      TL / Closers listed first
                      {["admin", "ceo", "rtm", "op"].includes(role) ? "; dialing agents available below" : ""}
                    </span>
                  </label>
                ) : (
                  <p className={styles.closerHint}>
                    Closer:{" "}
                    {closers[0] ? closerOptionLabel(closers[0]) : currentCloserId || "No linked employee"}
                  </p>
                )}

                <label className={styles.fullWidth}>
                  Info (optional)
                  <textarea value={info} onChange={(event) => setInfo(event.target.value)} rows={3} />
                </label>
              </div>
              {!openRows.length && <p className={styles.error}>There are no open Q checks to disposition.</p>}
              {canPickCloser && !effectiveCloserId && (
                <p className={styles.error}>Select a closer before saving.</p>
              )}
              {feedbackMutation.error && <p className={styles.error}>{(feedbackMutation.error as Error).message}</p>}
            </form>
          </Dialog>

          <Dialog
            open={editOpen}
            onOpenChange={(open) => {
              if (!open) {
                setEditOpen(false);
                setEditingRow(null);
                setEditForm(EMPTY_EDIT);
                setEditFieldErrors({});
                setEditFormError("");
                editMutation.reset();
              } else {
                setEditOpen(true);
              }
            }}
            title="Edit Q feedback"
            scrollBody
            footer={
              <>
                <Button type="button" variant="ghost" onClick={() => setEditOpen(false)} disabled={editMutation.isPending}>
                  Cancel
                </Button>
                <Button type="submit" form="q-feedback-edit-form" disabled={!canSaveEdit}>
                  {editMutation.isPending ? "Saving…" : "Save changes"}
                </Button>
              </>
            }
          >
            <form id="q-feedback-edit-form" onSubmit={submitEdit}>
              <div className={styles.formGrid}>
                <label>
                  Member ID
                  <input
                    value={formatMemberId(editForm.memberId)}
                    onChange={(e) => {
                      const caret = e.target.selectionStart || 0;
                      const next = applyMemberIdInput(e.target.value, caret);
                      setEditFieldErrors((prev) => ({ ...prev, memberId: undefined }));
                      setEditForm((prev) => ({ ...prev, memberId: next.stored }));
                      requestAnimationFrame(() => e.target.setSelectionRange(next.caret, next.caret));
                    }}
                  />
                  {editFieldErrors.memberId ? <em className={styles.error}>{editFieldErrors.memberId}</em> : null}
                </label>
                <label>
                  Full name
                  <input
                    value={editForm.fullName}
                    onChange={(e) => {
                      setEditFieldErrors((prev) => ({ ...prev, fullName: undefined }));
                      setEditForm((prev) => ({ ...prev, fullName: e.target.value.replace(/\d/g, "") }));
                    }}
                  />
                  {editFieldErrors.fullName ? <em className={styles.error}>{editFieldErrors.fullName}</em> : null}
                </label>
                <label>
                  Date of birth
                  <input
                    type="date"
                    value={editForm.dateOfBirth}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={editForm.phone}
                    onChange={(e) => {
                      setEditFieldErrors((prev) => ({ ...prev, phone: undefined }));
                      setEditForm((prev) => ({ ...prev, phone: digitsOnlyPhone(e.target.value) }));
                    }}
                  />
                  {editFieldErrors.phone ? <em className={styles.error}>{editFieldErrors.phone}</em> : null}
                </label>

                {saleLockedEdit ? (
                  <p className={`${styles.closerHint} ${styles.fullWidth}`}>
                    Disposition is <strong>Sale</strong> (locked — linked from RPM Sales). Member fields and info remain editable.
                  </p>
                ) : (
                  <>
                    <fieldset className={`${styles.statusFieldset} ${styles.fullWidth}`}>
                      <legend>Disposition</legend>
                      <div className={styles.chips}>
                        {DISPOSITIONS.map(({ value, label }) => (
                          <label
                            key={value}
                            className={`${styles.statusChip} ${styles[value]} ${
                              !editForm.clearFeedback && editForm.disposition === value ? styles.selected : ""
                            }`}
                          >
                            <input
                              type="radio"
                              name="edit-disposition"
                              value={value}
                              checked={!editForm.clearFeedback && editForm.disposition === value}
                              onChange={() =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  disposition: value,
                                  clearFeedback: false,
                                }))
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <label className={styles.closerHint}>
                        <input
                          type="checkbox"
                          checked={editForm.clearFeedback}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              clearFeedback: e.target.checked,
                              disposition: e.target.checked ? "" : prev.disposition,
                            }))
                          }
                        />{" "}
                        Clear feedback (return to open Q)
                      </label>
                    </fieldset>

                    {canPickCloser ? (
                      <label className={styles.fullWidth}>
                        Closer
                        <Select
                          searchable
                          aria-label="Search closer"
                          value={editEffectiveCloser}
                          placeholder={scopeQuery.isLoading ? "Loading closers…" : "— Select closer —"}
                          options={[
                            { value: "", label: "— Select closer —" },
                            ...closers.map((employee) => ({
                              value: employee.id,
                              label: closerOptionLabel(employee),
                            })),
                          ]}
                          onChange={(value) => setEditForm((prev) => ({ ...prev, closerId: value }))}
                          disabled={editForm.clearFeedback}
                        />
                      </label>
                    ) : (
                      <p className={styles.closerHint}>
                        Closer:{" "}
                        {closers[0] ? closerOptionLabel(closers[0]) : currentCloserId || "No linked employee"}
                      </p>
                    )}
                  </>
                )}

                <label className={styles.fullWidth}>
                  Info
                  <textarea
                    value={editForm.info}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, info: e.target.value }))}
                    rows={3}
                  />
                </label>
              </div>
              {editingRow && (
                <p className={styles.closerHint}>
                  Agent: {editingRow.agentName || editingRow.agentId || "—"} · Created {displayDay(editingRow)}
                </p>
              )}
              {editFormError && <p className={styles.error}>{editFormError}</p>}
            </form>
          </Dialog>

          <Card>
            <div className={styles.toolbar}>
              <input
                type="search"
                aria-label="Search Q feedback"
                placeholder="Search member, phone, agent, or closer"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {checksQuery.isLoading && <Skeleton />}
            {checksQuery.error && (
              <QueryErrorCard error={checksQuery.error} pageName="Q feedback" onRetry={() => checksQuery.refetch()} />
            )}
            {!checksQuery.isLoading && !checksQuery.error && rows.length === 0 && (
              <EmptyState
                title="No Q checks in this period"
                hint="Qualified checks for the selected dates will appear here for closer feedback."
              />
            )}
            {!checksQuery.isLoading && !checksQuery.error && rows.length > 0 && (
              <>
                <section className={styles.section}>
                  <h2>
                    Open Qs <span>{openRows.length}</span>
                  </h2>
                  {openRows.length === 0 ? (
                    <EmptyState title="All Qs are dispositioned" />
                  ) : (
                    <div className={styles.tableWrap}>
                      <table>
                        <thead>
                          <tr>
                            <th>Created</th>
                            <th>Agent</th>
                            <th>Member</th>
                            <th>Phone</th>
                            <th aria-label="Actions" />
                          </tr>
                        </thead>
                        <tbody>
                          {openRows.map((row) => (
                            <tr key={row.id}>
                              <td>{displayDay(row)}</td>
                              <td>{row.agentName || row.agentId || "—"}</td>
                              <td>{memberLabel(row)}</td>
                              <td>{row.phone || "—"}</td>
                              <td className={styles.actions}>
                                {canSubmit && (
                                  <Button
                                    size="sm"
                                    type="button"
                                    disabled={pendingRowId === row.id}
                                    onClick={() => openForm(row.id)}
                                  >
                                    Feedback
                                  </Button>
                                )}
                                {canEdit && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    type="button"
                                    disabled={pendingRowId === row.id}
                                    onClick={() => openEdit(row)}
                                  >
                                    Edit
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className={styles.section}>
                  <h2>
                    Completed <span>{completedRows.length}</span>
                  </h2>
                  {completedRows.length === 0 ? (
                    <EmptyState title="No completed feedback yet" />
                  ) : (
                    <div className={styles.tableWrap}>
                      <table>
                        <thead>
                          <tr>
                            <th>Created</th>
                            <th>Agent</th>
                            <th>Member</th>
                            <th>Closer</th>
                            <th>Disposition</th>
                            {canEdit ? <th aria-label="Actions" /> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {completedRows.map((row) => (
                            <tr key={row.id} className={isSaleRow(row) ? styles.saleRow : undefined}>
                              <td>{displayDay(row)}</td>
                              <td>{row.agentName || row.agentId || "—"}</td>
                              <td>{memberLabel(row)}</td>
                              <td>{row.closerName || row.closerId || "—"}</td>
                              <td>
                                <span className={`${styles.pill} ${isSaleRow(row) ? styles.sale : styles[rowDisposition(row) || ""]}`}>
                                  {dispositionLabel(row)}
                                </span>
                              </td>
                              {canEdit ? (
                                <td className={styles.actions}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    type="button"
                                    disabled={pendingRowId === row.id}
                                    onClick={() => openEdit(row)}
                                  >
                                    Edit
                                  </Button>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </Card>
        </Tabs.Content>

        {canViewAnalysis && (
          <Tabs.Content value="analysis">
            {analysisQuery.isLoading && <Skeleton />}
            {analysisQuery.error && (
              <QueryErrorCard
                error={analysisQuery.error}
                pageName="Q feedback analysis"
                onRetry={() => analysisQuery.refetch()}
              />
            )}
            {analysisQuery.data && (
              <AnalysisPanel
                data={analysisQuery.data}
                closerTargetDraft={closerTargetDraft}
                onCloserTargetDraft={setCloserTargetDraft}
                onSaveCloserTarget={() => saveTargetMutation.mutate()}
                canEditTarget={canEditCloserTarget}
                savingTarget={saveTargetMutation.isPending}
              />
            )}
            {saveTargetMutation.error && (
              <p className={styles.error}>{(saveTargetMutation.error as Error).message}</p>
            )}
          </Tabs.Content>
        )}
      </Tabs.Root>
    </div>
  );
}
