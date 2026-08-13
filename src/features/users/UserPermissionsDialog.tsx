import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";

type Perm = { key: string; label: string; category?: string };

export function UserPermissionsDialog({
  username,
  role,
  open,
  onOpenChange,
}: {
  username: string | null;
  role?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { path } = useCompanyScope();
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());

  const { data: catalog } = useQuery({
    queryKey: ["rbac-catalog-user-perms"],
    queryFn: () => api<{ permissions?: Perm[] }>("/rbac/catalog"),
    enabled: open,
  });

  const { data: permData, isLoading } = useQuery({
    queryKey: ["user-permissions", username, role],
    queryFn: () =>
      api<{ defaults?: Record<string, boolean>; overrides?: { permissionKey: string; allowed: boolean }[] }>(
        path(`/admin/users/${encodeURIComponent(username!)}/permissions`, role ? { role } : undefined)
      ),
    enabled: open && !!username,
  });

  useEffect(() => {
    if (!open) setPending(new Map());
  }, [open, username]);

  const overrides = Object.fromEntries((permData?.overrides || []).map((o) => [o.permissionKey, o.allowed]));
  const defaults = permData?.defaults || {};

  const getEffective = (key: string) => {
    if (pending.has(key)) return pending.get(key)!;
    if (overrides[key] !== undefined) return overrides[key];
    return defaults[key] ?? false;
  };

  const toggle = (key: string, allowed: boolean) => {
    const def = defaults[key] ?? false;
    setPending((prev) => {
      const next = new Map(prev);
      if (allowed === def) next.delete(key);
      else next.set(key, allowed);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const final = new Map<string, boolean>();
      (permData?.overrides || []).forEach((o) => final.set(o.permissionKey, o.allowed));
      pending.forEach((allowed, key) => {
        const def = defaults[key] ?? false;
        if (allowed === def) final.delete(key);
        else final.set(key, allowed);
      });
      const entries = [...final.entries()].map(([permissionKey, allowed]) => ({ permissionKey, allowed }));
      return api(path(`/admin/users/${encodeURIComponent(username!)}/permissions`), {
        method: "PUT",
        body: JSON.stringify({ entries }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-permissions", username] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setPending(new Map());
      onOpenChange(false);
    },
  });

  const clearAll = useMutation({
    mutationFn: () => api(path(`/admin/users/${encodeURIComponent(username!)}/permissions`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-permissions", username] });
      setPending(new Map());
    },
  });

  const perms = catalog?.permissions || [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Exception access — ${username}`}
      xlarge
      scrollBody
      footer={
        <>
          <Button variant="secondary" onClick={() => clearAll.mutate()}>Clear all exceptions</Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!pending.size || save.isPending}>Save ({pending.size})</Button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: "0.75rem" }}>Override Access Control keys for this user only.</p>
      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && perms.map((p) => {
        const eff = getEffective(p.key);
        const hasEx = pending.has(p.key) || overrides[p.key] !== undefined;
        return (
          <label key={p.key} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.35rem", alignItems: "flex-start" }}>
            <input type="checkbox" checked={eff} onChange={(e) => toggle(p.key, e.target.checked)} />
            <span>
              <strong>{p.label}</strong>
              <span className="muted" style={{ fontSize: "0.75rem", display: "block" }}>
                Role default: {defaults[p.key] ? "Allow" : "Deny"}{hasEx ? " · exception" : ""}
              </span>
            </span>
          </label>
        );
      })}
    </Dialog>
  );
}
