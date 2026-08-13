import { motion } from "framer-motion";

export function KpiRing({
  value,
  label,
  max = 100,
  onClick,
}: {
  value: number;
  label: string;
  max?: number;
  onClick?: () => void;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <motion.div
      className="interactive"
      style={{ textAlign: "center", cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
    >
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--chart-track)" strokeWidth="8" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="52" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text)">
          {value}
        </text>
      </svg>
      <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
        {label}
      </div>
    </motion.div>
  );
}
