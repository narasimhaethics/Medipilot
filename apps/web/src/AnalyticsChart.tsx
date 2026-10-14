import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export function AnalyticsChart({ data, gradientId }: { data: { day: string; visits: number }[]; gradientId: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#43aaa7" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#43aaa7" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#edf1f4" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#8a97a5", fontSize: 11 }} dy={9} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: "#8a97a5", fontSize: 11 }} />
        <Tooltip contentStyle={{ border: "1px solid #e6ebef", borderRadius: 10, boxShadow: "0 8px 24px #1c374010" }} />
        <Area type="monotone" dataKey="visits" stroke="#269a96" strokeWidth={2.5} fill={`url(#${gradientId})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
