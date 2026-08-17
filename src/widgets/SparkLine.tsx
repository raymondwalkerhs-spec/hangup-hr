import { ResponsiveContainer, LineChart, Line, Tooltip } from "recharts";

export function SparkLine({
  data,
  dataKey = "v",
  color = "var(--primary)",
}: {
  data: { v: number; label?: string }[];
  dataKey?: string;
  color?: string;
}) {
  if (!data?.length) return <p className="muted">No trend data</p>;
  return (
    <ResponsiveContainer width="100%" height={80}>
      <LineChart data={data}>
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
        <Tooltip
          formatter={(value: number) => [value, "Sales"]}
          labelFormatter={(_, payload) => {
            const row = payload?.[0]?.payload as { label?: string } | undefined;
            return row?.label ? `Day ${row.label}` : "";
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
