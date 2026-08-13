import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fmt, monthLabel } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import styles from "./CommissionTiersCard.module.css";

type Tier = { minSales: number; maxSales?: number | null; rateEgp: number; commissionType?: string };

export function CommissionTiersCard() {
  const month = useAppStore((s) => s.month);
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [edits, setEdits] = useState<Tier[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["commission-tiers", month, companyContext],
    queryFn: () => api<{ tiers: Tier[] }>(path("/commission-tiers", { month })),
  });

  const tiers = edits.length ? edits : data?.tiers || [];

  const save = useMutation({
    mutationFn: () =>
      api(path("/commission-tiers"), { method: "PUT", body: JSON.stringify({ month, tiers }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["commission-tiers", month] });
      setEdits([]);
    },
  });

  const updateTier = (idx: number, patch: Partial<Tier>) => {
    const next = [...tiers];
    next[idx] = { ...next[idx], ...patch };
    setEdits(next);
  };

  const addTier = () => {
    setEdits([...tiers, { minSales: 0, maxSales: null, rateEgp: 0, commissionType: "" }]);
  };

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <div>
          <h3>Commission tiers</h3>
          <p className="muted">{monthLabel(month)}</p>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={addTier}>Add tier</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save tiers</Button>
        </div>
      </div>
      {isLoading && <p className="muted">Loading…</p>}
      <table className={styles.table}>
        <thead>
          <tr><th>Min sales</th><th>Max sales</th><th>Rate (EGP)</th><th>Type</th></tr>
        </thead>
        <tbody>
          {tiers.map((t, i) => (
            <tr key={i}>
              <td><input type="number" value={t.minSales} onChange={(e) => updateTier(i, { minSales: Number(e.target.value) })} className={styles.input} /></td>
              <td><input type="number" value={t.maxSales ?? ""} placeholder="∞" onChange={(e) => updateTier(i, { maxSales: e.target.value ? Number(e.target.value) : null })} className={styles.input} /></td>
              <td><input type="number" value={t.rateEgp} onChange={(e) => updateTier(i, { rateEgp: Number(e.target.value) })} className={styles.input} /></td>
              <td><input value={t.commissionType || ""} onChange={(e) => updateTier(i, { commissionType: e.target.value })} className={styles.input} /></td>
            </tr>
          ))}
          {!tiers.length && !isLoading && (
            <tr><td colSpan={4} className="muted">No tiers — click Add tier</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
