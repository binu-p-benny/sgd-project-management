"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, ReferenceLine } from "recharts";
import type { DurationVarianceRow } from "@/lib/dashboard";

export function DurationVarianceWidget({ data }: { data: DurationVarianceRow[] }) {
  return (
    <div className="rounded-xl border border-edge border-t-4 border-t-accent bg-gradient-to-br from-indigo-50 to-70% to-surface p-4 dark:from-indigo-500/10 shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
            <path d="M12 3v18M7 7l-3.5 7a3.5 3.5 0 0 0 7 0L7 7ZM17 7l-3.5 7a3.5 3.5 0 0 0 7 0L17 7ZM4 21h16M3.5 7h7M13.5 7h7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h3 className="text-sm font-semibold text-fg">
          Actual vs planned duration
        </h3>
      </div>
      <p className="mb-4 text-xs text-fg-muted">
        Days over (red) or under (blue) the planned duration, averaged per step
      </p>

      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">No completed steps yet.</p>
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
                    <span className="font-mono text-xs text-fg-muted">{row.stepCode}</span>
                    <span
                      className="font-medium"
                      style={{ color: isOver ? "var(--chart-diverging-pos)" : "var(--chart-diverging-neg)" }}
                    >
                      {isOver ? "+" : ""}
                      {row.varianceDays}d
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${magnitude}%`,
                        backgroundColor: isOver ? "var(--chart-diverging-pos)" : "var(--chart-diverging-neg)",
                      }}
                    />
                  </div>
                  <div className="text-xs text-fg-subtle">
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
