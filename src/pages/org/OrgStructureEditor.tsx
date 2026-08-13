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
  teamTls,
  teamClosers,
  onAssignTeam,
  onAddTl,
  onRemoveTl,
  onAddCloser,
  onRemoveCloser,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  allTeams: TeamMeta[];
  teamTls: Record<string, string[]>;
  teamClosers: Record<string, string[]>;
  onAssignTeam: (empId: string, teamName: string, revert?: () => void) => void;
  onAddTl: (teamId: string, teamName: string, employeeId: string) => void;
  onRemoveTl: (teamId: string, employeeId: string) => void;
  onAddCloser: (teamId: string, teamName: string, employeeId: string) => void;
  onRemoveCloser: (teamId: string, employeeId: string) => void;
  busy?: boolean;
}) {
  const [tab, setTab] = useState("teams");
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [tlTeamId, setTlTeamId] = useState("");
  const [closerTeamId, setCloserTeamId] = useState("");
  const [teamDraft, setTeamDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setTeamDraft({});
      setSearch("");
      setUnitFilter("");
    }
  }, [open]);

  useEffect(() => {
    setTeamDraft({});
  }, [employees]);

  const teamNames = useMemo(
    () => [...new Set(allTeams.map((t) => t.name).filter(Boolean))].sort(),
    [allTeams]
  );

  const units = useMemo(
    () => [...new Set(allTeams.map((t) => t.unit).filter(Boolean))].sort(),
    [allTeams]
  );

  const teamById = useMemo(() => {
    const m = new Map<string, TeamMeta>();
    allTeams.forEach((t) => m.set(t.id, t));
    return m;
  }, [allTeams]);

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
    ? [...new Set([...(selectedCloserTeam.closerEmployeeIds || []), ...(teamClosers[selectedCloserTeam.id] || [])].filter(Boolean))]
    : [];
  const closerOpts = selectedCloserTeam
    ? closerCandidates(selectedCloserTeam.name, selectedCloserTeam.unit, employees)
    : [];

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

        <Tabs.Content value="teams" className={styles.panel}>
          <p className="muted">
            Change an agent&apos;s team from the dropdown. If the team is in another unit, you&apos;ll be asked to update the unit too.
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
                <option key={u} value={u}>{u}</option>
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
                          <option key={tn} value={tn}>{tn}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  );
                })}
                {!filteredEmployees.length && (
                  <tr><td colSpan={4} className="muted">No employees match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        <Tabs.Content value="tls" className={styles.panel}>
          <p className="muted">Pick a team, then add or remove team leaders (TLs).</p>
          <label className={styles.field}>
            <span className="muted">Team</span>
            <select
              className={styles.selectWide}
              value={tlTeamId}
              onChange={(e) => setTlTeamId(e.target.value)}
            >
              <option value="">Select team…</option>
              {allTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.unit ? ` (${t.unit})` : ""}
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
                          <option key={e.id} value={e.id}>{empLabel(e)}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Other TLs">
                        {tlOpts.otherTls.map((e) => (
                          <option key={e.id} value={e.id}>{empLabel(e)}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Agents (unusual)">
                        {tlOpts.agents.map((e) => (
                          <option key={e.id} value={e.id}>{empLabel(e)}</option>
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
            Closers can submit sales and IT tickets for active agents on their assigned team(s). They cannot submit leave on behalf of agents or manage team structure.
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
                  {t.name}{t.unit ? ` (${t.unit})` : ""}
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
                      <option key={e.id} value={e.id}>{empLabel(e)}</option>
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
