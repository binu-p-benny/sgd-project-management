"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LabelList } from "recharts";
import type { DepartmentKpiRow } from "@/lib/department-kpi";
import { scoreColorVar } from "./scoreColor";

export function DepartmentScoreChart({ rows }: { rows: DepartmentKpiRow[] }) {
  const data = rows.map((r) => ({ label: r.label, score: r.score }));

  return (
    <div className="rounded-xl border border-edge border-t-4 border-t-accent bg-gradient-to-br from-indigo-50 to-70% to-surface p-4 shadow-[var(--shadow-sm)] dark:from-indigo-500/10 sm:p-5">
      <h3 className="mb-1 text-sm font-semibold text-fg">Performance score by department</h3>
      <p className="mb-4 text-xs text-fg-muted">
        On-time completion (weighted 60%), QC pass rate (20%), current overdue backlog (20%)
      </p>

      {/* Desktop: horizontal bar chart */}
      <div className="hidden h-64 sm:block">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 28 }}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--chart-axis)" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={110}
              tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", fontSize: 12 }}
              labelStyle={{ color: "var(--chart-text-primary)" }}
              cursor={{ fill: "var(--chart-grid)" }}
              formatter={(value) => [`${value} / 100`, "Score"]}
            />
            <Bar dataKey="score" radius={[0, 4, 4, 0]}>
              {data.map((row) => (
                <Cell key={row.label} fill={scoreColorVar(row.score)} />
              ))}
              <LabelList dataKey="score" position="right" fill="var(--chart-text-secondary)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Mobile: bar list */}
      <div className="flex flex-col gap-3 sm:hidden">
        {data.map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-fg">{row.label}</span>
              <span className="font-mono tabular-nums text-fg-muted">{row.score}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full"
                style={{ width: `${row.score}%`, backgroundColor: scoreColorVar(row.score) }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
