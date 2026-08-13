import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/stores/theme-store";
import { monthLabel } from "@/api/client";
import { Button } from "@/ui/Button";
import styles from "./TimelineScrubber.module.css";

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function TimelineScrubber() {
  const { month, setMonth } = useAppStore();

  return (
    <div className={styles.scrubber}>
      <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
        <ChevronLeft size={16} />
      </Button>
      <input
        type="month"
        className={styles.input}
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        aria-label="Month"
      />
      <span className={styles.label}>{monthLabel(month)}</span>
      <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}
