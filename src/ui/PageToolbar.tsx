import styles from "./PageToolbar.module.css";
import { Select } from "./Select";
import { clearUiBlockersIfResidue } from "@/lib/uiBlockers";

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
        onFocus={() => clearUiBlockersIfResidue()}
        onMouseDown={() => clearUiBlockersIfResidue()}
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
  const items = [{ value: "", label: allLabel }, ...normalizeFilterOptions(options)];
  return (
    <label className={styles.field}>
      <span className="muted">{label}</span>
      <Select value={value} onChange={onChange} options={items} placeholder={allLabel} aria-label={label} />
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
