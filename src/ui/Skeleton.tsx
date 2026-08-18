import styles from "./Skeleton.module.css";

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.block} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.line} style={{ width: `${88 - (i % 4) * 8}%` }} />
      ))}
    </div>
  );
}
