import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/app/AuthProvider";
import { Button } from "@/ui/Button";
import { TotpCodeInput } from "@/ui/TotpCodeInput";
import { AuthSetupShell } from "./AuthSetupShell";
import styles from "./AuthSetupShell.module.css";

const TIMEOUT_MS = 20_000;

type EnrollStart = {
  factorId: string;
  qrCode?: string | null;
  secret?: string | null;
};

export function Setup2faPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromSettings = searchParams.get("from") === "settings" || searchParams.get("add") === "1";
  const addAnother = searchParams.get("add") === "1";
  const { refreshStatus } = useAuth();
  const [password, setPassword] = useState("");
  const [currentTotp, setCurrentTotp] = useState("");
  const [label, setLabel] = useState(addAnother ? "Phone / backup" : "Hangup Portal");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const withTimeout = async <T,>(fn: () => Promise<T>) => {
    setTimedOut(false);
    clearTimer();
    timerRef.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    try {
      return await fn();
    } finally {
      clearTimer();
    }
  };

  const startEnroll = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await withTimeout(() =>
        api<EnrollStart>("/auth/mfa/enroll/start", {
          method: "POST",
          body: JSON.stringify({
            password,
            friendlyName: label,
            ...(addAnother && currentTotp ? { totpCode: currentTotp } : {}),
          }),
        }, 25000)
      );
      setFactorId(data.factorId);
      setQrCode(data.qrCode || null);
      setSecret(data.secret || null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await withTimeout(() =>
        api<{ needsGoogleLink?: boolean; needsSetup?: boolean }>("/auth/mfa/enroll/verify", {
          method: "POST",
          body: JSON.stringify({ code, factorId, password }),
        }, 25000)
      );
      await refreshStatus().catch(() => null);
      if (fromSettings) {
        navigate("/settings#account-security", { replace: true });
      } else if (data.needsGoogleLink || data.needsSetup) {
        navigate("/link-google", { replace: true });
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSetupShell
      title={addAnother ? "Add another Authenticator" : "Set up Authenticator"}
      subtitle={
        addAnother
          ? "Scan a new QR on another phone or app. Keep at least one working code for password changes and Google unlink."
          : "Scan the QR with Google Authenticator or Authy. You will need this code to change or reset your password, and to unlink Google — not for daily sign-in."
      }
      step={2}
      error={error}
      loading={loading}
      timedOut={timedOut}
      onRetry={() => (factorId ? verify() : startEnroll())}
    >
      {!factorId ? (
        <>
          <label className={styles.field}>
            <span>Confirm password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {addAnother ? (
            <>
              <label className={styles.field}>
                <span>Device label (optional)</span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={64}
                  placeholder="Phone / backup"
                />
              </label>
              <label className={styles.field}>
                <span>Current Authenticator code</span>
                <TotpCodeInput value={currentTotp} onChange={setCurrentTotp} disabled={loading} />
              </label>
            </>
          ) : null}
          <Button
            onClick={startEnroll}
            disabled={loading || password.length < 8 || (addAnother && currentTotp.length !== 6)}
          >
            Show QR code
          </Button>
        </>
      ) : (
        <>
          {qrCode ? (
            <img src={qrCode} alt="Authenticator QR" className={styles.qr} />
          ) : (
            <p className={styles.muted}>QR unavailable — enter the secret manually.</p>
          )}
          {secret ? <p className={styles.secret}>Secret: {secret}</p> : null}
          <label className={styles.field}>
            <span>6-digit Authenticator code</span>
            <TotpCodeInput value={code} onChange={setCode} autoFocus disabled={loading} />
          </label>
          <Button onClick={verify} disabled={loading || code.length < 6}>
            Confirm and continue
          </Button>
        </>
      )}
    </AuthSetupShell>
  );
}
