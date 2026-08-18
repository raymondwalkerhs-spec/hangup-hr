import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import styles from "./Select.module.css";

export type SelectOption = { value: string; label: string };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [flip, setFlip] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const searchable = options.length >= 10;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const hit = options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
    const selected = options.find((o) => o.value === value);
    if (selected && !hit.some((o) => o.value === selected.value)) return [selected, ...hit];
    return hit;
  }, [options, query, value]);

  const selected = options.find((o) => o.value === value);

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuMax = 256;
    const spaceBelow = window.innerHeight - r.bottom;
    const shouldFlip = spaceBelow < menuMax && r.top > spaceBelow;
    setFlip(shouldFlip);
    setPos({
      top: shouldFlip ? r.top : r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 160),
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onWin = () => place();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onDoc);
    queueMicrotask(() => searchRef.current?.focus());
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  useEffect(() => {
    setHi(0);
  }, [query, open]);

  const selectAt = (i: number) => {
    const opt = filtered[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHi(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHi(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      selectAt(hi);
    }
  };

  return (
    <div className={clsx(styles.wrap, className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={clsx(styles.trigger, open && styles.triggerOpen)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && filtered[hi] ? optionId(hi) : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        onKeyDown={onKeyDown}
      >
        <span className={clsx(styles.value, !selected && styles.muted)}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className={styles.caret} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            className={styles.menu}
            style={{
              top: flip ? undefined : pos.top,
              bottom: flip ? window.innerHeight - pos.top + 4 : undefined,
              left: pos.left,
              width: pos.width,
            }}
          >
            {searchable ? (
              <input
                ref={searchRef}
                className={styles.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search…"
                aria-label="Filter options"
              />
            ) : null}
            {filtered.map((o, i) => (
              <button
                key={o.value || `empty-${i}`}
                id={optionId(i)}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={clsx(
                  styles.option,
                  i === hi && styles.optionActive,
                  o.value === value && styles.optionSelected
                )}
                onMouseEnter={() => setHi(i)}
                onClick={() => selectAt(i)}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
