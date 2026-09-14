import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, setSessionId } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { getHrDesktop } from "@/lib/desktopUpdate";
import { Button } from "@/ui/Button";
import { AuthSetupShell } from "./AuthSetupShell";
import styles from "./AuthSetupShell.module.css";

const TIMEOUT_MS = 90_000;
const POLL_MS = 700;

function resolveMode(location: ReturnType<typeof useLocation>): "link" | "cold" {
  const q = new URLSearchParams(location.search).get("mode");
  if (q === "link" || q === "cold") return q;
  try {
    const stored = sessionStorage.getItem("hr_oauth_mode");
    if (stored === "link" || stored === "cold") return stored;
  } catch {
    /* ignore */
  }
  const stateMode = (location.state as { mode?: string } | null)?.mode;
  return stateMode === "link" ? "link" : "cold";
}

export function OauthPendingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshStatus } = useAuth();
  const mode = resolveMode(location);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const finishingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const finish = async (code: string, finishMode: "link" | "cold" = mode) => {
    const trimmed = String(code || "").trim();
    if (!trimmed || finishingRef.current) return;
    finishingRef.current = true;
    setError(null);
    setLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      if (finishMode === "link") {
        const data = await api<{ needsMfaEnroll?: boolean; needsSetup?: boolean }>(
          "/auth/google/complete-link",
          { method: "POST", body: JSON.stringify({ code: trimmed }), skipAuthRedirect: true },
          25000
        );
        await refreshStatus().catch(() => null);
        try {
          sessionStorage.removeItem("hr_oauth_mode");
        } catch {
          /* ignore */
        }
        if (data.needsMfaEnroll) navigate("/setup-2fa", { replace: true });
        else navigate("/dashboard", { replace: true });
      } else {
        const data = await api<{
          sessionId: string;
          needsMfaEnroll?: boolean;
          needsGoogleLink?: boolean;
          needsSetup?: boolean;
        }>(
          "/auth/google/cold-complete",
          {
            method: "POST",
            body: JSON.stringify({ code: trimmed }),
            skipAuthRedirect: true,
          },
          25000
        );
        setSessionId(data.sessionId);
        const desktop = getHrDesktop();
        desktop?.setSession?.(data.sessionId);
        // Avoid hard /login bounce if status races the new session.
        await refreshStatus().catch(() => null);
        try {
          sessionStorage.removeItem("hr_oauth_mode");
        } catch {
          /* ignore */
        }
        if (data.needsMfaEnroll) navigate("/setup-2fa", { replace: true });
        else if (data.needsGoogleLink) navigate("/link-google", { replace: true });
        else navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      finishingRef.current = false;
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const syncLinkedIdentity = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setError(null);
    setLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      if (mode === "link") {
        const data = await api<{ needsMfaEnroll?: boolean }>(
          "/auth/google/sync-link",
          { method: "POST", body: "{}", skipAuthRedirect: true },
          25000
        );
        await refreshStatus().catch(() => null);
        if (data.needsMfaEnroll) navigate("/setup-2fa", { replace: true });
        else navigate("/dashboard", { replace: true });
      } else {
        setError("Sign in with password first, then link Google from the setup screen.");
        setLoading(false);
        finishingRef.current = false;
      }
    } catch (err) {
      finishingRef.current = false;
      setError((err as Error).message);
      setLoading(false);
    }
  };

  useEffect(() => {
    timerRef.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    const params = new URLSearchParams(window.location.search);
    const codeFromQuery = params.get("code");
    const errFromQuery = params.get("error");
    if (errFromQuery) {
      setError(errFromQuery);
      setLoading(false);
    } else if (codeFromQuery) {
      finish(codeFromQuery, mode);
    }

    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "hangup-oauth-code" && ev.data.code) finish(String(ev.data.code), mode);
    };
    window.addEventListener("message", onMsg);
    const desktop = getHrDesktop() as {
      onOAuthCallback?: (cb: (p: { code?: string; error?: string }) => void) => () => void;
    } | null;
    const off = desktop?.onOAuthCallback?.((p) => {
      if (p?.error) {
        setError(String(p.error));
        setLoading(false);
        return;
      }
      if (p?.code) finish(String(p.code), mode);
    });

    pollRef.current = setInterval(async () => {
      if (finishingRef.current) return;
      try {
        const data = await api<{
          pending?: boolean;
          code?: string | null;
          error?: string | null;
          syncLinked?: boolean;
          mode?: string;
        }>("/auth/oauth-poll", { method: "GET", skipAuthRedirect: true }, 8000);
        if (data?.syncLinked) {
          await syncLinkedIdentity();
          return;
        }
        if (data?.error) {
          if (/already linked/i.test(String(data.error))) {
            await syncLinkedIdentity();
            return;
          }
          setError(String(data.error));
          setLoading(false);
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
        if (data?.code) {
          const m = data.mode === "link" ? "link" : data.mode === "cold" ? "cold" : mode;
          finish(String(data.code), m);
        }
      } catch {
        /* keep polling */
      }
    }, POLL_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener("message", onMsg);
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthSetupShell
      title="Waiting for Google"
      subtitle="Finish signing in with Google in your browser, then return here — this window continues automatically."
      error={error}
      loading={loading && !timedOut && !error}
      timedOut={timedOut}
      onRetry={() => {
        setTimedOut(false);
        setLoading(true);
        setError(null);
        finishingRef.current = false;
        timerRef.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
      }}
    >
      <p className={styles.muted}>
        Finish Google in your browser, then return to this window — Hangup Portal continues automatically.
        If nothing happens, use Cancel and try again, or paste the code from the browser address bar below.
      </p>
      <label className={styles.field}>
        <span>Sign-in code (optional)</span>
        <input
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          placeholder="Only if the app is still waiting"
        />
      </label>
      <Button
        onClick={() => {
          finishingRef.current = false;
          finish(manualCode.trim());
        }}
        disabled={!manualCode.trim()}
      >
        Submit code
      </Button>
      <Button
        variant="secondary"
        onClick={() => navigate(mode === "link" ? "/link-google" : "/login", { replace: true })}
      >
        Cancel
      </Button>
    </AuthSetupShell>
  );
}
