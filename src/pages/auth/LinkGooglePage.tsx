import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { getHrDesktop } from "@/lib/desktopUpdate";
import { Button } from "@/ui/Button";
import { AuthSetupShell } from "./AuthSetupShell";
import styles from "./AuthSetupShell.module.css";

const TIMEOUT_MS = 20_000;

export function LinkGooglePage() {
  const navigate = useNavigate();
  const { refreshStatus } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [waitingBrowser, setWaitingBrowser] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || data.type !== "hangup-oauth-code") return;
      complete(String(data.code || ""));
    };
    window.addEventListener("message", onMsg);
    const desktop = getHrDesktop() as { onOAuthCallback?: (cb: (payload: { code?: string }) => void) => () => void } | null;
    let off: (() => void) | undefined;
    if (desktop?.onOAuthCallback) {
      off = desktop.onOAuthCallback((payload) => {
        if (payload?.code) complete(String(payload.code));
      });
    }
    return () => {
      window.removeEventListener("message", onMsg);
      off?.();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const armTimeout = () => {
    setTimedOut(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
  };

  const startLink = async () => {
    setError(null);
    setLoading(true);
    armTimeout();
    try {
      const data = await api<{
        url?: string;
        alreadyLinked?: boolean;
        needsMfaEnroll?: boolean;
        needsSetup?: boolean;
        needsGoogleLink?: boolean;
      }>("/auth/google/start-link", {
        method: "POST",
        body: JSON.stringify({ password }),
      }, 25000);
      if (data.alreadyLinked || (data.needsGoogleLink === false && !data.url)) {
        await refreshStatus().catch(() => null);
        if (data.needsMfaEnroll) navigate("/setup-2fa", { replace: true });
        else navigate("/dashboard", { replace: true });
        return;
      }
      setWaitingBrowser(true);
      try {
        sessionStorage.setItem("hr_oauth_mode", "link");
        document.cookie = "hr_oauth_mode=link; path=/; max-age=600; SameSite=Lax";
      } catch {
        /* ignore */
      }
      const desktop = getHrDesktop() as { openExternal?: (url: string) => Promise<void> } | null;
      if (desktop?.openExternal) {
        await desktop.openExternal(data.url!);
      } else {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
      navigate("/oauth-pending?mode=link", { replace: true, state: { mode: "link" } });
    } catch (err) {
      setError((err as Error).message);
      setWaitingBrowser(false);
    } finally {
      setLoading(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };

  const complete = async (code: string) => {
    if (!code) return;
    setError(null);
    setLoading(true);
    armTimeout();
    try {
      const data = await api<{ needsSetup?: boolean; needsMfaEnroll?: boolean }>(
        "/auth/google/complete-link",
        { method: "POST", body: JSON.stringify({ code }) },
        25000
      );
      await refreshStatus().catch(() => null);
      if (data.needsMfaEnroll) {
        navigate("/setup-2fa", { replace: true });
      } else if (data.needsSetup) {
        navigate("/setup-2fa", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  };

  return (
    <AuthSetupShell
      title="Link Google"
      subtitle="Confirm your Gmail with Google. That address becomes the email on your employee card."
      step={3}
      error={error}
      loading={loading || waitingBrowser}
      timedOut={timedOut}
      onRetry={startLink}
    >
      <p className={styles.muted}>
        Use the Google account you want for Sign in with Google next time.
      </p>
      <label className={styles.field}>
        <span>Confirm password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <Button onClick={startLink} disabled={loading || password.length < 8}>
        Continue with Google
      </Button>
    </AuthSetupShell>
  );
}
