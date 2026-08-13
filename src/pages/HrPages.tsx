import { createListPage } from "./createListPage";
import { changeCols } from "@/api/columnMaps";

export { EmployeesPage } from "@/features/employees/EmployeesPage";
export { SalariesPage } from "./salaries/SalariesPage";
export { BonusesPage } from "./bonuses/BonusesPage";
export { DeductionsPage } from "./deductions/DeductionsPage";
export { LoansPage } from "./loans/LoansPage";
export { LoanApprovalsPage } from "./loans/LoanApprovalsPage";

export { UsersPage } from "./users/UsersPage";

export const ChangesPage = createListPage({
  title: "Changes",
  queryKey: ["changelog"],
  fetchPath: "/changelog",
  companyScoped: true,
  columns: changeCols,
  inspectorTitle: (r) => String(r.summary || r.action || r.entity),
});
