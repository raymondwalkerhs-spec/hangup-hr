import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { StatusPill } from "@/ui/StatusPill";
import styles from "./MeetingRequestsPage.module.css";

type Mr = {
  id: string;
  title?: string;
  description?: string;
  proposedDate?: string;
  proposedTime?: string;
  durationMinutes?: number;
  requesterEmployeeId?: string;
  status?: string;
  participants?: string[];
  reviewNotes?: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  rescheduled: "Rescheduled",
};

function participantLabel(p: string, empName: (id: string) => string) {
  if (p.startsWith("employee:")) return empName(p.slice(9));
  if (p.startsWith("team:")) {
    const [u, t] = p.slice(5).split("|");
    return `Team: ${[u, t].filter(Boolean).join(" › ")}`;
  }
  if (p.startsWith("unit:")) return `Unit: ${p.slice(5)}`;
  return empName(p);
}

export function MeetingRequestsPage() {
  const qc = useQueryClient();
  const { status } = useAuth();
  const { path, companyContext } = useCompanyScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") || "";
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    proposedDate: new Date().toISOString().slice(0, 10),
    proposedTime: "10:00",
    durationMinutes: "30",
    participants: [] as string[],
    participantSearch: "",
  });

  const user = status?.user as Record<string, unknown> | undefined;
  const canSubmit = user?.canSubmitMeetingRequest === true;
  const canReview = user?.canReviewMeetingRequest === true;
  const myEmpId = String(user?.employeeId || "");

  const { data, isLoading } = useQuery({
    queryKey: ["meeting-requests", statusFilter, companyContext],
    queryFn: () => {
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      return api<{ requests: Mr[] }>(path(`/meeting-requests${q}`));
    },
  });

  const { data: empData } = useQuery({
    queryKey: ["employees-mr", companyContext],
    queryFn: () => api<{ employees: { id: string; american_name?: string; arabic_name?: string; unit?: string; team?: string }[] }>(path("/employees")),
    enabled: createOpen,
  });

  const { data: teamsData } = useQuery({
    queryKey: ["teams-mr", companyContext],
    queryFn: () => api<{ teams?: { name: string; unit?: string }[] }>(path("/hrms/teams")),
    enabled: createOpen,
  });

  const empMap = useMemo(() => new Map((empData?.employees || []).map((e) => [e.id, e])), [empData?.employees]);
  const empName = (id: string) => {
    const e = empMap.get(id);
    return e ? (e.american_name || e.arabic_name || e.id) : id || "—";
  };

  const participantOptions = useMemo(() => {
    const role = String(user?.role || "");
    const leadTeams = (user?.leadTeams as { unit?: string; team?: string; name?: string }[]) || [];
    const myUnit = String(user?.unit || "");
    const isHrAdmin = ["hr", "admin", "ceo"].includes(role);
    const isOp = role === "op";
    const isTl = role === "tl";

    let visibleEmps = empData?.employees || [];
    if (isTl) {
      const myTeams = new Set(leadTeams.map((lt) => lt.team || lt.name));
      visibleEmps = visibleEmps.filter((e) => myTeams.has(e.team));
    } else if (isOp && myUnit) {
      visibleEmps = visibleEmps.filter((e) => e.unit === myUnit);
    }

    let visibleTeams = teamsData?.teams || [];
    if (isTl) {
      const allowed = new Set(leadTeams.map((lt) => `${lt.unit}|${lt.team || lt.name}`));
      visibleTeams = visibleTeams.filter((t) => allowed.has(`${t.unit}|${t.name}`));
    } else if (isOp && myUnit) {
      visibleTeams = visibleTeams.filter((t) => t.unit === myUnit);
    }

    const units = (isOp || isHrAdmin)
      ? [...new Set((isOp ? [myUnit] : (empData?.employees || []).map((e) => e.unit)).filter(Boolean))]
      : [];

    const emps = visibleEmps.map((e) => ({
      value: `employee:${e.id}`,
      label: e.american_name || e.arabic_name || e.id,
      sub: e.id,
      group: "emp" as const,
    }));
    const teams = visibleTeams.map((t) => ({
      value: `team:${t.unit || ""}|${t.name}`,
      label: t.name,
      sub: t.unit || "",
      group: "team" as const,
    }));
    const unitOpts = units.map((u) => ({
      value: `unit:${u}`,
      label: String(u),
      sub: "",
      group: "unit" as const,
    }));
    const q = form.participantSearch.trim().toLowerCase();
    const filter = <T extends { label: string; sub: string }>(items: T[]) =>
      q ? items.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(q)) : items;
    return { emps: filter(emps), teams: filter(teams), units: filter(unitOpts) };
  }, [empData?.employees, teamsData?.teams, form.participantSearch, user]);

  const review = useMutation({
    mutationFn: ({ id, status, reviewNotes }: { id: string; status: string; reviewNotes?: string }) =>
      api(path(`/meeting-requests/${id}`), {
        method: "PATCH",
        body: JSON.stringify({ status, reviewNotes }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meeting-requests"] }),
  });

  const create = useMutation({
    mutationFn: () =>
      api(path("/meeting-requests"), {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          proposedDate: form.proposedDate,
          proposedTime: form.proposedTime,
          durationMinutes: Number(form.durationMinutes) || 30,
          requesterEmployeeId: myEmpId,
          requesterRole: user?.role || "",
          participants: form.participants,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meeting-requests"] });
      setCreateOpen(false);
      setForm((f) => ({ ...f, title: "", description: "", participants: [] }));
    },
  });

  const items = data?.requests || [];
  const tabs = ["", "pending", "approved", "rejected", "rescheduled"];

  const toggleParticipant = (value: string) => {
    setForm((f) => ({
      ...f,
      participants: f.participants.includes(value)
        ? f.participants.filter((p) => p !== value)
        : [...f.participants, value],
    }));
  };

  return (
    <div>
      <SectionHeader
        title="Meeting Requests"
        subtitle="Schedule meetings with your team, unit, or specific employees"
        actions={canSubmit ? <Button onClick={() => setCreateOpen(true)}>+ New Request</Button> : undefined}
      />

      <div className={styles.tabs}>
        {tabs.map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={`${styles.tab} ${statusFilter === s ? styles.tabActive : ""}`}
            onClick={() => setSearchParams(s ? { status: s } : {})}
          >
            {s ? STATUS_LABELS[s] : "All"}
          </button>
        ))}
      </div>

      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && !items.length && (
        <Card><p className="muted" style={{ textAlign: "center", padding: "2rem" }}>No meeting requests.</p></Card>
      )}

      <div className={styles.grid}>
        {items.map((r) => {
          const dateStr = r.proposedDate
            ? new Date(`${r.proposedDate}T${r.proposedTime || "00:00"}`).toLocaleString([], {
                weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })
            : "—";
          const participants = r.participants || [];
          return (
            <Card key={r.id} className={styles.card}>
              <div className={styles.cardHead}>
                <strong>{r.title}</strong>
                <StatusPill variant={r.status === "approved" ? "ok" : r.status === "pending" ? "warn" : "muted"}>
                  {STATUS_LABELS[r.status || ""] || r.status}
                </StatusPill>
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.25rem 0" }}>
                {dateStr} · {r.durationMinutes || 30} min
              </p>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                By <strong>{empName(r.requesterEmployeeId || "")}</strong>
              </p>
              {r.description && <p style={{ fontSize: "0.9rem" }}>{r.description}</p>}
              {participants.length > 0 && (
                <ul className={styles.participants}>
                  {participants.slice(0, 6).map((p) => (
                    <li key={p}>{participantLabel(p, empName)}</li>
                  ))}
                  {participants.length > 6 && <li className="muted">+{participants.length - 6} more</li>}
                </ul>
              )}
              {r.reviewNotes && <p className="muted" style={{ fontSize: "0.8rem" }}>Note: {r.reviewNotes}</p>}
              {canReview && r.status === "pending" && (
                <div className={styles.actions}>
                  <Button size="sm" onClick={() => review.mutate({ id: r.id, status: "approved" })}>Approve</Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      const notes = prompt("Rejection reason (optional):") || "";
                      review.mutate({ id: r.id, status: "rejected", reviewNotes: notes });
                    }}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New meeting request"
        wide
        scrollBody
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!form.title || !form.proposedDate || !form.proposedTime || !form.participants.length || !myEmpId || create.isPending}
            >
              Submit
            </Button>
          </>
        }
      >
        <FormGrid wide>
          <FormField label="Title" span="full">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </FormField>
          <FormField label="Description" span="full">
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </FormField>
          <FormField label="Date">
            <input type="date" value={form.proposedDate} onChange={(e) => setForm({ ...form, proposedDate: e.target.value })} />
          </FormField>
          <FormField label="Time">
            <input type="time" value={form.proposedTime} onChange={(e) => setForm({ ...form, proposedTime: e.target.value })} />
          </FormField>
          <FormField label="Duration (min)">
            <input type="number" min={5} max={480} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
          </FormField>
          <FormField label="Search participants" span="full">
            <input value={form.participantSearch} onChange={(e) => setForm({ ...form, participantSearch: e.target.value })} placeholder="Filter employees, teams, units…" />
          </FormField>
        </FormGrid>
        <div className={styles.picker}>
          {participantOptions.emps.length > 0 && (
            <>
              <div className={styles.pickerHead}>Employees ({participantOptions.emps.length})</div>
              {participantOptions.emps.map((o) => (
                <label key={o.value} className={styles.pickRow}>
                  <input type="checkbox" checked={form.participants.includes(o.value)} onChange={() => toggleParticipant(o.value)} />
                  <span>{o.label} <span className="muted">{o.sub}</span></span>
                </label>
              ))}
            </>
          )}
          {participantOptions.teams.length > 0 && (
            <>
              <div className={styles.pickerHead}>Teams ({participantOptions.teams.length})</div>
              {participantOptions.teams.map((o) => (
                <label key={o.value} className={styles.pickRow}>
                  <input type="checkbox" checked={form.participants.includes(o.value)} onChange={() => toggleParticipant(o.value)} />
                  <span>{o.label} <span className="muted">{o.sub}</span></span>
                </label>
              ))}
            </>
          )}
          {participantOptions.units.length > 0 && (
            <>
              <div className={styles.pickerHead}>Units ({participantOptions.units.length})</div>
              {participantOptions.units.map((o) => (
                <label key={o.value} className={styles.pickRow}>
                  <input type="checkbox" checked={form.participants.includes(o.value)} onChange={() => toggleParticipant(o.value)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </>
          )}
          <p className="muted" style={{ marginTop: "0.5rem" }}>{form.participants.length} selected</p>
        </div>
        {create.isError && <p style={{ color: "var(--err)" }}>{(create.error as Error).message}</p>}
        {!myEmpId && <p style={{ color: "var(--err)" }}>No employee linked to your account.</p>}
      </Dialog>
    </div>
  );
}
