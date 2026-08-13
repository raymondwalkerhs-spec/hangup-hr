import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { canAccessPage, firstAllowedPage, type StatusUser } from "@/lib/nav-access";
import { CatOrbitLoader } from "@/features/shell/PageLoadingOverlay";
import styles from "./RequireAccess.module.css";

export function RequireAccess({ page, children }: { page: string; children: ReactNode }) {
  const { status, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className={styles.loadingInline}>
        <CatOrbitLoader message="Loading…" />
      </div>
    );
  }

  const user = status?.user as StatusUser | undefined;
  if (!canAccessPage(user, page)) {
    const fallback = firstAllowedPage(user);
    if (fallback === page) {
      return <>{children}</>;
    }
    return <Navigate to={`/${fallback}`} replace state={{ deniedFrom: location.pathname }} />;
  }

  return <>{children}</>;
}
