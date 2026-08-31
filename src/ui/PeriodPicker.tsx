import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { workWeekBounds } from "@/lib/workWeek";
import styles from "./PeriodPicker.module.css";

export type DateRange = { from: string; to: string };

function cairoToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function monthBounds(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

function prevMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function cairoPeriodPresets(): { id: string; label: string; range: DateRange }[] {
  const today = cairoToday();
  const yesterday = addDays(today, -1);
  const cur = workWeekBounds(today);
  const prevFri = addDays(cur.monday, -3);
  const prev = workWeekBounds(prevFri);
  const thisM = monthBounds(today);
  const lastM = monthBounds(prevMonth(today));
  return [
    { id: "today", label: "Today", range: { from: today, to: today } },
    { id: "yesterday", label: "Yesterday", range: { from: yesterday, to: yesterday } },
    { id: "week", label: "Current week", range: { from: cur.monday, to: cur.friday } },
    { id: "prev-week", label: "Previous week", range: { from: prev.monday, to: prev.friday } },
    { id: "month", label: "This month", range: thisM },
    { id: "prev-month", label: "Previous month", range: lastM },
  ];
}

function daysInGrid(monthStart: string) {
  const [y, m] = monthStart.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startPad = (first.getDay() + 6) % 7;
  const lastDate = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) {
    cells.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return cells;
}

export function PeriodPicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [drag, setDrag] = useState<string | null>(null);
  const today = cairoToday();
  const months = useMemo(() => {
    const base = from || today;
    return [prevMonth(base), `${base.slice(0, 7)}-01`, monthBounds(addDays(monthBounds(base).to, 1)).from];
  }, [from, today]);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [open]);

  const label = from === to ? from : `${from} → ${to}`;

  return (
    <label className={styles.wrap}>
      <span className="muted">Period</span>
      <button ref={triggerRef} type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)}>
        {label || "Choose dates"}
      </button>
      {open &&
        createPortal(
          <div
            className={styles.panel}
            data-hangup-floating=""
            style={{ top: pos.top, left: pos.left }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseUp={() => setDrag(null)}
          >
            <div className={styles.presets}>
              {cairoPeriodPresets().map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={styles.preset}
                  onClick={() => {
                    onChange(p.range);
                    setOpen(false);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className={styles.months}>
              {months.map((m) => (
                <div key={m} className={styles.month}>
                  <strong>{m.slice(0, 7)}</strong>
                  <div className={styles.grid}>
                    {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                      <span key={i} className={styles.dow}>{d}</span>
                    ))}
                    {daysInGrid(m).map((d, i) => {
                      if (!d) return <span key={`e-${i}`} />;
                      const selected = d >= from && d <= to;
                      return (
                        <button
                          key={d}
                          type="button"
                          className={`${styles.day} ${selected ? styles.sel : ""}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setDrag(d);
                            onChange({ from: d, to: d });
                          }}
                          onMouseEnter={() => {
                            if (!drag) return;
                            const a = drag < d ? drag : d;
                            const b = drag < d ? d : drag;
                            onChange({ from: a, to: b });
                          }}
                        >
                          {Number(d.slice(8))}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </label>
  );
}
