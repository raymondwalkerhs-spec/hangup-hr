import { useMemo, useState, useEffect } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { confirmAddTl, confirmAddCloser, tlCandidates, closerCandidates } from "./orgHelpers";
import type { Employee, TeamMeta } from "./orgTypes";
import styles from "./OrgStructureEditor.module.css";

function empLabel(emp: Employee | undefined) {
  if (!emp) return "—";
  return `${emp.id} — ${emp.american_name || emp.arabic_name || emp.id}`;
}

export function OrgStructureEditor({
  open,
  onOpenChange,
  employees,
  allTeams,
  orgUnits = [],
  teamTls,
  teamClosers,
  onAssignTeam,
  onAddTl,
  onRemoveTl,
  onAddCloser,
  onRemoveCloser,
  onToggleDials,
  onRelocateTeam,
  onDeleteTeam,
  onCreateTeam,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  allTeams: TeamMeta[];
  orgUnits?: string[];
  teamTls: Record<string, string[]>;
  teamClosers: Record<string, string[]>;
  onAssignTeam: (empId: string, teamName: string, revert?: () => void) => void;
  onAddTl: (teamId: string, teamName: string, employeeId: string) => void;
  onRemoveTl: (teamId: string, employeeId: string) => void;
  onAddCloser: (teamId: string, teamName: string, employeeId: string) => void;
  onRemoveCloser: (teamId: string, employeeId: string) => void;
  onToggleDials: (teamId: string, dialsSales: boolean) => void;
  onRelocateTeam: (teamId: string, unit: string, reassignIds: boolean) => void;
  onDeleteTeam: (teamId: string, teamName: string) => void;
  onCreateTeam: (payload: { name: string; unit: string; dialsSales: boolean }) => void;
  busy?: boolean;
}) {
  const [tab, setTab] = useState("manage");
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [manageUnitFilter, setManageUnitFilter] = useState("");
  const [tlTeamId, setTlTeamId] = useState("");
  const [closerTeamId, setCloserTeamId] = useState("");
  const [teamDraft, setTeamDraft] = useState<Record<string, string>>({});
  const [moveDraft, setMoveDraft] = useState<Record<string, string>>({});
  const [reassignIds, setReassignIds] = useState(true);
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newDials, setNewDials] = useState(true);

  useEffect(() => {
    if (!open) {
      setTeamDraft({});
      setMoveDraft({});
      setSearch("");
      setUnitFilter("");
      setManageUnitFilter("");
      setNewName("");
    }
  }, [open]);

  useEffect(() => {
    setTeamDraft({});
  }, [employees]);

  const teamNames = useMemo(
    () => [...new Set(allTeams.map((t) => t.name).filter(Boolean))].sort(),
    [allTeams]
  );

  const units = useMemo(() => {
    const fromTeams = allTeams.map((t) => t.unit).filter(Boolean) as string[];
    return [...new Set([...orgUnits, ...fromTeams])].sort();
  }, [allTeams, orgUnits]);

  const teamById = useMemo(() => {
    const m = new Map<string, TeamMeta>();
    allTeams.forEach((t) => m.set(t.id, t));
    return m;
  }, [allTeams]);

  const managedTeams = useMemo(() => {
    return [...allTeams]
      .filter((t) => !manageUnitFilter || t.unit === manageUnitFilter)
      .sort((a, b) => {
        const u = String(a.unit || "").localeCompare(String(b.unit || ""));
        if (u) return u;
        return String(a.name).localeCompare(String(b.name));
      });
  }, [allTeams, manageUnitFilter]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .filter((e) => String(e.status || "").toLowerCase() !== "deleted")
      .filter((e) => !unitFilter || e.unit === unitFilter)
      .filter((e) => {
        if (!q) return true;
        const hay = [e.id, e.american_name, e.arabic_name, e.team, e.unit].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => String(a.american_name || a.id).localeCompare(String(b.american_name || b.id)));
  }, [employees, search, unitFilter]);

  const selectedTeam = teamById.get(tlTeamId);
  const tlIds = selectedTeam
    ? [...new Set([selectedTeam.tlEmployeeId || "", ...(teamTls[selectedTeam.id] || [])].filter(Boolean))]
    : [];
  const tlOpts = selectedTeam ? tlCandidates(selectedTeam.name, employees, allTeams) : null;

  const selectedCloserTeam = teamById.get(closerTeamId);
  const closerIds = selectedCloserTeam
    ? [
        ...new Set([
          ...(selectedCloserTeam.closerEmployeeIds || []),
          ...(teamClosers[selectedCloserTeam.id] || []),
        ].filter(Boolean)),
      ]
    : [];
  const closerOpts = selectedCloserTeam
    ? closerCandidates(selectedCloserTeam.name, selectedCloserTeam.unit, employees)
    : [];

  const agentCountByTeam = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of employees) {
      if (!e.team) continue;
      if (String(e.status || "").toLowerCase() === "deleted") continue;
      m.set(e.team, (m.get(e.team) || 0) + 1);
    }
    return m;
  }, [employees]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit teams, TLs & closers"
      size="xlarge"
      scrollBody
    >
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className={styles.tabs}>
          <Tabs.Trigger value="manage" className={styles.tab}>
            Manage teams
          </Tabs.Trigger>
          <Tabs.Trigger value="teams" className={styles.tab}>
            Agent teams
          </Tabs.Trigger>
          <Tabs.Trigger value="tls" className={styles.tab}>
            Team leaders (TL)
          </Tabs.Trigger>
          <Tabs.Trigger value="closers" className={styles.tab}>
            Closers
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="manage" className={styles.panel}>
          <p className="muted">
            Delete a team, move it to another unit, or mark it as dialing / non-dialing. Moving can optionally
            reassign dialing agent IDs to the new unit prefix.
          </p>
          <div className={styles.toolbar}>
            <select
              className={styles.filter}
              value={manageUnitFilter}
              onChange={(e) => setManageUnitFilter(e.target.value)}
            >
              <option value="">All units</option>
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={reassignIds}
                onChange={(e) => setReassignIds(e.target.checked)}
              />
              Reassign agent IDs when moving
            </label>
          </div>

          <ul className={styles.manageList}>
            {managedTeams.map((t) => {
              const dialing = t.dialsSales !== false;
              const agentsOnTeam = agentCountByTeam.get(t.name) || 0;
              const moveTo = moveDraft[t.id] ?? "";
              return (
                <li key={t.id} className={styles.manageCard}>
                  <div className={styles.manageHead}>
                    <h3 className={styles.manageTitle}>
                      {t.name}
                      <span className="muted"> · {t.unit || "—"}</span>
                      <span className="muted"> · {agentsOnTeam} agent{agentsOnTeam === 1 ? "" : "s"}</span>
                    </h3>
                    <span className="muted">{dialing ? "Dialing team" : "Non-dialing"}</span>
                  </div>
                  <div className={styles.manageActions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onToggleDials(t.id, !dialing)}
                    >
                      {dialing ? "Mark non-dialing" : "Mark dialing"}
                    </Button>
                    <select
                      className={styles.inlineSelect}
                      value={moveTo}
                      disabled={busy}
                      aria-label={`Move ${t.name} to unit`}
                      onChange={(e) => setMoveDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                    >
                      <option value="">Move to unit…</option>
                      {units
                        .filter((u) => u !== t.unit)
                        .map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !moveTo}
                      onClick={() => {
                        if (!moveTo) return;
                        const idNote = reassignIds
                          ? " Dialing agents may get new IDs for the destination unit."
                          : "";
                        if (
                          !confirm(
                            `Move team "${t.name}" from ${t.unit || "?"} to ${moveTo}? Agents on the team will update to the new unit.${idNote}`
                          )
                        ) {
                          return;
                        }
                        onRelocateTeam(t.id, moveTo, reassignIds);
                        setMoveDraft((d) => {
                          const { [t.id]: _, ...rest } = d;
                          return rest;
                        });
                      }}
                    >
                      Move
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        const msg =
                          agentsOnTeam > 0
                            ? `Delete team "${t.name}"? ${agentsOnTeam} agent(s) will be unassigned from this team. TLs/closers on the team are removed. Sales history is kept.`
                            : `Delete team "${t.name}"? TLs/closers on the team are removed. Sales history is kept.`;
                        if (!confirm(msg)) return;
                        onDeleteTeam(t.id, t.name);
                        if (tlTeamId === t.id) setTlTeamId("");
                        if (closerTeamId === t.id) setCloserTeamId("");
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
            {!managedTeams.length && <li className="muted">No teams in this filter.</li>}
          </ul>

          <div className={styles.createRow}>
            <label className={styles.createField}>
              <span className="muted">New team name</span>
              <input
                value={newName}
                disabled={busy}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Jude"
              />
            </label>
            <label className={styles.createField}>
              <span className="muted">Unit</span>
              <select
                value={newUnit || units[0] || ""}
                disabled={busy}
                onChange={(e) => setNewUnit(e.target.value)}
              >
                {!units.length && <option value="">No units</option>}
                {units.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={newDials}
                disabled={busy}
                onChange={(e) => setNewDials(e.target.checked)}
              />
              Dialing team
            </label>
            <Button
              size="sm"
              disabled={busy || !newName.trim() || !(newUnit || units[0])}
              onClick={() => {
                const unit = newUnit || units[0];
                if (!newName.trim() || !unit) return;
                onCreateTeam({ name: newName.trim(), unit, dialsSales: newDials });
                setNewName("");
              }}
            >
              Create team
            </Button>
          </div>
        </Tabs.Content>

        <Tabs.Content value="teams" className={styles.panel}>
          <p className="muted">
            Change an agent&apos;s team from the dropdown. If the team is in another unit, you&apos;ll be asked to
            update the unit too.
          </p>
          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.search}
              placeholder="Search name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className={styles.filter} value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
              <option value="">All units</option>
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Team</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp) => {
                  const teamValue = teamDraft[emp.id] ?? emp.team ?? "";
                  return (
                    <tr key={emp.id}>
                      <td>{emp.id}</td>
                      <td>{emp.american_name || emp.arabic_name || "—"}</td>
                      <td>{emp.unit || "—"}</td>
                      <td>
                        <select
                          className={styles.select}
                          value={teamValue}
                          disabled={busy}
                          onChange={(e) => {
                            const next = e.target.value;
                            const prev = emp.team || "";
                            if (next === prev) return;
                            setTeamDraft((d) => ({ ...d, [emp.id]: next }));
                            onAssignTeam(emp.id, next, () => {
                              setTeamDraft((d) => {
                                const { [emp.id]: _, ...rest } = d;
                                return rest;
                              });
                            });
                          }}
                        >
                          <option value="">— Unassigned —</option>
                          {teamNames.map((tn) => (
                            <option key={tn} value={tn}>
                              {tn}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {!filteredEmployees.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No employees match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        <Tabs.Content value="tls" className={styles.panel}>
          <p className="muted">Pick a team, then add or remove team leaders (TLs).</p>
          <label className={styles.field}>
            <span className="muted">Team</span>
            <select className={styles.selectWide} value={tlTeamId} onChange={(e) => setTlTeamId(e.target.value)}>
              <option value="">Select team…</option>
              {allTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.unit ? ` (${t.unit})` : ""}
                </option>
              ))}
            </select>
          </label>

          {selectedTeam && (
            <div className={styles.tlSection}>
              <h3 className={styles.subhead}>Current TLs — {selectedTeam.name}</h3>
              {tlIds.length ? (
                <ul className={styles.tlList}>
                  {tlIds.map((id) => {
                    const emp = employees.find((e) => e.id === id);
                    return (
                      <li key={id} className={styles.tlRow}>
                        <span>{empLabel(emp)}</span>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`Remove ${empLabel(emp)} as TL from ${selectedTeam.name}?`)) {
                              onRemoveTl(selectedTeam.id, id);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">No TL assigned.</p>
              )}

              <label className={styles.field}>
                <span className="muted">Add TL</span>
                <select
                  className={styles.selectWide}
                  defaultValue=""
                  disabled={busy}
                  onChange={(e) => {
                    const employeeId = e.target.value;
                    e.target.value = "";
                    if (!employeeId) return;
                    if (!confirmAddTl(employeeId, selectedTeam.name, employees, allTeams)) return;
                    onAddTl(selectedTeam.id, selectedTeam.name, employeeId);
                  }}
                >
                  <option value="">+ Choose employee…</option>
                  {tlOpts && (
                    <>
                      <optgroup label={`TLs on ${selectedTeam.name}`}>
                        {tlOpts.onTeam.map((e) => (
                          <option key={e.id} value={e.id}>
                            {empLabel(e)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Other TLs">
                        {tlOpts.otherTls.map((e) => (
                          <option key={e.id} value={e.id}>
                            {empLabel(e)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Agents (unusual)">
                        {tlOpts.agents.map((e) => (
                          <option key={e.id} value={e.id}>
                            {empLabel(e)}
                          </option>
                        ))}
                      </optgroup>
                    </>
                  )}
                </select>
              </label>
            </div>
          )}
        </Tabs.Content>

        <Tabs.Content value="closers" className={styles.panel}>
          <p className="muted">
            Closers can submit sales and IT tickets for active agents on their assigned team(s). They cannot submit
            leave on behalf of agents or manage team structure.
          </p>
          <label className={styles.field}>
            <span className="muted">Team</span>
            <select
              className={styles.selectWide}
              value={closerTeamId}
              onChange={(e) => setCloserTeamId(e.target.value)}
            >
              <option value="">Select team…</option>
              {allTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.unit ? ` (${t.unit})` : ""}
                </option>
              ))}
            </select>
          </label>

          {selectedCloserTeam && (
            <div className={styles.tlSection}>
              <h3 className={styles.subhead}>Current closers — {selectedCloserTeam.name}</h3>
              {closerIds.length ? (
                <ul className={styles.tlList}>
                  {closerIds.map((id) => {
                    const emp = employees.find((e) => e.id === id);
                    return (
                      <li key={id} className={styles.tlRow}>
                        <span>{empLabel(emp)}</span>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`Remove ${empLabel(emp)} as closer from ${selectedCloserTeam.name}?`)) {
                              onRemoveCloser(selectedCloserTeam.id, id);
                            }
                          }}
                        >
                          Remove
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">No closers assigned.</p>
              )}

              <label className={styles.field}>
                <span className="muted">Add closer (same unit as team)</span>
                <select
                  className={styles.selectWide}
                  defaultValue=""
                  disabled={busy}
                  onChange={(e) => {
                    const employeeId = e.target.value;
                    e.target.value = "";
                    if (!employeeId) return;
                    if (!confirmAddCloser(employeeId, selectedCloserTeam.name, employees)) return;
                    onAddCloser(selectedCloserTeam.id, selectedCloserTeam.name, employeeId);
                  }}
                >
                  <option value="">+ Choose employee…</option>
                  {closerOpts
                    .filter((e) => !closerIds.includes(e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {empLabel(e)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </Dialog>
  );
}
