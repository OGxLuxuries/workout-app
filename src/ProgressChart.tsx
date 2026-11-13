import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
export default function ProgressChart({
  data,
  people,
  unit,
}: {
  data: Record<string, unknown>[];
  people: { id: string; name: string }[];
  unit: string;
}) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(v) => v.slice(5)} />
          <YAxis unit={" " + unit} />
          <Tooltip />
          <Legend />
          {people.map((p, i) => (
            <Line
              key={p.id}
              type="monotone"
              dataKey={p.id}
              name={p.name}
              stroke={i ? "#bd6b36" : "#287058"}
              strokeWidth={3}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
