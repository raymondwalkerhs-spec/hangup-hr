import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/app/AuthProvider";
import { setCompanyContext as persistCompany } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import styles from "./CompanySwitcher.module.css";

export function CompanySwitcher({ collapsed }: { collapsed?: boolean }) {
  const { status, refreshStatus } = useAuth();
  const qc = useQueryClient();
  const companyContext = useAppStore((s) => s.companyContext);
  const setCompanyContext = useAppStore((s) => s.setCompanyContext);
  const statusUser = (status?.user || {}) as Record<string, unknown>;
  const canManage =
    statusUser.canManageHs2Company === true || status?.canManageHs2Company === true;
  const isHs2 = companyContext === "hs2";

  const switchTo = (next: "hangup" | "hs2") => {
    if (next === companyContext) return;
    persistCompany(next);
    setCompanyContext(next);
    qc.invalidateQueries();
    refreshStatus().catch(() => {});
  };

  if (!canManage) {
    return null;
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className={`${styles.collapsedBadge} ${styles.collapsedBtn} ${isHs2 ? styles.collapsedHs2 : ""}`}
        title={isHs2 ? "Switch to Main Hangup" : "Switch to HS-2"}
        onClick={() => switchTo(isHs2 ? "hangup" : "hs2")}
      >
        {isHs2 ? "2" : "H"}
      </button>
    );
  }

  return (
    <div className={styles.switcher} role="group" aria-label="Company to manage">
      <span className={styles.label}>Managing</span>
      <div className={styles.btns}>
        <button
          type="button"
          className={`${styles.btn} ${!isHs2 ? styles.active : ""}`}
          onClick={() => switchTo("hangup")}
        >
          Main Hangup
        </button>
        <button
          type="button"
          className={`${styles.btn} ${isHs2 ? styles.active : ""}`}
          onClick={() => switchTo("hs2")}
        >
          HS-2
        </button>
      </div>
    </div>
  );
}
