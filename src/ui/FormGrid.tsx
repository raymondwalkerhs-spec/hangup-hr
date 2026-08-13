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
}: {
  label: string;
  children: ReactNode;
  span?: "full" | 2;
}) {
  const spanClass = span === "full" ? styles.full : span === 2 ? styles.span2 : "";
  return (
    <label className={`${styles.field} ${spanClass}`}>
      <span>{label}</span>
      {children}
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
