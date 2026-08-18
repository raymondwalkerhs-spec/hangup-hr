import { useAuth } from "@/app/AuthProvider";
import { PayrollPage } from "@/pages/payroll/PayrollPage";
import { PayslipPage } from "@/pages/OpsPages";

export function PayrollRoute() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  if (role === "agent" || role === "office_assistant") return <PayslipPage />;
  return <PayrollPage />;
}
