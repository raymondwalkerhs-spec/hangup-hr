import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { FLOATING_UI_ATTR } from "./floatingUi";
import { clearUiBlockersIfResidue } from "@/lib/uiBlockers";
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
  searchable,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  searchable?: boolean;
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
  const [inDialog, setInDialog] = useState(false);
  useEffect(() => {
    setInDialog(Boolean(triggerRef.current?.closest("[data-radix-dialog-content], [role='dialog']")));
  }, []);
  const showSearch = searchable === true || (searchable !== false && options.length >= 10);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const hit = options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
    const selectedOpt = options.find((o) => o.value === value);
    if (selectedOpt && !hit.some((o) => o.value === selectedOpt.value)) return [selectedOpt, ...hit];
    return hit;
  }, [options, query, value]);

  const selected = value !== "" && value != null ? options.find((o) => o.value === value) : undefined;

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuMax = 280;
    const spaceBelow = window.innerHeight - r.bottom;
    const shouldFlip = spaceBelow < menuMax && r.top > spaceBelow;
    setFlip(shouldFlip);
    setPos({
      top: shouldFlip ? r.top : r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 180),
    });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onWin = () => place();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", onDoc);
    const focusSearch = () => searchRef.current?.focus();
    const t = window.setTimeout(focusSearch, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
      document.removeEventListener("pointerdown", onDoc);
    };
  }, [open]);

  useEffect(() => {
    setHi(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector<HTMLElement>("[data-option-active='1']");
    el?.scrollIntoView({ block: "nearest" });
  }, [hi, open, filtered]);

  const close = () => {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };

  const selectAt = (i: number) => {
    const opt = filtered[i];
    if (!opt) return;
    onChange(opt.value);
    close();
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
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(Math.max(filtered.length - 1, 0), h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHi(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHi(Math.max(filtered.length - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectAt(hi);
    }
  };

  const menuNode = open ? (
    <div
      ref={menuRef}
      id={listId}
      role="listbox"
      className={clsx(styles.menu, inDialog && styles.menuInline)}
      {...{ [FLOATING_UI_ATTR]: "" }}
      style={
        inDialog
          ? { width: pos.width || undefined }
          : {
              top: flip ? undefined : pos.top,
              bottom: flip ? window.innerHeight - pos.top + 4 : undefined,
              left: pos.left,
              width: pos.width,
            }
      }
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {showSearch ? (
        <input
          ref={searchRef}
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            onKeyDown(e);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Search…"
          aria-label="Filter options"
        />
      ) : null}
      <div className={styles.list}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>No matches</div>
        ) : (
          filtered.map((o, i) => (
            <button
              key={`${o.value}::${i}`}
              id={optionId(i)}
              type="button"
              role="option"
              aria-selected={o.value === value}
              data-option-active={i === hi ? "1" : undefined}
              className={clsx(
                styles.option,
                i === hi && styles.optionActive,
                o.value === value && styles.optionSelected
              )}
              onMouseEnter={() => setHi(i)}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                selectAt(i);
              }}
            >
              {o.label}
            </button>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={clsx(styles.wrap, className)} style={inDialog ? { position: "relative" } : undefined}>
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
        onPointerDown={() => {
          clearUiBlockersIfResidue();
        }}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
        }}
        onKeyDown={onKeyDown}
      >
        <span className={clsx(styles.value, !selected && styles.muted)}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className={styles.caret} aria-hidden />
      </button>
      {inDialog ? menuNode : menuNode && createPortal(menuNode, document.body)}
    </div>
  );
}
