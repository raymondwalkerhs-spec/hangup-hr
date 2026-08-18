import { Outlet, NavLink } from "react-router-dom";
import { Menu, LogOut, RefreshCw, Search, Moon, Sun, ChevronLeft, Pin } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthProvider";
import { NAV_GROUPS, NAV_ITEMS } from "./nav-config";
import { useAppStore, useThemeStore, THEMES } from "@/stores/theme-store";
import { useWorkspaceStore } from "@/stores/cross-filter-store";
import { InspectorRail } from "@/workspace/InspectorRail";
import { CommandPalette } from "@/workspace/CommandPalette";
import { TimelineScrubber } from "@/workspace/TimelineScrubber";
import { BottomDock } from "@/workspace/BottomDock";
import { Button } from "@/ui/Button";
import { StatusPill } from "@/ui/StatusPill";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { api } from "@/api/client";
import { canAccessPage, isRestrictedPage, type StatusUser } from "@/lib/nav-access";
import { PAGE_TITLES, PATH_TITLES } from "./nav-config";
import { scopedPath } from "@/lib/apiQuery";
import { CompanySwitcher } from "@/features/company/CompanySwitcher";
import { NotificationBell } from "@/features/shell/NotificationBell";
import { BreakOverlay } from "@/features/shell/BreakOverlay";
import { VersionUpdateGate } from "@/features/shell/VersionUpdateGate";
import { ReconnectBanner } from "@/features/shell/ReconnectBanner";
import { AgentGuide } from "@/features/shell/AgentGuide";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useInspectorStore } from "@/stores/cross-filter-store";
import { useLocation } from "react-router-dom";
import { useMemo, useRef, useCallback, useEffect, useState } from "react";
import styles from "./AppShell.module.css";

function NavIcon({ name }: { name: string }) {
  const pascal = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("") as keyof typeof LucideIcons;
  const Icon = LucideIcons[pascal] as React.ComponentType<{ size?: number; strokeWidth?: number }>;
  return Icon ? <Icon size={18} strokeWidth={2} /> : <LucideIcons.Circle size={14} />;
}

function useVisibleNav() {
  const { status, loading } = useAuth();
  return useMemo(() => {
    const user = status?.user as StatusUser | undefined;
    // Before /status resolves, do not show payroll-only links (they bounce to dashboard).
    if (loading && !user) {
      return NAV_ITEMS.filter((item) => !isRestrictedPage(item.page));
    }
    return NAV_ITEMS.filter((item) => canAccessPage(user, item.page));
  }, [status, loading]);
}

export function AppShell() {
  const { user, logout, refreshStatus, status } = useAuth();
  const { sidebarCollapsed, sidebarPinned, toggleSidebar, setSidebarCollapsed, setSidebarPinned } = useAppStore();
  const { theme, setTheme } = useThemeStore();
  const setCommandOpen = useWorkspaceStore((s) => s.setCommandOpen);
  const location = useLocation();
  const visibleNav = useVisibleNav();
  const inspectorOpen = useInspectorStore((s) => s.open);
  const companyContext = useAppStore((s) => s.companyContext);
  const month = useAppStore((s) => s.month);
  const qc = useQueryClient();
  const showAnnouncementsNav = visibleNav.some((item) => item.path === "/announcements");
  const { data: announcementUnreadData } = useQuery({
    queryKey: ["announcement-unread", companyContext],
    queryFn: () => api<{ unreadCount?: number }>(scopedPath("/announcements/unread-count", {}, companyContext)),
    refetchInterval: 30000,
    enabled: showAnnouncementsNav,
  });
  const unreadAnnouncements = announcementUnreadData?.unreadCount || 0;
  const { state: connState } = useConnectionStatus();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const pageKey = location.pathname.replace(/^\//, "") || "dashboard";
  const [outletKey, setOutletKey] = useState(0);
  useEffect(() => {
    setOutletKey((k) => k + 1);
  }, [location.pathname]);
  const title = PATH_TITLES[pageKey] || PAGE_TITLES[pageKey] || "Hangup Portal";
  const impersonating = Boolean(status?.impersonating);
  const themeMeta = THEMES.find((t) => t.id === theme) || THEMES[0];
  const isDark = theme === "dark" || theme === "red-wine";

  const showSidebar = () => {
    clearTimeout(hideTimer.current);
    setSidebarCollapsed(false);
  };

  const scheduleHide = useCallback(() => {
    if (sidebarPinned) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setSidebarCollapsed(true), 400);
  }, [sidebarPinned, setSidebarCollapsed]);

  const prefetchPage = useCallback(
    (navPath: string) => {
      if (navPath === "/payroll") {
        void qc.prefetchQuery({
          queryKey: ["payroll-full", month, companyContext, true],
          queryFn: () =>
            api(scopedPath("/payroll", { month, hideOut: "true" }, companyContext)),
          staleTime: 60_000,
        });
      } else if (navPath === "/employees") {
        void qc.prefetchQuery({
          queryKey: ["employees-list", true, companyContext, month],
          queryFn: () =>
            api(
              scopedPath(
                "/employees",
                { month, hideOut: "true", showLegacy: "false" },
                companyContext
              )
            ),
          staleTime: 60_000,
        });
      }
    },
    [qc, month, companyContext]
  );

  const handleSync = async () => {
    await api("/sync/refresh", { method: "POST" });
    await refreshStatus();
  };

  const cycleTheme = () => {
    const idx = THEMES.findIndex((t) => t.id === theme);
    setTheme(THEMES[(idx + 1) % THEMES.length].id);
  };

  useEffect(() => {
    document.body.classList.toggle("company-hs2", companyContext === "hs2");
    document.title = companyContext === "hs2" ? "Hangup HS-2" : "Hangup Portal";
  }, [companyContext]);

  return (
    <div
      className={`${styles.shell} ${sidebarCollapsed ? styles.collapsed : ""} ${sidebarPinned ? styles.pinned : ""}`}
      onMouseLeave={scheduleHide}
    >
      {sidebarCollapsed && !sidebarPinned && (
        <div className={styles.sidebarHitZone} onMouseEnter={showSidebar} aria-hidden />
      )}
      <aside className={styles.sidebar} onMouseEnter={showSidebar}>
        <div className={styles.brand}>
          <button type="button" className={styles.menuBtn} onClick={toggleSidebar} aria-label="Toggle sidebar">
            {sidebarCollapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
          </button>
          {!sidebarCollapsed && (
            <div className={styles.brandText}>
              <img src="/img/hr-team.png" alt="" className={styles.logo} />
              <div>
                <strong>Hangup Portal</strong>
                <span className={styles.brandSub}>HR workspace</span>
              </div>
            </div>
          )}
          {!sidebarCollapsed && (
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setSidebarPinned(!sidebarPinned)}
              title={sidebarPinned ? "Unpin sidebar" : "Pin sidebar open"}
              style={{ marginLeft: "auto" }}
            >
              <Pin size={16} style={{ opacity: sidebarPinned ? 1 : 0.5 }} />
            </button>
          )}
        </div>

        <CompanySwitcher collapsed={sidebarCollapsed} />

        <nav className={styles.nav}>
          {NAV_GROUPS.map((group) => {
            const items = visibleNav.filter((n) => n.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className={styles.navGroup}>
                <div className={styles.navLabel} aria-hidden={sidebarCollapsed || undefined}>{group}</div>
                {items.map((item) => {
                  const unread = item.path === "/announcements" ? unreadAnnouncements : 0;
                  return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `${styles.navBtn} ${isActive ? styles.active : ""}`}
                    data-tour={item.navId}
                    title={sidebarCollapsed ? `${item.label}${unread ? ` (${unread})` : ""}` : undefined}
                    onMouseEnter={() => prefetchPage(item.path)}
                    onFocus={() => prefetchPage(item.path)}
                  >
                    <span className={styles.navIcon}><NavIcon name={item.icon} /></span>
                    <span className={styles.navText} aria-hidden={sidebarCollapsed || undefined}>{item.label}</span>
                    {unread > 0 && <span className={styles.navCount}>{unread > 99 ? "99+" : unread}</span>}
                  </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className={styles.footer}>
          {!sidebarCollapsed && user && (
            <div className={styles.userBlock}>
              <div className={styles.userAvatar}>{(user.username || "?")[0].toUpperCase()}</div>
              <div className={styles.userMeta}>
                <strong>{user.username}</strong>
                <span>{String(status?.user?.role || "user")}</span>
              </div>
            </div>
          )}
          <div className={styles.footerActions}>
            <Button variant="ghost" size="sm" onClick={handleSync} title="Refresh data">
              <RefreshCw size={16} />
              {!sidebarCollapsed && "Sync"}
            </Button>
            <Button variant="ghost" size="sm" onClick={cycleTheme} title={`Theme: ${themeMeta.label}`}>
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button variant="ghost" size="sm" onClick={logout} title="Sign out">
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </aside>

      <div className={`${styles.main} ${inspectorOpen ? styles.inspectorOpen : ""}`}>
        {impersonating && (
          <div className={styles.impersonation} role="status">
            Viewing as another user —{" "}
            <button
              type="button"
              onClick={() => api("/impersonate/stop", { method: "POST" }).then(() => refreshStatus())}
            >
              Exit view
            </button>
          </div>
        )}
        <header className={styles.topbar}>
          <div className={styles.topbarTitle}>
            <strong>{title}</strong>
            {companyContext === "hs2" && <StatusPill variant="warn">HS-2</StatusPill>}
            <StatusPill variant={connState === "live" ? "online" : connState === "reconnecting" ? "warn" : "err"}>
              {connState === "live" ? "Live" : connState === "reconnecting" ? "Reconnecting" : "Offline"}
            </StatusPill>
          </div>
          <div className={styles.topActions}>
            <NotificationBell />
            <TimelineScrubber />
            <button type="button" className={styles.searchBtn} onClick={() => setCommandOpen(true)}>
              <Search size={16} />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>
        <div className={styles.contentFrame}>
          <ReconnectBanner state={connState} />
          <PageLoadingOverlay />
          <main className={`${styles.content} page-enter`}>
            <ErrorBoundary label={title} key={`${location.pathname}:${outletKey}`} onRetry={() => setOutletKey((k) => k + 1)}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>

      <InspectorRail />
      <CommandPalette />
      <BreakOverlay />
      <VersionUpdateGate />
      <AgentGuide />
      <BottomDock onSync={handleSync} />
    </div>
  );
}
