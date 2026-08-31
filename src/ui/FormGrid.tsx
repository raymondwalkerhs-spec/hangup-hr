import type { ReactNode } from "react";
import styles from "./FormGrid.module.css";

export function FormGrid({
  children,
  wide,
  className,
}: {
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return <div className={`${styles.grid} ${wide ? styles.gridWide : ""} ${className || ""}`}>{children}</div>;
}

export function FormField({
  label,
  children,
  span,
  error,
}: {
  label: string;
  children: ReactNode;
  span?: "full" | 2;
  error?: string;
}) {
  const spanClass = span === "full" ? styles.full : span === 2 ? styles.span2 : "";
  return (
    <label className={`${styles.field} ${spanClass} ${error ? styles.invalid : ""}`}>
      <span>{label}</span>
      {children}
      {error ? <em className={styles.fieldError}>{error}</em> : null}
    </label>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
