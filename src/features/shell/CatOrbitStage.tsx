import { useEffect, useId, useRef } from "react";
import styles from "./PageLoadingOverlay.module.css";

type Pt = { x: number; y: number };
type PathFn = (t: number) => Pt;

function ellipse(rx: number, ry: number, phase = 0): PathFn {
  return (t) => {
    const a = t * Math.PI * 2 + phase;
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
  };
}

/** Superellipse: n=2 circle, higher n → rounded rect, lower n → diamond. */
function superellipse(rx: number, ry: number, n: number, phase = 0): PathFn {
  return (t) => {
    const a = t * Math.PI * 2 + phase;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p = 2 / n;
    return {
      x: Math.sign(ca) * rx * Math.pow(Math.abs(ca), p),
      y: Math.sign(sa) * ry * Math.pow(Math.abs(sa), p),
    };
  };
}

function polarWobble(r: number, lobes: number, amount: number, phase = 0): PathFn {
  return (t) => {
    const a = t * Math.PI * 2 + phase;
    const rad = r * (1 + amount * Math.cos(lobes * a));
    return { x: Math.cos(a) * rad, y: Math.sin(a) * rad };
  };
}

function lemniscate(ax: number, ay: number, phase = 0): PathFn {
  return (t) => {
    const a = t * Math.PI * 2 + phase;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const d = 1 + s * s;
    return { x: (ax * c) / d, y: (ay * s * c) / d };
  };
}

function makePaths(): PathFn[] {
  return [
    ellipse(54, 54),
    ellipse(64, 42, 0.4),
    ellipse(42, 62, 1.1),
    superellipse(56, 56, 3.4, 0.2),
    superellipse(62, 46, 5.2, 0.8),
    superellipse(50, 58, 1.65, 0.5),
    polarWobble(54, 3, 0.16, 0.3),
    polarWobble(52, 4, 0.14, 1.2),
    polarWobble(55, 2, 0.18, 0.7),
    lemniscate(58, 52),
    lemniscate(52, 58, Math.PI / 2),
  ];
}

function pickPath(paths: PathFn[], avoid?: PathFn) {
  let next = paths[Math.floor(Math.random() * paths.length)];
  if (paths.length > 1) {
    while (next === avoid) next = paths[Math.floor(Math.random() * paths.length)];
  }
  return next;
}

function useOrbitMotion(active: boolean) {
  const catRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const pupilRefs = useRef<SVGGElement[]>([]);
  const pathsRef = useRef(makePaths());
  const pathRef = useRef<PathFn>(pathsRef.current[0]);
  const facingRef = useRef(1);
  const startRef = useRef(0);
  const durationRef = useRef(2600);

  useEffect(() => {
    if (!active) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const cat = catRef.current;
      if (cat) cat.style.transform = "translate(54px, 0px)";
      return;
    }

    pathRef.current = pickPath(pathsRef.current);
    startRef.current = performance.now();
    durationRef.current = 2200 + Math.random() * 900;
    let prev = pathRef.current(0);
    let raf = 0;

    const tick = (now: number) => {
      let t = (now - startRef.current) / durationRef.current;
      if (t >= 1) {
        pathRef.current = pickPath(pathsRef.current, pathRef.current);
        startRef.current = now;
        durationRef.current = 2200 + Math.random() * 900;
        t = 0;
      }
      const p = pathRef.current(t);
      const look = pathRef.current(Math.min(1, t + 0.012));
      const vx = look.x - prev.x;
      if (Math.abs(vx) > 0.12) facingRef.current = vx < 0 ? -1 : 1;
      prev = p;

      const cat = catRef.current;
      const face = faceRef.current;
      if (cat) cat.style.transform = `translate(${p.x}px, ${p.y}px)`;
      if (face) face.style.transform = `scaleX(${facingRef.current})`;

      const mag = Math.max(28, Math.hypot(p.x, p.y));
      const px = (p.x / mag) * 3.15;
      const py = (p.y / mag) * 3.15;
      for (const g of pupilRefs.current) {
        if (g) g.style.transform = `translate(${px}px, ${py}px)`;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const setPupil = (el: SVGGElement | null, i: number) => {
    if (el) pupilRefs.current[i] = el;
  };

  return { catRef, faceRef, setPupil };
}

function CenterCat({ setPupil }: { setPupil: (el: SVGGElement | null, i: number) => void }) {
  const uid = useId().replace(/:/g, "");
  const leftClip = `${uid}-eye-l`;
  const rightClip = `${uid}-eye-r`;

  return (
    <svg className={styles.centerCat} viewBox="0 0 80 80" aria-hidden>
      <defs>
        <clipPath id={leftClip}>
          <ellipse cx="29" cy="42" rx="8.2" ry="9.2" />
        </clipPath>
        <clipPath id={rightClip}>
          <ellipse cx="51" cy="42" rx="8.2" ry="9.2" />
        </clipPath>
      </defs>
      <ellipse cx="40" cy="73" rx="16" ry="4.5" fill="currentColor" opacity="0.1" />
      <path d="M18 32c-2-14 8-24 16-26 1.5 7 4 13 6 16h8c2-3 4.5-9 6-16 8 2 18 12 16 26" fill="#f0a85a" />
      <path d="M20 20l10 12-8-14c-1 .4-1.6 1.2-2 2z" fill="#f7c98a" />
      <path d="M60 20l-10 12 8-14c1 .4 1.6 1.2 2 2z" fill="#f7c98a" />
      <path d="M23 18l6 11-5-12z" fill="#e8899a" />
      <path d="M57 18l-6 11 5-12z" fill="#e8899a" />
      <ellipse cx="40" cy="47" rx="25" ry="22.5" fill="#f0a85a" />
      <ellipse cx="23" cy="52" rx="7.5" ry="5.5" fill="#f7c98a" />
      <ellipse cx="57" cy="52" rx="7.5" ry="5.5" fill="#f7c98a" />
      <path d="M16 39c5-2.2 10-1.2 12 1.2" stroke="#d08a42" strokeWidth="1.35" fill="none" strokeLinecap="round" />
      <path d="M16 45c5-1.2 10 0 12 2" stroke="#d08a42" strokeWidth="1.35" fill="none" strokeLinecap="round" />
      <path d="M64 39c-5-2.2-10-1.2-12 1.2" stroke="#d08a42" strokeWidth="1.35" fill="none" strokeLinecap="round" />
      <path d="M64 45c-5-1.2-10 0-12 2" stroke="#d08a42" strokeWidth="1.35" fill="none" strokeLinecap="round" />
      <ellipse cx="29" cy="42" rx="8.2" ry="9.2" fill="#fffef8" />
      <ellipse cx="51" cy="42" rx="8.2" ry="9.2" fill="#fffef8" />
      <g clipPath={`url(#${leftClip})`}>
        <g className={styles.pupils} ref={(el) => setPupil(el, 0)}>
          <circle cx="29" cy="42" r="3.85" fill="#2b1a12" />
          <circle cx="30.5" cy="40.5" r="1.15" fill="#fff" />
        </g>
      </g>
      <g clipPath={`url(#${rightClip})`}>
        <g className={styles.pupils} ref={(el) => setPupil(el, 1)}>
          <circle cx="51" cy="42" r="3.85" fill="#2b1a12" />
          <circle cx="52.5" cy="40.5" r="1.15" fill="#fff" />
        </g>
      </g>
      <path d="M40 48.4c-1.5 0-2.7 1.3-2.4 2.4.4 1.4 2.4 2.2 2.4 2.2s2-0.8 2.4-2.2c.3-1.1-.9-2.4-2.4-2.4z" fill="#c45b6a" />
      <path d="M40 53c0 3.4-2.6 5.4-5.6 5.4" fill="none" stroke="#2b1a12" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M40 53c0 3.4 2.6 5.4 5.6 5.4" fill="none" stroke="#2b1a12" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function CatLeg({ className, hipX, hipY }: { className: string; hipX: number; hipY: number }) {
  return (
    <g transform={`translate(${hipX} ${hipY})`}>
      <g className={className}>
        <path
          d="M0 0 c-1 6 0 10 1 14"
          fill="none"
          stroke="#e09a4a"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        <ellipse cx="1.6" cy="15.2" rx="3.1" ry="1.7" fill="#d4883c" />
      </g>
    </g>
  );
}

export function RunningCat() {
  return (
    <svg className={styles.orbitCatSvg} viewBox="0 0 86 52" aria-hidden>
      <ellipse className={styles.catShadow} cx="44" cy="48" rx="18" ry="2.4" fill="currentColor" />
      <g className={styles.runBody}>
        <g className={styles.tail}>
          <path
            d="M18 24c-8-1-14-8-13-16 3 4 8 8 14 10"
            fill="none"
            stroke="#f0a85a"
            strokeWidth="4.2"
            strokeLinecap="round"
          />
        </g>
        <CatLeg className={styles.legHindA} hipX={30} hipY={28} />
        <CatLeg className={styles.legHindB} hipX={36} hipY={28} />
        <ellipse cx="40" cy="26" rx="18" ry="11" fill="#f0a85a" />
        <ellipse cx="36" cy="28" rx="8" ry="5.5" fill="#f7c98a" />
        <CatLeg className={styles.legForeA} hipX={48} hipY={28} />
        <CatLeg className={styles.legForeB} hipX={54} hipY={28} />
        <g className={styles.head}>
          <path d="M62 8l4 9h-7z" fill="#f0a85a" />
          <path d="M76 9l-5 9h6z" fill="#f0a85a" />
          <path d="M63.2 10.2l2.4 6.2h-4z" fill="#e8899a" />
          <path d="M74.6 10.6l-3 6.2h3.6z" fill="#e8899a" />
          <ellipse cx="68" cy="22" rx="11" ry="10" fill="#f0a85a" />
          <circle cx="73.2" cy="20.4" r="1.55" fill="#2b1a12" />
          <circle cx="73.7" cy="19.9" r="0.45" fill="#fff" />
          <path d="M77.4 23.6c1.4.2 2.1 1.1 1.8 1.9" fill="none" stroke="#c45b6a" strokeWidth="1.35" strokeLinecap="round" />
          <path d="M66 24.5c1.6 2.2 5.2 2.4 6.6.2" fill="none" stroke="#2b1a12" strokeWidth="1.05" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

export function CatOrbitStage({
  message,
  sub,
  active = true,
}: {
  message: string;
  sub?: string;
  active?: boolean;
}) {
  const { catRef, faceRef, setPupil } = useOrbitMotion(active);

  return (
    <div className={styles.stage}>
      <div className={styles.orbitWrap} aria-hidden>
        <div className={styles.centerCatWrap}>
          <CenterCat setPupil={setPupil} />
        </div>
        <div className={styles.orbitCat} ref={catRef}>
          <div className={styles.orbitCatFace} ref={faceRef}>
            <RunningCat />
          </div>
        </div>
      </div>
      <p className={styles.label}>{message}</p>
      {sub ? <p className={styles.sub}>{sub}</p> : null}
    </div>
  );
}
