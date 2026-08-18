import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { StatusPill } from "@/ui/StatusPill";
import { Select } from "@/ui/Select";
import { useDeferredDelete } from "@/ui/useDeferredDelete";
import styles from "./CoachingPage.module.css";

type Person = {
  id: string;
  american_name?: string;
  arabic_name?: string;
  team?: string;
  unit?: string;
  status?: string;
  name?: string;
};

type Ticket = {
  id: string;
  employeeId?: string;
  agentName?: string;
  agentStatus?: string;
  coachEmployeeId?: string;
  coachName?: string;
  submittedBy?: string;
  coachingDate?: string;
  coachingAt?: string;
  outcome?: string;
  generalNotes?: string;
  extraGeneralNotes?: string;
  secretNotes?: string;
  extraSecretNotes?: string;
  hasSecretNotes?: boolean;
  createdBy?: string;
  authorEmployeeId?: string;
  unit?: string;
  team?: string;
};

type Options = {
  agents?: Person[];
  coaches?: { tls?: Person[]; closers?: Person[]; ops?: Person[]; quality?: Person[]; agents?: Person[] };
  defaultCoachId?: string;
  canAssignCoach?: boolean;
  coachLocked?: boolean;
  canEditDateTime?: boolean;
  canDelete?: boolean;
  canViewSecret?: boolean;
  outcomes?: string[];
  nowLocal?: string;
};

const OUTCOME_LABELS: Record<string, string> = {
  pending: "Pending",
  positive: "Positive",
  negative: "Negative",
  normal: "Normal",
};

function empLabel(e?: Person | null, fallback = "") {
  if (!e) return fallback;
  return e.american_name || e.arabic_name || e.name || e.id || fallback;
}

function toInputDateTime(iso?: string, fallback = "") {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatWhen(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function outcomeVariant(outcome?: string): "ok" | "warn" | "err" | "muted" {
  if (outcome === "positive") return "ok";
  if (outcome === "negative") return "err";
  if (outcome === "pending") return "warn";
  return "muted";
}

export function CoachingPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const { user } = useAppStatus();
  const selfEmpId = String(user?.employeeId || "");
  const username = String(user?.username || "").toLowerCase();
  const role = String(user?.role || "").toLowerCase();
  const canSubmit = user?.canSubmitCoaching === true;
  const canViewSecretFlag = user?.canViewCoachingSecret === true;
  const canDelete = user?.canDeleteCoaching === true || ["admin", "ceo"].includes(role);
  const canEditDateTime = user?.canEditCoachingDateTime === true || role === "admin" || role === "ceo";
  const canManageNotes = ["hr", "admin", "ceo"].includes(role);

  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    agent: "",
    coach: "",
    outcome: "",
    agentStatus: "",
    team: "",
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [form, setForm] = useState({
    employeeId: "",
    coachEmployeeId: "",
    coachingAt: "",
    outcome: "pending",
    generalNotes: "",
    secretNotes: "",
    extraGeneralNotes: "",
    extraSecretNotes: "",
  });
  const [formError, setFormError] = useState("");

  const filterQuery = useMemo(() => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    const s = q.toString();
    return s ? `?${s}` : "";
  }, [filters]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["coaching", companyContext, filterQuery],
    queryFn: () =>
      api<{
        tickets?: Ticket[];
        filterOptions?: { agents?: Person[]; coaches?: Person[]; teams?: string[]; outcomes?: string[] };
      }>(path(`/coaching${filterQuery}`)),
  });

  const { data: options } = useQuery({
    queryKey: ["coaching-options", companyContext],
    queryFn: () => api<Options>(path("/coaching/options")),
    enabled: canSubmit || canDelete || canManageNotes || Boolean(selfEmpId),
  });

  const tickets = data?.tickets || [];
  const deferred = useDeferredDelete({
    items: tickets,
    commit: async (id) => {
      await api(path(`/coaching/${id}`), { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["coaching"] });
      setEditorOpen(false);
      setSelected(null);
    },
    message: "Coaching ticket deleted",
  });
  const filterOptions = data?.filterOptions;
  const agents = options?.agents || [];
  const coachSections = options?.coaches || {};
  const agentMap = useMemo(() => {
    const map: Record<string, Person> = {};
    for (const a of agents) map[a.id] = a;
    for (const section of [coachSections.tls, coachSections.closers, coachSections.ops, coachSections.quality, coachSections.agents]) {
      for (const p of section || []) map[p.id] = p;
    }
    for (const t of tickets) {
      if (t.employeeId && !map[t.employeeId]) {
        map[t.employeeId] = { id: t.employeeId, american_name: t.agentName, status: t.agentStatus, team: t.team };
      }
      if (t.coachEmployeeId && !map[t.coachEmployeeId]) {
        map[t.coachEmployeeId] = { id: t.coachEmployeeId, american_name: t.coachName };
      }
    }
    return map;
  }, [agents, coachSections, tickets]);

  const isAuthor = (t?: Ticket | null) => {
    if (!t) return false;
    if (username && String(t.createdBy || t.submittedBy || "").toLowerCase() === username) return true;
    return Boolean(selfEmpId && t.authorEmployeeId === selfEmpId);
  };
  const isCoach = (t?: Ticket | null) => Boolean(selfEmpId && t?.coachEmployeeId === selfEmpId);
  const showSecret = (t?: Ticket | null) =>
    canViewSecretFlag || isCoach(t) || isAuthor(t) || options?.canViewSecret === true;

  const coachLocked = options?.coachLocked === true || options?.canAssignCoach === false;
  const canAssignCoach = options?.canAssignCoach === true && !coachLocked;

  const openNew = () => {
    setSelected(null);
    setForm({
      employeeId: agents[0]?.id || "",
      coachEmployeeId: options?.defaultCoachId || selfEmpId,
      coachingAt: options?.nowLocal || toInputDateTime(new Date().toISOString()),
      outcome: "pending",
      generalNotes: "",
      secretNotes: "",
      extraGeneralNotes: "",
      extraSecretNotes: "",
    });
    setFormError("");
    setEditorOpen(true);
  };

  const openTicket = (t: Ticket) => {
    setSelected(t);
    setForm({
      employeeId: t.employeeId || "",
      coachEmployeeId: t.coachEmployeeId || "",
      coachingAt: toInputDateTime(t.coachingAt, `${String(t.coachingDate || "").slice(0, 10)}T12:00`),
      outcome: t.outcome || "pending",
      generalNotes: t.generalNotes || "",
      secretNotes: t.secretNotes || "",
      extraGeneralNotes: t.extraGeneralNotes || "",
      extraSecretNotes: t.extraSecretNotes || "",
    });
    setFormError("");
    setEditorOpen(true);
  };

  const editing = Boolean(selected?.id);
  const coachCanFollowUp = editing && isCoach(selected);
  const canEditOriginal = editing && canManageNotes;
  const canSave =
    (!editing && canSubmit) ||
    canEditOriginal ||
    coachCanFollowUp ||
    (editing && canEditDateTime) ||
    (editing && canDelete);

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) {
        const body: Record<string, unknown> = {
          employeeId: form.employeeId,
          coachEmployeeId: form.coachEmployeeId,
          outcome: form.outcome,
          generalNotes: form.generalNotes,
        };
        if (showSecret(null)) body.secretNotes = form.secretNotes;
        if (canEditDateTime) body.coachingAt = form.coachingAt;
        return api(path("/coaching"), { method: "POST", body: JSON.stringify(body) });
      }
      const body: Record<string, unknown> = {};
      if (coachCanFollowUp || canEditOriginal) {
        body.outcome = form.outcome;
        body.extraGeneralNotes = form.extraGeneralNotes;
        if (showSecret(selected)) body.extraSecretNotes = form.extraSecretNotes;
      }
      if (canEditOriginal) {
        body.generalNotes = form.generalNotes;
        if (showSecret(selected)) body.secretNotes = form.secretNotes;
      }
      if (canEditDateTime) body.coachingAt = form.coachingAt;
      if (canDelete && canAssignCoach) {
        body.employeeId = form.employeeId;
        body.coachEmployeeId = form.coachEmployeeId;
      }
      return api(path(`/coaching/${selected?.id}`), { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coaching"] });
      setEditorOpen(false);
      setSelected(null);
    },
    onError: (err: Error) => setFormError(err.message || "Save failed"),
  });


  const coachSelect = (disabled: boolean) => {
    const sections: { label: string; people: Person[] }[] = [
      { label: "Team leads", people: coachSections.tls || [] },
      { label: "Closers", people: coachSections.closers || [] },
      { label: "OPs", people: coachSections.ops || [] },
      { label: "Quality", people: coachSections.quality || [] },
      { label: "Agents", people: coachSections.agents || [] },
    ].filter((s) => s.people.length);
    const known = new Set(sections.flatMap((s) => s.people.map((p) => p.id)));
    const defaultId = form.coachEmployeeId || options?.defaultCoachId || "";
    const options = [
      { value: "", label: "Select coach" },
      ...(defaultId && !known.has(defaultId)
        ? [{ value: defaultId, label: `${empLabel(agentMap[defaultId], defaultId)} (me)` }]
        : []),
      ...sections.flatMap((s) =>
        s.people.map((p) => ({ value: p.id, label: `${s.label} · ${empLabel(p)} (${p.id})` }))
      ),
    ];
    return (
      <Select
        value={form.coachEmployeeId}
        onChange={(value) => setForm((f) => ({ ...f, coachEmployeeId: value }))}
        disabled={disabled}
        options={options}
        placeholder="Select coach"
      />
    );
  };

  return (
    <div>
      <SectionHeader
        title="Coaching"
        subtitle="Agent coaching tickets"
        actions={canSubmit ? <Button onClick={openNew}>+ New ticket</Button> : undefined}
      />

      <div className={styles.filters}>
        <label>
          From
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          />
        </label>
        <label>
          Agent
          <Select
            value={filters.agent}
            onChange={(agent) => setFilters((f) => ({ ...f, agent }))}
            options={[
              { value: "", label: "All agents" },
              ...(filterOptions?.agents || agents).map((a) => ({ value: a.id, label: empLabel(a) })),
            ]}
            placeholder="All agents"
          />
        </label>
        <label>
          Coach
          <Select
            value={filters.coach}
            onChange={(coach) => setFilters((f) => ({ ...f, coach }))}
            options={[
              { value: "", label: "All coaches" },
              ...(filterOptions?.coaches || []).map((c) => ({ value: c.id, label: empLabel(c) })),
            ]}
            placeholder="All coaches"
          />
        </label>
        <label>
          Outcome
          <Select
            value={filters.outcome}
            onChange={(outcome) => setFilters((f) => ({ ...f, outcome }))}
            options={[
              { value: "", label: "All outcomes" },
              ...(filterOptions?.outcomes || options?.outcomes || Object.keys(OUTCOME_LABELS)).map((o) => ({
                value: o,
                label: OUTCOME_LABELS[o] || o,
              })),
            ]}
            placeholder="All outcomes"
          />
        </label>
        <label>
          Agent status
          <Select
            value={filters.agentStatus}
            onChange={(agentStatus) => setFilters((f) => ({ ...f, agentStatus }))}
            options={[
              { value: "", label: "Active + out" },
              { value: "active", label: "Active agents" },
              { value: "out", label: "Out agents" },
            ]}
          />
        </label>
        <label>
          Team
          <Select
            value={filters.team}
            onChange={(team) => setFilters((f) => ({ ...f, team }))}
            options={[
              { value: "", label: "All teams" },
              ...(filterOptions?.teams || []).map((t) => ({ value: t, label: t })),
            ]}
            placeholder="All teams"
          />
        </label>
      </div>

      {isLoading && <p className="muted">Loading…</p>}
      {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
      {!isLoading && !deferred.visibleItems.length && <p className="muted">No coaching tickets.</p>}

      <div className={styles.grid}>
        {deferred.visibleItems.map((t) => (
          <Card key={t.id} className={styles.card} onClick={() => openTicket(t)}>
            <div className={styles.cardHeader}>
              <strong>{t.agentName || empLabel(agentMap[t.employeeId || ""]) || t.employeeId}</strong>
              <StatusPill variant={outcomeVariant(t.outcome)}>
                {OUTCOME_LABELS[t.outcome || "pending"] || t.outcome}
              </StatusPill>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {formatWhen(t.coachingAt || t.coachingDate)}
              {t.team ? ` · ${t.team}` : ""}
            </p>
            <p className="muted" style={{ margin: "0.25rem 0 0" }}>
              Coach: {t.coachName || empLabel(agentMap[t.coachEmployeeId || ""]) || "—"}
              {t.submittedBy ? ` · By ${t.submittedBy}` : ""}
            </p>
            {t.generalNotes ? <p className={styles.notes}>{t.generalNotes}</p> : null}
            {t.extraGeneralNotes ? <p className={styles.notes}><em>Follow-up:</em> {t.extraGeneralNotes}</p> : null}
          </Card>
        ))}
      </div>

      <Dialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={editing ? "Coaching ticket" : "New coaching ticket"}
        wide
        footer={
          <div className={styles.actions}>
            {editing && canDelete && selected?.id && (
              <Button variant="danger" onClick={() => selected.id && deferred.requestDelete(selected.id)}>Delete</Button>
            )}
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>Close</Button>
            {canSave && (
              <Button onClick={() => save.mutate()} disabled={save.isPending || !form.employeeId}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        }
      >
        <div className={styles.form}>
          {formError && <p style={{ color: "var(--err)" }}>{formError}</p>}
          <label>
            Agent
            {canSubmit && !editing ? (
              <Select
                value={form.employeeId}
                onChange={(employeeId) => setForm((f) => ({ ...f, employeeId }))}
                options={[
                  { value: "", label: "Select agent" },
                  ...agents.map((a) => ({ value: a.id, label: `${empLabel(a)} (${a.id})` })),
                ]}
                placeholder="Select agent"
              />
            ) : (
              <input value={selected?.agentName || empLabel(agentMap[form.employeeId]) || form.employeeId} readOnly />
            )}
          </label>
          <label>
            Coach
            {(!editing && (canAssignCoach || coachLocked)) || (editing && canDelete && canAssignCoach)
              ? coachSelect(Boolean(editing ? !(canDelete && canAssignCoach) : coachLocked && !canAssignCoach))
              : <input value={selected?.coachName || empLabel(agentMap[form.coachEmployeeId]) || form.coachEmployeeId} readOnly />}
          </label>
          <label>
            Submitted by
            <input value={editing ? (selected?.submittedBy || selected?.createdBy || "") : username} readOnly />
          </label>
          <label>
            Date & time
            <input
              type="datetime-local"
              value={form.coachingAt}
              onChange={(e) => setForm((f) => ({ ...f, coachingAt: e.target.value }))}
              readOnly={!canEditDateTime}
            />
            {!canEditDateTime && <span className={styles.secretHint}>Only Admin can change date and time.</span>}
          </label>
          <label>
            Outcome
            <Select
              value={form.outcome}
              onChange={(outcome) => setForm((f) => ({ ...f, outcome }))}
              disabled={editing && !(coachCanFollowUp || canEditOriginal)}
              options={(options?.outcomes || Object.keys(OUTCOME_LABELS)).map((o) => ({
                value: o,
                label: OUTCOME_LABELS[o] || o,
              }))}
            />
          </label>
          <label>
            General notes
            <textarea
              value={form.generalNotes}
              onChange={(e) => setForm((f) => ({ ...f, generalNotes: e.target.value }))}
              readOnly={editing && !canEditOriginal}
              placeholder="Visible to the agent"
            />
          </label>
          {editing && (
            <label>
              Extra general notes
              <textarea
                value={form.extraGeneralNotes}
                onChange={(e) => setForm((f) => ({ ...f, extraGeneralNotes: e.target.value }))}
                readOnly={!(coachCanFollowUp || canEditOriginal)}
                placeholder="Coach follow-up after the session"
              />
            </label>
          )}
          {showSecret(selected) && (
            <>
              <label>
                Secret notes
                <textarea
                  value={form.secretNotes}
                  onChange={(e) => setForm((f) => ({ ...f, secretNotes: e.target.value }))}
                  readOnly={editing && !canEditOriginal}
                  placeholder="Visible to HR, Quality, and Admin"
                />
                <span className={styles.secretHint}>Not visible to the coached agent.</span>
              </label>
              {editing && (
                <label>
                  Extra secret notes
                  <textarea
                    value={form.extraSecretNotes}
                    onChange={(e) => setForm((f) => ({ ...f, extraSecretNotes: e.target.value }))}
                    readOnly={!(coachCanFollowUp || canEditOriginal || canViewSecretFlag)}
                    placeholder="Coach follow-up (secret)"
                  />
                </label>
              )}
            </>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deferred.confirmId)}
        onOpenChange={(o) => !o && deferred.setConfirmId(null)}
        title="Delete coaching ticket?"
        message="It will move to the recycle bin. Only Admin/CEO can restore it. You can undo for 6 seconds."
        danger
        onConfirm={() => {
          deferred.confirmDelete();
          setEditorOpen(false);
          setSelected(null);
        }}
      />
    </div>
  );
}
