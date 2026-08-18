import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/ui/Button";
import { useAuth } from "@/app/AuthProvider";
import { canAccessPage, type StatusUser } from "@/lib/nav-access";
import styles from "./AgentGuide.module.css";

const STEPS = [
  { id: "requests", path: "/requests", page: "requests", title: "Request a day off", copy: "Submit unpaid, medical, or same-day leave here. Annual leave is not available from this screen." },
  { id: "it", path: "/it-requests", page: "it-requests", title: "Request IT help", copy: "Open an IT ticket for your own equipment or access issues." },
  { id: "sales", path: "/sales", page: "sales", title: "Submit a sale", copy: "Use Add sale to submit MLA or RPM. Your log shows your own rows." },
  { id: "attendance", path: "/attendance", page: "attendance", title: "View attendance", copy: "Your attendance is read-only. Ask your TL if a day looks wrong." },
  { id: "bonuses", path: "/bonuses", page: "bonuses", title: "Bonuses", copy: "Posted bonuses for you show up here." },
  { id: "deductions", path: "/deductions", page: "deductions", title: "Deductions", copy: "Posted deductions for you show up here." },
];

function storageKey(userId: string) {
  return `hangup-agent-guide:${userId}`;
}

export function AgentGuide() {
  const { user, status, loading } = useAuth();
  const loc = useLocation();
  const navigate = useNavigate();
  const statusUser = status?.user as StatusUser | undefined;
  const role = String(user?.role || "").toLowerCase();
  const userId = String(user?.username || "");
  const allowed = role === "agent" || role === "office_assistant";

  const steps = useMemo(
    () => STEPS.filter((s) => canAccessPage(statusUser, s.page)),
    [statusUser]
  );

  const [idx, setIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (loading || !userId || !allowed) return;
    const skip = localStorage.getItem(storageKey(userId)) === "1";
    setDismissed(skip);
    setReady(!skip);
  }, [allowed, loading, userId]);

  useEffect(() => {
    if (!ready || dismissed || !steps[idx]) return;
    const step = steps[idx];
    if (loc.pathname !== step.path && loc.pathname !== `${step.path}/`) {
      navigate(step.path);
    }
  }, [dismissed, idx, loc.pathname, navigate, ready, steps]);

  if (!ready || dismissed || !allowed || loc.pathname.startsWith("/cats")) return null;
  if (document.querySelector("[data-error-boundary]")) return null;
  if (document.querySelector("[data-page-loader]")) return null;

  const step = steps[idx];
  if (!step) return null;

  const finish = (persist: boolean) => {
    if (persist && userId) localStorage.setItem(storageKey(userId), "1");
    setDismissed(true);
    setReady(false);
  };

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-label="First-login guide">
      <div className={styles.card}>
        <strong>{step.title}</strong>
        <p>{step.copy}</p>
        <div className={styles.nav}>
          <Button variant="ghost" size="sm" onClick={() => finish(true)}>
            Don't show again
          </Button>
          <span className="muted">{idx + 1} / {steps.length}</span>
          <Button variant="secondary" size="sm" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
            Back
          </Button>
          <Button variant="ghost" size="sm" onClick={() => finish(false)}>
            Skip
          </Button>
          {idx < steps.length - 1 ? (
            <Button size="sm" onClick={() => setIdx((i) => i + 1)}>Next</Button>
          ) : (
            <Button size="sm" onClick={() => finish(true)}>Done</Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
