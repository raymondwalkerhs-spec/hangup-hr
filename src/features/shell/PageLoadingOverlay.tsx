import { useCallback, useEffect, useRef, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { CatOrbitStage } from "./CatOrbitStage";
import { Button } from "@/ui/Button";
import styles from "./PageLoadingOverlay.module.css";

/** Shell / background polls — never keep the page spinner alive for these. */
const BACKGROUND_QUERY_ROOTS = new Set([
  "hrms-notifications",
  "app-version",
  "version-gate",
  "status",
  "announcement-unread",
  "connectivity",
]);

const SHOW_DELAY_MS = 90;
const MIN_VISIBLE_MS = 280;
const SLOW_MS = 12_000;
const MAX_VISIBLE_MS = 90_000;

function pageTitleFromPath(pathname: string): string {
  const key = pathname.replace(/^\//, "").split("/")[0] || "page";
  return key.replace(/-/g, " ");
}

function isColdPageFetch(query: { queryKey: readonly unknown[]; state: { data: unknown; fetchStatus: string } }) {
  const root = String(query.queryKey[0] ?? "");
  if (BACKGROUND_QUERY_ROOTS.has(root)) return false;
  if (query.state.data !== undefined) return false;
  return query.state.fetchStatus === "fetching";
}

/**
 * Overlay only for cold loads (no cached data). Cached payroll/employees paint immediately.
 * Cat stays on stage; at 90s Retry sits under the cat (never hide silently).
 */
export function PageLoadingOverlay() {
  const location = useLocation();
  const qc = useQueryClient();
  const skip = location.pathname === "/cats" || location.pathname.startsWith("/cats/");
  const coldFetching = useIsFetching({ predicate: isColdPageFetch });

  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState("Loading…");
  const [sub, setSub] = useState("Hang tight — almost there");
  const [stuck, setStuck] = useState(false);
  const shownAtRef = useRef(0);
  const pathRef = useRef(location.pathname);
  const coldRef = useRef(coldFetching);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pollTimerRef = useRef<ReturnType<typeof setInterval>>();

  coldRef.current = coldFetching;

  const resetForPath = useCallback((pathname: string) => {
    clearTimeout(hideTimerRef.current);
    clearTimeout(showTimerRef.current);
    clearInterval(pollTimerRef.current);
    setVisible(false);
    setStuck(false);
    setLabel(`Loading ${pageTitleFromPath(pathname)}…`);
    setSub("Hang tight — almost there");
  }, []);

  useEffect(() => {
    if (skip) {
      resetForPath(location.pathname);
      return;
    }
    if (pathRef.current === location.pathname) return;
    pathRef.current = location.pathname;
    resetForPath(location.pathname);

    const hideNow = () => {
      setVisible(false);
      setStuck(false);
      clearInterval(pollTimerRef.current);
    };

    const tryHide = () => {
      const elapsed = Date.now() - shownAtRef.current;
      if (elapsed >= SLOW_MS && coldRef.current > 0) {
        setSub("Still loading — you can wait.");
      }
      if (elapsed >= MAX_VISIBLE_MS && coldRef.current > 0) {
        setStuck(true);
        setSub("This page is taking too long.");
        return;
      }
      if (coldRef.current > 0) return;
      const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(hideNow, wait);
    };

    showTimerRef.current = setTimeout(() => {
      if (pathRef.current !== location.pathname) return;
      if (coldRef.current === 0) return;
      shownAtRef.current = Date.now();
      setVisible(true);
      pollTimerRef.current = setInterval(tryHide, 80);
      tryHide();
    }, SHOW_DELAY_MS);

    return () => {
      clearTimeout(hideTimerRef.current);
      clearTimeout(showTimerRef.current);
      clearInterval(pollTimerRef.current);
    };
  }, [location.pathname, skip, resetForPath]);

  useEffect(() => {
    if (!visible || stuck) return;
    if (coldFetching > 0) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAtRef.current));
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setStuck(false);
    }, wait);
    return () => clearTimeout(hideTimerRef.current);
  }, [coldFetching, visible, stuck]);

  const retry = () => {
    shownAtRef.current = Date.now();
    setStuck(false);
    setSub("Hang tight — almost there");
    qc.invalidateQueries();
  };

  const keepWaiting = () => {
    shownAtRef.current = Date.now();
    setStuck(false);
    setSub("Still loading — you can wait.");
  };

  if (skip) return null;

  return (
    <div
      className={`${styles.overlay} ${visible ? styles.overlayVisible : ""}`}
      data-page-loader={visible ? "1" : undefined}
      aria-live="polite"
      aria-busy={visible}
      aria-hidden={!visible}
    >
      <CatOrbitStage message={label} sub={sub} active={visible} />
      {stuck ? (
        <div className={styles.stuckActions}>
          <Button type="button" onClick={retry}>
            Retry
          </Button>
          <Button type="button" variant="ghost" onClick={keepWaiting}>
            Keep waiting
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function CatOrbitLoader({ message = "Loading workspace…" }: { message?: string }) {
  return <CatOrbitStage message={message} />;
}
