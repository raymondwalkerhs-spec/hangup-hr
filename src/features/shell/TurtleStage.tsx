import styles from "./TurtleStage.module.css";

/** Polished earthy turtle SVG — fills from --critter-* theme vars. */
export function TurtleSvg({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 96 72" aria-hidden>
      <ellipse cx="48" cy="66" rx="22" ry="3.5" fill="currentColor" opacity="0.12" />
      {/* hind legs */}
      <ellipse cx="28" cy="52" rx="8" ry="5" fill="var(--critter-skin, var(--cat-fur))" transform="rotate(-18 28 52)" />
      <ellipse cx="68" cy="52" rx="8" ry="5" fill="var(--critter-skin, var(--cat-fur))" transform="rotate(18 68 52)" />
      {/* fore legs */}
      <ellipse cx="34" cy="48" rx="7" ry="4.5" fill="var(--critter-skin-dark, var(--cat-leg))" transform="rotate(-28 34 48)" />
      <ellipse cx="62" cy="48" rx="7" ry="4.5" fill="var(--critter-skin-dark, var(--cat-leg))" transform="rotate(28 62 48)" />
      {/* shell */}
      <ellipse cx="48" cy="38" rx="28" ry="20" fill="var(--critter-shell, var(--cat-fur))" />
      <ellipse cx="48" cy="36" rx="22" ry="15" fill="var(--critter-shell-light, var(--cat-fur-light))" opacity="0.55" />
      <path
        d="M30 38 Q48 22 66 38 Q48 48 30 38"
        fill="none"
        stroke="var(--critter-shell-dark, var(--cat-leg))"
        strokeWidth="1.4"
        opacity="0.55"
      />
      <path d="M48 22 L48 48" stroke="var(--critter-shell-dark, var(--cat-leg))" strokeWidth="1.2" opacity="0.4" />
      <path d="M34 30 L62 46" stroke="var(--critter-shell-dark, var(--cat-leg))" strokeWidth="1.1" opacity="0.35" />
      <path d="M62 30 L34 46" stroke="var(--critter-shell-dark, var(--cat-leg))" strokeWidth="1.1" opacity="0.35" />
      {/* head */}
      <ellipse cx="48" cy="18" rx="10" ry="9" fill="var(--critter-skin, var(--cat-fur))" />
      <ellipse cx="44.5" cy="16.5" rx="2.2" ry="2.6" fill="var(--critter-eye-white, var(--cat-eye-white))" />
      <ellipse cx="51.5" cy="16.5" rx="2.2" ry="2.6" fill="var(--critter-eye-white, var(--cat-eye-white))" />
      <circle cx="44.8" cy="16.8" r="1.15" fill="var(--critter-eye, var(--cat-eye))" />
      <circle cx="51.8" cy="16.8" r="1.15" fill="var(--critter-eye, var(--cat-eye))" />
      <circle cx="45.3" cy="16.2" r="0.35" fill="#fff" />
      <circle cx="52.3" cy="16.2" r="0.35" fill="#fff" />
      {/* tail tip */}
      <ellipse cx="48" cy="56" rx="3.5" ry="2.2" fill="var(--critter-skin-dark, var(--cat-leg))" />
    </svg>
  );
}

export function TurtleSpinStage({
  message,
  sub,
  active = true,
}: {
  message: string;
  sub?: string;
  active?: boolean;
}) {
  return (
    <div className={styles.stage}>
      <div
        className={`${styles.spinWrap} ${active ? styles.spinActive : ""}`}
        aria-hidden
        data-turtle="spin"
      >
        <div className={styles.spinInner}>
          <TurtleSvg className={styles.spinTurtle} />
        </div>
        <div className={styles.spinGlow} />
      </div>
      <p className={styles.label}>{message}</p>
      {sub ? <p className={styles.sub}>{sub}</p> : null}
    </div>
  );
}

export function AmblingTurtle() {
  return (
    <svg className={styles.ambleSvg} viewBox="0 0 96 56" aria-hidden data-turtle="amble">
      <ellipse cx="48" cy="52" rx="18" ry="2.2" fill="currentColor" opacity="0.12" />
      <ellipse cx="26" cy="40" rx="7" ry="4" fill="var(--critter-skin, var(--cat-fur))" transform="rotate(-12 26 40)" />
      <ellipse cx="70" cy="40" rx="7" ry="4" fill="var(--critter-skin, var(--cat-fur))" transform="rotate(12 70 40)" />
      <ellipse cx="34" cy="38" rx="6" ry="3.5" fill="var(--critter-skin-dark, var(--cat-leg))" transform="rotate(-22 34 38)" />
      <ellipse cx="62" cy="38" rx="6" ry="3.5" fill="var(--critter-skin-dark, var(--cat-leg))" transform="rotate(22 62 38)" />
      <ellipse cx="48" cy="30" rx="24" ry="16" fill="var(--critter-shell, var(--cat-fur))" />
      <ellipse cx="48" cy="28" rx="18" ry="12" fill="var(--critter-shell-light, var(--cat-fur-light))" opacity="0.5" />
      <path d="M32 30 Q48 18 64 30" fill="none" stroke="var(--critter-shell-dark, var(--cat-leg))" strokeWidth="1.2" opacity="0.45" />
      <path d="M48 16 L48 40" stroke="var(--critter-shell-dark, var(--cat-leg))" strokeWidth="1" opacity="0.35" />
      <ellipse cx="74" cy="24" rx="8" ry="7" fill="var(--critter-skin, var(--cat-fur))" />
      <circle cx="77" cy="22.5" r="1.4" fill="var(--critter-eye, var(--cat-eye))" />
      <circle cx="77.4" cy="22" r="0.4" fill="#fff" />
      <ellipse cx="22" cy="34" rx="3" ry="2" fill="var(--critter-skin-dark, var(--cat-leg))" />
    </svg>
  );
}
