import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell } from "recharts";
import { useCrossFilterStore } from "@/stores/cross-filter-store";

const COLORS = ["var(--primary)", "var(--accent)", "var(--ok)", "var(--warn)", "var(--chart-pending)"];

export function LinkedBarChart({
  data,
  filterKey,
  animate = true,
}: {
  data: { name: string; value: number }[];
  filterKey?: "team" | "status" | "category";
  animate?: boolean;
}) {
  const { filters, setFilter } = useCrossFilterStore();

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar
          dataKey="value"
          radius={[4, 4, 0, 0]}
          isAnimationActive={animate}
          onClick={(d) => {
            if (filterKey && d?.name) setFilter(filterKey, String(d.name));
          }}
          style={{ cursor: filterKey ? "pointer" : "default" }}
        >
          {data.map((entry, i) => (
            <Cell
              key={entry.name}
              fill={COLORS[i % COLORS.length]}
              opacity={filters[filterKey!] && filters[filterKey!] !== entry.name ? 0.35 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
