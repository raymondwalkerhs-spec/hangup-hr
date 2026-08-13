import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Button } from "@/ui/Button";
import styles from "./BreakOverlay.module.css";

type Break = {
  id: string;
  name?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  message?: string;
};

function parseEndMs(startTime: string, durationMinutes: number) {
  const m = String(startTime || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return Date.now() + durationMinutes * 60000;
  const d = new Date();
  d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  return d.getTime() + durationMinutes * 60000;
}

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function BreakOverlay() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [countdown, setCountdown] = useState("");

  const { data } = useQuery({
    queryKey: ["active-break"],
    queryFn: () => api<{ break?: Break | null; activeBreak?: Break | null }>("/sales-config/breaks/active"),
    refetchInterval: 60000,
  });

  const brk = data?.break || data?.activeBreak || null;
  const visible = brk && !dismissed.has(brk.id);

  useEffect(() => {
    if (!visible || !brk) return;
    const endMs = parseEndMs(brk.startTime || "", brk.durationMinutes || 15);
    const tick = () => setCountdown(formatCountdown(endMs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [visible, brk]);

  if (!visible || !brk) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <Button className={styles.close} size="sm" variant="ghost" onClick={() => setDismissed((s) => new Set(s).add(brk.id))}>✕</Button>
        <h2>Break time</h2>
        <p>{brk.name || "Scheduled break"}</p>
        <div className={styles.timer}>{countdown}</div>
        <p className="muted">{brk.durationMinutes || 15} min · ends ~{brk.endTime || ""}</p>
        {brk.message && <p>{brk.message}</p>}
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: "1rem" }}>Reopen from Breaks in the sidebar.</p>
      </div>
    </div>
  );
}
