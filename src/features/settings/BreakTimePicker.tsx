import { useMemo } from "react";
import { calcEndTime24, formatTimeAmPm, partsToTime24, time24ToParts } from "@/lib/breakTime";
import styles from "./BreakTimePicker.module.css";

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export function BreakTimePicker({
  value,
  onChange,
  durationMinutes,
  label = "Start time",
}: {
  value: string;
  onChange: (time24: string) => void;
  durationMinutes?: number;
  label?: string;
}) {
  const { hour12, minute, ampm } = useMemo(() => time24ToParts(value), [value]);
  const endPreview = useMemo(
    () => calcEndTime24(value, Number(durationMinutes) || 15),
    [value, durationMinutes]
  );

  const setParts = (next: Partial<{ hour12: number; minute: number; ampm: "AM" | "PM" }>) => {
    onChange(
      partsToTime24(
        next.hour12 ?? hour12,
        next.minute ?? minute,
        next.ampm ?? ampm
      )
    );
  };

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <div className={styles.row}>
        <select
          className={styles.select}
          value={hour12}
          aria-label={`${label} hour`}
          onChange={(e) => setParts({ hour12: Number(e.target.value) })}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className={styles.sep}>:</span>
        <select
          className={styles.select}
          value={minute}
          aria-label={`${label} minute`}
          onChange={(e) => setParts({ minute: Number(e.target.value) })}
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
          ))}
        </select>
        <select
          className={styles.select}
          value={ampm}
          aria-label={`${label} AM or PM`}
          onChange={(e) => setParts({ ampm: e.target.value as "AM" | "PM" })}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
      <span className="muted" style={{ fontSize: "0.75rem" }}>
        Selected: {formatTimeAmPm(value)}
        {durationMinutes ? ` · ends ${formatTimeAmPm(endPreview)}` : ""}
      </span>
    </div>
  );
}
