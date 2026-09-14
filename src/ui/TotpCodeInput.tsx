import { useEffect, useRef, useState } from "react";
import styles from "./TotpCodeInput.module.css";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
};

function digitsOnly(raw: string) {
  return String(raw || "").replace(/\D/g, "").slice(0, 6);
}

export function TotpCodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  "aria-label": ariaLabel = "Authenticator code",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const code = digitsOnly(value);
  const cells = Array.from({ length: 6 }, (_, i) => code[i] || "");
  const activeIndex = focused ? Math.min(code.length, 5) : -1;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (code.length === 6) onComplete?.(code);
    // intentionally not depending on onComplete identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div
      className={styles.wrap}
      data-ui="totp"
      onClick={() => inputRef.current?.focus()}
      role="group"
      aria-label={ariaLabel}
    >
      <input
        ref={inputRef}
        className={styles.overlay}
        value={code}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        onChange={(e) => onChange(digitsOnly(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPaste={(e) => {
          const pasted = digitsOnly(e.clipboardData.getData("text"));
          if (pasted) {
            e.preventDefault();
            onChange(pasted);
          }
        }}
        aria-label={ariaLabel}
      />
      <div className={styles.row} aria-hidden>
        {cells.map((ch, i) => (
          <div
            key={i}
            className={`${styles.cell} ${ch ? styles.filled : ""} ${activeIndex === i ? styles.active : ""}`}
          >
            {ch}
          </div>
        ))}
      </div>
    </div>
  );
}
