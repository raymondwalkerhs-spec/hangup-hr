import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { SalesClientsCatalog } from "@/features/settings/SalesClientsCatalog";
import { BreakTimePicker } from "@/features/settings/BreakTimePicker";
import { api } from "@/api/client";
import { calcEndTime24, formatTimeAmPm } from "@/lib/breakTime";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { FormField, FormGrid } from "@/ui/FormGrid";

type BreakRow = {
  id: string;
  name?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  message?: string;
};

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
  const [breakForm, setBreakForm] = useState({
    name: "",
    startTime: "12:00",
    durationMinutes: "15",
    message: "",
  });
  const [breakError, setBreakError] = useState<string | null>(null);

  const { data: breaksData } = useQuery({
    queryKey: ["settings-breaks", companyContext],
    queryFn: () => api<{ breaks?: BreakRow[] }>(path("/sales-config/breaks")),
    enabled: canManageBreaks,
  });

  const addBreak = useMutation({
    mutationFn: () => {
      const durationMinutes = Number(breakForm.durationMinutes) || 15;
      const startTime = breakForm.startTime;
      const endTime = calcEndTime24(startTime, durationMinutes);
      return api(path("/sales-config/breaks"), {
        method: "POST",
        body: JSON.stringify({
          name: breakForm.name.trim(),
          startTime,
          endTime,
          durationMinutes,
          message: breakForm.message,
        }),
      });
    },
    onSuccess: () => {
      setBreakError(null);
      qc.invalidateQueries({ queryKey: ["settings-breaks"] });
      qc.invalidateQueries({ queryKey: ["breaks"] });
      setBreakForm({ name: "", startTime: "12:00", durationMinutes: "15", message: "" });
    },
    onError: (err: Error) => setBreakError(err.message || "Failed to add break"),
  });

  const delBreak = useMutation({
    mutationFn: (id: string) => api(path(`/sales-config/breaks/${encodeURIComponent(id)}`), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings-breaks"] });
      qc.invalidateQueries({ queryKey: ["breaks"] });
    },
  });

  return (
    <>
      {canManageBreaks && (
        <Card style={{ marginTop: "1rem" }}>
          <h3>Break schedule</h3>
          <p className="muted">Scheduled breaks show a timer overlay for agents. Times are Egypt local.</p>
          <ul style={{ marginBottom: "1rem" }}>
            {(breaksData?.breaks || []).map((b) => (
              <li key={b.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem", gap: "0.5rem" }}>
                <span>
                  <strong>{b.name}</strong>
                  {" — "}
                  {formatTimeAmPm(b.startTime)}
                  {" – "}
                  {formatTimeAmPm(b.endTime || calcEndTime24(b.startTime || "12:00", b.durationMinutes || 15))}
                  {" "}({b.durationMinutes || 15} min)
                </span>
                <Button size="sm" variant="danger" onClick={() => { if (confirm("Delete break?")) delBreak.mutate(b.id); }}>Delete</Button>
              </li>
            ))}
          </ul>
          <FormGrid wide>
            <FormField label="Name">
              <input value={breakForm.name} onChange={(e) => setBreakForm({ ...breakForm, name: e.target.value })} />
            </FormField>
            <BreakTimePicker
              label="Start time"
              value={breakForm.startTime}
              durationMinutes={Number(breakForm.durationMinutes) || 15}
              onChange={(startTime) => setBreakForm({ ...breakForm, startTime })}
            />
            <FormField label="Duration (minutes)">
              <input
                type="number"
                min={1}
                value={breakForm.durationMinutes}
                onChange={(e) => setBreakForm({ ...breakForm, durationMinutes: e.target.value })}
              />
            </FormField>
            <FormField label="Message">
              <input value={breakForm.message} onChange={(e) => setBreakForm({ ...breakForm, message: e.target.value })} />
            </FormField>
            <Button
              size="sm"
              onClick={() => addBreak.mutate()}
              disabled={!breakForm.name.trim() || addBreak.isPending}
            >
              {addBreak.isPending ? "Adding…" : "Add break"}
            </Button>
          </FormGrid>
          {breakError && <p style={{ color: "var(--err)", marginTop: "0.5rem", fontSize: "0.85rem" }}>{breakError}</p>}
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
