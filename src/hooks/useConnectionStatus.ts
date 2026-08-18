import { useEffect, useRef, useState } from "react";
import { getSessionId } from "@/api/client";

export type ConnectionState = "live" | "reconnecting" | "offline";

async function probe(): Promise<boolean> {
  const session = getSessionId();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("/api/ping", {
      credentials: "same-origin",
      headers: session ? { "x-session-id": session } : {},
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function useConnectionStatus() {
  const [state, setState] = useState<ConnectionState>(navigator.onLine ? "live" : "offline");
  const fails = useRef(0);
  const backOnlineAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!navigator.onLine) {
        fails.current += 1;
        if (!cancelled) setState(fails.current >= 2 ? "offline" : "reconnecting");
        return;
      }
      const ok = await probe();
      if (cancelled) return;
      if (ok) {
        const wasDown = fails.current > 0 || state !== "live";
        fails.current = 0;
        setState("live");
        if (wasDown) backOnlineAt.current = Date.now();
      } else {
        fails.current += 1;
        setState(fails.current >= 2 ? "offline" : "reconnecting");
      }
    };
    void run();
    const id = setInterval(() => void run(), 30000);
    const onOnline = () => {
      fails.current = 0;
      setState("reconnecting");
      void run();
    };
    const onOffline = () => {
      fails.current = 2;
      setState("offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return { state, backOnlineAt: backOnlineAt.current };
}
