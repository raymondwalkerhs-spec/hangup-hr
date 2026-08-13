import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SalesClientsCatalog } from "@/features/settings/SalesClientsCatalog";
import { api } from "@/api/client";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { FormField, FormGrid } from "@/ui/FormGrid";

export function SettingsAdminExtras({
  canManageBreaks,
  canManageClients,
  canManageHs2,
}: {
  canManageBreaks?: boolean;
  canManageClients?: boolean;
  canManageHs2?: boolean;
}) {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const settingsCompany = companyContext === "hs2" ? "hs2" : "hangup";
  const [breakForm, setBreakForm] = useState({ name: "", startTime: "12:00", durationMinutes: "15", message: "" });

  const { data: breaksData } = useQuery({
    queryKey: ["settings-breaks", companyContext],
    queryFn: () => api<{ breaks?: { id: string; name?: string; startTime?: string; durationMinutes?: number; message?: string }[] }>(path("/sales-config/breaks")),
    enabled: canManageBreaks,
  });

  const addBreak = useMutation({
    mutationFn: () => api(path("/sales-config/breaks"), { method: "POST", body: JSON.stringify({ ...breakForm, durationMinutes: Number(breakForm.durationMinutes) }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings-breaks"] }); setBreakForm({ name: "", startTime: "12:00", durationMinutes: "15", message: "" }); },
  });

  const delBreak = useMutation({
    mutationFn: (id: string) => api(path(`/sales-config/breaks/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings-breaks"] }),
  });

  return (
    <>
      {canManageBreaks && (
        <Card style={{ marginTop: "1rem" }}>
          <h3>Break schedule</h3>
          <p className="muted">Scheduled breaks show a timer overlay for agents.</p>
          <ul style={{ marginBottom: "1rem" }}>
            {(breaksData?.breaks || []).map((b) => (
              <li key={b.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                <span><strong>{b.name}</strong> — {b.startTime} ({b.durationMinutes} min)</span>
                <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete break?")) delBreak.mutate(b.id); }}>Delete</Button>
              </li>
            ))}
          </ul>
          <FormGrid wide>
            <FormField label="Name"><input value={breakForm.name} onChange={(e) => setBreakForm({ ...breakForm, name: e.target.value })} /></FormField>
            <FormField label="Start (HH:MM)"><input value={breakForm.startTime} onChange={(e) => setBreakForm({ ...breakForm, startTime: e.target.value })} /></FormField>
            <FormField label="Minutes"><input type="number" value={breakForm.durationMinutes} onChange={(e) => setBreakForm({ ...breakForm, durationMinutes: e.target.value })} /></FormField>
            <FormField label="Message"><input value={breakForm.message} onChange={(e) => setBreakForm({ ...breakForm, message: e.target.value })} /></FormField>
            <Button size="sm" onClick={() => addBreak.mutate()} disabled={!breakForm.name}>Add break</Button>
          </FormGrid>
        </Card>
      )}
      {canManageClients && (
        <Card style={{ marginTop: "1rem" }}>
          <h3>Sales clients catalog</h3>
          <SalesClientsCatalog
            company={settingsCompany}
            canManageHs2={canManageHs2 === true}
          />
        </Card>
      )}
    </>
  );
}
