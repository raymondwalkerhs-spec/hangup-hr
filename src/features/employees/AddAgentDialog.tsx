import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FormField, FormGrid } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";

export function AddAgentDialog({
  open,
  onOpenChange,
  meta,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta?: {
    units?: string[];
    teams?: string[];
    positions?: string[];
  };
}) {
  const qc = useQueryClient();
  const { path, companyContext } = useCompanyScope();
  const [form, setForm] = useState({
    id: "",
    american_name: "",
    arabic_name: "",
    unit: "",
    team: "",
    position: "Agent",
    status: "Active",
    inTraining: false,
    phase1Start: "",
  });

  const { data: unitTeamsData } = useQuery({
    queryKey: ["meta-teams", form.unit, companyContext],
    queryFn: () => api<{ teams?: string[] }>(path("/meta/teams", { unit: form.unit })),
    enabled: Boolean(open && form.unit),
  });
  const unitTeams = unitTeamsData?.teams?.length ? unitTeamsData.teams : [];

  const create = useMutation({
    mutationFn: () =>
      api(path("/employees"), {
        method: "POST",
        body: JSON.stringify({
          id: form.id.trim(),
          american_name: form.american_name.trim(),
          arabic_name: form.arabic_name.trim() || undefined,
          unit: form.unit,
          team: form.team,
          position: form.inTraining ? "Trainee" : form.position,
          status: form.status,
          inTraining: form.inTraining,
          phase1Start: form.inTraining ? form.phase1Start || undefined : undefined,
          ...(companyContext === "hs2" ? { company: "hs2" } : {}),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees-list", companyContext] });
      onOpenChange(false);
      setForm({
        id: "",
        american_name: "",
        arabic_name: "",
        unit: "",
        team: "",
        position: "Agent",
        status: "Active",
        inTraining: false,
        phase1Start: "",
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add agent"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !form.id.trim() || !form.american_name.trim() || !form.unit}>
            Create employee
          </Button>
        </>
      }
    >
      <FormGrid wide>
        <FormField label="App ID *">
          <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="e.g. AG101" />
        </FormField>
        <FormField label="American name *">
          <input value={form.american_name} onChange={(e) => setForm({ ...form, american_name: e.target.value })} />
        </FormField>
        <FormField label="Arabic name">
          <input value={form.arabic_name} onChange={(e) => setForm({ ...form, arabic_name: e.target.value })} />
        </FormField>
        <FormField label="Unit *">
          <Select
            value={form.unit}
            onChange={(unit) => setForm({ ...form, unit, team: "" })}
            options={[{ value: "", label: "—" }, ...(meta?.units || []).map((u) => ({ value: u, label: u }))]}
          />
        </FormField>
        <FormField label="Team">
          <Select
            value={form.team}
            onChange={(team) => setForm({ ...form, team })}
            options={[{ value: "", label: "—" }, ...unitTeams.map((t) => ({ value: t, label: t }))]}
          />
        </FormField>
        <FormField label="Position">
          <Select
            value={form.position}
            disabled={form.inTraining}
            onChange={(position) => setForm({ ...form, position })}
            options={(meta?.positions || ["Agent", "Trainee", "TL"]).map((p) => ({ value: p, label: p }))}
          />
        </FormField>
        <FormField label="In training">
          <label><input type="checkbox" checked={form.inTraining} onChange={(e) => setForm({ ...form, inTraining: e.target.checked })} /> Start training program</label>
        </FormField>
        {form.inTraining && (
          <FormField label="Phase 1 start">
            <input type="date" value={form.phase1Start} onChange={(e) => setForm({ ...form, phase1Start: e.target.value })} />
          </FormField>
        )}
      </FormGrid>
      {create.isError && <p style={{ color: "var(--err)" }}>{(create.error as Error).message}</p>}
    </Dialog>
  );
}
