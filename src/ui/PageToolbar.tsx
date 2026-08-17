import styles from "./PageToolbar.module.css";
import { clearUiBlockers } from "@/lib/uiBlockers";

export type FilterOption = string | { value: string; label: string };

export function normalizeFilterOptions(options: FilterOption[]): { value: string; label: string }[] {
  return options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : { value: String(o.value), label: String(o.label) }
  );
}

export function PageToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`${styles.toolbar} ${className || ""}`}>{children}</div>;
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className={styles.field}>
      <span className="muted">{label}</span>
      <input
        type="search"
        className={styles.search}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => clearUiBlockers()}
        onMouseDown={() => clearUiBlockers()}
        placeholder={placeholder}
      />
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  allLabel?: string;
}) {
  const items = normalizeFilterOptions(options);
  return (
    <label className={styles.field}>
      <span className="muted">{label}</span>
      <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {items.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function FilterDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span className="muted">{label}</span>
      <span className={styles.dateRow}>
        <input
          type="date"
          className={styles.select}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {value ? (
          <button type="button" className={styles.clearDate} onClick={() => onChange("")} aria-label="Clear date">
            ×
          </button>
        ) : null}
      </span>
    </label>
  );
}
