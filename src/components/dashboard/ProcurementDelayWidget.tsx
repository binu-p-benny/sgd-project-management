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
    <div className="rounded-xl border border-edge border-t-4 border-t-orange-500 bg-gradient-to-br from-orange-50 to-70% to-surface p-4 dark:from-orange-500/10 shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/25">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
            <rect x="3.5" y="7" width="17" height="12" rx="1.5" />
            <path d="M3.5 11h17M8 7V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V7" strokeLinecap="round" />
          </svg>
        </span>
        <h3 className="text-sm font-semibold text-fg">Procurement delays</h3>
      </div>
      <p className="mb-4 text-xs text-fg-muted">
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
              <span className="text-fg">{row.label}</span>
              <span className="text-fg-muted">
                {row.overrunRate}% ({row.overrunCount}/{row.totalCount})
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
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
