import { useAppStore } from "@/stores/theme-store";
import { buildApiQuery, isHs2Company, scopedPath } from "@/lib/apiQuery";

export function useCompanyScope() {
  const companyContext = useAppStore((s) => s.companyContext);
  return {
    companyContext,
    isHs2: isHs2Company(companyContext),
    buildQuery: (params: Record<string, string | number | boolean | undefined | null> = {}) =>
      buildApiQuery(params, companyContext),
    path: (
      p: string,
      params?: Record<string, string | number | boolean | undefined | null>
    ) => scopedPath(p, params, companyContext),
  };
}
