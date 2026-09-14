/** Gotham Night bats — silhouette with flapping wings. */
import styles from "./BatStage.module.css";

export function BatSvg({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 40" width="64" height="40" aria-hidden>
      <g fill="var(--cat-fur, #3d4558)">
        <path d="M32 18c-3 0-5.5 2-6.5 5-.4 1.2.4 2.5 1.6 2.8 1.5.4 3.2.7 4.9.7s3.4-.3 4.9-.7c1.2-.3 2-1.6 1.6-2.8C37.5 20 35 18 32 18z" />
        <g className={styles.wingLeft}>
          <path d="M26 22C14 10 4 12 2 18c6 2 12 8 18 10 2-1.5 4-3.5 6-6z" />
        </g>
        <g className={styles.wingRight}>
          <path d="M38 22c12-12 22-10 24-4-6 2-12 8-18 10-2-1.5-4-3.5-6-6z" />
        </g>
        <circle cx="28.5" cy="21" r="1.2" fill="var(--cat-nose, #f0c14b)" />
        <circle cx="35.5" cy="21" r="1.2" fill="var(--cat-nose, #f0c14b)" />
        <path d="M29 14l-2-6 4 4 1-5 1 5 4-4-2 6z" fill="var(--cat-fur-light, #6b7488)" />
      </g>
    </svg>
  );
}

export function BatSpinStage({
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
        data-bat="spin"
        data-cat="orbit"
      >
        <BatSvg className={styles.spinBat} />
      </div>
      <p className={styles.label}>{message}</p>
      {sub ? <p className={styles.sub}>{sub}</p> : null}
    </div>
  );
}

export function AmblingBat() {
  return <BatSvg className={styles.ambleBat} />;
}
