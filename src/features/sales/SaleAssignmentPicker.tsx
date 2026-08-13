import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { FormField, FormGrid, FormSection } from "@/ui/FormGrid";
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
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function useSaleSubmitScope(enabled: boolean) {
  const { path, companyContext } = useCompanyScope();
  return useQuery({
    queryKey: ["sales-submit-scope", companyContext],
    queryFn: () => api<SubmitScope>(path("/sales/submit-scope")),
    enabled,
  });
}

export function useRpmSubmitScope(enabled: boolean) {
  const { path, companyContext } = useCompanyScope();
  return useQuery({
    queryKey: ["rpm-sales-submit-scope", companyContext],
    queryFn: () => api<SubmitScope & { program?: string; enabledPrograms?: string[] }>(path("/rpm-sales/submit-scope")),
    enabled,
  });
}

export function SaleAssignmentPicker({
  scope,
  unit,
  team,
  agentId,
  closerId,
  onChange,
}: {
  scope: SubmitScope;
  unit: string;
  team: string;
  agentId: string;
  closerId: string;
  onChange: (patch: { unit?: string; team?: string; agentId?: string; closerId?: string }) => void;
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
            <select
              value={unit}
              disabled={lockUnit}
              onChange={(e) => onChange({ unit: e.target.value, team: "", agentId: "", closerId: "" })}
            >
              <option value="">— Select unit —</option>
              {units.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Team">
          <div className={styles.readonlyUnit}>{team || "— (from agent)"}</div>
        </FormField>
        <FormField label="Agent">
          <select
            value={agentId}
            disabled={lockAgent}
            onChange={(e) => syncFromAgent(e.target.value)}
          >
            <option value="">— Select agent —</option>
            {agentOptions.map((e) => (
              <option key={e.id} value={e.id}>{e.id} — {e.american_name || e.id}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Closer">
          <select value={closerId} onChange={(e) => onChange({ closerId: e.target.value })}>
            <option value="">— Select closer —</option>
            {closerOptions.map((e) => (
              <option key={e.id} value={e.id}>{e.id} — {e.american_name || e.id}</option>
            ))}
          </select>
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
