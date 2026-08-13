import { clsx } from "clsx";
import styles from "./StatusPill.module.css";

const variants: Record<string, string> = {
  ok: styles.ok,
  warn: styles.warn,
  err: styles.err,
  muted: styles.muted,
  online: styles.online,
};

export function StatusPill({
  children,
  variant = "muted",
  className,
}: {
  children: React.ReactNode;
  variant?: keyof typeof variants;
  className?: string;
}) {
  return <span className={clsx(styles.pill, variants[variant], className)}>{children}</span>;
}
