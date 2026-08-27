import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getSessionId } from "@/api/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Select } from "@/ui/Select";
import { useConfirmUndo } from "@/ui/useDeferredDelete";
import { ConfirmDialog } from "@/ui/Dialog";
import { useThemeStore, THEMES, type Theme, isThemeUnlocked, type ThemeUnlocks } from "@/stores/theme-store";
import { fileToBase64 } from "@/lib/files";
import { SettingsAdminExtras } from "./SettingsAdminExtras";
import styles from "./SettingsPage.module.css";

const NOTIF_ROLES = ["agent", "tl", "op", "quality", "rtm", "hr", "admin", "finance", "ceo"];

type Status = {
  appVersion?: string;
  lastSync?: string;
  hideOutEmployees?: boolean;
  showLegacyEmployees?: boolean;
  taxRules?: { incomeTaxRate?: number; socialInsuranceRate?: number };
  canManageSessions?: boolean;
  user?: Record<string, boolean | string | undefined>;
  impersonation?: { active?: boolean; as?: string };
  themeUnlocks?: ThemeUnlocks;
};

type Holiday = { id: string; name?: string; date?: string; holidayDate?: string; country?: string; active?: boolean };

export function SettingsPage() {
  const { theme, setTheme } = useThemeStore();
  const qc = useQueryClient();
  const undo = useConfirmUndo();
  const [impersonateUser, setImpersonateUser] = useState("");
  const [taxIncome, setTaxIncome] = useState("");
  const [taxSocial, setTaxSocial] = useState("");
  const [mgrDraft, setMgrDraft] = useState<Record<string, { opEmployeeId: string; hrManagerId: string; qualityManagerId: string }>>({});
  const [newCompany, setNewCompany] = useState({ slug: "", name: "", shortName: "" });

  const { status, loading: isLoading, refreshStatus } = useAppStatus();
  const { path, companyContext } = useCompanyScope();

  const user = status?.user || {};

  const { data: changelog } = useQuery({
    queryKey: ["changelog-settings"],
    queryFn: () => api<{ entries?: Record<string, unknown>[] }>("/changelog?limit=50"),
    enabled: status?.user?.canViewSettingsChangeLog === true,
  });

  const { data: impUsers } = useQuery({
    queryKey: ["impersonate-users"],
    queryFn: () => api<{ users?: { username: string; employeeName?: string; role?: string; status?: string }[] }>("/impersonate/users"),
    enabled: status?.user?.canImpersonate === true,
  });

  const { data: managers } = useQuery({
    queryKey: ["org-managers-settings"],
    queryFn: () => api<{ managers?: { unit: string; opEmployeeId?: string; hrManagerId?: string; qualityManagerId?: string }[] }>("/org/managers"),
    enabled: status?.user?.canViewSettingsManagingUnits === true,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: () => api<{ companies?: { name: string; slug: string; isDefault?: boolean; active?: boolean }[] }>("/companies"),
    enabled: status?.user?.canManageCompanies === true,
  });

  const { data: sessions } = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: () => api<{ sessions?: { id: string; device?: string; username?: string; lastActive?: string; lastSeenAt?: string }[] }>("/auth/sessions"),
    enabled: status?.canManageSessions === true,
  });

  const { data: holidaysData } = useQuery({
    queryKey: ["hrms-holidays", companyContext],
    queryFn: () => api<{ holidays?: Holiday[] }>(path("/hrms/holidays")),
    enabled: user.canViewSettingsHolidays === true,
  });

  const { data: notifRouting } = useQuery({
    queryKey: ["notification-routing", companyContext],
    queryFn: () => api<{ rules?: { actionKey: string; label?: string; enabled?: boolean; recipientRoles?: string[] }[] }>(path("/hrms/notification-routing")),
    enabled: ["admin", "ceo", "rtm", "hr"].includes(String(user.role || "")),
  });

  const hideOut = useMutation({
    mutationFn: (hide: boolean) => api("/settings/hide-out", { method: "PUT", body: JSON.stringify({ hide }) }),
    onSuccess: () => refreshStatus(),
  });

  const showLegacy = useMutation({
    mutationFn: (show: boolean) => api("/settings/show-legacy", { method: "PUT", body: JSON.stringify({ show }) }),
    onSuccess: () => {
      refreshStatus();
      qc.invalidateQueries({ queryKey: ["employees-list"] });
      qc.invalidateQueries({ queryKey: ["payroll-full"] });
      qc.invalidateQueries({ queryKey: ["attendance-grid"] });
    },
  });

  const sync = useMutation({
    mutationFn: () => api("/sync/refresh", { method: "POST", body: "{}" }),
    onSuccess: () => refreshStatus(),
  });

  const impersonate = useMutation({
    mutationFn: (username: string) => api("/impersonate/start", { method: "POST", body: JSON.stringify({ username }) }),
    onSuccess: () => window.location.reload(),
  });

  const changePassword = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api("/auth/change-password", { method: "PUT", body: JSON.stringify(body) }),
  });

  const saveTax = useMutation({
    mutationFn: () =>
      api(path("/settings/tax-rules"), {
        method: "PUT",
        body: JSON.stringify({
          incomeTaxRate: Number(taxIncome) || 0,
          socialInsuranceRate: Number(taxSocial) || 0,
        }),
      }),
    onSuccess: () => refreshStatus(),
  });

  const revokeSession = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${encodeURIComponent(id)}/revoke`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-sessions"] }),
  });

  const importFederalHolidays = useMutation({
    mutationFn: () => api(path("/hrms/holidays/import-federal"), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hrms-holidays"] }),
  });

  const importEgyHolidays = useMutation({
    mutationFn: () => api(path("/hrms/holidays/import-egyptian"), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hrms-holidays"] }),
  });

  const toggleHoliday = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(path(`/hrms/holidays/${encodeURIComponent(id)}`), { method: "PATCH", body: JSON.stringify({ active }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hrms-holidays"] }),
  });

  const deleteHoliday = useMutation({
    mutationFn: (id: string) => api(path(`/hrms/holidays/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hrms-holidays"] }),
  });

  const saveManager = useMutation({
    mutationFn: ({ unit, body }: { unit: string; body: Record<string, string> }) =>
      api(path(`/org/managers/${encodeURIComponent(unit)}`), { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-managers-settings"] }),
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const empId = String(user.employeeId || "");
      if (!empId) throw new Error("No employee linked to your account");
      const contentBase64 = await fileToBase64(file);
      return api(`/employees/${encodeURIComponent(empId)}/profile-photo`, {
        method: "POST",
        body: JSON.stringify({ contentBase64, fileName: file.name }),
      });
    },
    onSuccess: () => refreshStatus(),
  });

  const createCompany = useMutation({
    mutationFn: () => api("/companies", { method: "POST", body: JSON.stringify(newCompany) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["companies"] }); setNewCompany({ slug: "", name: "", shortName: "" }); },
  });

  const patchCompany = useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: Record<string, unknown> }) =>
      api(`/companies/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
  });

  const saveNotifRule = useMutation({
    mutationFn: ({ actionKey, recipientRoles, enabled }: { actionKey: string; recipientRoles: string[]; enabled: boolean }) =>
      api(path(`/hrms/notification-routing/${encodeURIComponent(actionKey)}`), {
        method: "PUT",
        body: JSON.stringify({ recipientRoles, enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-routing"] }),
  });

  const seedNotifRouting = useMutation({
    mutationFn: () => api(path("/hrms/notification-routing/seed"), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-routing"] }),
  });

  const canManageSalesConfig = ["rtm", "admin"].includes(String(user.role || ""));

  useEffect(() => {
    if (!status?.taxRules) return;
    setTaxIncome(String(status.taxRules.incomeTaxRate ?? 0));
    setTaxSocial(String(status.taxRules.socialInsuranceRate ?? 0));
  }, [status?.taxRules?.incomeTaxRate, status?.taxRules?.socialInsuranceRate]);

  const usaHolidays = (holidaysData?.holidays || []).filter((h) => String(h.country || "USA").toUpperCase() !== "EGY");
  const egyHolidays = (holidaysData?.holidays || []).filter((h) => String(h.country || "").toUpperCase() === "EGY");

  const mgrRow = (m: { unit: string; opEmployeeId?: string; hrManagerId?: string; qualityManagerId?: string }) => {
    const draft = mgrDraft[m.unit] || {
      opEmployeeId: m.opEmployeeId || "",
      hrManagerId: m.hrManagerId || "",
      qualityManagerId: m.qualityManagerId || "",
    };
    const setDraft = (patch: Partial<typeof draft>) =>
      setMgrDraft((prev) => ({ ...prev, [m.unit]: { ...draft, ...patch } }));
    return (
      <tr key={m.unit}>
        <td><strong>{m.unit}</strong></td>
        {user.canManageOrg ? (
          <>
            <td><input value={draft.opEmployeeId} onChange={(e) => setDraft({ opEmployeeId: e.target.value })} placeholder="OP ID" /></td>
            <td><input value={draft.hrManagerId} onChange={(e) => setDraft({ hrManagerId: e.target.value })} placeholder="HR ID" /></td>
            <td>
              <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <input value={draft.qualityManagerId} onChange={(e) => setDraft({ qualityManagerId: e.target.value })} placeholder="Quality ID" />
                <Button size="sm" variant="secondary" onClick={() => saveManager.mutate({ unit: m.unit, body: draft })}>Save</Button>
              </div>
            </td>
          </>
        ) : (
          <>
            <td>{m.opEmployeeId || "—"}</td>
            <td>{m.hrManagerId || "—"}</td>
            <td>{m.qualityManagerId || "—"}</td>
          </>
        )}
      </tr>
    );
  };

  return (
    <div>
      <SectionHeader title="Settings" />
      {isLoading && <p className="muted">Loading…</p>}

      <div className={styles.grid}>
        {user.canViewSettingsProfilePhoto !== false && (
          <Card>
            <h3>Profile picture</h3>
            {user.employeeId ? (
              <>
                <img src={`/api/employees/${encodeURIComponent(String(user.employeeId))}/avatar`} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", marginBottom: "0.5rem" }} />
                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto.mutate(f); }} />
              </>
            ) : (
              <p className="muted">Link an employee record to upload a profile photo.</p>
            )}
          </Card>
        )}

        {user.canViewSettingsTheme !== false && (
          <Card>
            <h3>Appearance</h3>
            <p className="muted">
              Color theme for this device. Most premium themes unlock at 10 RPM sent as agent or 10 closed as closer this month.
              Turtle Grove needs 15 sent or 15 closed.
            </p>
            <div className={styles.themePicker}>
              {THEMES.map((t) => {
                const unlocks = (status as Status | null)?.themeUnlocks;
                const unlocked = isThemeUnlocked(t.id, unlocks);
                const isTurtle = t.id === "turtles";
                const thresh = isTurtle
                  ? unlocks?.turtleThreshold ?? 15
                  : unlocks?.agentThreshold ?? 10;
                const closerThresh = isTurtle
                  ? unlocks?.turtleThreshold ?? 15
                  : unlocks?.closerThreshold ?? 10;
                const progress = t.premium
                  ? `${unlocks?.agentSalesThisMonth ?? 0}/${thresh} sent · ${unlocks?.closerSalesThisMonth ?? 0}/${closerThresh} closed`
                  : null;
                const needN = isTurtle ? 15 : 10;
                const lockHint = `Need ${needN} RPM sent as agent or ${needN} closed as closer (${progress})`;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!unlocked}
                    title={unlocked ? t.desc : lockHint}
                    className={`${styles.themeOption} ${theme === t.id ? styles.themeActive : ""} ${!unlocked ? styles.themeLocked : ""}`}
                    onClick={() => {
                      if (unlocked) setTheme(t.id as Theme);
                    }}
                  >
                    <span className={`${styles.swatch} ${styles[`swatch_${t.id}` as keyof typeof styles] || ""}`} />
                    <span>
                      <strong>
                        {t.label}
                        {t.premium ? <span className={styles.premiumBadge}>Premium</span> : null}
                      </strong>
                      <small className="muted">
                        {unlocked ? t.desc : `Locked · ${progress}`}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {user.canViewSettingsHideOut === true && (
          <Card>
            <h3>Display</h3>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={!!status?.hideOutEmployees}
                onChange={(e) => hideOut.mutate(e.target.checked)}
              />
              Hide OUT employees (previous month) by default
            </label>
            <label className={styles.toggle} style={{ marginTop: "0.5rem" }}>
              <input
                type="checkbox"
                checked={!!status?.showLegacyEmployees}
                onChange={(e) => showLegacy.mutate(e.target.checked)}
              />
              Show legacy employees (left 2+ months ago, no pay)
            </label>
          </Card>
        )}

        {user.canViewSettingsSession === true && (
          <>
            <Card>
              <h3>App version</h3>
              <p><strong>{status?.appVersion || "unknown"}</strong></p>
            </Card>
            <Card>
              <h3>Session</h3>
              <p className="muted">Session ID (for support):</p>
              <code>{getSessionId() || "—"}</code>
            </Card>
          </>
        )}

        {user.canViewSettingsSync !== false && (
          <Card>
            <h3>Data sync</h3>
            <p className="muted">Last sync: {status?.lastSync ? new Date(status.lastSync).toLocaleString() : "Never"}</p>
            <Button onClick={() => sync.mutate()} disabled={sync.isPending}>Refresh from server</Button>
          </Card>
        )}

        {user.canImpersonate === true && (
          <Card>
            <h3>View as user (testing)</h3>
            {status?.impersonation?.active && (
              <p className="muted">Currently viewing as <strong>{status.impersonation.as}</strong></p>
            )}
            <Select
              value={impersonateUser}
              onChange={setImpersonateUser}
              options={[
                { value: "", label: "— Choose user —" },
                ...(impUsers?.users || []).map((u) => ({
                  value: u.username,
                  label: `${u.employeeName || u.username} — ${u.username} (${u.role})`,
                })),
              ]}
            />
            <Button size="sm" onClick={() => {
              if (impersonateUser && confirm(`View as ${impersonateUser}?`)) impersonate.mutate(impersonateUser);
            }}>Start viewing</Button>
          </Card>
        )}

        {user.canManageEmployees === true && (
          <Card>
            <h3>Tax rules</h3>
            <p className="muted">Income tax and social insurance rates used on payslips.</p>
            <div style={{ display: "grid", gap: "0.5rem", maxWidth: "280px" }}>
              <label className={styles.toggle}>Income tax %
                <input type="number" min={0} max={100} step={0.01} value={taxIncome} onChange={(e) => setTaxIncome(e.target.value)} />
              </label>
              <label className={styles.toggle}>Social insurance %
                <input type="number" min={0} max={100} step={0.01} value={taxSocial} onChange={(e) => setTaxSocial(e.target.value)} />
              </label>
              <Button size="sm" onClick={() => saveTax.mutate()} disabled={saveTax.isPending}>Save tax rules</Button>
            </div>
          </Card>
        )}

        {user.canViewSettingsChangePassword !== false && (
          <Card>
            <h3>Change password</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              changePassword.mutate({
                currentPassword: String(fd.get("current") || ""),
                newPassword: String(fd.get("new") || ""),
              });
            }} style={{ display: "grid", gap: "0.5rem" }}>
              <input name="current" type="password" placeholder="Current password" required />
              <input name="new" type="password" placeholder="New password" required />
              <Button type="submit" size="sm" disabled={changePassword.isPending}>Update password</Button>
            </form>
          </Card>
        )}
      </div>

      {user.canViewSettingsManagingUnits === true && managers?.managers && (
        <Card style={{ marginTop: "1rem" }}>
          <h3>Managing units</h3>
          <p className="muted">OP, HR, and Quality managers per unit (edit on Organization page for OP chips).</p>
          <table className={styles.table}>
            <thead><tr><th>Unit</th><th>OP</th><th>HR</th><th>Quality</th></tr></thead>
            <tbody>
              {managers.managers.map(mgrRow)}
            </tbody>
          </table>
        </Card>
      )}

      {user.canManageCompanies === true && companies?.companies && (
        <Card style={{ marginTop: "1rem" }}>
          <h3>Companies</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
            <input placeholder="Slug" value={newCompany.slug} onChange={(e) => setNewCompany({ ...newCompany, slug: e.target.value })} />
            <input placeholder="Name" value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} />
            <input placeholder="Short name" value={newCompany.shortName} onChange={(e) => setNewCompany({ ...newCompany, shortName: e.target.value })} />
            <Button size="sm" onClick={() => createCompany.mutate()} disabled={!newCompany.slug || !newCompany.name}>Add company</Button>
          </div>
          <table className={styles.table}>
            <thead><tr><th>Name</th><th>Slug</th><th>Default</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {companies.companies.map((c) => (
                <tr key={c.slug}>
                  <td><input defaultValue={c.name} onBlur={(e) => { if (e.target.value !== c.name) patchCompany.mutate({ slug: c.slug, body: { name: e.target.value } }); }} /></td>
                  <td><code>{c.slug}</code></td>
                  <td>{c.isDefault ? "Yes" : ""}</td>
                  <td>
                    <label><input type="checkbox" defaultChecked={c.active !== false} onChange={(e) => patchCompany.mutate({ slug: c.slug, body: { active: e.target.checked } })} /> Active</label>
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {notifRouting?.rules && (
        <Card style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Notification routing</h3>
            <Button size="sm" variant="secondary" onClick={() => { if (confirm("Reset all notification routing to defaults?")) seedNotifRouting.mutate(); }}>Reset defaults</Button>
          </div>
          <p className="muted">Which roles receive each notification type.</p>
          <table className={styles.table}>
            <thead><tr><th>Type</th><th>Enabled</th><th>Notify roles</th></tr></thead>
            <tbody>
              {notifRouting.rules.map((r) => (
                <tr key={r.actionKey}>
                  <td><strong>{r.label || r.actionKey}</strong></td>
                  <td>
                    <input
                      type="checkbox"
                      defaultChecked={r.enabled !== false}
                      onChange={(e) => saveNotifRule.mutate({ actionKey: r.actionKey, recipientRoles: r.recipientRoles || [], enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 0.75rem" }}>
                      {NOTIF_ROLES.map((role) => {
                        const roles = r.recipientRoles || [];
                        return (
                          <label key={role} style={{ fontSize: "0.8rem", display: "flex", gap: "0.25rem", alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={roles.includes(role)}
                              onChange={(e) => {
                                const next = e.target.checked ? [...roles, role] : roles.filter((x) => x !== role);
                                saveNotifRule.mutate({ actionKey: r.actionKey, recipientRoles: next, enabled: r.enabled !== false });
                              }}
                            />
                            {role}
                          </label>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <SettingsAdminExtras
        canManageBreaks={canManageSalesConfig}
        canManageClients={canManageSalesConfig}
        canManageHs2={user.canManageHs2Company === true}
      />

      {status?.canManageSessions === true && sessions?.sessions && (
        <Card style={{ marginTop: "1rem" }}>
          <h3>Active sessions</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {sessions.sessions.map((s) => (
              <li key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.35rem" }}>
                <span>{s.username || s.device || s.id} — {(s.lastActive || s.lastSeenAt) ? new Date(s.lastActive || s.lastSeenAt!).toLocaleString() : ""}</span>
                <Button size="sm" variant="danger" onClick={() => { if (confirm("Revoke this session?")) revokeSession.mutate(s.id); }}>Revoke</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {user.canViewSettingsHolidays === true && (
        <Card style={{ marginTop: "1rem" }}>
          <h3>Federal holidays (USA)</h3>
          <p className="muted">Disabled holidays are excluded from attendance prefill.</p>
          <div style={{ marginBottom: "0.75rem" }}>
            <Button size="sm" variant="secondary" onClick={() => importFederalHolidays.mutate()} disabled={importFederalHolidays.isPending}>
              Import federal holidays (2024–2028)
            </Button>
          </div>
          <div style={{ maxHeight: "240px", overflow: "auto" }}>
            {usaHolidays.map((h) => (
              <label key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <span>
                  <input
                    type="checkbox"
                    checked={h.active !== false}
                    onChange={(e) => toggleHoliday.mutate({ id: h.id, active: e.target.checked })}
                  />
                  {" "}{h.date || h.holidayDate}: {h.name}
                </span>
                <Button size="sm" variant="secondary" onClick={() => undo.confirmUndo({
                  title: "Delete holiday?",
                  toast: "Holiday deleted",
                  commit: () => deleteHoliday.mutateAsync(h.id),
                })}>Delete</Button>
              </label>
            ))}
            {!usaHolidays.length && <p className="muted">No holidays — click Import.</p>}
          </div>
          {["admin", "ceo"].includes(String(user.role)) && (
            <>
              <h3 style={{ marginTop: "1.25rem" }}>Egyptian holidays</h3>
              <Button size="sm" variant="secondary" onClick={() => importEgyHolidays.mutate()} disabled={importEgyHolidays.isPending} style={{ marginBottom: "0.5rem" }}>
                Import Egyptian holidays (2024–2028)
              </Button>
              <div style={{ maxHeight: "200px", overflow: "auto" }}>
                {egyHolidays.map((h) => (
                  <label key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.25rem" }}>
                    <span>
                      <input type="checkbox" checked={h.active !== false} onChange={(e) => toggleHoliday.mutate({ id: h.id, active: e.target.checked })} />
                      {" "}{h.date || h.holidayDate}: {h.name}
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => undo.confirmUndo({
                      title: "Delete holiday?",
                      toast: "Holiday deleted",
                      commit: () => deleteHoliday.mutateAsync(h.id),
                    })}>Delete</Button>
                  </label>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {user.canViewSettingsChangeLog === true && (
        <Card style={{ marginTop: "1rem" }}>
          <h3>Change log</h3>
          <table className={styles.table}>
            <thead><tr><th>When</th><th>User</th><th>Entity</th><th>Summary</th></tr></thead>
            <tbody>
              {(changelog?.entries || []).slice(0, 20).map((e, i) => (
                <tr key={i}>
                  <td>{String(e.timestamp || "").slice(0, 19).replace("T", " ")}</td>
                  <td>{String(e.username || "—")}</td>
                  <td>{String(e.entity || "—")}</td>
                  <td>{String(e.summary || e.action || "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
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
