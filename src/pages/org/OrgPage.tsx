import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { StatusPill } from "@/ui/StatusPill";
import { useInspectorStore } from "@/stores/cross-filter-store";
import { InspectorDetail } from "@/ui/InspectorDetail";
import { Dialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { confirmAddTl, confirmAddCloser, tlCandidates, closerCandidates, opCandidates, opIdsForUnit, checkerCandidates, checkerIdsForUnit } from "./orgHelpers";
import { canManageOrgPage } from "./orgAccess";
import { OrgStructureEditor } from "./OrgStructureEditor";
import type { Agent, Employee, TeamMeta, UnitSection } from "./orgTypes";
import styles from "./OrgPage.module.css";

function empName(employees: Employee[], id: string, nameOnly = false) {
  const e = employees.find((x) => x.id === id);
  if (!e) return id || "—";
  const name = e.american_name || e.arabic_name || e.id;
  return nameOnly ? name : `${e.id} — ${name}`;
}

function TeamSelect({
  value,
  teamNames,
  onChange,
  className,
}: {
  value: string;
  teamNames: string[];
  onChange: (teamName: string) => void;
  className?: string;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Select
        className={className || styles.teamSelect}
        value={value}
        onChange={onChange}
        options={[{ value: "", label: "—" }, ...teamNames.map((tn) => ({ value: tn, label: tn }))]}
      />
    </div>
  );
}

export function OrgPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const openInspector = useInspectorStore((s) => s.openInspector);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [approveRegTarget, setApproveRegTarget] = useState<Record<string, unknown> | null>(null);
  const [approveTeam, setApproveTeam] = useState("");
  const [approveUnit, setApproveUnit] = useState("");
  const [editRegTarget, setEditRegTarget] = useState<Record<string, unknown> | null>(null);
  const [editRegForm, setEditRegForm] = useState({
    americanName: "",
    legalName: "",
    phone: "",
    email: "",
    unit: "",
    team: "",
  });

  const { user: statusUser } = useAppStatus();

  const { data, isLoading, error } = useQuery({
    queryKey: ["org-full", companyContext],
    queryFn: async () => {
      const [structure, empData, teamsRes, mgrRes] = await Promise.all([
        api<{ units?: UnitSection[]; unassigned?: Agent[] }>(path("/hrms/org-structure")),
        api<{ employees: Employee[] }>(path("/employees")).catch(() => ({ employees: [] })),
        api<{ teams?: TeamMeta[]; orgUnits?: string[] }>(path("/hrms/teams")).catch(() => ({ teams: [] })),
        api<{ managers?: { unit: string; opEmployeeId?: string }[]; teamTls?: Record<string, string[]>; teamClosers?: Record<string, string[]>; unitOps?: Record<string, string[]>; unitCheckers?: Record<string, string[]> }>(path("/org/managers")),
      ]);
      return {
        structure,
        employees: empData.employees || [],
        teams: teamsRes.teams || [],
        orgUnits: teamsRes.orgUnits || [],
        mgr: mgrRes,
      };
    },
  });

  const employees = data?.employees || [];
  const unitOps = data?.mgr?.unitOps || {};
  const unitCheckers = data?.mgr?.unitCheckers || {};
  const managers = data?.mgr?.managers || [];
  const teamTls = data?.mgr?.teamTls || {};
  const teamClosers = data?.mgr?.teamClosers || {};
  const allTeams = data?.teams || [];
  const defaultOrgUnits =
    companyContext === "hs2" ? ["HS-2"] : ["HS-1", "HS-3", "HS-Back-End", "HS-MGMT"];
  const orgUnits = [
    ...new Set([
      ...(data?.orgUnits || []),
      ...defaultOrgUnits,
      ...allTeams.map((t) => t.unit || "").filter(Boolean),
    ]),
  ];

  const invalidateOrg = () => {
    qc.invalidateQueries({ queryKey: ["org-full"] });
    qc.invalidateQueries({ queryKey: ["employees-list"] });
  };

  const { data: pinData } = useQuery({
    queryKey: ["daily-pin", companyContext],
    queryFn: () => api<{ registrationCode?: string; date?: string }>(path("/registration/daily-pin")),
    enabled: ["op", "rtm", "hr", "admin", "ceo", "quality"].includes(String(statusUser?.role || "").toLowerCase()),
  });

  const { data: pendingRegs, refetch: refetchPendingRegs } = useQuery({
    queryKey: ["pending-regs", companyContext],
    queryFn: () => api<{ pending?: Record<string, unknown>[] }>(path("/registration/pending")),
    enabled: ["op", "admin", "hr", "ceo"].includes(String(statusUser?.role || "").toLowerCase()),
    refetchOnWindowFocus: true,
  });

  const approveReg = useMutation({
    mutationFn: ({ id, team, unit }: { id: string; team?: string; unit?: string }) =>
      api(path(`/registration/${id}/approve`), {
        method: "POST",
        body: JSON.stringify({ team: team || "", unit: unit || "" }),
      }),
    onSuccess: () => {
      setApproveRegTarget(null);
      setApproveTeam("");
      setApproveUnit("");
      qc.invalidateQueries({ queryKey: ["pending-regs"] });
      qc.invalidateQueries({ queryKey: ["registration-pending"] });
      invalidateOrg();
    },
  });

  const rejectReg = useMutation({
    mutationFn: (id: string) => api(path(`/registration/${id}/reject`), { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-regs"] });
      qc.invalidateQueries({ queryKey: ["registration-pending"] });
    },
  });

  const patchReg = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      api(path(`/registration/${id}`), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      setEditRegTarget(null);
      qc.invalidateQueries({ queryKey: ["pending-regs"] });
      qc.invalidateQueries({ queryKey: ["registration-pending"] });
      toast.success("Registration updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update registration"),
  });

  const addOp = useMutation({
    mutationFn: ({ unit, employeeId }: { unit: string; employeeId: string }) =>
      api(path(`/org/unit-ops/${encodeURIComponent(unit)}`), { method: "POST", body: JSON.stringify({ employeeId }) }),
    onSuccess: () => {
      toast.success("OP assigned");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add OP"),
  });

  const removeOp = useMutation({
    mutationFn: ({ unit, employeeId }: { unit: string; employeeId: string }) =>
      api(path(`/org/unit-ops/${encodeURIComponent(unit)}/${encodeURIComponent(employeeId)}`), { method: "DELETE" }),
    onSuccess: invalidateOrg,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove OP"),
  });

  const addChecker = useMutation({
    mutationFn: ({ unit, employeeId }: { unit: string; employeeId: string }) =>
      api(path(`/org/unit-checkers/${encodeURIComponent(unit)}`), { method: "POST", body: JSON.stringify({ employeeId }) }),
    onSuccess: () => {
      toast.success("Checker assigned");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add checker"),
  });

  const removeChecker = useMutation({
    mutationFn: ({ unit, employeeId }: { unit: string; employeeId: string }) =>
      api(path(`/org/unit-checkers/${encodeURIComponent(unit)}/${encodeURIComponent(employeeId)}`), { method: "DELETE" }),
    onSuccess: invalidateOrg,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove checker"),
  });

  const addTl = useMutation({
    mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
      api(path(`/org/team-tls/${teamId}`), { method: "POST", body: JSON.stringify({ employeeId }) }),
    onSuccess: () => {
      toast.success("Team leader assigned");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not assign TL"),
  });

  const removeTl = useMutation({
    mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
      api(path(`/org/team-tls/${teamId}/${encodeURIComponent(employeeId)}`), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Team leader removed");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove TL"),
  });

  const addCloser = useMutation({
    mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
      api(path(`/org/team-closers/${teamId}`), { method: "POST", body: JSON.stringify({ employeeId }) }),
    onSuccess: () => {
      toast.success("Closer assigned");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not assign closer"),
  });

  const removeCloser = useMutation({
    mutationFn: ({ teamId, employeeId }: { teamId: string; employeeId: string }) =>
      api(path(`/org/team-closers/${teamId}/${encodeURIComponent(employeeId)}`), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Closer removed");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove closer"),
  });

  const assignTeam = useMutation({
    mutationFn: async ({ empId, teamName }: { empId: string; teamName: string }) => {
      const teamMeta = allTeams.find((t) => t.name === teamName);
      const emp = employees.find((e) => e.id === empId);
      const patch: Record<string, string> = { team: teamName };
      if (teamName && teamMeta?.unit && emp && teamMeta.unit !== emp.unit) {
        if (
          !confirm(
            `Team "${teamName}" belongs to ${teamMeta.unit}, but employee is on ${emp.unit || "?"}. Update employee unit to ${teamMeta.unit}?`
          )
        ) {
          throw new Error("cancelled");
        }
        patch.unit = teamMeta.unit;
      }
      return api(path(`/employees/${empId}`), {
        method: "PUT",
        body: JSON.stringify({
          ...patch,
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      });
    },
    onSuccess: () => {
      toast.success("Team updated");
      invalidateOrg();
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "cancelled") return;
      toast.error(err instanceof Error ? err.message : "Could not change team");
    },
  });

  const toggleDials = useMutation({
    mutationFn: ({ teamId, dialsSales }: { teamId: string; dialsSales: boolean }) =>
      api(path(`/hrms/teams/${teamId}`), {
        method: "PATCH",
        body: JSON.stringify({ dialsSales }),
      }),
    onSuccess: (_data, vars) => {
      toast.success(vars.dialsSales ? "Marked as dialing team" : "Marked as non-dialing team");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update dialing flag"),
  });

  const relocateTeam = useMutation({
    mutationFn: ({
      teamId,
      unit,
      reassignIds,
    }: {
      teamId: string;
      unit: string;
      reassignIds: boolean;
    }) =>
      api<{ changes?: { from: string; to: string }[]; skipped?: unknown[] }>(
        path(`/hrms/teams/${teamId}/relocate`),
        {
          method: "POST",
          body: JSON.stringify({ unit, reassignIds }),
        }
      ),
    onSuccess: (res) => {
      const moved = res?.changes?.length || 0;
      toast.success(moved ? `Team moved · ${moved} agent update(s)` : "Team moved");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not move team"),
  });

  const deleteTeam = useMutation({
    mutationFn: (teamId: string) =>
      api<{ clearedEmployeeIds?: string[] }>(path(`/hrms/teams/${teamId}`), { method: "DELETE" }),
    onSuccess: (res) => {
      const n = res?.clearedEmployeeIds?.length || 0;
      toast.success(n ? `Team deleted · ${n} agent(s) unassigned` : "Team deleted");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not delete team"),
  });

  const createTeam = useMutation({
    mutationFn: (payload: { name: string; unit: string; dialsSales: boolean }) =>
      api(path("/hrms/teams"), {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Team created");
      invalidateOrg();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create team"),
  });

  const canApproveReg = ["op", "admin", "hr", "ceo"].includes(String(statusUser?.role || "").toLowerCase());
  const registrationCode = pinData?.registrationCode;
  const pendingList = pendingRegs?.pending || [];
  const companyUnits = companyContext === "hs2" ? ["HS-2"] : ["HS-1", "HS-3"];
  const approveTeamOptions = allTeams.filter((t) => t.unit === approveUnit).map((t) => t.name).filter(Boolean);
  const editTeamOptions = allTeams.filter((t) => t.unit === editRegForm.unit).map((t) => t.name).filter(Boolean);
  const orgBusy =
    addTl.isPending ||
    removeTl.isPending ||
    addCloser.isPending ||
    removeCloser.isPending ||
    assignTeam.isPending ||
    toggleDials.isPending ||
    relocateTeam.isPending ||
    deleteTeam.isPending ||
    createTeam.isPending;

  const canManage = canManageOrgPage(statusUser);

  const teamNames = useMemo(
    () => [...new Set(allTeams.map((t) => t.name).filter(Boolean))].sort(),
    [allTeams]
  );

  const teamMetaByName = useMemo(() => {
    const m = new Map<string, TeamMeta>();
    allTeams.forEach((t) => m.set(t.name, t));
    return m;
  }, [allTeams]);

  const handleAssignTeam = (empId: string, teamName: string, revert?: () => void) => {
    assignTeam.mutate(
      { empId, teamName },
      { onError: () => revert?.() }
    );
  };

  const handleAddTlDirect = (teamId: string, teamName: string, employeeId: string) => {
    if (!employeeId || !teamId) return;
    addTl.mutate({ teamId, employeeId });
  };

  if (isLoading) {
    return (
      <div>
        <SectionHeader title="Organization" subtitle="Units, teams, and hierarchy" />
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader title="Organization" subtitle="Units, teams, and hierarchy" />
        <p style={{ color: "var(--err)" }}>{error instanceof Error ? error.message : "Could not load organization"}</p>
      </div>
    );
  }

  const units = data?.structure?.units || [];
  const unassigned = data?.structure?.unassigned || [];

  return (
    <div>
      <SectionHeader
        title="Organization"
        subtitle="Unit → Team → Agent · OP manages unit · TL leads team · Closers submit sales/IT for team"
        actions={
          canManage ? (
            <Button onClick={() => setEditOpen(true)}>Edit teams, TLs &amp; closers</Button>
          ) : undefined
        }
      />

      {canManage && (
        <OrgStructureEditor
          open={editOpen}
          onOpenChange={setEditOpen}
          employees={employees}
          allTeams={allTeams}
          orgUnits={orgUnits}
          teamTls={teamTls}
          teamClosers={teamClosers}
          busy={orgBusy}
          onAssignTeam={handleAssignTeam}
          onAddTl={handleAddTlDirect}
          onRemoveTl={(teamId, employeeId) => removeTl.mutate({ teamId, employeeId })}
          onAddCloser={(teamId, _teamName, employeeId) => addCloser.mutate({ teamId, employeeId })}
          onRemoveCloser={(teamId, employeeId) => removeCloser.mutate({ teamId, employeeId })}
          onToggleDials={(teamId, dialsSales) => toggleDials.mutate({ teamId, dialsSales })}
          onRelocateTeam={(teamId, unit, reassignIds) =>
            relocateTeam.mutate({ teamId, unit, reassignIds })
          }
          onDeleteTeam={(teamId) => deleteTeam.mutate(teamId)}
          onCreateTeam={(payload) => createTeam.mutate(payload)}
        />
      )}

      {registrationCode && (
        <Card style={{ marginBottom: "1rem" }}>
          <strong>Today&apos;s agent registration code</strong>
          <span className="muted" style={{ marginLeft: "0.5rem" }}>({pinData?.date || "today"})</span>
          <div style={{ fontSize: "1.35rem", letterSpacing: "0.15em", marginTop: "0.5rem" }}>{registrationCode}</div>
          <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
            Share this code with new agents only — do not mention company names.
          </p>
        </Card>
      )}

      {canApproveReg && (
        <Card style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3 style={{ margin: 0 }}>Pending registrations ({pendingList.length})</h3>
            <Button size="sm" variant="secondary" onClick={() => refetchPendingRegs()}>Refresh</Button>
          </div>
          {pendingList.length > 0 ? (
          <div className="table-wrap">
            <table className={styles.agentTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Phone</th>
                  <th>Company</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingList.map((p) => (
                  <tr key={String(p.id)}>
                    <td>{String(p.americanName || p.fullName || "—")}</td>
                    <td>{String(p.unit || "—")}</td>
                    <td>{String(p.phone || "—")}</td>
                    <td>{p.company === "hs2" ? "HS-2" : "Hang-Up"}</td>
                    <td>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditRegTarget(p);
                          setEditRegForm({
                            americanName: String(p.americanName || ""),
                            legalName: String(p.legalName || p.arabicName || p.fullName || ""),
                            phone: String(p.phone || ""),
                            email: String(p.email || ""),
                            unit: String(p.unit || companyUnits[0] || "HS-3"),
                            team: String(p.team || ""),
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setApproveRegTarget(p);
                          setApproveUnit(String(p.unit || companyUnits[0] || "HS-3"));
                          setApproveTeam(String(p.team || ""));
                        }}
                      >
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => rejectReg.mutate(String(p.id))}>Reject</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : (
            <p className="muted">No pending registrations right now.</p>
          )}
        </Card>
      )}

      {units.map((section) => {
        const opIds = opIdsForUnit(section.unit, unitOps, managers);
        const checkerIds = checkerIdsForUnit(section.unit, unitCheckers);
        return (
          <Card key={section.unit} style={{ marginBottom: "1rem" }}>
            <div className={styles.unitHeader}>
              <h2>{section.unit}</h2>
              <div className={styles.unitMeta}>
              <div className={styles.chips}>
                <span className="muted">OPs:</span>
                {opIds.length ? opIds.map((id) => (
                  <span key={id} className={styles.chip}>
                    {empName(employees, id, true)}
                    {canManage && (
                      <button
                        type="button"
                        className={styles.chipRemove}
                        title="Remove OP"
                        onClick={() => {
                          if (confirm(`Remove ${empName(employees, id, true)} as OP for ${section.unit}?`)) {
                            removeOp.mutate({ unit: section.unit, employeeId: id });
                          }
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                )) : <span className="muted">—</span>}
                {canManage && (
                  <Select
                    className={styles.addSelect}
                    value=""
                    onChange={(employeeId) => {
                      if (employeeId) addOp.mutate({ unit: section.unit, employeeId });
                    }}
                    options={[
                      { value: "", label: "+ Add OP" },
                      ...opCandidates(section.unit, employees).map((emp) => ({
                        value: emp.id,
                        label: `${emp.id} — ${emp.american_name || emp.id}${emp.unit && emp.unit !== section.unit ? ` (${emp.unit})` : ""}`,
                      })),
                    ]}
                    placeholder="+ Add OP"
                  />
                )}
              </div>
              <div className={styles.chips}>
                <span className="muted">Checkers:</span>
                {checkerIds.length ? checkerIds.map((id) => (
                  <span key={id} className={styles.chip}>
                    {empName(employees, id, true)}
                    {canManage && (
                      <button
                        type="button"
                        className={styles.chipRemove}
                        title="Remove checker"
                        onClick={() => {
                          if (confirm(`Remove ${empName(employees, id, true)} as checker for ${section.unit}?`)) {
                            removeChecker.mutate({ unit: section.unit, employeeId: id });
                          }
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                )) : <span className="muted">—</span>}
                {canManage && (
                  <Select
                    className={styles.addSelect}
                    value=""
                    onChange={(employeeId) => {
                      if (employeeId) addChecker.mutate({ unit: section.unit, employeeId });
                    }}
                    options={[
                      { value: "", label: "+ Add checker" },
                      ...checkerCandidates(section.unit, employees).map((emp) => ({
                        value: emp.id,
                        label: `${emp.id} — ${emp.american_name || emp.id}${emp.unit && emp.unit !== section.unit ? ` (${emp.unit})` : ""}`,
                      })),
                    ]}
                    placeholder="+ Add checker"
                  />
                )}
              </div>
              </div>
            </div>

            <div className={styles.teamStack}>
              {(section.teams || []).map((team) => {
                const meta = teamMetaByName.get(team.name);
                const tlIds = [...new Set([meta?.tlEmployeeId || "", ...(teamTls[meta?.id || ""] || [])].filter(Boolean))];
                const closerIds = [...new Set([...(meta?.closerEmployeeIds || []), ...(teamClosers[meta?.id || ""] || [])].filter(Boolean))];
                const open = expandedTeams.has(team.name);
                const tlOpts = tlCandidates(team.name, employees, allTeams);
                const closerOpts = closerCandidates(team.name, meta?.unit, employees);
                return (
                  <details
                    key={team.name}
                    className={styles.teamCard}
                    open={open}
                    onToggle={(e) => {
                      const next = new Set(expandedTeams);
                      if ((e.target as HTMLDetailsElement).open) next.add(team.name);
                      else next.delete(team.name);
                      setExpandedTeams(next);
                    }}
                  >
                    <summary className={styles.teamSummary}>
                      <span>
                        <strong>{team.name}</strong>
                        {team.dialsSales === false && <StatusPill variant="muted">No dial</StatusPill>}
                        <span className="muted"> ({(team.agents || []).length} agents)</span>
                      </span>
                      <span className={styles.chips} onClick={(e) => e.preventDefault()}>
                        <span className="muted">TLs:</span>
                        {tlIds.length ? tlIds.map((id) => (
                          <span key={id} className={styles.chip}>
                            {empName(employees, id, true)}
                            {canManage && meta?.id && (
                              <button
                                type="button"
                                className={styles.chipRemove}
                                title="Remove TL"
                                onClick={() => {
                                  if (confirm(`Remove ${empName(employees, id, true)} as TL from this team?`)) {
                                    removeTl.mutate({ teamId: meta.id, employeeId: id });
                                  }
                                }}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        )) : <span className="muted">—</span>}
                        {canManage && meta?.id && (
                          <div onClick={(e) => e.stopPropagation()}>
                          <Select
                            className={styles.addSelect}
                            value=""
                            onChange={(employeeId) => {
                              if (!employeeId) return;
                              if (!confirmAddTl(employeeId, team.name, employees, allTeams)) return;
                              handleAddTlDirect(meta.id, team.name, employeeId);
                            }}
                            options={[
                              { value: "", label: "+ Add TL" },
                              ...tlOpts.onTeam.map((e) => ({ value: e.id, label: `On team · ${e.id} — ${e.american_name || e.id}` })),
                              ...tlOpts.otherTls.map((e) => ({ value: e.id, label: `Other TLs · ${e.id} — ${e.american_name || e.id}` })),
                              ...tlOpts.agents.map((e) => ({ value: e.id, label: `Agent · ${e.id} — ${e.american_name || e.id}` })),
                            ]}
                            placeholder="+ Add TL"
                          />
                          </div>
                        )}
                        <span className="muted" style={{ marginLeft: "0.5rem" }}>Closers:</span>
                        {closerIds.length ? closerIds.map((id) => (
                          <span key={id} className={styles.chip}>
                            {empName(employees, id, true)}
                            {canManage && meta?.id && (
                              <button
                                type="button"
                                className={styles.chipRemove}
                                title="Remove closer"
                                onClick={() => {
                                  if (confirm(`Remove ${empName(employees, id, true)} as closer from this team?`)) {
                                    removeCloser.mutate({ teamId: meta.id, employeeId: id });
                                  }
                                }}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        )) : <span className="muted">—</span>}
                        {canManage && meta?.id && (
                          <div onClick={(e) => e.stopPropagation()}>
                          <Select
                            className={styles.addSelect}
                            value=""
                            onChange={(employeeId) => {
                              if (!employeeId) return;
                              if (!confirmAddCloser(employeeId, team.name, employees)) return;
                              addCloser.mutate({ teamId: meta.id, employeeId });
                            }}
                            options={[
                              { value: "", label: "+ Add closer" },
                              ...closerOpts
                                .filter((e) => !closerIds.includes(e.id))
                                .map((e) => ({ value: e.id, label: `${e.id} — ${e.american_name || e.id}` })),
                            ]}
                            placeholder="+ Add closer"
                          />
                          </div>
                        )}
                      </span>
                    </summary>
                    <table className={styles.agentTable}>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Name</th>
                          <th>Position</th>
                          {canManage && <th>Team</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(team.agents || []).map((a) => (
                          <tr
                            key={a.id}
                            className={styles.clickable}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("select")) return;
                              const emp = employees.find((x) => x.id === a.id) || a;
                              openInspector(String(a.name || a.id), <InspectorDetail row={emp as Record<string, unknown>} />);
                            }}
                          >
                            <td>{a.id}</td>
                            <td>{a.name}</td>
                            <td>{a.position || "—"}</td>
                            {canManage && (
                              <td>
                                <TeamSelect
                                  value={team.name}
                                  teamNames={teamNames}
                                  onChange={(teamName) => {
                                    if (teamName === team.name) return;
                                    handleAssignTeam(a.id, teamName);
                                  }}
                                />
                              </td>
                            )}
                          </tr>
                        ))}
                        {!(team.agents || []).length && (
                          <tr><td colSpan={canManage ? 4 : 3} className="muted">No agents</td></tr>
                        )}
                      </tbody>
                    </table>
                  </details>
                );
              })}
              {!(section.teams || []).length && <p className="muted">No teams in this unit.</p>}
            </div>
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <Card>
          <h3>Unassigned (no team)</h3>
          <table className={styles.agentTable}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                {canManage && <th>Assign team</th>}
              </tr>
            </thead>
            <tbody>
              {unassigned.map((a) => (
                <tr
                  key={a.id}
                  className={styles.clickable}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("select")) return;
                    openInspector(a.name, <InspectorDetail row={a as Record<string, unknown>} />);
                  }}
                >
                  <td>{a.id}</td>
                  <td>{a.name}</td>
                  {canManage && (
                    <td>
                      <TeamSelect
                        value=""
                        teamNames={teamNames}
                        onChange={(teamName) => handleAssignTeam(a.id, teamName)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={approveRegTarget !== null}
        onOpenChange={(o) => { if (!o) { setApproveRegTarget(null); setApproveTeam(""); setApproveUnit(""); } }}
        title="Approve registration"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setApproveRegTarget(null); setApproveTeam(""); setApproveUnit(""); }}>Cancel</Button>
            <Button
              onClick={() => approveRegTarget && approveReg.mutate({ id: String(approveRegTarget.id), team: approveTeam, unit: approveUnit })}
              disabled={approveReg.isPending}
            >
              Approve
            </Button>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Creates employee + active login for <strong>{String(approveRegTarget?.americanName || approveRegTarget?.fullName || "")}</strong>.
          The employee ID prefix comes from the unit you select (HS-1 → HS1-…). Assign a team now or later.
        </p>
        <FormGrid>
          <FormField label="Unit">
            <Select
              value={approveUnit}
              onChange={(v) => {
                setApproveUnit(v);
                setApproveTeam("");
              }}
              options={companyUnits.map((u) => ({ value: u, label: u }))}
            />
          </FormField>
          <FormField label="Team (optional)">
            <Select
              value={approveTeam}
              onChange={setApproveTeam}
              options={[
                { value: "", label: "— Unassigned (assign later) —" },
                ...approveTeamOptions.map((name) => ({ value: name, label: name })),
              ]}
            />
          </FormField>
        </FormGrid>
      </Dialog>

      <Dialog
        open={editRegTarget !== null}
        onOpenChange={(o) => { if (!o) setEditRegTarget(null); }}
        title="Edit pending registration"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditRegTarget(null)}>Cancel</Button>
            <Button
              onClick={() =>
                editRegTarget &&
                patchReg.mutate({
                  id: String(editRegTarget.id),
                  body: {
                    americanName: editRegForm.americanName,
                    legalName: editRegForm.legalName,
                    phone: editRegForm.phone,
                    email: editRegForm.email,
                    unit: editRegForm.unit,
                    team: editRegForm.team,
                  },
                })
              }
              disabled={patchReg.isPending}
            >
              Save
            </Button>
          </>
        }
      >
        <FormGrid>
          <FormField label="American name">
            <input
              value={editRegForm.americanName}
              onChange={(e) => setEditRegForm((f) => ({ ...f, americanName: e.target.value }))}
            />
          </FormField>
          <FormField label="Legal name">
            <input
              value={editRegForm.legalName}
              onChange={(e) => setEditRegForm((f) => ({ ...f, legalName: e.target.value }))}
            />
          </FormField>
          <FormField label="Phone">
            <input
              value={editRegForm.phone}
              onChange={(e) => setEditRegForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </FormField>
          <FormField label="Email">
            <input
              value={editRegForm.email}
              onChange={(e) => setEditRegForm((f) => ({ ...f, email: e.target.value }))}
            />
          </FormField>
          <FormField label="Unit">
            <Select
              value={editRegForm.unit}
              onChange={(v) => setEditRegForm((f) => ({ ...f, unit: v, team: "" }))}
              options={companyUnits.map((u) => ({ value: u, label: u }))}
            />
          </FormField>
          <FormField label="Team (optional)">
            <Select
              value={editRegForm.team}
              onChange={(v) => setEditRegForm((f) => ({ ...f, team: v }))}
              options={[
                { value: "", label: "— Unassigned —" },
                ...editTeamOptions.map((name) => ({ value: name, label: name })),
              ]}
            />
          </FormField>
        </FormGrid>
      </Dialog>
    </div>
  );
}
