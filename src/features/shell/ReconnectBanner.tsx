import { useEffect, useState } from "react";
import type { ConnectionState } from "@/hooks/useConnectionStatus";
import styles from "./ReconnectBanner.module.css";

export function ReconnectBanner({ state }: { state: ConnectionState }) {
  const [showBack, setShowBack] = useState(false);
  const [prev, setPrev] = useState(state);

  useEffect(() => {
    if (prev !== "live" && state === "live") {
      setShowBack(true);
      const t = setTimeout(() => setShowBack(false), 2500);
      setPrev(state);
      return () => clearTimeout(t);
    }
    setPrev(state);
  }, [state, prev]);

  if (state === "live" && !showBack) return null;

  return (
    <div
      className={`${styles.banner} ${state === "offline" ? styles.offline : styles.warn}`}
      role="status"
    >
      {state === "live" && showBack && "Back online"}
      {state === "reconnecting" && "Lost connection — retrying…"}
      {state === "offline" && "You're offline. Showing last saved data if we have it."}
    </div>
  );
}
