import { useEffect, useRef } from "react";
import { RunningCat } from "@/features/shell/CatOrbitStage";
import { AmblingTurtle } from "@/features/shell/TurtleStage";
import { useThemeStore } from "@/stores/theme-store";
import styles from "./CatsPage.module.css";

type Pt = { x: number; y: number };
type PathFn = (t: number) => Pt;

function ellipse(rx: number, ry: number, phase = 0): PathFn {
  return (t) => {
    const a = t * Math.PI * 2 + phase;
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
  };
}
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

const PATHS: PathFn[] = [
  ellipse(1, 1),
  ellipse(1, 0.62, 0.4),
  ellipse(0.7, 1, 1.1),
  superellipse(1, 1, 3.4, 0.2),
  superellipse(1, 0.75, 5.2, 0.8),
  polarWobble(1, 3, 0.16, 0.3),
  polarWobble(1, 4, 0.14, 1.2),
  lemniscate(1, 0.85),
  lemniscate(0.85, 1, Math.PI / 2),
];

const CAT_COUNT = 10;
const TURTLE_COUNT = 8;

function PlayCritter({ index, slow, useTurtle }: { index: number; slow?: boolean; useTurtle?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const path = PATHS[index % PATHS.length];
    const cx = 12 + ((index * 17) % 76);
    const cy = 18 + ((index * 23) % 64);
    const rx = 70 + (index % 5) * 18;
    const ry = 50 + (index % 4) * 16;
    let start = performance.now();
    let dur = slow ? 7500 + (index % 6) * 800 : 2800 + (index % 6) * 400;
    let facing = 1;
    let prev = path(0);
    if (reduce) {
      const el = wrapRef.current;
      if (el) el.style.transform = `translate(${cx}vw, ${cy}vh)`;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      let t = (now - start) / dur;
      if (t >= 1) {
        start = now;
        dur = slow ? 7000 + Math.random() * 4000 : 2600 + Math.random() * 1400;
        t = 0;
      }
      const p = path(t);
      const look = path(Math.min(1, t + 0.01));
      const vx = look.x - prev.x;
      if (Math.abs(vx) > 0.002) facing = vx < 0 ? -1 : 1;
      prev = p;
      const el = wrapRef.current;
      const face = faceRef.current;
      if (el) el.style.transform = `translate(calc(${cx}vw + ${p.x * rx}px), calc(${cy}vh + ${p.y * ry}px))`;
      if (face) face.style.transform = `scaleX(${facing})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, slow]);

  return (
    <div
      className={useTurtle ? styles.turtle : styles.cat}
      ref={wrapRef}
      aria-hidden
      data-cat={useTurtle ? undefined : "orbit"}
      data-turtle={useTurtle ? "amble" : undefined}
    >
      <div ref={faceRef}>{useTurtle ? <AmblingTurtle /> : <RunningCat />}</div>
    </div>
  );
}

export function CatsPage() {
  const theme = useThemeStore((s) => s.theme);
  const turtles = theme === "turtles";
  const count = turtles ? TURTLE_COUNT : CAT_COUNT;

  return (
    <div className={styles.page}>
      <p className={styles.caption}>
        {turtles ? "Hangup turtles — no HR data here. Slow and steady." : "Hangup cats — no HR data here. Sit back."}
      </p>
      <div className={styles.stage}>
        {Array.from({ length: count }, (_, i) => (
          <PlayCritter key={`${turtles ? "t" : "c"}-${i}`} index={i} slow={turtles} useTurtle={turtles} />
        ))}
      </div>
    </div>
  );
}
