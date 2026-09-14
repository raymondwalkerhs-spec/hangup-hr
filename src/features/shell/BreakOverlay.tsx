import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useCompanyScope } from "@/hooks/useCompanyScope";
import { Button } from "@/ui/Button";
import { formatTimeAmPm } from "@/lib/breakTime";
import styles from "./BreakOverlay.module.css";

type Break = {
  id: string;
  name?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  message?: string;
};

type Take = {
  id: string;
  scheduleId?: string | null;
  startedAt?: string | null;
  allowedMinutes?: number;
  status?: string;
};

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function playBreakRing(ctxRef: { current: AudioContext | null }) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  } catch {
    /* audio may be blocked */
  }
}

export function BreakOverlay() {
  const qc = useQueryClient();
  const { path } = useCompanyScope();
  const audioRef = useRef<AudioContext | null>(null);
  const rangForTake = useRef<string | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState<Set<string>>(() => new Set());
  const [countdown, setCountdown] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, refetch } = useQuery({
    queryKey: ["active-break"],
    queryFn: () =>
      api<{ activeBreak?: Break | null; openTake?: Take | null }>(path("/sales-config/breaks/active")),
    refetchInterval: 15000,
  });

  const brk = data?.activeBreak || null;
  const openTake = data?.openTake || null;
  const inProgress = openTake && ["in_progress", "overdue"].includes(String(openTake.status || ""));
  const promptVisible = Boolean(brk && !sessionDismissed.has(brk.id) && !inProgress);
  const timerVisible = Boolean(inProgress);

  const start = useMutation({
    mutationFn: () => api(path(`/sales-config/breaks/${encodeURIComponent(brk!.id)}/start`), { method: "POST", body: "{}" }),
    onSuccess: () => {
      setError(null);
      playBreakRing(audioRef); // unlock audio context on gesture
      qc.invalidateQueries({ queryKey: ["active-break"] });
      qc.invalidateQueries({ queryKey: ["break-takes"] });
      refetch();
    },
    onError: (err: Error) => setError(err.message),
  });

  const dismiss = useMutation({
    mutationFn: () => api(path(`/sales-config/breaks/${encodeURIComponent(brk!.id)}/dismiss`), { method: "POST", body: "{}" }),
    onSuccess: () => {
      if (brk) setSessionDismissed((s) => new Set(s).add(brk.id));
      setError(null);
      qc.invalidateQueries({ queryKey: ["active-break"] });
      qc.invalidateQueries({ queryKey: ["break-takes"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const end = useMutation({
    mutationFn: () =>
      api(path(`/sales-config/breaks/takes/${encodeURIComponent(openTake!.id)}/end`), {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      setError(null);
      setOverdue(false);
      rangForTake.current = null;
      qc.invalidateQueries({ queryKey: ["active-break"] });
      qc.invalidateQueries({ queryKey: ["break-takes"] });
      refetch();
    },
    onError: (err: Error) => setError(err.message),
  });

  useEffect(() => {
    if (!inProgress || !openTake?.startedAt) return;
    const allowedMs = (Number(openTake.allowedMinutes) || 15) * 60000;
    const startMs = new Date(openTake.startedAt).getTime();
    const tick = () => {
      const left = startMs + allowedMs - Date.now();
      setCountdown(formatCountdown(left));
      const isOver = left <= 0;
      setOverdue(isOver);
      if (isOver && rangForTake.current !== openTake.id) {
        rangForTake.current = openTake.id;
        playBreakRing(audioRef);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [inProgress, openTake?.id, openTake?.startedAt, openTake?.allowedMinutes]);

  if (!promptVisible && !timerVisible) return null;

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.card} role="dialog" aria-label="Break time" onClick={(e) => e.stopPropagation()}>
        {promptVisible && brk ? (
          <>
            <h2>Break time</h2>
            <p>{brk.name || "Scheduled break"}</p>
            <p className="muted">
              {brk.durationMinutes || 15} min · window {formatTimeAmPm(brk.startTime)} – {formatTimeAmPm(brk.endTime)}
            </p>
            {brk.message ? <p>{brk.message}</p> : null}
            <div className={styles.actions}>
              <Button
                onClick={() => start.mutate()}
                disabled={start.isPending}
              >
                Start break now
              </Button>
              <Button variant="secondary" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
                Close
              </Button>
            </div>
          </>
        ) : null}

        {timerVisible && openTake ? (
          <>
            <h2>{overdue ? "Break overtime" : "On break"}</h2>
            <div className={styles.timer} data-overdue={overdue ? "1" : "0"}>
              {countdown}
            </div>
            <p className="muted">
              {overdue
                ? "Time is up — tap End break when you are back."
                : `${openTake.allowedMinutes || 15} min allotted`}
            </p>
            <div className={styles.actions}>
              <Button variant={overdue ? "danger" : "primary"} onClick={() => end.mutate()} disabled={end.isPending}>
                End break
              </Button>
            </div>
          </>
        ) : null}

        {error ? <p className={styles.err}>{error}</p> : null}
      </div>
    </div>
  );
}
