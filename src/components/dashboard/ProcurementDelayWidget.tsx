"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import type { ProcurementDelayRow } from "@/lib/dashboard";

const ITEM_TYPE_LABEL: Record<string, string> = { section: "Section", hardware: "Hardware", gasket: "Gasket" };
// Fixed categorical slots, matches the app's other item_type usages.
const ITEM_TYPE_COLOR_VAR: Record<string, string> = {
  section: "var(--chart-series-1)",
  hardware: "var(--chart-series-2)",
  gasket: "var(--chart-series-3)",
};

export function ProcurementDelayWidget({ data }: { data: ProcurementDelayRow[] }) {
  const rows = data.map((r) => ({ ...r, label: ITEM_TYPE_LABEL[r.itemType] }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Procurement delays</h3>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Share of items that missed their expected arrival date
      </p>

      {/* Desktop: bar chart */}
      <div className="hidden h-56 sm:block">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
            <YAxis
              unit="%"
              domain={[0, 100]}
              tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", fontSize: 12 }}
              labelStyle={{ color: "var(--chart-text-primary)" }}
              formatter={(value, _name, item) => [
                `${value}% (${item.payload.overrunCount} of ${item.payload.totalCount})`,
                "Overrun rate",
              ]}
            />
            <Bar dataKey="overrunRate" radius={[4, 4, 0, 0]}>
              {rows.map((row) => (
                <Cell key={row.itemType} fill={ITEM_TYPE_COLOR_VAR[row.itemType]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Mobile: vertical list */}
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <div key={row.itemType} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-900 dark:text-zinc-50">{row.label}</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {row.overrunRate}% ({row.overrunCount}/{row.totalCount})
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full"
                style={{ width: `${row.overrunRate}%`, backgroundColor: ITEM_TYPE_COLOR_VAR[row.itemType] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
