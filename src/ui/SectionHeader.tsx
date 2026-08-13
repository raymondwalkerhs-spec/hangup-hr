import type { ReactNode } from "react";
import styles from "./SectionHeader.module.css";

export function SectionHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumb?: string[];
}) {
  return (
    <header className={styles.header}>
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            {breadcrumb.map((b, i) => (
              <span key={i}>
                {i > 0 && " / "}
                {b}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
