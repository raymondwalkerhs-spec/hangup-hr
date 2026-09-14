import type { ReactNode } from "react";
import { Button } from "@/ui/Button";
import styles from "./AuthSetupShell.module.css";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  error?: string | null;
  loading?: boolean;
  onRetry?: () => void;
  timedOut?: boolean;
  /** 1 password done, 2 authenticator, 3 google */
  step?: 1 | 2 | 3;
};

const STEPS = [
  { n: 1 as const, label: "Password" },
  { n: 2 as const, label: "Authenticator" },
  { n: 3 as const, label: "Gmail" },
];

export function AuthSetupShell({
  title,
  subtitle,
  children,
  error,
  loading,
  onRetry,
  timedOut,
  step = 2,
}: Props) {
  return (
    <div className={styles.page} data-ui="auth-setup">
      <div className={styles.panel}>
        <img src="/img/hr-team.png" alt="Hangup" className={styles.logo} />
        <ol className={styles.steps} aria-label="Account setup progress">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className={`${styles.stepItem} ${step >= s.n ? styles.stepDone : ""} ${step === s.n ? styles.stepCurrent : ""}`}
            >
              <span className={styles.stepNum}>{s.n}</span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
        <h1>{title}</h1>
        {subtitle ? <p className={styles.sub}>{subtitle}</p> : null}
        {loading ? <p className={styles.loading}>Working… this can take a few seconds.</p> : null}
        {(error || timedOut) && (
          <div className={styles.errorBox} role="alert">
            <p>{timedOut ? "This is taking too long. Check your connection and try again." : error}</p>
            {onRetry ? (
              <Button type="button" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
