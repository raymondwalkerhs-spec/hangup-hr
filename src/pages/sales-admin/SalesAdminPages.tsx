import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { api } from "@/api/client";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import styles from "./SalesPermissionsPage.module.css";

const ROLES = ["agent", "tl", "op", "quality", "rtm", "public_relations", "admin", "ceo", "hr", "finance"];
type TabId = "main" | "quality" | "attachments" | "actions";
type SalesProgram = "mla" | "rpm";

function apiBase(program: SalesProgram) {
  return program === "rpm" ? "/rpm-sales" : "/sales";
}

type Field = { key: string; label?: string; section?: string; sensitive?: boolean };
type Perm = {
  fieldKey?: string;
  viewRoles?: string[];
  editRoles?: string[];
  mainViewRoles?: string[];
  qualityViewRoles?: string[];
};
type AttachPerm = { attachmentKey: string; label?: string; viewRoles?: string[]; editRoles?: string[] };
type ActionPerm = { actionKey: string; label?: string; allowedRoles?: string[] };

function roleLabel(role: string) {
  return String(role || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function roleInList(role: string, list?: string[]) {
  return (list || []).map((r) => String(r).toLowerCase()).includes(String(role).toLowerCase());
}

function rolesOf(perm: Perm | undefined, kind: "view" | "edit", tab: TabId) {
  if (!perm) return [];
  if (kind === "edit") return perm.editRoles || [];
  if (tab === "quality") return perm.qualityViewRoles || [];
  return perm.mainViewRoles || perm.viewRoles || [];
}

export function SalesPermissionsPage() {
  const qc = useQueryClient();
  const [program, setProgram] = useState<SalesProgram>("mla");
  const [role, setRole] = useState("agent");
  const [tab, setTab] = useState<TabId>("main");
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [attachPending, setAttachPending] = useState<Map<string, boolean>>(new Map());
  const [actionPending, setActionPending] = useState<Map<string, boolean>>(new Map());

  const base = apiBase(program);

  const { data, isLoading } = useQuery({
    queryKey: ["sales-field-catalog-admin", program],
    queryFn: () =>
      api<{
        fields?: Field[];
        permissions?: Perm[];
        attachmentPermissions?: AttachPerm[];
        sections?: string[];
      }>(`${base}/field-catalog?allFields=1`),
  });

  const { data: actionsData } = useQuery({
    queryKey: ["sales-action-perms", program],
    queryFn: () => api<{ permissions?: ActionPerm[]; actions?: ActionPerm[] }>(`${base}/action-permissions`),
    enabled: program === "mla" || program === "rpm",
  });

  const permMap = useMemo(() => {
    const m: Record<string, Perm> = {};
    (data?.permissions || []).forEach((p) => {
      if (p.fieldKey) m[p.fieldKey] = p;
    });
    return m;
  }, [data?.permissions]);

  const fields = data?.fields || [];
  const attachPerms = data?.attachmentPermissions || [];
  const actionPerms = actionsData?.permissions || actionsData?.actions || [];

  const getFieldEffective = (fieldKey: string, kind: "view" | "edit") => {
    const pk = `${tab}::${role}::${fieldKey}::${kind}`;
    if (pending.has(pk)) return pending.get(pk)!;
    return roleInList(role, rolesOf(permMap[fieldKey], kind, tab));
  };

  const toggleField = (fieldKey: string, kind: "view" | "edit", allowed: boolean) => {
    const pk = `${tab}::${role}::${fieldKey}::${kind}`;
    const saved = roleInList(role, rolesOf(permMap[fieldKey], kind, tab));
    setPending((prev) => {
      const next = new Map(prev);
      if (allowed === saved) next.delete(pk);
      else next.set(pk, allowed);
      return next;
    });
  };

  const getAttachEffective = (attachKey: string, kind: "view" | "edit") => {
    const pk = `attach::${attachKey}::${role}::${kind}`;
    if (attachPending.has(pk)) return attachPending.get(pk)!;
    const perm = attachPerms.find((a) => a.attachmentKey === attachKey);
    const list = kind === "edit" ? perm?.editRoles : perm?.viewRoles;
    return roleInList(role, list);
  };

  const toggleAttach = (attachKey: string, kind: "view" | "edit", allowed: boolean) => {
    const pk = `attach::${attachKey}::${role}::${kind}`;
    const perm = attachPerms.find((a) => a.attachmentKey === attachKey);
    const saved = roleInList(role, kind === "edit" ? perm?.editRoles : perm?.viewRoles);
    setAttachPending((prev) => {
      const next = new Map(prev);
      if (allowed === saved) next.delete(pk);
      else next.set(pk, allowed);
      return next;
    });
  };

  const getActionEffective = (actionKey: string) => {
    const pk = `action::${actionKey}::${role}`;
    if (actionPending.has(pk)) return actionPending.get(pk)!;
    const perm = actionPerms.find((a) => a.actionKey === actionKey);
    return roleInList(role, perm?.allowedRoles);
  };

  const toggleAction = (actionKey: string, allowed: boolean) => {
    const pk = `action::${actionKey}::${role}`;
    const perm = actionPerms.find((a) => a.actionKey === actionKey);
    const saved = roleInList(role, perm?.allowedRoles);
    setActionPending((prev) => {
      const next = new Map(prev);
      if (allowed === saved) next.delete(pk);
      else next.set(pk, allowed);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      const byField: Record<string, Record<string, string[]>> = {};
      for (const [pk, enabled] of pending.entries()) {
        const [t, r, fieldKey, kind] = pk.split("::");
        if (!byField[fieldKey]) {
          const p = permMap[fieldKey] || {};
          byField[fieldKey] = {
            viewRoles: [...(p.viewRoles || [])],
            editRoles: [...(p.editRoles || [])],
            mainViewRoles: [...rolesOf(p, "view", "main")],
            qualityViewRoles: [...rolesOf(p, "view", "quality")],
          };
        }
        if (kind === "edit") {
          const set = new Set(byField[fieldKey].editRoles.map((x) => x.toLowerCase()));
          if (enabled) set.add(r);
          else set.delete(r);
          byField[fieldKey].editRoles = [...set];
        } else {
          const listKey = t === "quality" ? "qualityViewRoles" : "mainViewRoles";
          const set = new Set(byField[fieldKey][listKey].map((x) => x.toLowerCase()));
          if (enabled) set.add(r);
          else set.delete(r);
          byField[fieldKey][listKey] = [...set];
          if (t === "main") byField[fieldKey].viewRoles = [...set];
        }
      }
      for (const [fieldKey, body] of Object.entries(byField)) {
        await api(`${base}/field-permissions/${encodeURIComponent(fieldKey)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      }

      const attachKeys = new Set([...attachPending.keys()].map((pk) => pk.split("::")[1]));
      for (const attachKey of attachKeys) {
        const def = attachPerms.find((a) => a.attachmentKey === attachKey);
        const viewSet = new Set((def?.viewRoles || []).map((x) => x.toLowerCase()));
        const editSet = new Set((def?.editRoles || []).map((x) => x.toLowerCase()));
        for (const [pk, enabled] of attachPending.entries()) {
          const [, ak, r, kind] = pk.split("::");
          if (ak !== attachKey) continue;
          const set = kind === "edit" ? editSet : viewSet;
          if (enabled) set.add(r);
          else set.delete(r);
        }
        await api(`${base}/attachment-permissions/${encodeURIComponent(attachKey)}`, {
          method: "PUT",
          body: JSON.stringify({ label: def?.label, viewRoles: [...viewSet], editRoles: [...editSet] }),
        });
      }

      if (program === "mla" || program === "rpm") {
      const actionKeys = new Set([...actionPending.keys()].map((pk) => pk.split("::")[1]));
      for (const actionKey of actionKeys) {
        const def = actionPerms.find((a) => a.actionKey === actionKey);
        const rolesSet = new Set((def?.allowedRoles || []).map((x) => x.toLowerCase()));
        for (const [pk, enabled] of actionPending.entries()) {
          const [, ak, r] = pk.split("::");
          if (ak !== actionKey) continue;
          if (enabled) rolesSet.add(r);
          else rolesSet.delete(r);
        }
        await api(`${base}/action-permissions/${encodeURIComponent(actionKey)}`, {
          method: "PUT",
          body: JSON.stringify({ allowedRoles: [...rolesSet], label: def?.label }),
        });
      }
      }
    },
    onSuccess: () => {
      setPending(new Map());
      setAttachPending(new Map());
      setActionPending(new Map());
      qc.invalidateQueries({ queryKey: ["sales-field-catalog-admin", program] });
      qc.invalidateQueries({ queryKey: ["sales-action-perms", program] });
    },
  });

  const seed = useMutation({
    mutationFn: () => api(`${base}/field-permissions/seed`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-field-catalog-admin", program] });
      qc.invalidateQueries({ queryKey: ["sales-action-perms", program] });
    },
  });

  const sections = useMemo(() => {
    const s = data?.sections || [...new Set(fields.map((f) => f.section || "general"))];
    return s;
  }, [data?.sections, fields]);

  const pendingCount = pending.size + attachPending.size + actionPending.size;

  return (
    <div>
      <SectionHeader
        title="Sales permissions"
        subtitle={`${program.toUpperCase()} · ${roleLabel(role)} · ${tab}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => { if (confirm("Reset all sales permissions to defaults?")) seed.mutate(); }}>Reset defaults</Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={!pendingCount || save.isPending}>Save ({pendingCount})</Button>
          </>
        }
      />

      <div className={styles.rolePicker} style={{ marginBottom: "0.75rem" }}>
        {(["mla", "rpm"] as SalesProgram[]).map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.roleBtn} ${program === p ? styles.roleActive : ""}`}
            onClick={() => {
              setProgram(p);
              setPending(new Map());
              setAttachPending(new Map());
              setActionPending(new Map());
            }}
          >
            {p.toUpperCase()}
          </button>
        ))}
      </div>

      <div className={styles.rolePicker}>
        {ROLES.map((r) => (
          <button key={r} type="button" className={`${styles.roleBtn} ${role === r ? styles.roleActive : ""}`} onClick={() => setRole(r)}>
            {roleLabel(r)}
          </button>
        ))}
      </div>

      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <Tabs.List className={styles.tabs}>
          <Tabs.Trigger value="main" className={styles.tab}>Edit sale</Tabs.Trigger>
          <Tabs.Trigger value="quality" className={styles.tab}>Quality ticket</Tabs.Trigger>
          <Tabs.Trigger value="attachments" className={styles.tab}>Attachments</Tabs.Trigger>
          <Tabs.Trigger value="actions" className={styles.tab}>Actions</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      <Card style={{ marginTop: "1rem" }}>
        {isLoading && <p className="muted">Loading…</p>}
        {!isLoading && tab !== "attachments" && tab !== "actions" && (
          <div className="table-wrap">
            <table className={styles.table}>
              <thead><tr><th align="left">Field</th><th>View</th><th>Edit</th></tr></thead>
              <tbody>
                {sections.map((sec) => {
                  const secFields = fields.filter((f) => (f.section || "general") === sec);
                  if (!secFields.length) return null;
                  return (
                    <Fragment key={`sec-${sec}`}>
                      <tr className={styles.catRow}><td colSpan={3}><strong>{sec}</strong></td></tr>
                      {secFields.map((f) => (
                        <tr key={f.key}>
                          <td><strong>{f.label || f.key}</strong><div className="muted" style={{ fontSize: "0.75rem" }}>{f.key}</div></td>
                          <td align="center"><input type="checkbox" checked={getFieldEffective(f.key, "view")} onChange={(e) => toggleField(f.key, "view", e.target.checked)} /></td>
                          <td align="center"><input type="checkbox" checked={getFieldEffective(f.key, "edit")} onChange={(e) => toggleField(f.key, "edit", e.target.checked)} /></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && tab === "attachments" && (
          <div className="table-wrap">
            <table className={styles.table}>
              <thead><tr><th align="left">Attachment</th><th>View</th><th>Edit</th></tr></thead>
              <tbody>
                {attachPerms.map((a) => (
                  <tr key={a.attachmentKey}>
                    <td><strong>{a.label || a.attachmentKey}</strong></td>
                    <td align="center"><input type="checkbox" checked={getAttachEffective(a.attachmentKey, "view")} onChange={(e) => toggleAttach(a.attachmentKey, "view", e.target.checked)} /></td>
                    <td align="center"><input type="checkbox" checked={getAttachEffective(a.attachmentKey, "edit")} onChange={(e) => toggleAttach(a.attachmentKey, "edit", e.target.checked)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && tab === "actions" && (
          <div className="table-wrap">
            <table className={styles.table}>
              <thead><tr><th align="left">Action</th><th>Allowed</th></tr></thead>
              <tbody>
                {actionPerms.map((a) => (
                  <tr key={a.actionKey}>
                    <td><strong>{a.label || a.actionKey}</strong></td>
                    <td align="center"><input type="checkbox" checked={getActionEffective(a.actionKey)} onChange={(e) => toggleAction(a.actionKey, e.target.checked)} /></td>
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

export function SalesLogColumnsPage() {
  const qc = useQueryClient();
  const [program, setProgram] = useState<SalesProgram>("mla");
  const [local, setLocal] = useState<{ columnKey: string; label?: string; enabled?: boolean; adminOnly?: boolean }[] | null>(null);

  const base = apiBase(program);

  const { data, isLoading } = useQuery({
    queryKey: ["sales-columns", program],
    queryFn: () => api<{ columns: { columnKey: string; label?: string; enabled?: boolean; visible?: boolean; adminOnly?: boolean }[] }>(`${base}/list-columns`),
  });

  const cols = local ?? (data?.columns || []).map((c) => ({
    columnKey: c.columnKey,
    label: c.label,
    enabled: c.enabled ?? c.visible ?? true,
    adminOnly: c.adminOnly,
  }));

  const save = useMutation({
    mutationFn: () =>
      api(`${base}/list-columns`, {
        method: "PUT",
        body: JSON.stringify({
          columns: cols.map((c) => ({ columnKey: c.columnKey, enabled: c.enabled !== false })),
        }),
      }),
    onSuccess: () => {
      setLocal(null);
      qc.invalidateQueries({ queryKey: ["sales-columns", program] });
    },
  });

  const seed = useMutation({
    mutationFn: () => api(`${base}/list-columns/seed`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      setLocal(null);
      qc.invalidateQueries({ queryKey: ["sales-columns", program] });
    },
  });

  return (
    <div>
      <SectionHeader
        title="Log columns"
        subtitle={`${program.toUpperCase()} · columns shown on the Sales log`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => { if (confirm("Reset columns to defaults?")) seed.mutate(); }}>Reset defaults</Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save columns</Button>
          </>
        }
      />
      <div className={styles.rolePicker} style={{ marginBottom: "0.75rem" }}>
        {(["mla", "rpm"] as SalesProgram[]).map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.roleBtn} ${program === p ? styles.roleActive : ""}`}
            onClick={() => { setProgram(p); setLocal(null); }}
          >
            {p.toUpperCase()}
          </button>
        ))}
      </div>
      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        {!isLoading && (
          <div className="table-wrap">
            <table style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead><tr><th>Show</th><th align="left">Column</th><th align="left">Key</th><th>Admin only</th></tr></thead>
              <tbody>
                {cols.map((c, i) => (
                  <tr key={c.columnKey}>
                    <td align="center">
                      <input
                        type="checkbox"
                        checked={c.enabled !== false}
                        onChange={(e) => {
                          const next = [...cols];
                          next[i] = { ...c, enabled: e.target.checked };
                          setLocal(next);
                        }}
                      />
                    </td>
                    <td><strong>{c.label || c.columnKey}</strong></td>
                    <td className="muted"><code>{c.columnKey}</code></td>
                    <td align="center">{c.adminOnly ? "Yes" : "—"}</td>
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
