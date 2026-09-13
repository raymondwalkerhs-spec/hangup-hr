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
};

export function AuthSetupShell({
  title,
  subtitle,
  children,
  error,
  loading,
  onRetry,
  timedOut,
}: Props) {
  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <img src="/img/hr-team.png" alt="Hangup" className={styles.logo} />
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
