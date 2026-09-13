import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, setSessionId } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { getHrDesktop } from "@/lib/desktopUpdate";
import { Button } from "@/ui/Button";
import { AuthSetupShell } from "./AuthSetupShell";
import styles from "./AuthSetupShell.module.css";

const TIMEOUT_MS = 20_000;

export function OauthPendingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshStatus } = useAuth();
  const mode = (location.state as { mode?: string } | null)?.mode || "cold";
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = async (code: string) => {
    if (!code) return;
    setError(null);
    setLoading(true);
    try {
      if (mode === "link") {
        const data = await api<{ needsMfaEnroll?: boolean; needsSetup?: boolean }>(
          "/auth/google/complete-link",
          { method: "POST", body: JSON.stringify({ code }) },
          25000
        );
        await refreshStatus().catch(() => null);
        if (data.needsMfaEnroll) navigate("/setup-2fa", { replace: true });
        else navigate("/dashboard", { replace: true });
      } else {
        const data = await api<{
          sessionId: string;
          needsMfaEnroll?: boolean;
          needsGoogleLink?: boolean;
          needsSetup?: boolean;
        }>("/auth/google/cold-complete", {
          method: "POST",
          body: JSON.stringify({ code }),
        }, 25000);
        setSessionId(data.sessionId);
        const desktop = getHrDesktop();
        desktop?.setSession?.(data.sessionId);
        await refreshStatus().catch(() => null);
        if (data.needsMfaEnroll) navigate("/setup-2fa", { replace: true });
        else if (data.needsGoogleLink) navigate("/link-google", { replace: true });
        else navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  useEffect(() => {
    timerRef.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    const params = new URLSearchParams(window.location.search);
    const codeFromQuery = params.get("code");
    if (codeFromQuery) {
      finish(codeFromQuery);
    }
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "hangup-oauth-code" && ev.data.code) finish(String(ev.data.code));
    };
    window.addEventListener("message", onMsg);
    const desktop = getHrDesktop() as { onOAuthCallback?: (cb: (p: { code?: string }) => void) => () => void } | null;
    const off = desktop?.onOAuthCallback?.((p) => {
      if (p?.code) finish(String(p.code));
    });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("message", onMsg);
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthSetupShell
      title="Waiting for Google"
      subtitle="Finish signing in with Google in your browser. This window will continue automatically."
      error={error}
      loading={loading && !timedOut}
      timedOut={timedOut}
      onRetry={() => {
        setTimedOut(false);
        setLoading(true);
        timerRef.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
      }}
    >
      <p className={styles.muted}>
        If nothing happens after 20 seconds, paste the OAuth code from the callback URL or retry from login.
      </p>
      <label className={styles.field}>
        <span>OAuth code (manual fallback)</span>
        <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="code=…" />
      </label>
      <Button
        onClick={() => finish(manualCode.trim())}
        disabled={!manualCode.trim()}
      >
        Submit code
      </Button>
      <Button variant="secondary" onClick={() => navigate(mode === "link" ? "/link-google" : "/login", { replace: true })}>
        Cancel
      </Button>
    </AuthSetupShell>
  );
}
