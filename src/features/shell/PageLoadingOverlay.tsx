import { useEffect, useRef, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { CatOrbitStage } from "./CatOrbitStage";
import styles from "./PageLoadingOverlay.module.css";

/** Shell / background polls — never keep the page spinner alive for these. */
const BACKGROUND_QUERY_ROOTS = new Set([
  "hrms-notifications",
  "app-version",
  "version-gate",
  "status",
]);

/** Don't flash the overlay on cached pages. */
const SHOW_DELAY_MS = 90;
const MIN_VISIBLE_MS = 280;
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
 */
export function PageLoadingOverlay() {
  const location = useLocation();
  const coldFetching = useIsFetching({ predicate: isColdPageFetch });

  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState("Loading…");
  const shownAtRef = useRef(0);
  const pathRef = useRef(location.pathname);
  const coldRef = useRef(coldFetching);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pollTimerRef = useRef<ReturnType<typeof setInterval>>();

  coldRef.current = coldFetching;

  useEffect(() => {
    if (pathRef.current === location.pathname) return;
    pathRef.current = location.pathname;
    clearTimeout(hideTimerRef.current);
    clearTimeout(showTimerRef.current);
    clearInterval(pollTimerRef.current);
    setVisible(false);
    setLabel(`Loading ${pageTitleFromPath(location.pathname)}…`);

    const hideNow = () => {
      setVisible(false);
      clearInterval(pollTimerRef.current);
    };

    const tryHide = () => {
      const elapsed = Date.now() - shownAtRef.current;
      if (elapsed >= MAX_VISIBLE_MS) {
        hideNow();
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
  }, [location.pathname]);

  useEffect(() => {
    if (!visible) return;
    if (coldFetching > 0) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAtRef.current));
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), wait);
    return () => clearTimeout(hideTimerRef.current);
  }, [coldFetching, visible]);

  return (
    <div
      className={`${styles.overlay} ${visible ? styles.overlayVisible : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={visible}
      aria-hidden={!visible}
    >
      <CatOrbitStage message={label} sub="Hang tight — almost there" active={visible} />
    </div>
  );
}

export function CatOrbitLoader({ message = "Loading workspace…" }: { message?: string }) {
  return <CatOrbitStage message={message} />;
}
