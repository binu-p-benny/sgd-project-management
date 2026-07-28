"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import type { DepartmentWorkloadRow } from "@/lib/dashboard";
import { DEPARTMENT_LABELS } from "@/lib/labels";
import type { Department } from "@prisma/client";

// Fixed order + fixed categorical slot per department — never cycled or re-derived from data.
const DEPARTMENT_ORDER: Department[] = [
  "hr_admin",
  "project_engineer",
  "design_engineer",
  "purchase",
  "accounts",
];
const DEPARTMENT_COLOR_VAR: Record<Department, string> = {
  hr_admin: "var(--chart-series-1)",
  project_engineer: "var(--chart-series-2)",
  design_engineer: "var(--chart-series-3)",
  purchase: "var(--chart-series-4)",
  accounts: "var(--chart-series-5)",
  owner_admin: "var(--chart-muted)",
};

export function DepartmentWorkloadWidget({ data }: { data: DepartmentWorkloadRow[] }) {
  const rows = DEPARTMENT_ORDER.map((department) => ({
    department,
    label: DEPARTMENT_LABELS[department],
    openCount: data.find((d) => d.department === department)?.openCount ?? 0,
  }));
  const maxCount = Math.max(...rows.map((r) => r.openCount), 1);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Department workload</h3>

      {/* Desktop: bar chart */}
      <div className="hidden h-64 sm:block">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tick={{ fill: "var(--chart-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", fontSize: 12 }}
              labelStyle={{ color: "var(--chart-text-primary)" }}
              formatter={(value) => [`${value} open step${value === 1 ? "" : "s"}`, ""]}
            />
            <Bar dataKey="openCount" radius={[4, 4, 0, 0]}>
              {rows.map((row) => (
                <Cell key={row.department} fill={DEPARTMENT_COLOR_VAR[row.department]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Mobile: vertical list */}
      <div className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <div key={row.department} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-900 dark:text-zinc-50">{row.label}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{row.openCount}</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(row.openCount / maxCount) * 100}%`,
                  backgroundColor: DEPARTMENT_COLOR_VAR[row.department],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
