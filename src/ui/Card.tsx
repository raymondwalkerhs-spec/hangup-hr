import { clsx } from "clsx";
import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx(styles.card, className)} data-ui="card" {...props}>
      {children}
    </div>
  );
}

export function WidgetCard({
  title,
  scope,
  children,
  className,
  onClick,
}: {
  title?: string;
  scope?: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Card className={clsx(styles.widget, className)} onClick={onClick} role={onClick ? "button" : undefined}>
      {(title || scope) && (
        <div className={styles.widgetHead}>
          {title && <h3>{title}</h3>}
          {scope && <span className={styles.scope}>{scope}</span>}
        </div>
      )}
      <div className={styles.widgetBody}>{children}</div>
    </Card>
  );
}

export function StatTile({
  value,
  label,
  accent,
  onClick,
  active,
}: {
  value: ReactNode;
  label: string;
  accent?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Card
      className={clsx(styles.stat, accent && styles.statAccent, onClick && styles.statClick, active && styles.statActive)}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <strong className="tabular-nums">{value}</strong>
      <span className="muted">{label}</span>
    </Card>
  );
}
