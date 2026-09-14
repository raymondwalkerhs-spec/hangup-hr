import { SalesClientsCatalog } from "@/features/settings/SalesClientsCatalog";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Card } from "@/ui/Card";

export function SettingsAdminExtras({
  canManageClients,
  canManageHs2,
}: {
  canManageClients?: boolean;
  canManageHs2?: boolean;
}) {
  const { companyContext } = useCompanyScope();
  const settingsCompany = companyContext === "hs2" ? "hs2" : "hangup";

  if (!canManageClients) return null;

  return (
    <Card style={{ marginTop: "1rem" }}>
      <h3>Sales clients catalog</h3>
      <SalesClientsCatalog company={settingsCompany} canManageHs2={canManageHs2 === true} />
    </Card>
  );
}
