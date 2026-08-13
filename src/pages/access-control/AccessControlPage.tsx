import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import styles from "./AccessControlPage.module.css";

type Perm = { key: string; label: string; description?: string; category: string };
type EffEntry = { effective?: boolean; override?: boolean | null };

function roleLabel(role: string) {
  const acronyms: Record<string, string> = { it: "IT", hr: "HR", op: "OP", tl: "TL", rtm: "RTM", ceo: "CEO" };
  const k = role.toLowerCase();
  if (acronyms[k]) return acronyms[k];
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AccessControlPage() {
  const qc = useQueryClient();
  const { refreshStatus } = useAuth();
  const { path, companyContext } = useCompanyScope();
  const [role, setRole] = useState("agent");
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());

  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: ["rbac-catalog"],
    queryFn: () =>
      api<{
        roles?: string[];
        permissions?: Perm[];
        categories?: string[];
        defaults?: Record<string, Record<string, boolean>>;
      }>("/rbac/catalog"),
  });

  const { data: overridesData, isLoading: overridesLoading } = useQuery({
    queryKey: ["rbac-overrides", companyContext],
    queryFn: () =>
      api<{ effective?: Record<string, Record<string, EffEntry>> }>(path("/rbac/overrides")),
  });

  const isLoading = catalogLoading || overridesLoading;
  const data = { ...catalog, effective: overridesData?.effective };

  const save = useMutation({
    mutationFn: () => {
      const entries = [...pending.entries()].map(([pk, allowed]) => {
        const [r, permissionKey] = pk.split("::");
        return { role: r, permissionKey, allowed };
      });
      return api(path("/rbac/overrides"), { method: "PUT", body: JSON.stringify({ entries }) });
    },
    onSuccess: () => {
      setPending(new Map());
      qc.invalidateQueries({ queryKey: ["rbac-overrides"] });
      refreshStatus().catch(() => {});
    },
  });

  const resetRole = useMutation({
    mutationFn: () => api(path("/rbac/reset"), { method: "POST", body: JSON.stringify({ role }) }),
    onSuccess: () => {
      setPending(new Map());
      qc.invalidateQueries({ queryKey: ["rbac-overrides"] });
      refreshStatus().catch(() => {});
    },
  });

  const roles = useMemo(
    () => catalog?.roles || Object.keys(catalog?.defaults || { agent: {}, tl: {}, op: {}, hr: {}, admin: {} }),
    [catalog?.roles, catalog?.defaults]
  );

  const permsByCat = useMemo(() => {
    const m = new Map<string, Perm[]>();
    (data?.permissions || []).forEach((p) => {
      if (!m.has(p.category)) m.set(p.category, []);
      m.get(p.category)!.push(p);
    });
    return m;
  }, [data?.permissions]);

  const getEffective = (permissionKey: string) => {
    const pk = `${role}::${permissionKey}`;
    if (pending.has(pk)) return pending.get(pk)!;
    const eff = data?.effective?.[role]?.[permissionKey];
    if (eff && typeof eff.effective === "boolean") return eff.effective;
    return data?.defaults?.[role]?.[permissionKey] ?? false;
  };

  const toggle = (permissionKey: string, allowed: boolean) => {
    const pk = `${role}::${permissionKey}`;
    const def = data?.defaults?.[role]?.[permissionKey] ?? false;
    setPending((prev) => {
      const next = new Map(prev);
      if (allowed === def) next.delete(pk);
      else next.set(pk, allowed);
      return next;
    });
  };

  return (
    <div>
      <SectionHeader
        title="Access Control"
        subtitle={`Editing permissions for ${roleLabel(role)}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => resetRole.mutate()} disabled={resetRole.isPending}>
              Reset role
            </Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={!pending.size || save.isPending}>
              Save changes ({pending.size})
            </Button>
          </>
        }
      />

      <div className={styles.rolePicker}>
        {roles.map((r) => (
          <button key={r} type="button" className={`${styles.roleBtn} ${role === r ? styles.roleActive : ""}`} onClick={() => setRole(r)}>
            {roleLabel(r)}
          </button>
        ))}
      </div>

      <Card>
        {isLoading && <p className="muted">Loading…</p>}
        {!isLoading && (
          <div className="table-wrap">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th align="left">Permission</th>
                  <th>Default</th>
                  <th>Effective</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {(data?.categories || [...permsByCat.keys()]).map((cat) => (
                  <Fragment key={`cat-${cat}`}>
                    <tr className={styles.catRow}>
                      <td colSpan={4}><strong>{cat}</strong></td>
                    </tr>
                    {(permsByCat.get(cat) || []).map((p) => {
                      const eff = getEffective(p.key);
                      const pk = `${role}::${p.key}`;
                      const state = pending.has(pk) ? "pending" : data?.effective?.[role]?.[p.key]?.override != null ? "override" : "default";
                      return (
                        <tr key={p.key}>
                          <td>
                            <strong>{p.label}</strong>
                            <div className="muted" style={{ fontSize: "0.75rem" }}>{p.description || p.key}</div>
                          </td>
                          <td align="center">{data?.defaults?.[role]?.[p.key] ? "Allow" : "Deny"}</td>
                          <td align="center">
                            <label>
                              <input type="checkbox" checked={eff} onChange={(e) => toggle(p.key, e.target.checked)} />
                              {" "}{eff ? "Allow" : "Deny"}
                            </label>
                          </td>
                          <td align="center">
                            <span className={styles.badge}>{state}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
