import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { Select } from "@/ui/Select";
import styles from "./AttendanceStatusCell.module.css";

const TRANSPORT_STATUSES = new Set(["Half Day", "Quarter Day-Off", "Lateness A", "Lateness B", "NSNC Half Day"]);

function isWeekend(date: string) {
  const d = new Date(date + "T12:00:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

function statusClass(status: string) {
  if (!status) return "";
  if (status.includes("Lateness")) return styles.lateness;
  if (status === "Day-OFF" || status === "OUT") return styles.off;
  if (status === "Attended" || status === "WFH") return styles.ok;
  return styles.other;
}

function labelFor(status: string, date: string) {
  if (status === "Day-OFF" && isWeekend(date)) return "OFF★";
  return status || "—";
}

type MenuPos = { left: number; top?: number; bottom?: number };

export function AttendanceStatusCell({
  empId,
  date,
  status,
  transportOverride,
  statuses,
  canEdit,
  locked,
  selected,
  onChange,
  onPointerSelect,
}: {
  empId: string;
  date: string;
  status: string;
  transportOverride?: string;
  statuses: string[];
  canEdit: boolean;
  locked: boolean;
  selected?: boolean;
  onChange: (status: string, transport?: string) => void;
  onPointerSelect?: (empId: string, date: string, mode: "start" | "move" | "end") => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const st = status;
  const showTransport = TRANSPORT_STATUSES.has(st);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuMax = 200;
      const gap = 4;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < menuMax && rect.top > spaceBelow;
      setMenuPos({
        left: rect.left + rect.width / 2,
        top: openUp ? undefined : rect.bottom + gap,
        bottom: openUp ? window.innerHeight - rect.top + gap : undefined,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  if (!canEdit || locked) {
    return <span className={styles.readonly}>{st || "—"}</span>;
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.chip} ${statusClass(st)} ${selected ? styles.selected : ""}`}
        onClick={() => {
          if (!onPointerSelect) setOpen((o) => !o);
        }}
        onPointerDown={(e) => {
          if (!canEdit || locked || !onPointerSelect) return;
          e.preventDefault();
          onPointerSelect(empId, date, "start");
        }}
        onPointerEnter={() => onPointerSelect?.(empId, date, "move")}
        onPointerUp={() => {
          onPointerSelect?.(empId, date, "end");
          if (!onPointerSelect) return;
          setOpen(true);
        }}
        title={date}
      >
        {labelFor(st, date)}
      </button>
      {open && menuPos && (
        <div
          className={styles.menu}
          style={{
            position: "fixed",
            left: menuPos.left,
            top: menuPos.top,
            bottom: menuPos.bottom,
            transform: "translateX(-50%)",
          }}
        >
          {statuses.map((x) => (
            <button
              key={x}
              type="button"
              className={`${styles.menuItem} ${x === st ? styles.menuActive : ""}`}
              onClick={() => {
                const needsTransport = TRANSPORT_STATUSES.has(x);
                onChange(x, needsTransport ? transportOverride : "");
                setOpen(false);
              }}
            >
              <span className={`${styles.pill} ${statusClass(x)}`}>{labelFor(x, date)}</span>
            </button>
          ))}
        </div>
      )}
      {showTransport && (
        <Select
          className={styles.transport}
          value={transportOverride || ""}
          onChange={(v) => onChange(st, v)}
          aria-label="Transport"
          options={[
            { value: "", label: "Transport" },
            { value: "full", label: "Full" },
            { value: "half", label: "Half" },
            { value: "none", label: "None" },
          ]}
        />
      )}
    </div>
  );
}
