import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";

export function useSaleSubmitPrograms() {
  const { path, companyContext } = useCompanyScope();
  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["sales-submit-scope", companyContext],
    queryFn: () => api<{ enabledPrograms?: string[] }>(path("/sales/submit-scope")),
    staleTime: 60_000,
  });
  const enabledPrograms = data?.enabledPrograms ?? ["mla", "rpm"];
  const canSubmitMla = enabledPrograms.includes("mla");
  const canSubmitRpm = enabledPrograms.includes("rpm");
  const canSubmitAny = canSubmitMla || canSubmitRpm;
  const needsProgramPicker = canSubmitMla && canSubmitRpm;

  return {
    enabledPrograms,
    canSubmitMla,
    canSubmitRpm,
    canSubmitAny,
    needsProgramPicker,
    isLoading,
    ready: isFetched || !isLoading,
  };
}
