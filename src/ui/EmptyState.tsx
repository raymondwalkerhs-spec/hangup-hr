import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

export function EmptyState({
  title = "Nothing here yet",
  hint,
  action,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.wrap}>
      <Inbox className={styles.icon} size={28} aria-hidden />
      <p className={styles.title}>{title}</p>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
