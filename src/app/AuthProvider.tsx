import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, getSessionId, clearSessionId, getCompanyContext } from "@/api/client";
import { useAppStore } from "@/stores/theme-store";
import { scopedPath, userCompanyFromUnit } from "@/lib/apiQuery";

export interface AuthUser {
  username: string;
  role?: string;
  employeeId?: string;
  permissions?: Record<string, boolean>;
  unit?: string;
  canManageHs2Company?: boolean;
  canAccessHs2Company?: boolean;
  canSeeHs2InSales?: boolean;
  [key: string]: unknown;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  status: Record<string, unknown> | null;
  refreshStatus: () => Promise<Record<string, unknown> | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const setCompany = useAppStore((s) => s.setCompanyContext);
  const companyContext = useAppStore((s) => s.companyContext);

  const refreshStatus = async () => {
    if (!getSessionId()) {
      setUser(null);
      setStatus(null);
      return null;
    }
    const month = useAppStore.getState().month;
    const data = await api<Record<string, unknown>>(
      scopedPath("/status", month ? { month } : {}, getCompanyContext()),
      { skipAuthRedirect: true }
    );
    setStatus(data);
    const authUser = (data.user as AuthUser) || null;
    setUser(authUser);
    const canManage =
      authUser?.canManageHs2Company === true || data.canManageHs2Company === true;
    const canAccess =
      authUser?.canAccessHs2Company === true || data.canAccessHs2Company === true;
    if (canManage) {
      setCompany(getCompanyContext() === "hs2" ? "hs2" : "hangup");
    } else if (canAccess) {
      setCompany(userCompanyFromUnit(String(authUser?.unit || "")));
    } else {
      setCompany("hangup");
    }
    return data;
  };
  const refreshRef = useRef(refreshStatus);
  refreshRef.current = refreshStatus;

  useEffect(() => {
    refreshStatus()
      .catch(() => {
        clearSessionId();
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !getSessionId()) return;
    refreshStatus().catch(() => {});
  }, [companyContext]);

  useEffect(() => {
    if (loading || !getSessionId()) return;
    const onVis = () => {
      if (document.visibilityState === "visible") refreshRef.current().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const id = setInterval(() => {
      refreshRef.current().catch(() => {});
    }, 30000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearInterval(id);
    };
  }, [loading]);

  const logout = async () => {
    try {
      await api("/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    clearSessionId();
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, loading, status, refreshStatus, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function useNavVisible(page: string): boolean {
  const { status } = useAuth();
  const nav = (status?.nav as Record<string, boolean>) || {};
  return nav[page] !== false;
}
