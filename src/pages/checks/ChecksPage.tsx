import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { useRpmSubmitScope, type SubmitScope } from "@/features/sales/SaleAssignmentPicker";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { cairoWorkingDayToday } from "@/lib/salesCells";
import { applyMemberIdInput, formatMemberId, stripMemberId, validateMemberId } from "@/lib/rpmMemberId";
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
import styles from "./ChecksPage.module.css";

type CheckStatus = "q" | "nq" | "age_limit" | "under_age" | "duplicate";
type ManualDisposition = "dropped_with_client" | "callback" | "not_int" | "retransfer";
type FeedbackStatus = ManualDisposition | "sale";
type SortOrder = "newest" | "oldest";

type RpmCheck = {
  id: string;
  agentId?: string;
  agentName?: string;
  memberId?: string;
  fullName?: string;
  dob?: string;
  dateOfBirth?: string;
  phone?: string;
  checkStatus: CheckStatus;
  feedbackStatus?: FeedbackStatus | null;
  closerId?: string;
  closerName?: string;
  feedbackAt?: string;
  feedback_at?: string;
  info?: string;
  linkedRpmSaleId?: string | null;
  workingDay?: string;
  createdAt?: string;
  created_at?: string;
};

type CheckForm = {
  agentId: string;
  memberId: string;
  fullName: string;
  dob: string;
  phone: string;
  checkStatus: CheckStatus;
  info: string;
};

const STATUSES: { value: CheckStatus; label: string }[] = [
  { value: "q", label: "Q" },
  { value: "nq", label: "NQ" },
  { value: "age_limit", label: "Age" },
  { value: "under_age", label: "Under Age" },
  { value: "duplicate", label: "Duplicate" },
];

const FEEDBACK_LABELS: Record<FeedbackStatus, string> = {
  dropped_with_client: "Dropped with client",
  callback: "CallBack",
  not_int: "Not Int",
  retransfer: "Retransfer",
  sale: "Sale",
};

const MANUAL_DISPOSITIONS: { value: ManualDisposition; label: string }[] = [
  { value: "dropped_with_client", label: "Dropped with client" },
  { value: "callback", label: "CallBack" },
  { value: "not_int", label: "Not Int" },
  { value: "retransfer", label: "Retransfer" },
];

type FeedbackScope = {
  closers?: { id: string; american_name?: string; team?: string }[];
  defaultCloserId?: string;
  lockCloser?: boolean;
};

const EMPTY_FORM: CheckForm = {
  agentId: "",
  memberId: "",
  fullName: "",
  dob: "",
  phone: "",
  checkStatus: "q",
  info: "",
};

/** Q needs full identity; NQ / Age / Under / Duplicate only need agent + member + phone. */
function isQStatus(status: CheckStatus) {
  return status === "q";
}

type FieldErrors = Partial<Record<keyof CheckForm | "form", string>>;

function validateCheckFormFields(form: CheckForm): FieldErrors {
  const errors: FieldErrors = {};
  if (!String(form.agentId || "").trim()) errors.agentId = "Select an agent before submitting";
  const member = validateMemberId(form.memberId);
  if (!member.ok) errors.memberId = member.message || "Wrong MCN";
  const phone = validateDigitsPhone(form.phone, { required: true });
  if (!phone.ok) errors.phone = phone.message || "Phone is required";
  if (isQStatus(form.checkStatus)) {
    const name = validatePersonName(form.fullName, { required: true });
    if (!name.ok) errors.fullName = name.message || "Full name is required for Q checks";
    if (!String(form.dob || "").trim()) errors.dob = "Date of birth is required for Q checks";
  }
  return errors;
}

function validateCheckForm(form: CheckForm): string | null {
  const errors = validateCheckFormFields(form);
  return Object.values(errors)[0] || null;
}

function rowsFromResponse(data: unknown): RpmCheck[] {
  if (Array.isArray(data)) return data as RpmCheck[];
  const record = (data || {}) as Record<string, unknown>;
  const rows = record.checks ?? record.rpmChecks ?? record.items ?? record.rows;
  return Array.isArray(rows) ? (rows as RpmCheck[]) : [];
}

function createdAt(row: RpmCheck) {
  return row.createdAt || row.created_at || "";
}

function displayDay(row: RpmCheck) {
  const day = String(row.workingDay || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Date(`${day}T12:00:00`).toLocaleDateString();
  const at = createdAt(row);
  return at ? new Date(at).toLocaleString() : "—";
}

function workingDayOf(row: RpmCheck) {
  return String(row.workingDay || createdAt(row) || "").slice(0, 10);
}

function statusLabel(status: CheckStatus) {
  return STATUSES.find((item) => item.value === status)?.label || status;
}

function feedbackLabel(status?: FeedbackStatus | null) {
  if (!status) return "";
  return FEEDBACK_LABELS[status] || status;
}

function isSaleRow(row: RpmCheck) {
  return row.checkStatus === "q" && (row.feedbackStatus === "sale" || Boolean(row.linkedRpmSaleId));
}

function hasReadableFeedback(row: RpmCheck) {
  return row.checkStatus === "q" && Boolean(row.feedbackStatus);
}

/** Q Feedback sheet imports belong on /q-feedback, not Checks. */
function isQFeedbackSheetImport(row: RpmCheck) {
  const info = String(row.info || "");
  return info.includes("[source:q-feedback-sheet]") || info.includes("[import:qfb:");
}

function agentOptionLabel(employee: { id: string; american_name?: string; team?: string }) {
  const name = employee.american_name || employee.id;
  const team = employee.team ? ` · ${employee.team}` : "";
  return `${name} (${employee.id})${team}`;
}

function closerOptionLabel(employee: { id: string; american_name?: string; team?: string }) {
  const name = employee.american_name || employee.id;
  const team = employee.team ? ` · ${employee.team}` : "";
  return `${name}${team}`;
}

export default function ChecksPage() {
  const { user } = useAuth();
  const { path, companyContext } = useCompanyScope();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CheckForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef(form);
  formRef.current = form;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CheckStatus | "all" | "sale">("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [viewRow, setViewRow] = useState<RpmCheck | null>(null);
  const [feedbackDisposition, setFeedbackDisposition] = useState<ManualDisposition | "">("");
  const [feedbackCloserId, setFeedbackCloserId] = useState("");
  const today = cairoWorkingDayToday();
  const [period, setPeriod] = useState<DateRange>({ from: today, to: today });

  const canSubmit =
    user?.canSubmitRpmChecks === true ||
    ["admin", "ceo", "rtm", "quality", "tl", "op"].includes(String(user?.role || "").toLowerCase());
  const canSubmitQFeedback = user?.canSubmitRpmQFeedback === true;
  const currentCloserId = String(user?.employeeId || "");
  const canManageChecks =
    user?.canEditRpmChecks === true ||
    ["admin", "rtm", "ceo"].includes(String(user?.role || "").toLowerCase());

  function openNew() {
    setEditingId(null);
    setFormError("");
    setFieldErrors({});
    setFeedbackDisposition("");
    setFeedbackCloserId("");
    setForm({
      ...EMPTY_FORM,
      agentId: "",
    });
    setFormOpen(true);
  }

  useEffect(() => {
    if (searchParams.get("action") !== "new") return;
    if (!canSubmit) return;
    openNew();
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per action=new
  }, [searchParams, setSearchParams, canSubmit]);

  const checksQuery = useQuery({
    queryKey: ["rpm-checks", companyContext, period.from, period.to],
    queryFn: () => api(path("/rpm-checks", { from: period.from, to: period.to })),
  });

  const scopeQuery = useQuery({
    queryKey: ["rpm-checks-agent-scope", companyContext],
    queryFn: () => api<SubmitScope>(path("/rpm-checks/agent-scope")),
    enabled: formOpen && canSubmit,
    staleTime: 0,
    refetchOnMount: "always",
  });
  // Fallback for environments that still rely on sales submit-scope
  const salesScopeQuery = useRpmSubmitScope(formOpen && canSubmit && Boolean(scopeQuery.isError));
  const agentScope = scopeQuery.data || salesScopeQuery.data;

  const showFeedbackShortcut =
    formOpen && !editingId && isQStatus(form.checkStatus) && canSubmitQFeedback;

  const feedbackScopeQuery = useQuery({
    queryKey: ["rpm-checks-feedback-scope", companyContext, "check"],
    queryFn: () => api<FeedbackScope>(path("/rpm-checks/feedback-scope", { forCheckCreate: "1" })),
    enabled: showFeedbackShortcut,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const feedbackClosers = useMemo(() => {
    const list = feedbackScopeQuery.data?.closers || [];
    const merged = [...list];
    if (currentCloserId && !merged.some((employee) => employee.id === currentCloserId)) {
      merged.unshift({ id: currentCloserId });
    }
    return merged;
  }, [feedbackScopeQuery.data?.closers, currentCloserId]);

  useEffect(() => {
    if (!showFeedbackShortcut || !feedbackDisposition) return;
    setFeedbackCloserId((prev) => prev || currentCloserId || feedbackScopeQuery.data?.defaultCloserId || "");
  }, [
    showFeedbackShortcut,
    feedbackDisposition,
    currentCloserId,
    feedbackScopeQuery.data?.defaultCloserId,
  ]);

  useEffect(() => {
    if (!isQStatus(form.checkStatus)) {
      setFeedbackDisposition("");
      setFeedbackCloserId("");
    }
  }, [form.checkStatus]);

  const effectiveFeedbackCloserId =
    feedbackCloserId || currentCloserId || feedbackScopeQuery.data?.defaultCloserId || feedbackClosers[0]?.id || "";

  const saveMutation = useMutation({
    mutationFn: (payload: CheckForm & { feedbackDisposition?: ManualDisposition | ""; feedbackCloserId?: string }) => {
      const fieldErrs = validateCheckFormFields(payload);
      if (Object.keys(fieldErrs).length) {
        const err = new Error(Object.values(fieldErrs)[0] || "Fix highlighted fields") as Error & {
          fieldErrors?: FieldErrors;
        };
        err.fieldErrors = fieldErrs;
        throw err;
      }
      const agentId = String(payload.agentId || "").trim();
      const needsIdentity = isQStatus(payload.checkStatus);
      const memberNorm = stripMemberId(payload.memberId);
      const day = cairoWorkingDayToday();
      const body: Record<string, unknown> = {
        agentId,
        memberId: memberNorm,
        fullName: needsIdentity ? String(payload.fullName || "").trim() : null,
        dateOfBirth: needsIdentity ? payload.dob || null : null,
        phone: digitsOnlyPhone(payload.phone),
        checkStatus: payload.checkStatus,
        info: payload.info || null,
        workingDay: day,
      };
      if (
        !editingId &&
        isQStatus(payload.checkStatus) &&
        payload.feedbackDisposition
      ) {
        if (!payload.feedbackCloserId) {
          throw new Error("Select a closer when adding Q feedback on submit");
        }
        body.feedbackStatus = payload.feedbackDisposition;
        body.closerId = payload.feedbackCloserId;
      }
      return api(path(editingId ? `/rpm-checks/${encodeURIComponent(editingId)}` : "/rpm-checks"), {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
        headers: {
          "Idempotency-Key": editingId
            ? `edit-${editingId}`
            : `${companyContext}|${memberNorm}|${day}`,
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rpm-checks"] });
      await queryClient.invalidateQueries({ queryKey: ["rpm-q-feedback"] });
      setForm(EMPTY_FORM);
      setFormError("");
      setFieldErrors({});
      setFeedbackDisposition("");
      setFeedbackCloserId("");
      setEditingId(null);
      setFormOpen(false);
    },
    onError: (err: Error & { fieldErrors?: FieldErrors; code?: string; existing?: { agentId?: string; checkStatus?: string } }) => {
      if (err.fieldErrors) setFieldErrors(err.fieldErrors);
      if (err.code === "MEMBER_DAY_EXISTS" || /already logged today/i.test(err.message)) {
        const who = err.existing?.agentId ? ` (agent ${err.existing.agentId}${err.existing.checkStatus ? ` · ${err.existing.checkStatus}` : ""})` : "";
        setFormError(`${err.message}${who ? "" : ""}${/Edit the existing/i.test(err.message) ? "" : " Edit the existing check to change status."}`);
        return;
      }
      setFormError(err.message || "Save failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(path(`/rpm-checks/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rpm-checks"] }),
  });

  const rows = useMemo(
    () => rowsFromResponse(checksQuery.data).filter((row) => !isQFeedbackSheetImport(row)),
    [checksQuery.data]
  );
  const periodRows = useMemo(
    () =>
      rows.filter((row) => {
        const day = workingDayOf(row);
        if (!day) return true;
        return day >= period.from && day <= period.to;
      }),
    [rows, period.from, period.to]
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(
        STATUSES.map(({ value }) => [value, periodRows.filter((row) => row.checkStatus === value).length])
      ) as Record<CheckStatus, number>,
    [periodRows]
  );
  const saleCount = periodRows.filter((row) => isSaleRow(row)).length;

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return periodRows
      .filter((row) => {
        if (filter === "all") return true;
        if (filter === "sale") return isSaleRow(row);
        return row.checkStatus === filter;
      })
      .filter((row) =>
        !term
          ? true
          : [row.memberId, row.fullName, row.phone, row.agentName, row.agentId, row.feedbackStatus]
              .some((value) => String(value || "").toLowerCase().includes(term))
      )
      .sort((a, b) => {
        const delta = new Date(createdAt(a)).getTime() - new Date(createdAt(b)).getTime();
        return sort === "oldest" ? delta : -delta;
      });
  }, [filter, periodRows, search, sort]);

  const agents = useMemo(() => {
    const list = agentScope?.agents || [];
    const ensureId = form.agentId || (!editingId ? agentScope?.defaultAgentId || "" : "");
    if (!ensureId || list.some((a) => a.id === ensureId)) return list;
    return [
      ...list,
      {
        id: ensureId,
        american_name:
          rows.find((r) => r.id === editingId)?.agentName ||
          (ensureId === String(user?.employeeId || "") ? String(user?.employeeId || ensureId) : ensureId),
      },
    ];
  }, [
    agentScope?.agents,
    agentScope?.defaultAgentId,
    editingId,
    form.agentId,
    rows,
    user?.employeeId,
  ]);

  useEffect(() => {
    if (!formOpen || editingId) return;
    const defaultId = String(agentScope?.defaultAgentId || "").trim();
    const onlyId =
      !defaultId && (agentScope?.agents || []).length === 1
        ? String(agentScope?.agents?.[0]?.id || "").trim()
        : "";
    const nextId = defaultId || onlyId;
    if (!nextId) return;
    setForm((prev) => (prev.agentId ? prev : { ...prev, agentId: nextId }));
  }, [formOpen, editingId, agentScope?.defaultAgentId, agentScope?.agents]);

  function beginEdit(row: RpmCheck) {
    setEditingId(row.id);
    setFormError("");
    setFieldErrors({});
    setForm({
      agentId: row.agentId || "",
      memberId: row.memberId || "",
      fullName: row.fullName || "",
      dob: (row.dateOfBirth || row.dob)?.slice(0, 10) || "",
      phone: row.phone || "",
      checkStatus: row.checkStatus,
      info: row.info || "",
    });
    setFormOpen(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saveMutation.isPending) return;
    setFormError("");
    const latest = formRef.current;
    const agentId = String(latest.agentId || "").trim();
    const payload = { ...latest, agentId };
    const fieldErrs = validateCheckFormFields(payload);
    setFieldErrors(fieldErrs);
    if (Object.keys(fieldErrs).length) {
      setFormError("Fix highlighted fields");
      return;
    }
    saveMutation.mutate({
      ...payload,
      feedbackDisposition,
      feedbackCloserId: effectiveFeedbackCloserId,
    });
  }

  const needsQIdentity = isQStatus(form.checkStatus);
  const feedbackPartial =
    Boolean(feedbackDisposition) &&
    !effectiveFeedbackCloserId;
  const canSaveCheck =
    Boolean(form.agentId && form.memberId.trim() && form.phone.trim()) &&
    (!needsQIdentity || (Boolean(form.fullName.trim()) && Boolean(form.dob.trim()))) &&
    !feedbackPartial &&
    !saveMutation.isPending;

  return (
    <div>
      <SectionHeader
        title="RPM checks"
        subtitle="Eligibility and duplicate checks"
        actions={
          canSubmit ? (
            <Button type="button" onClick={openNew}>
              + New check
            </Button>
          ) : undefined
        }
      />

      <div className={styles.periodBar}>
        <PeriodPicker from={period.from} to={period.to} onChange={setPeriod} />
      </div>

      <div className={styles.stats}>
        {STATUSES.map(({ value, label }) => (
          <StatTile
            key={value}
            value={counts[value]}
            label={label}
            onClick={() => setFilter(value)}
            active={filter === value}
          />
        ))}
        <StatTile value={saleCount} label="Sale" onClick={() => setFilter("sale")} active={filter === "sale"} />
        <StatTile
          value={periodRows.length}
          label="Total Checks"
          accent
          onClick={() => setFilter("all")}
          active={filter === "all"}
        />
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(EMPTY_FORM);
            setFormError("");
            saveMutation.reset();
          }
        }}
        title={editingId ? "Edit check" : "New check"}
        scrollBody
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFormOpen(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" form="rpm-check-form" disabled={!canSaveCheck}>
              {saveMutation.isPending ? "Saving…" : editingId ? "Save changes" : "Submit check"}
            </Button>
          </>
        }
      >
        <form id="rpm-check-form" onSubmit={submit}>
          <div className={styles.formGrid}>
            <fieldset className={`${styles.statusFieldset} ${styles.fullWidth}`}>
              <legend>Check status</legend>
              <div className={styles.chips}>
                {STATUSES.map(({ value, label }) => (
                  <label
                    key={value}
                    className={`${styles.statusChip} ${styles[value]} ${form.checkStatus === value ? styles.selected : ""}`}
                  >
                    <input
                      type="radio"
                      name="checkStatus"
                      value={value}
                      checked={form.checkStatus === value}
                      onChange={() => setForm((prev) => ({ ...prev, checkStatus: value }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                {needsQIdentity
                  ? "Q requires agent, member ID, phone, full name, and date of birth."
                  : "NQ / Age / Under / Duplicate need agent, member ID, and phone only."}
              </p>
            </fieldset>
            <label className={fieldErrors.agentId ? styles.invalidField : undefined}>
              Agent
              <Select
                searchable
                aria-label="Search agent"
                value={form.agentId}
                disabled={Boolean(editingId) || agentScope?.lockAgent}
                placeholder={
                  scopeQuery.isLoading && !agentScope ? "Loading agents…" : "— Select agent —"
                }
                options={agents.map((employee) => ({
                  value: employee.id,
                  label: agentOptionLabel(employee),
                }))}
                onChange={(value) => {
                  setFieldErrors((prev) => ({ ...prev, agentId: undefined }));
                  setForm((prev) => ({ ...prev, agentId: value }));
                }}
              />
              {fieldErrors.agentId ? <em className={styles.fieldHint}>{fieldErrors.agentId}</em> : null}
            </label>
            <label className={fieldErrors.memberId ? styles.invalidField : undefined}>
              Member ID (MCN)
              <input
                required
                value={formatMemberId(form.memberId)}
                onChange={(event) => {
                  const caret = event.target.selectionStart || 0;
                  const next = applyMemberIdInput(event.target.value, caret);
                  setFieldErrors((prev) => ({ ...prev, memberId: undefined }));
                  setForm((prev) => ({ ...prev, memberId: next.stored }));
                  requestAnimationFrame(() => {
                    event.target.setSelectionRange(next.caret, next.caret);
                  });
                }}
              />
              {fieldErrors.memberId ? <em className={styles.fieldHint}>{fieldErrors.memberId}</em> : null}
            </label>
            <label className={fieldErrors.phone ? styles.invalidField : undefined}>
              Phone
              <input
                required
                type="tel"
                inputMode="numeric"
                value={form.phone}
                onChange={(event) => {
                  setFieldErrors((prev) => ({ ...prev, phone: undefined }));
                  setForm((prev) => ({ ...prev, phone: digitsOnlyPhone(event.target.value) }));
                }}
              />
              {fieldErrors.phone ? <em className={styles.fieldHint}>{fieldErrors.phone}</em> : null}
            </label>
            {needsQIdentity && (
              <>
                <label className={fieldErrors.fullName ? styles.invalidField : undefined}>
                  Full name
                  <input
                    required
                    value={form.fullName}
                    onChange={(event) => {
                      setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
                      setForm((prev) => ({
                        ...prev,
                        fullName: event.target.value.replace(/\d/g, ""),
                      }));
                    }}
                  />
                  {fieldErrors.fullName ? <em className={styles.fieldHint}>{fieldErrors.fullName}</em> : null}
                </label>
                <label className={fieldErrors.dob ? styles.invalidField : undefined}>
                  Date of birth
                  <input
                    required
                    type="date"
                    value={form.dob}
                    onChange={(event) => {
                      setFieldErrors((prev) => ({ ...prev, dob: undefined }));
                      setForm((prev) => ({ ...prev, dob: event.target.value }));
                    }}
                  />
                  {fieldErrors.dob ? <em className={styles.fieldHint}>{fieldErrors.dob}</em> : null}
                </label>
              </>
            )}
            {showFeedbackShortcut ? (
              <div className={`${styles.feedbackShortcut} ${styles.fullWidth}`}>
                <p className={styles.feedbackShortcutLead}>
                  <strong>Optional:</strong> add Q feedback on the same submit if you already know the disposition.
                  Open Qs still use the <strong>Q Feedback</strong> page — this is only a shortcut.
                </p>
                <div className={styles.feedbackShortcutGrid}>
                  <label>
                    Disposition (optional)
                    <select
                      aria-label="Q feedback disposition"
                      value={feedbackDisposition}
                      onChange={(event) =>
                        setFeedbackDisposition(event.target.value as ManualDisposition | "")
                      }
                    >
                      <option value="">— Skip (open Q) —</option>
                      {MANUAL_DISPOSITIONS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {feedbackDisposition ? (
                    <label>
                      Closer
                      <Select
                        searchable
                        aria-label="Search closer"
                        value={effectiveFeedbackCloserId}
                        disabled={feedbackScopeQuery.isLoading}
                        placeholder={
                          feedbackScopeQuery.isLoading ? "Loading TL / closers…" : "— Select closer —"
                        }
                        options={[
                          { value: "", label: "— Select closer —" },
                          ...feedbackClosers.map((employee) => ({
                            value: employee.id,
                            label: closerOptionLabel(employee),
                          })),
                        ]}
                        onChange={(value) => setFeedbackCloserId(value)}
                      />
                      <span className={styles.feedbackCloserHint}>
                        Defaults to you · choose another TL or Closer if needed
                      </span>
                    </label>
                  ) : null}
                </div>
                {feedbackPartial ? (
                  <p className={styles.error}>Select a closer when adding Q feedback on submit.</p>
                ) : null}
                {feedbackDisposition ? (
                  <p className={styles.feedbackShortcutNote}>
                    Sale disposition is never manual — it is set when an RPM sale auto-links to this Q.
                  </p>
                ) : null}
              </div>
            ) : null}
            <label className={styles.fullWidth}>
              Info (optional)
              <input
                value={form.info}
                onChange={(event) => setForm((prev) => ({ ...prev, info: event.target.value }))}
              />
            </label>
          </div>
          {(scopeQuery.error && salesScopeQuery.error) && (
            <p className={styles.error}>
              {(salesScopeQuery.error as Error).message ||
                (scopeQuery.error as Error).message ||
                "Could not load agents"}
            </p>
          )}
          {formError && <p className={styles.error}>{formError}</p>}
          {saveMutation.error && <p className={styles.error}>{(saveMutation.error as Error).message}</p>}
        </form>
      </Dialog>

      <Dialog
        open={Boolean(viewRow)}
        onOpenChange={(open) => {
          if (!open) setViewRow(null);
        }}
        title="Q feedback"
        footer={
          <Button type="button" variant="secondary" onClick={() => setViewRow(null)}>
            Close
          </Button>
        }
      >
        {viewRow && (
          <div className={styles.feedbackView}>
            <div>
              <span className="muted">Member</span>
              <strong>{viewRow.fullName || "—"}</strong>
              <div className="muted">{viewRow.memberId || ""}</div>
            </div>
            <div>
              <span className="muted">Agent</span>
              <div>{viewRow.agentName || viewRow.agentId || "—"}</div>
            </div>
            <div>
              <span className="muted">Disposition</span>
              <div>
                <span
                  className={`${styles.pill} ${
                    isSaleRow(viewRow) ? styles.sale : styles[viewRow.feedbackStatus || "q"]
                  }`}
                >
                  {feedbackLabel(viewRow.feedbackStatus) || "—"}
                </span>
              </div>
            </div>
            <div>
              <span className="muted">Closer</span>
              <div>{viewRow.closerName || viewRow.closerId || "—"}</div>
            </div>
            <div>
              <span className="muted">Feedback at</span>
              <div>
                {viewRow.feedbackAt || viewRow.feedback_at
                  ? new Date(String(viewRow.feedbackAt || viewRow.feedback_at)).toLocaleString()
                  : "—"}
              </div>
            </div>
            {viewRow.linkedRpmSaleId && (
              <div>
                <span className="muted">Linked sale</span>
                <div>{viewRow.linkedRpmSaleId}</div>
              </div>
            )}
            <div className={styles.feedbackInfo}>
              <span className="muted">Info</span>
              <p>{viewRow.info || "—"}</p>
            </div>
          </div>
        )}
      </Dialog>

      <Card>
        <div className={styles.toolbar}>
          <input
            aria-label="Search checks"
            type="search"
            placeholder="Search member, phone, or agent"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className={styles.filterChips}>
            <button type="button" className={filter === "all" ? styles.activeFilter : ""} onClick={() => setFilter("all")}>
              All
            </button>
            {STATUSES.map(({ value, label }) => (
              <button
                type="button"
                key={value}
                className={filter === value ? styles.activeFilter : ""}
                onClick={() => setFilter(value)}
              >
                {value === "duplicate" ? "Duplicates" : label}
              </button>
            ))}
            <button type="button" className={filter === "sale" ? styles.activeFilter : ""} onClick={() => setFilter("sale")}>
              Sale
            </button>
          </div>
          <select aria-label="Sort checks" value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>

        {checksQuery.isLoading && <Skeleton />}
        {checksQuery.error && (
          <QueryErrorCard error={checksQuery.error} pageName="RPM checks" onRetry={() => checksQuery.refetch()} />
        )}
        {!checksQuery.isLoading && !checksQuery.error && visibleRows.length === 0 && (
          <EmptyState
            title="No checks found"
            hint={
              search || filter !== "all"
                ? "Try changing your search, filter, or date range."
                : canSubmit
                  ? "Use + New check to submit the first RPM check."
                  : "No checks in scope for this period."
            }
          />
        )}
        {!checksQuery.isLoading && !checksQuery.error && visibleRows.length > 0 && (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Agent</th>
                  <th>Member ID</th>
                  <th>Member</th>
                  <th>DOB</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Feedback</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id} className={isSaleRow(row) ? styles.saleRow : undefined}>
                    <td>{displayDay(row)}</td>
                    <td>{row.agentName || row.agentId || "—"}</td>
                    <td>{row.memberId || "—"}</td>
                    <td>{row.fullName || "—"}</td>
                    <td>
                      {row.dateOfBirth || row.dob
                        ? new Date(String(row.dateOfBirth || row.dob)).toLocaleDateString()
                        : "—"}
                    </td>
                    <td>{row.phone || "—"}</td>
                    <td>
                      <span className={`${styles.pill} ${styles[row.checkStatus]}`}>{statusLabel(row.checkStatus)}</span>
                    </td>
                    <td>
                      {isSaleRow(row) ? (
                        <span className={`${styles.pill} ${styles.sale}`}>Sale</span>
                      ) : row.checkStatus === "q" ? (
                        row.feedbackStatus ? (
                          <span className={`${styles.pill} ${styles[row.feedbackStatus]}`}>
                            {feedbackLabel(row.feedbackStatus)}
                          </span>
                        ) : (
                          <span className={`${styles.pill} ${styles.noFeedback}`}>No feedback</span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={styles.actions}>
                      {hasReadableFeedback(row) && (
                        <Button size="sm" variant="secondary" type="button" onClick={() => setViewRow(row)}>
                          View
                        </Button>
                      )}
                      {canSubmit && (
                        <Button size="sm" variant="secondary" type="button" onClick={() => beginEdit(row)}>
                          Edit
                        </Button>
                      )}
                      {canManageChecks && (
                        <Button
                          size="sm"
                          variant="danger"
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => window.confirm("Delete this check?") && deleteMutation.mutate(row.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
