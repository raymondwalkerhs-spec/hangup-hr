import { useCrossFilterStore } from "@/stores/cross-filter-store";
import { StatusPill } from "./StatusPill";
import styles from "./FilterChipBar.module.css";

export function FilterChipBar() {
  const { filters, clearFilter, clearAll } = useCrossFilterStore();
  const entries = Object.entries(filters).filter(([, v]) => v);

  if (!entries.length) return null;

  return (
    <div className={styles.bar}>
      {entries.map(([k, v]) => (
        <button key={k} type="button" className={styles.chipBtn} onClick={() => clearFilter(k as keyof typeof filters)}>
          <StatusPill variant="ok">
            {k}: {v} ×
          </StatusPill>
        </button>
      ))}
      <button type="button" className={styles.clear} onClick={clearAll}>
        Clear all
      </button>
    </div>
  );
}
