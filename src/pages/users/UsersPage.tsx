import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { useAppStatus } from "@/hooks/useAppStatus";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Dialog, ConfirmDialog } from "@/ui/Dialog";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import { useConfirmUndo } from "@/ui/useDeferredDelete";
import { PageToolbar, SearchField, FilterSelect } from "@/ui/PageToolbar";
import { StatusPill } from "@/ui/StatusPill";
import { UserPermissionsDialog } from "@/features/users/UserPermissionsDialog";

type PendingReg = {
  id: string;
  fullName?: string;
  americanName?: string;
  legalName?: string;
  arabicName?: string;
  phone?: string;
  email?: string;
  unit?: string;
  team?: string;
  company?: string;
  nationality?: string;
  nationalId?: string;
  passportNumber?: string;
  createdAt?: string;
};

type UserRow = {
  username: string;
  email?: string;
  emailClaimed?: string;
  googleEmail?: string;
  mfaEnrolledAt?: string | null;
  role?: string;
  status?: string;
  employeeId?: string;
  employeeName?: string;
  employeeTeam?: string;
  employeeUnit?: string;
  isIt?: boolean;
  hasExceptionAccess?: boolean;
  lastLoginAt?: string | null;
  updatedAt?: string | null;
};

export function UsersPage() {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const undo = useConfirmUndo();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [creds, setCreds] = useState<{
    username?: string;
    password?: string | null;
    employeeId?: string;
    loginActive?: boolean;
    usedAgentPassword?: boolean;
  } | null>(null);
  const [permUser, setPermUser] = useState<UserRow | null>(null);
  const [activateUser, setActivateUser] = useState<UserRow | null>(null);
  const [activateForm, setActivateForm] = useState({ password: "", role: "agent" });
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "agent", status: "active", employeeId: "", isIt: false });
  const [approveRegTarget, setApproveRegTarget] = useState<PendingReg | null>(null);
  const [approveUnit, setApproveUnit] = useState("");
  const [approveTeam, setApproveTeam] = useState("");
  const [editRegTarget, setEditRegTarget] = useState<PendingReg | null>(null);
  const [editRegForm, setEditRegForm] = useState({ americanName: "", legalName: "", phone: "", email: "", unit: "", team: "" });

  const { user: appUser } = useAppStatus();

  const { data: pendingData, refetch: refetchPending } = useQuery({
    queryKey: ["registration-pending", companyContext],
    queryFn: () => api<{ pending?: PendingReg[] }>(path("/registration/pending")),
    enabled: appUser?.canApproveRegistration === true,
    refetchOnWindowFocus: true,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users", companyContext],
    queryFn: () =>
      api<{ users: UserRow[]; roles?: string[]; statuses?: string[]; units?: string[]; teams?: string[] }>(path("/admin/users")),
  });

  const rows = useMemo(() => {
    let list = data?.users || [];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((u) =>
        [u.username, u.employeeId, u.employeeName, u.email, u.employeeTeam, u.employeeUnit, u.role]
          .join(" ").toLowerCase().includes(q)
      );
    }
    if (statusFilter === "active") list = list.filter((u) => (u.status || "active").toLowerCase() === "active");
    else if (statusFilter === "inactive") list = list.filter((u) => (u.status || "").toLowerCase() === "inactive");
    else if (statusFilter === "no-login") list = list.filter((u) => !u.employeeId);
    if (unitFilter) list = list.filter((u) => u.employeeUnit === unitFilter);
    if (teamFilter) list = list.filter((u) => u.employeeTeam === teamFilter);
    if (roleFilter) list = list.filter((u) => String(u.role || "").toLowerCase() === roleFilter);
    return list;
  }, [data?.users, search, statusFilter, unitFilter, teamFilter, roleFilter]);

  const saveUser = useMutation({
    mutationFn: () => {
      const body = {
        username: form.username,
        email: form.email,
        password: form.password || undefined,
        role: form.role,
        status: form.status,
        employeeId: form.employeeId || undefined,
        isIt: form.isIt,
      };
      if (editUser) {
        return api(path(`/admin/users/${encodeURIComponent(editUser.username)}`), { method: "PUT", body: JSON.stringify(body) });
      }
      return api(path("/admin/users"), { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setEditUser(null);
      setAddOpen(false);
    },
  });

  const deleteUser = useMutation({
    mutationFn: (username: string) => api(path(`/admin/users/${encodeURIComponent(username)}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const purgeUser = useMutation({
    mutationFn: (username: string) => api(path(`/admin/users/${encodeURIComponent(username)}/purge`), { method: "POST", body: "{}" }),
    onSuccess: (res) => {
      const released = (res as { releasedAppId?: string }).releasedAppId;
      alert(released ? `Purged — ID ${released} released` : "User purged");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const resetMfa = useMutation({
    mutationFn: (username: string) =>
      api(`/auth/mfa/admin-reset/${encodeURIComponent(username)}`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      alert("MFA cleared — user must re-enroll on next login.");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const { data: teamsRes } = useQuery({
    queryKey: ["org-teams-users", companyContext],
    queryFn: () => api<{ teams?: { name?: string; unit?: string }[] }>(path("/hrms/teams")),
    enabled: appUser?.canApproveRegistration === true,
  });
  const allTeams = teamsRes?.teams || [];
  const companyUnits = companyContext === "hs2" ? ["HS-2"] : ["HS-1", "HS-3"];
  const approveTeamOptions = allTeams.filter((t) => t.unit === approveUnit).map((t) => t.name || "").filter(Boolean);
  const editTeamOptions = allTeams.filter((t) => t.unit === editRegForm.unit).map((t) => t.name || "").filter(Boolean);

  const approveReg = useMutation({
    mutationFn: ({ id, unit, team }: { id: string; unit?: string; team?: string }) =>
      api(path(`/registration/${encodeURIComponent(id)}/approve`), {
        method: "POST",
        body: JSON.stringify({ unit: unit || "", team: team || "" }),
      }),
    onSuccess: (res) => {
      const r = res as {
        username?: string;
        password?: string | null;
        tempPassword?: string | null;
        employeeId?: string;
        loginActive?: boolean;
        usedAgentPassword?: boolean;
      };
      setCreds({
        username: r.username,
        employeeId: r.employeeId,
        loginActive: r.loginActive,
        usedAgentPassword: r.usedAgentPassword,
        password: r.tempPassword || r.password || null,
      });
      qc.invalidateQueries({ queryKey: ["registration-pending"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["org-full"] });
      setApproveRegTarget(null);
      setApproveTeam("");
      setApproveUnit("");
    },
  });

  const rejectReg = useMutation({
    mutationFn: (id: string) => api(path(`/registration/${encodeURIComponent(id)}/reject`), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registration-pending"] }),
  });

  const patchReg = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) =>
      api(path(`/registration/${encodeURIComponent(id)}`), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      setEditRegTarget(null);
      qc.invalidateQueries({ queryKey: ["registration-pending"] });
    },
  });

  const activate = useMutation({
    mutationFn: () =>
      api(path(`/admin/users/${encodeURIComponent(activateUser!.username)}`), {
        method: "PUT",
        body: JSON.stringify({ status: "active", role: activateForm.role, password: activateForm.password }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setActivateUser(null);
    },
  });

  const syncLogins = useMutation({
    mutationFn: () => api(path("/admin/users/sync-employees"), { method: "POST", body: "{}" }),
    onSuccess: (res) => {
      alert(`Synced ${(res as { created?: number }).created ?? 0} login(s)`);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const openEdit = (u: UserRow) => {
    setEditUser(u);
    setForm({
      username: u.username,
      email: u.email || "",
      password: "",
      role: u.role || "agent",
      status: u.status || "active",
      employeeId: u.employeeId || "",
      isIt: !!u.isIt,
    });
  };

  return (
    <div>
      <SectionHeader
        title="Users"
        subtitle={`${rows.length} users`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => syncLogins.mutate()}>Sync employee logins</Button>
            <Button size="sm" onClick={() => { setEditUser(null); setAddOpen(true); setForm({ username: "", email: "", password: "", role: "agent", status: "active", employeeId: "", isIt: false }); }}>+ Add user</Button>
          </>
        }
      />

      <PageToolbar>
        <SearchField value={search} onChange={setSearch} placeholder="Search users…" />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={["active", "inactive", "no-login"]} allLabel="All" />
        <FilterSelect label="Unit" value={unitFilter} onChange={setUnitFilter} options={data?.units || []} />
        <FilterSelect label="Team" value={teamFilter} onChange={setTeamFilter} options={data?.teams || []} />
        <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter} options={data?.roles || []} />
      </PageToolbar>

      {(appUser?.canApproveRegistration || (pendingData?.pending || []).length > 0) && (
        <Card style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3 style={{ margin: 0 }}>Pending agent registrations ({pendingData?.pending?.length ?? 0})</h3>
            <Button size="sm" variant="secondary" onClick={() => refetchPending()}>Refresh</Button>
          </div>
          <p className="muted">One approve creates the employee and activates login. Assign team later on Organization if needed.</p>
          {(pendingData?.pending || []).length > 0 ? (
          <div className="table-wrap">
            <table style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead><tr><th align="left">Name</th><th>Unit</th><th>Phone</th><th>Company</th><th align="right">Actions</th></tr></thead>
              <tbody>
                {(pendingData?.pending || []).map((p) => (
                  <tr key={p.id}>
                    <td>{p.americanName || p.fullName || "—"}</td>
                    <td>{p.unit || "—"}</td>
                    <td>{p.phone || "—"}</td>
                    <td>{p.company === "hs2" ? "HS-2" : "Hang-Up"}</td>
                    <td align="right" style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditRegTarget(p);
                          setEditRegForm({
                            americanName: p.americanName || "",
                            legalName: p.legalName || p.arabicName || p.fullName || "",
                            phone: p.phone || "",
                            email: p.email || "",
                            unit: p.unit || companyUnits[0] || "HS-3",
                            team: p.team || "",
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setApproveRegTarget(p);
                          setApproveUnit(p.unit || companyUnits[0] || "HS-3");
                          setApproveTeam(p.team || "");
                        }}
                      >
                        Approve
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => { if (confirm("Reject registration?")) rejectReg.mutate(p.id); }}>Reject</Button>
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

      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        {error && <p style={{ color: "var(--err)" }}>{(error as Error).message}</p>}
        {!isLoading && !error && (
          <div className="table-wrap">
            <table style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th align="left">User</th>
                  <th align="left">Employee</th>
                  <th align="left">Unit / Team</th>
                  <th align="left">Role</th>
                  <th>Status</th>
                  <th align="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.username}>
                    <td>
                      <strong>{u.username}</strong>
                      {u.hasExceptionAccess && <StatusPill variant="warn">Exception</StatusPill>}
                      {u.isIt && <StatusPill variant="muted">IT</StatusPill>}
                      <div className="muted" style={{ fontSize: "0.75rem" }}>{u.email || "—"}</div>
                      {u.googleEmail ? (
                        <div className="muted" style={{ fontSize: "0.75rem" }}>Google: {u.googleEmail}</div>
                      ) : null}
                      {u.mfaEnrolledAt ? (
                        <div className="muted" style={{ fontSize: "0.75rem" }}>MFA enrolled</div>
                      ) : null}
                    </td>
                    <td>{u.employeeId ? `${u.employeeId} — ${u.employeeName || ""}` : "—"}</td>
                    <td className="muted">{u.employeeUnit || "—"} / {u.employeeTeam || "—"}</td>
                    <td>{u.role}</td>
                    <td align="center"><StatusPill variant={u.status === "active" ? "ok" : "muted"}>{u.status}</StatusPill></td>
                    <td align="right" style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(u)}>Edit</Button>
                      {editUser?.username !== u.username && (
                        <Button size="sm" variant="secondary" onClick={() => setPermUser(u)}>Permissions</Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (!confirm(`Reset Authenticator MFA for ${u.username}? They must re-enroll.`)) return;
                          resetMfa.mutate(u.username);
                        }}
                      >
                        Reset MFA
                      </Button>
                      {u.status === "inactive" && u.employeeId && (
                        <Button size="sm" onClick={() => { setActivateUser(u); setActivateForm({ password: "", role: u.role || "agent" }); }}>Activate</Button>
                      )}
                      <Button size="sm" variant="danger" onClick={() => undo.confirmUndo({
                        title: `Remove ${u.username}?`,
                        toast: "User removed",
                        commit: () => deleteUser.mutateAsync(u.username),
                      })}>Remove</Button>
                      {u.employeeId && (
                        <Button size="sm" variant="danger" onClick={() => {
                          if (!confirm(`Permanently remove login for ${u.username} and release employee ID?`)) return;
                          if (!confirm("This cannot be undone. Continue?")) return;
                          purgeUser.mutate(u.username);
                        }}>Purge</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={6} className="muted">No users match filters</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={addOpen || !!editUser}
        onOpenChange={(o) => { if (!o) { setAddOpen(false); setEditUser(null); } }}
        title={editUser ? `Edit ${editUser.username}` : "Add user"}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => { setAddOpen(false); setEditUser(null); }}>Cancel</Button>
            <Button onClick={() => saveUser.mutate()} disabled={saveUser.isPending || !form.username}>Save</Button>
          </>
        }
      >
        <FormGrid wide>
          <FormField label="Username">
            <input value={form.username} disabled={!!editUser} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </FormField>
          <FormField label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
          <FormField label={editUser ? "New password (optional)" : "Password"}>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </FormField>
          <FormField label="Role">
            <Select
              value={form.role}
              onChange={(role) => setForm({ ...form, role })}
              options={(data?.roles || ["agent", "tl", "op", "hr", "admin"]).map((r) => ({ value: r, label: r }))}
            />
          </FormField>
          <FormField label="Status">
            <Select
              value={form.status}
              onChange={(status) => setForm({ ...form, status })}
              options={(data?.statuses || ["active", "inactive"]).map((s) => ({ value: s, label: s }))}
            />
          </FormField>
          <FormField label="Employee ID"><input value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} /></FormField>
          <FormField label="IT access">
            <label><input type="checkbox" checked={form.isIt} onChange={(e) => setForm({ ...form, isIt: e.target.checked })} /> IT user</label>
          </FormField>
        </FormGrid>
        {saveUser.isError && <p style={{ color: "var(--err)" }}>{(saveUser.error as Error).message}</p>}
      </Dialog>

      <UserPermissionsDialog
        username={permUser?.username || null}
        role={permUser?.role}
        open={!!permUser}
        onOpenChange={(o) => !o && setPermUser(null)}
      />

      <Dialog open={!!activateUser} onOpenChange={(o) => !o && setActivateUser(null)} title={`Activate ${activateUser?.username}`} footer={
        <>
          <Button variant="secondary" onClick={() => setActivateUser(null)}>Cancel</Button>
          <Button onClick={() => activate.mutate()} disabled={!activateForm.password}>Activate</Button>
        </>
      }>
        <FormGrid>
          <FormField label="Password"><input type="password" value={activateForm.password} onChange={(e) => setActivateForm({ ...activateForm, password: e.target.value })} /></FormField>
          <FormField label="Role">
            <Select
              value={activateForm.role}
              onChange={(role) => setActivateForm({ ...activateForm, role })}
              options={(data?.roles || []).map((r) => ({ value: r, label: r }))}
            />
          </FormField>
        </FormGrid>
      </Dialog>

      <Dialog open={!!creds} onOpenChange={(o) => !o && setCreds(null)} title="Registration approved" footer={<Button onClick={() => setCreds(null)}>Done</Button>}>
        <p><strong>User ID:</strong> <code>{creds?.username || creds?.employeeId}</code></p>
        <p><strong>Employee ID:</strong> {creds?.employeeId}</p>
        {creds?.usedAgentPassword ? (
          <p className="muted">Login uses the password the agent chose during registration (not shown here).</p>
        ) : creds?.password ? (
          <p><strong>Temporary password:</strong> <code>{creds.password}</code></p>
        ) : null}
        <p className="muted">
          {creds?.loginActive !== false
            ? "Login is active — agent can sign in with their User ID and registration password."
            : "Login is inactive — contact IT."}
        </p>
      </Dialog>
      <Dialog
        open={!!approveRegTarget}
        onOpenChange={(o) => { if (!o) { setApproveRegTarget(null); setApproveTeam(""); setApproveUnit(""); } }}
        title="Approve registration"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setApproveRegTarget(null); setApproveTeam(""); setApproveUnit(""); }}>Cancel</Button>
            <Button
              onClick={() => approveRegTarget && approveReg.mutate({ id: approveRegTarget.id, unit: approveUnit, team: approveTeam })}
              disabled={approveReg.isPending}
            >
              Approve
            </Button>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          Employee ID prefix comes from the selected unit (HS-1 → HS1-…).
        </p>
        <FormGrid>
          <FormField label="Unit">
            <Select
              value={approveUnit}
              onChange={(v) => { setApproveUnit(v); setApproveTeam(""); }}
              options={companyUnits.map((u) => ({ value: u, label: u }))}
            />
          </FormField>
          <FormField label="Team (optional)">
            <Select
              value={approveTeam}
              onChange={setApproveTeam}
              options={[{ value: "", label: "— Unassigned —" }, ...approveTeamOptions.map((name) => ({ value: name, label: name }))]}
            />
          </FormField>
        </FormGrid>
      </Dialog>

      <Dialog
        open={!!editRegTarget}
        onOpenChange={(o) => { if (!o) setEditRegTarget(null); }}
        title="Edit pending registration"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditRegTarget(null)}>Cancel</Button>
            <Button
              onClick={() =>
                editRegTarget &&
                patchReg.mutate({
                  id: editRegTarget.id,
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
            <input value={editRegForm.americanName} onChange={(e) => setEditRegForm((f) => ({ ...f, americanName: e.target.value }))} />
          </FormField>
          <FormField label="Legal name">
            <input value={editRegForm.legalName} onChange={(e) => setEditRegForm((f) => ({ ...f, legalName: e.target.value }))} />
          </FormField>
          <FormField label="Phone">
            <input value={editRegForm.phone} onChange={(e) => setEditRegForm((f) => ({ ...f, phone: e.target.value }))} />
          </FormField>
          <FormField label="Email">
            <input value={editRegForm.email} onChange={(e) => setEditRegForm((f) => ({ ...f, email: e.target.value }))} />
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
              options={[{ value: "", label: "— Unassigned —" }, ...editTeamOptions.map((name) => ({ value: name, label: name }))]}
            />
          </FormField>
        </FormGrid>
      </Dialog>

      <ConfirmDialog
        open={undo.confirmOpen}
        onOpenChange={undo.setConfirmOpen}
        title={undo.confirmTitle}
        message={undo.confirmMessage}
        danger
        onConfirm={undo.confirmDelete}
      />
    </div>
  );
}
