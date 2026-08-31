import {
  Plus,
  FileText,
  RefreshCw,
  PieChart,
  Headphones,
  Building2,
  ClipboardCheck,
  MessageSquare,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useAppStatus } from "@/hooks/useAppStatus";
import { useAuth } from "@/app/AuthProvider";
import { useSalesIntentStore } from "@/stores/sales-intent-store";
import { useAppStore } from "@/stores/theme-store";
import { setCompanyContext as persistCompany } from "@/api/client";
import styles from "./BottomDock.module.css";

type DockAction = {
  icon: typeof Plus;
  label: string;
  path: string | null;
  openForm?: boolean;
  requiresSales?: boolean;
  requiresIt?: boolean;
  requiresCosts?: boolean;
  requiresChecks?: boolean;
  requiresQFeedback?: boolean;
};

const BASE_ACTIONS: DockAction[] = [
  { icon: Plus, label: "Sale", path: "/sales", openForm: true, requiresSales: true },
  { icon: ClipboardCheck, label: "Check", path: "/checks", openForm: true, requiresChecks: true },
  { icon: MessageSquare, label: "Q Feedback", path: "/q-feedback", openForm: true, requiresQFeedback: true },
  { icon: FileText, label: "Leave", path: "/requests" },
  { icon: Headphones, label: "IT", path: "/it-requests", openForm: true, requiresIt: true },
  { icon: PieChart, label: "Costs", path: "/costs", requiresCosts: true },
  { icon: RefreshCw, label: "Sync", path: null },
];

export function BottomDock({ onSync }: { onSync?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const requestNewSale = useSalesIntentStore((s) => s.requestNewSale);
  const { user } = useAppStatus();
  const { refreshStatus } = useAuth();
  const companyContext = useAppStore((s) => s.companyContext);
  const setCompanyContext = useAppStore((s) => s.setCompanyContext);

  const canCosts = user?.canAccessCosts === true || user?.canSubmitExpense === true;
  const canSales = user?.canSubmitSales === true;
  const canIt = user?.canViewItRequests === true || user?.canSubmitItRequest === true;
  const canChecks = user?.canSubmitRpmChecks === true;
  const canQFeedback = user?.canSubmitRpmQFeedback === true;
  const canSwitchCompany = user?.canManageHs2Company === true;
  const isHs2 = companyContext === "hs2";

  const actions = BASE_ACTIONS.filter((a) => {
    if (a.requiresCosts) return canCosts;
    if (a.requiresSales) return canSales;
    if (a.requiresIt) return canIt;
    if (a.requiresChecks) return canChecks;
    if (a.requiresQFeedback) return canQFeedback;
    return true;
  });

  const go = (path: string, openForm?: boolean) => {
    if (openForm && path === "/sales") {
      requestNewSale();
      navigate("/sales");
      return;
    }
    const url = openForm ? `${path}?action=new` : path;
    navigate(url);
  };

  const toggleCompany = () => {
    const next = isHs2 ? "hangup" : "hs2";
    persistCompany(next);
    setCompanyContext(next);
    qc.invalidateQueries();
    refreshStatus().catch(() => {});
  };

  return (
    <motion.div
      className={styles.dock}
      data-chrome="dock"
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 25 }}
    >
      {canSwitchCompany && (
        <button
          type="button"
          className={`${styles.item} ${styles.companyToggle} ${isHs2 ? styles.companyHs2 : ""} interactive`}
          onClick={toggleCompany}
          title={isHs2 ? "Switch to Main Hangup" : "Switch to HS-2"}
        >
          <Building2 size={20} />
          <span>{isHs2 ? "Main" : "HS-2"}</span>
        </button>
      )}
      {actions.map(({ icon: Icon, label, path, openForm }) => (
        <button
          key={label}
          type="button"
          className={`${styles.item} interactive`}
          onClick={() => (path ? go(path, openForm) : onSync?.())}
          title={label}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </motion.div>
  );
}
