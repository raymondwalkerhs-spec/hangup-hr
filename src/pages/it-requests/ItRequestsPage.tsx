import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { StatusPill } from "@/ui/StatusPill";
import styles from "./ItRequestsPage.module.css";

type ItRequest = {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  urgency?: string;
  status?: string;
  employeeId?: string;
  unit?: string;
  assignedTo?: string;
  createdBy?: string;
  createdAt?: string;
  resolvedAt?: string;
  denialReason?: string;
  resolutionNotes?: string;
  approvedBy?: string;
  deniedBy?: string;
};

type ItUser = { username: string; displayName?: string; employeeId?: string };

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

const URGENCY_LABELS: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  critical: "Critical",
};

const CATEGORY_OPTIONS = [
  { value: "hardware", label: "Hardware" },
  { value: "software", label: "Software" },
  { value: "network", label: "Network / Connectivity" },
  { value: "account", label: "Account / Access" },
  { value: "equipment", label: "Equipment" },
  { value: "other", label: "Other" },
];

function canEditTicket(it: ItRequest, selfEmpId: string, canAssign: boolean) {
  if (canAssign) return true;
  return Boolean(selfEmpId && it.employeeId === selfEmpId);
}

const ISSUE_TYPES = [
  "Headset issue",
  "Noise cancellation not working",
  "PC died",
  "Dialer issue",
  "Can't hear customers",
  "Portal app issue",
  "Other",
];

function formatWhen(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function ItRequestsPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") || "";
  const [selected, setSelected] = useState<ItRequest | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    employeeId: "",
    issueType: "",
    description: "",
    category: "hardware",
    urgency: "normal",
  });
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNotes, setResolveNotes] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ title: "", category: "hardware", urgency: "normal" });
  const [patchError, setPatchError] = useState("");

  const { user } = useAppStatus();
  const selfEmpId = String(user?.employeeId || "");
  const username = String(user?.username || "");
  const userRole = String(user?.role || "").toLowerCase();
  const leadTeams = (user?.leadTeams as { team?: string; unit?: string }[] | undefined) || [];
  const closerTeams = (user?.closerTeams as { team?: string; unit?: string }[] | undefined) || [];
  const isItStaff = userRole === "it" || user?.isIt === true;
  const canItOnBehalf =
    userRole === "tl" ||
    userRole === "op" ||
    isItStaff ||
    leadTeams.length > 0 ||
    closerTeams.length > 0;

  const canSubmit = user?.canSubmitItRequest === true;
  const canAssign = user?.canAssignItRequest === true;
  const canApprove = user?.canApproveItRequest === true;
  const canResolve = user?.canResolveItRequest === true;
  const canDelete = user?.canDeleteItRequest === true;
  const canViewFilters = user?.canViewItRequestFilters === true;

  const { data, isLoading } = useQuery({
    queryKey: ["it-requests", statusFilter, companyContext],
    queryFn: () => {
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      return api<{ requests?: ItRequest[] }>(path(`/it-requests${q}`));
    },
  });

  const { data: empData } = useQuery({
    queryKey: ["employees-it", companyContext],
    queryFn: () => api<{ employees?: { id: string; american_name?: string; arabic_name?: string; team?: string; unit?: string }[] }>(path("/employees")),
    enabled: canAssign,
  });

  const { data: scopedEmpData } = useQuery({
    queryKey: ["it-scoped-agents", companyContext, leadTeams, closerTeams],
    queryFn: () =>
      api<{ employees?: { id: string; american_name?: string; arabic_name?: string; team?: string; unit?: string }[] }>(
        path("/it-requests/scoped-agents")
      ),
    enabled: canSubmit && canItOnBehalf,
  });

  const { data: itUsersData } = useQuery({
    queryKey: ["it-users"],
    queryFn: () => api<{ itUsers?: ItUser[] }>("/it-requests/it-users"),
    enabled: canAssign,
  });

  const employees = empData?.employees || [];
  const empName = (id?: string) => {
    const pool = [...employees, ...(scopedEmpData?.employees || [])];
    const e = pool.find((x) => x.id === id);
    return e?.american_name || e?.arabic_name || id || "—";
  };

  const scopedAgents = useMemo(() => {
    if (canItOnBehalf) {
      const fromApi = scopedEmpData?.employees || [];
      if (fromApi.length) return fromApi;
    }
    const active = employees.filter((e) => {
      const s = String(e.status || "active").toLowerCase();
      return s === "active" || s === "";
    });
    if (!canItOnBehalf) return active.filter((e) => e.id === selfEmpId);
    return active.filter((e) => e.id === selfEmpId);
  }, [employees, scopedEmpData?.employees, canItOnBehalf, selfEmpId]);

  const items = data?.requests || [];
  const itUsers = itUsersData?.itUsers || [];

  const openNew = useCallback(() => {
    setNewForm({
      employeeId: selfEmpId,
      issueType: "",
      description: "",
      category: "hardware",
      urgency: "normal",
    });
    setNewOpen(true);
  }, [selfEmpId]);

  useEffect(() => {
    if (searchParams.get("action") !== "new" || !canSubmit) return;
    openNew();
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, canSubmit, openNew]);

  const create = useMutation({
    mutationFn: () => {
      const employeeId = (canItOnBehalf ? newForm.employeeId : selfEmpId) || selfEmpId;
      const descParts = [newForm.issueType, newForm.description.trim()].filter(Boolean);
      const description = descParts.join("\n");
      const title = description.split(/\s+/).slice(0, 6).join(" ") || `IT request from ${employeeId}`;
      return api(path("/it-requests"), {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          title,
          description,
          category: newForm.category,
          urgency: newForm.urgency,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["it-requests"] });
      setNewOpen(false);
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, body, keepOpen }: { id: string; body: Record<string, unknown>; keepOpen?: boolean }) =>
      api(path(`/it-requests/${id}`), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["it-requests"] });
      setPatchError("");
      if (vars.keepOpen) {
        setSelected((prev) => {
          if (!prev || prev.id !== vars.id) return prev;
          return {
            ...prev,
            title: vars.body.title != null ? String(vars.body.title) : prev.title,
            category: vars.body.category != null ? String(vars.body.category) : prev.category,
            urgency: vars.body.urgency != null ? String(vars.body.urgency) : prev.urgency,
          };
        });
      } else {
        setSelected(null);
      }
      setResolveOpen(false);
      setAssignOpen(false);
      setEditOpen(false);
      setResolveNotes("");
      setAssignTo("");
    },
    onError: (e: Error) => setPatchError(e.message),
  });

  const openEdit = (it: ItRequest) => {
    setEditForm({
      title: it.title || "",
      category: it.category || "other",
      urgency: it.urgency || "normal",
    });
    setPatchError("");
    setEditOpen(true);
  };

  const saveEdit = () => {
    if (!selected) return;
    const title = editForm.title.trim();
    if (!title) {
      setPatchError("Title is required.");
      return;
    }
    patch.mutate({
      id: selected.id,
      keepOpen: true,
      body: {
        title,
        category: editForm.category,
        urgency: editForm.urgency,
      },
    });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api(path(`/it-requests/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["it-requests"] });
      setSelected(null);
    },
  });

  const deny = (id: string) => {
    const reason = window.prompt("Reason for denying this request (optional):") ?? "";
    patch.mutate({ id, body: { action: "deny", denialReason: reason } });
  };

  return (
    <div>
      <SectionHeader
        title="IT Requests"
        subtitle={`${items.length} tickets`}
        actions={canSubmit ? <Button onClick={openNew}>+ New request</Button> : undefined}
      />

      {canViewFilters && (
        <div className={styles.tabs}>
          {["", "open", "in_progress", "resolved", "closed"].map((s) => (
            <button
              key={s || "all"}
              type="button"
              className={`${styles.tab} ${statusFilter === s ? styles.tabActive : ""}`}
              onClick={() => {
                if (s) searchParams.set("status", s);
                else searchParams.delete("status");
                setSearchParams(searchParams);
              }}
            >
              {s ? STATUS_LABELS[s] : "All"}
            </button>
          ))}
        </div>
      )}

      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && !items.length && <p className="muted">No IT requests found.</p>}

      <div className={styles.grid}>
        {items.map((it) => (
          <Card key={it.id} className={`interactive ${styles.card}`} onClick={() => setSelected(it)}>
            <div className={styles.cardHeader}>
              <strong>{it.title || it.id}</strong>
              <StatusPill variant={it.status === "open" ? "warn" : it.status === "in_progress" ? "ok" : "muted"}>
                {STATUS_LABELS[String(it.status)] || String(it.status)}
              </StatusPill>
            </div>
            <p className="muted">
              {URGENCY_LABELS[String(it.urgency)] || String(it.urgency || "normal")} · {String(it.category || "—")}
              {it.unit ? ` · ${it.unit}` : ""}
            </p>
            <p className={styles.desc}>{String(it.description || "").slice(0, 120)}</p>
            <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
              {empName(it.employeeId)} · opened {formatWhen(it.createdAt)}
              {it.assignedTo ? ` · assigned ${it.assignedTo}` : ""}
            </p>
          </Card>
        ))}
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.title || "IT Request"}
        wide
        footer={
          <div className={styles.dialogActions}>
            {selected && canEditTicket(selected, selfEmpId, canAssign) && (
              <Button variant="secondary" onClick={() => openEdit(selected)}>Edit</Button>
            )}
            {canDelete && (
              <Button variant="danger" onClick={() => {
                if (confirm("Delete this ticket?")) remove.mutate(String(selected?.id));
              }}>Delete</Button>
            )}
            {canAssign && selected && !selected.assignedTo && selected.status === "open" && (
              <Button variant="secondary" onClick={() => {
                setAssignTo(username);
                patch.mutate({ id: selected.id, body: { assignedTo: username } });
              }}>Grab</Button>
            )}
            {canAssign && selected && (
              <Button variant="secondary" onClick={() => setAssignOpen(true)}>Assign</Button>
            )}
            {canApprove && selected?.status === "open" && (
              <>
                <Button onClick={() => patch.mutate({ id: String(selected?.id), body: { action: "approve" } })}>Approve</Button>
                <Button variant="danger" onClick={() => deny(String(selected?.id))}>Deny</Button>
              </>
            )}
            {canResolve && (selected?.status === "open" || selected?.status === "in_progress") && (
              <Button onClick={() => setResolveOpen(true)}>Resolve</Button>
            )}
            {canAssign && (selected?.status === "resolved" || selected?.status === "closed") && (
              <Button variant="secondary" onClick={() => patch.mutate({ id: String(selected?.id), body: { status: "open" } })}>Reopen</Button>
            )}
            <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
          </div>
        }
      >
        {selected && (
          <div className={styles.detail}>
            <p><strong>Status:</strong> {STATUS_LABELS[String(selected.status)] || String(selected.status)}</p>
            <p><strong>Urgency:</strong> {URGENCY_LABELS[String(selected.urgency)] || String(selected.urgency)}</p>
            <p><strong>Category:</strong> {String(selected.category)}</p>
            <p><strong>Requester:</strong> {empName(selected.employeeId)} ({selected.employeeId})</p>
            <p><strong>Unit:</strong> {selected.unit || "—"}</p>
            <p><strong>Assigned to:</strong> {selected.assignedTo || "Unassigned"}</p>
            <p><strong>Opened:</strong> {formatWhen(selected.createdAt)}</p>
            {selected.resolvedAt && <p><strong>Resolved:</strong> {formatWhen(selected.resolvedAt)}</p>}
            {selected.approvedBy && <p><strong>Approved by:</strong> {selected.approvedBy}</p>}
            {selected.deniedBy && <p><strong>Denied by:</strong> {selected.deniedBy}</p>}
            <p><strong>Description:</strong></p>
            <p style={{ whiteSpace: "pre-wrap" }}>{selected.description || "—"}</p>
            {selected.denialReason && <p style={{ color: "var(--err)" }}>Denied: {selected.denialReason}</p>}
            {selected.resolutionNotes && <p><strong>Resolution:</strong> {selected.resolutionNotes}</p>}
            {patchError && <p style={{ color: "var(--err)", margin: 0 }}>{patchError}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit IT request"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={!editForm.title.trim() || patch.isPending}>
              {patch.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <label>
            <span className="muted">Title</span>
            <input
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            />
          </label>
          <label>
            <span className="muted">Category</span>
            <select
              value={editForm.category}
              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted">Urgency</span>
            <select
              value={editForm.urgency}
              onChange={(e) => setEditForm({ ...editForm, urgency: e.target.value })}
            >
              {Object.entries(URGENCY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          {patchError && <p style={{ color: "var(--err)", margin: 0 }}>{patchError}</p>}
        </div>
      </Dialog>

      <Dialog open={newOpen} onOpenChange={setNewOpen} title="New IT request" footer={
        <>
          <Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!selfEmpId || create.isPending}>
            {create.isPending ? "Submitting…" : "Submit"}
          </Button>
        </>
      }>
        <div className={styles.form}>
          {canItOnBehalf && (
            <label>
              <span className="muted">On behalf of</span>
              <select value={newForm.employeeId} onChange={(e) => setNewForm({ ...newForm, employeeId: e.target.value })}>
                <option value={selfEmpId}>Myself ({selfEmpId})</option>
                {scopedAgents.filter((e) => e.id !== selfEmpId).map((e) => (
                  <option key={e.id} value={e.id}>{e.american_name || e.id} ({e.id})</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span className="muted">Category</span>
            <select value={newForm.category} onChange={(e) => setNewForm({ ...newForm, category: e.target.value })}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted">Common issue</span>
            <select value={newForm.issueType} onChange={(e) => setNewForm({ ...newForm, issueType: e.target.value })}>
              <option value="">— Select —</option>
              {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            <span className="muted">Urgency</span>
            <select value={newForm.urgency} onChange={(e) => setNewForm({ ...newForm, urgency: e.target.value })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            <span className="muted">Description</span>
            <textarea value={newForm.description} onChange={(e) => setNewForm({ ...newForm, description: e.target.value })} rows={4} placeholder="Steps to reproduce, error messages, affected device…" />
          </label>
        </div>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen} title="Assign ticket" footer={
        <>
          <Button variant="secondary" onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button disabled={!assignTo || !selected} onClick={() => {
            if (!selected) return;
            patch.mutate({ id: selected.id, body: { action: "reassign", assignedTo: assignTo } });
          }}>Assign</Button>
        </>
      }>
        <label>
          <span className="muted">IT staff</span>
          <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">— Select —</option>
            {itUsers.map((u) => (
              <option key={u.username} value={u.username}>{u.displayName || u.username}</option>
            ))}
          </select>
        </label>
      </Dialog>

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen} title="Resolve ticket" footer={
        <>
          <Button variant="secondary" onClick={() => setResolveOpen(false)}>Cancel</Button>
          <Button disabled={!selected} onClick={() => {
            if (!selected) return;
            patch.mutate({
              id: selected.id,
              body: { status: "resolved", resolutionNotes: resolveNotes.trim() },
            });
          }}>Mark resolved</Button>
        </>
      }>
        <label>
          <span className="muted">Resolution notes</span>
          <textarea value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} rows={4} placeholder="What was fixed, parts replaced, follow-up needed…" />
        </label>
      </Dialog>
    </div>
  );
}
