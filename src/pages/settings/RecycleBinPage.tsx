import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SectionHeader } from "@/ui/SectionHeader";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmDialog } from "@/ui/Dialog";
import { useState } from "react";

type RecycleItem = {
  id: string;
  sourceTable: string;
  sourceId: string;
  deletedBy?: string;
  deletedAt?: string;
  snapshot?: Record<string, unknown>;
};

export function RecycleBinPage() {
  const { path } = useCompanyScope();
  const qc = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["recycle-bin"],
    queryFn: () => api<{ items: RecycleItem[] }>(path("/recycle-bin")),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api(path(`/recycle-bin/${id}/restore`), { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recycle-bin"] }),
  });

  const items = data?.items || [];

  return (
    <div>
      <SectionHeader title="Recycle bin" subtitle="Items stay 20 days, then files are purged" />
      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="muted">{(error as Error).message}</p>}
      <Card>
        {items.length === 0 && <p className="muted">Nothing in the bin.</p>}
        {items.map((item) => (
          <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.65rem 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <strong>{item.sourceTable}</strong>
              <div className="muted" style={{ fontSize: "0.8rem" }}>
                {String(item.snapshot?.title || item.snapshot?.employee_id || item.sourceId)} · {item.deletedBy || "—"} · {String(item.deletedAt || "").slice(0, 16)}
              </div>
            </div>
            <Button size="sm" onClick={() => setConfirmId(item.id)}>Restore</Button>
          </div>
        ))}
      </Card>
      <ConfirmDialog
        open={Boolean(confirmId)}
        onOpenChange={(o) => !o && setConfirmId(null)}
        title="Restore this item?"
        message="It will go back to the live list."
        onConfirm={() => confirmId && restore.mutate(confirmId)}
      />
    </div>
  );
}
