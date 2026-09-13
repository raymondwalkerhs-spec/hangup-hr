import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./AppShell";
import { RequireAccess } from "./RequireAccess";
import { TrailingSlashRedirect } from "./TrailingSlashRedirect";
import { LoginPage } from "@/pages/auth/LoginPage";
import { Setup2faPage } from "@/pages/auth/Setup2faPage";
import { LinkGooglePage } from "@/pages/auth/LinkGooglePage";
import { OauthPendingPage } from "@/pages/auth/OauthPendingPage";
import { CatsPage } from "@/pages/cats/CatsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { SalesPage } from "@/pages/SalesPage";
import { CostsPage } from "@/pages/CostsPage";
import { OfficePoPage } from "@/pages/office-po/OfficePoPage";
import ChecksPage from "@/pages/checks/ChecksPage";
import QFeedbackPage from "@/pages/checks/QFeedbackPage";
import CheckDuplicatesPage from "@/pages/checks/CheckDuplicatesPage";
import {
  BonusesPage,
  DeductionsPage,
  LoansPage,
  LoanApprovalsPage,
  SalariesPage,
  UsersPage,
  ChangesPage,
} from "@/pages/HrPages";
import { EmployeesPage } from "@/features/employees/EmployeesPage";
import { AttendancePage } from "@/pages/attendance/AttendancePage";
import { PayrollRoute } from "@/pages/payroll/PayrollRoute";
import {
  OrgPage,
  EquipmentPage,
  RequestsPage,
  ItRequestsPage,
  MeetingRequestsPage,
  InterviewsPage,
  TrainingPage,
  BreaksPage,
  TeamDashboardPage,
  PayslipPage,
  ReportsPage,
  CoachingPage,
} from "@/pages/OpsPages";
import {
  SettingsPage,
  AccessControlPage,
  SalesPermissionsPage,
  SalesLogColumnsPage,
  RulesPage,
  AnnouncementsPage,
} from "@/pages/AdminPages";
import { BackupPage } from "@/pages/backup/BackupPage";
import { OffboardingPage } from "@/pages/compliance/OffboardingPage";
import { ClearancePage } from "@/pages/compliance/ClearancePage";
import { RecycleBinPage } from "@/pages/settings/RecycleBinPage";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { getSessionId } from "@/api/client";
import { firstAllowedPage, type StatusUser } from "@/lib/nav-access";
import styles from "./RequireAccess.module.css";
import { CatOrbitLoader } from "@/features/shell/PageLoadingOverlay";

const SETUP_PATHS = new Set(["/setup-2fa", "/link-google", "/oauth-pending"]);

function ProtectedLayout() {
  const { loading, status } = useAuth();
  const location = useLocation();
  if (!getSessionId()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (loading) {
    return (
      <div className={styles.loading}>
        <CatOrbitLoader message="Loading workspace…" />
      </div>
    );
  }
  const security = status?.authSecurity as
    | {
        needsSetup?: boolean;
        needsMfaEnroll?: boolean;
        needsGoogleLink?: boolean;
        sessionKind?: string;
      }
    | undefined;
  if (
    security?.needsSetup ||
    security?.sessionKind === "pending_setup" ||
    security?.needsMfaEnroll ||
    security?.needsGoogleLink
  ) {
    if (!SETUP_PATHS.has(location.pathname)) {
      if (security.needsMfaEnroll) return <Navigate to="/setup-2fa" replace />;
      if (security.needsGoogleLink) return <Navigate to="/link-google" replace />;
      return <Navigate to="/setup-2fa" replace />;
    }
  }
  return <AppShell />;
}

function FallbackRedirect() {
  const { status } = useAuth();
  const user = status?.user as StatusUser | undefined;
  return <Navigate to={`/${firstAllowedPage(user)}`} replace />;
}

function Guard({ page, children }: { page: string; children: ReactNode }) {
  return <RequireAccess page={page}>{children}</RequireAccess>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <TrailingSlashRedirect />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/oauth-pending" element={<OauthPendingPage />} />
        <Route path="/setup-2fa" element={<Setup2faPage />} />
        <Route path="/link-google" element={<LinkGooglePage />} />
        <Route element={<ProtectedLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Guard page="dashboard"><DashboardPage /></Guard>} />
          <Route path="cats" element={<Guard page="cats"><CatsPage /></Guard>} />
          <Route path="announcements" element={<Guard page="announcements"><AnnouncementsPage /></Guard>} />
          <Route path="employees" element={<Guard page="employees"><EmployeesPage /></Guard>} />
          <Route path="org" element={<Guard page="org"><OrgPage /></Guard>} />
          <Route path="equipment" element={<Guard page="equipment"><EquipmentPage /></Guard>} />
          <Route path="interviews" element={<Guard page="interview"><InterviewsPage /></Guard>} />
          <Route path="training" element={<Guard page="training"><TrainingPage /></Guard>} />
          <Route path="coaching" element={<Guard page="coaching"><CoachingPage /></Guard>} />
          <Route path="attendance" element={<Guard page="attendance"><AttendancePage /></Guard>} />
          <Route path="breaks" element={<Guard page="breaks"><BreaksPage /></Guard>} />
          <Route path="requests" element={<Guard page="requests"><RequestsPage /></Guard>} />
          <Route path="meeting-requests" element={<Guard page="meeting-requests"><MeetingRequestsPage /></Guard>} />
          <Route path="it-requests" element={<Guard page="it-requests"><ItRequestsPage /></Guard>} />
          <Route path="payroll" element={<Guard page="payroll"><PayrollRoute /></Guard>} />
          <Route path="salaries" element={<Guard page="salaries"><SalariesPage /></Guard>} />
          <Route path="bonuses" element={<Guard page="bonuses"><BonusesPage /></Guard>} />
          <Route path="deductions" element={<Guard page="deductions"><DeductionsPage /></Guard>} />
          <Route path="loans" element={<Guard page="loans"><LoansPage /></Guard>} />
          <Route path="loan-approvals" element={<Guard page="loan-approvals"><LoanApprovalsPage /></Guard>} />
          <Route path="payslip" element={<Guard page="payslip"><PayslipPage /></Guard>} />
          <Route path="sales" element={<Guard page="sales"><SalesPage /></Guard>} />
          <Route path="checks" element={<Guard page="checks"><ChecksPage /></Guard>} />
          <Route path="q-feedback" element={<Guard page="q-feedback"><QFeedbackPage /></Guard>} />
          <Route path="check-duplicates" element={<Guard page="check-duplicates"><CheckDuplicatesPage /></Guard>} />
          <Route path="team-dashboard" element={<Guard page="team-dashboard"><TeamDashboardPage /></Guard>} />
          <Route path="costs" element={<Guard page="costs"><CostsPage /></Guard>} />
          <Route path="office-po" element={<Guard page="office-po"><OfficePoPage /></Guard>} />
          <Route path="reports" element={<Guard page="reports"><ReportsPage /></Guard>} />
          <Route path="analytics" element={<Guard page="analytics"><AnalyticsPage /></Guard>} />
          <Route path="users" element={<Guard page="users"><UsersPage /></Guard>} />
          <Route path="access-control" element={<Guard page="access-control"><AccessControlPage /></Guard>} />
          <Route path="sales-permissions" element={<Guard page="sales-permissions"><SalesPermissionsPage /></Guard>} />
          <Route path="sales-log-columns" element={<Guard page="sales-log-columns"><SalesLogColumnsPage /></Guard>} />
          <Route path="rules" element={<Guard page="rules"><RulesPage /></Guard>} />
          <Route path="changes" element={<Guard page="changes"><ChangesPage /></Guard>} />
          <Route path="backup" element={<Guard page="backup"><BackupPage /></Guard>} />
          <Route path="offboarding" element={<Guard page="offboarding"><OffboardingPage /></Guard>} />
          <Route path="clearance" element={<Guard page="clearance"><ClearancePage /></Guard>} />
          <Route path="recycle" element={<Guard page="recycle"><RecycleBinPage /></Guard>} />
          <Route path="settings" element={<Guard page="settings"><SettingsPage /></Guard>} />
          <Route path="*" element={<FallbackRedirect />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
