import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { FormField, FormGrid, FormSection } from "@/ui/FormGrid";
import { Select } from "@/ui/Select";
import styles from "./SaleModals.module.css";

type Employee = { id: string; american_name?: string; team?: string; unit?: string };
type OrgTeam = { name: string; unit?: string; dialsSales?: boolean; displayOrder?: number };

export type SubmitScope = {
  agents: Employee[];
  closers: Employee[];
  orgTeams: OrgTeam[];
  defaultAgentId?: string;
  defaultCloserId?: string;
  defaultUnit?: string;
  defaultTeam?: string;
  lockAgent?: boolean;
  lockTeam?: boolean;
  lockUnit?: boolean;
  allowedUnits?: string[];
  allowedTeams?: string[];
};

function agentsForUnit(agents: Employee[], unit: string) {
  return agents
    .filter((e) => !unit || e.unit === unit)
    .sort((a, b) => {
      const byName = String(a.american_name || "").localeCompare(String(b.american_name || ""), undefined, {
        sensitivity: "base",
      });
      if (byName) return byName;
      return String(a.id).localeCompare(String(b.id));
    });
}

function agentOptionLabel(e: Employee) {
  const name = e.american_name || e.id;
  const team = e.team ? ` · ${e.team}` : "";
  return `${name} (${e.id})${team}`;
}

export function useSaleSubmitScope(enabled: boolean) {
  const { path, companyContext } = useCompanyScope();
  return useQuery({
    queryKey: ["sales-submit-scope", companyContext],
    queryFn: () => api<SubmitScope>(path("/sales/submit-scope")),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useRpmSubmitScope(enabled: boolean) {
  const { path, companyContext } = useCompanyScope();
  return useQuery({
    queryKey: ["rpm-sales-submit-scope", companyContext],
    queryFn: () => api<SubmitScope & { program?: string; enabledPrograms?: string[] }>(path("/rpm-sales/submit-scope")),
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function SaleAssignmentPicker({
  scope,
  unit,
  team,
  agentId,
  closerId,
  onChange,
  fieldErrors,
}: {
  scope: SubmitScope;
  unit: string;
  team: string;
  agentId: string;
  closerId: string;
  onChange: (patch: { unit?: string; team?: string; agentId?: string; closerId?: string }) => void;
  fieldErrors?: Partial<Record<"agentId" | "closerId", string>>;
}) {
  const { orgTeams, agents, closers, lockAgent, lockUnit, allowedUnits = [] } = scope;

  const units = useMemo(() => {
    const dialing = orgTeams.map((t) => t.unit).filter(Boolean) as string[];
    const list = allowedUnits.length ? allowedUnits : [...new Set(dialing)];
    return [...list].sort();
  }, [orgTeams, allowedUnits]);

  const agentOptions = useMemo(() => {
    // Never filter agents by team — team is derived from the selected agent.
    return agentsForUnit(agents, unit);
  }, [agents, unit]);

  const closerOptions = closers;

  const syncFromAgent = (nextAgentId: string) => {
    const agent = agents.find((e) => e.id === nextAgentId);
    if (!agent) {
      onChange({ agentId: nextAgentId });
      return;
    }
    onChange({
      agentId: nextAgentId,
      team: agent.team || team,
      unit: agent.unit || unit,
    });
  };

  return (
    <FormSection title="Unit, team & assignment">
      <FormGrid wide>
        <FormField label="Unit">
          {lockUnit && unit ? (
            <div className={styles.readonlyUnit}>{unit}</div>
          ) : (
            <Select
              value={unit}
              disabled={lockUnit}
              placeholder="— Select unit —"
              options={[{ value: "", label: "— Select unit —" }, ...units.map((u) => ({ value: u, label: u }))]}
              onChange={(v) => onChange({ unit: v, team: "", agentId: "", closerId: "" })}
            />
          )}
        </FormField>
        <FormField label="Team">
          <div className={styles.readonlyUnit}>{team || "— (from agent)"}</div>
        </FormField>
        <FormField label="Agent" error={fieldErrors?.agentId}>
          <Select
            value={agentId}
            disabled={lockAgent}
            searchable
            placeholder="— Select agent —"
            options={[
              { value: "", label: "— Select agent —" },
              { value: "OTHER", label: "Other (unassigned)" },
              ...agentOptions
                .filter((e) => String(e.id).toUpperCase() !== "OTHER")
                .map((e) => ({ value: e.id, label: agentOptionLabel(e) })),
            ]}
            onChange={(v) => {
              if (String(v).toUpperCase() === "OTHER") {
                onChange({ agentId: "OTHER" });
                return;
              }
              syncFromAgent(v);
            }}
          />
        </FormField>
        <FormField label="Closer" error={fieldErrors?.closerId}>
          <Select
            value={closerId}
            searchable
            placeholder="— Select closer —"
            options={[
              { value: "", label: "— Select closer —" },
              ...closerOptions.map((e) => ({ value: e.id, label: agentOptionLabel(e) })),
            ]}
            onChange={(v) => onChange({ closerId: v })}
          />
        </FormField>
      </FormGrid>
    </FormSection>
  );
}

export function initAssignmentFromScope(scope: SubmitScope) {
  const agentId = scope.defaultAgentId || "";
  const fromAgent = agentId ? (scope.agents || []).find((e) => e.id === agentId) : undefined;
  return {
    unit: fromAgent?.unit || scope.defaultUnit || "",
    team: fromAgent?.team || (agentId ? scope.defaultTeam || "" : ""),
    agentId,
    closerId: scope.defaultCloserId || "",
  };
}

export function initAssignmentFromSale(sale: Record<string, unknown>) {
  const fd = (sale.formData as Record<string, unknown>) || {};
  return {
    unit: String(sale.unit || fd.unit || ""),
    team: String(sale.team || fd.team || ""),
    agentId: String(sale.agentId || ""),
    closerId: String(sale.closerId || ""),
  };
}
