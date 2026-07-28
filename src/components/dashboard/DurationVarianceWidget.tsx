"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine } from "recharts";
import type { DurationVarianceRow } from "@/lib/dashboard";

export function DurationVarianceWidget({ data }: { data: DurationVarianceRow[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Actual vs planned duration
      </h3>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Days over (red) or under (blue) the planned duration, averaged per step
      </p>

      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No completed steps yet.</p>
      ) : (
        <>
          {/* Desktop: diverging bar chart */}
          <div className="hidden h-64 sm:block">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                <XAxis type="number" tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="stepCode"
                  tick={{ fill: "var(--chart-text-secondary)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <ReferenceLine x={0} stroke="var(--chart-axis)" />
                <Tooltip
                  contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", fontSize: 12 }}
                  labelStyle={{ color: "var(--chart-text-primary)" }}
                  formatter={(value, _name, item) => [
                    `${Number(value) > 0 ? "+" : ""}${value}d (planned ${item.payload.avgPlannedDays}d, actual ${item.payload.avgActualDays}d, n=${item.payload.sampleSize})`,
                    "Variance",
                  ]}
                />
                <Bar dataKey="varianceDays" radius={[2, 2, 2, 2]}>
                  {data.map((row) => (
                    <Cell
                      key={row.stepCode}
                      fill={row.varianceDays > 0 ? "var(--chart-diverging-pos)" : "var(--chart-diverging-neg)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Mobile: vertical list, worst overruns first */}
          <div className="flex flex-col gap-2 sm:hidden">
            {data.map((row) => {
              const isOver = row.varianceDays > 0;
              const magnitude = Math.min(Math.abs(row.varianceDays) * 10, 100);
              return (
                <div key={row.stepCode} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{row.stepCode}</span>
                    <span
                      className="font-medium"
                      style={{ color: isOver ? "var(--chart-diverging-pos)" : "var(--chart-diverging-neg)" }}
                    >
                      {isOver ? "+" : ""}
                      {row.varianceDays}d
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${magnitude}%`,
                        backgroundColor: isOver ? "var(--chart-diverging-pos)" : "var(--chart-diverging-neg)",
                      }}
                    />
                  </div>
                  <div className="text-xs text-zinc-400 dark:text-zinc-500">
                    planned {row.avgPlannedDays}d · actual {row.avgActualDays}d · n={row.sampleSize}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
