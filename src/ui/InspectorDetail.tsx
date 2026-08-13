import { fmt } from "@/api/client";

const SKIP = new Set(["id", "created_at", "updated_at"]);

export function InspectorDetail({ row, fields }: { row: Record<string, unknown>; fields?: string[] }) {
  const keys = fields || Object.keys(row).filter((k) => !SKIP.has(k) && row[k] != null && row[k] !== "");
  return (
    <dl style={{ margin: 0, fontSize: "0.85rem" }}>
      {keys.map((k) => {
        const v = row[k];
        const display =
          typeof v === "number" ? fmt(v) : typeof v === "object" ? JSON.stringify(v) : String(v ?? "—");
        return (
          <div key={k} style={{ marginBottom: "0.5rem" }}>
            <dt className="muted" style={{ fontSize: "0.7rem", textTransform: "capitalize" }}>
              {k.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
            </dt>
            <dd style={{ margin: "0.1rem 0 0" }}>{display}</dd>
          </div>
        );
      })}
    </dl>
  );
}
