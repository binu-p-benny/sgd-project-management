"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import type { PhaseStatusCell } from "@/lib/dashboard";
import { PHASE_LABELS, OVERALL_STATUS_LABELS } from "@/lib/labels";
import type { OverallStatus, ProjectPhase } from "@prisma/client";

const STATUS_ORDER: OverallStatus[] = ["on_track", "delayed", "blocked", "completed"];
const STATUS_COLOR_VAR: Record<OverallStatus, string> = {
  on_track: "var(--chart-status-good)",
  delayed: "var(--chart-status-warning)",
  blocked: "var(--chart-status-critical)",
  completed: "var(--chart-muted)",
};
const PHASE_ORDER: ProjectPhase[] = ["phase_1", "phase_2", "phase_3", "completed"];

function pivot(cells: PhaseStatusCell[]) {
  return PHASE_ORDER.map((phase) => {
    const row: Record<string, string | number> = { phase, phaseLabel: PHASE_LABELS[phase] };
    let total = 0;
    for (const status of STATUS_ORDER) {
      const count = cells.find((c) => c.phase === phase && c.status === status)?.count ?? 0;
      row[status] = count;
      total += count;
    }
    row.total = total;
    return row;
  }).filter((row) => (row.total as number) > 0);
}

export function PhaseStatusWidget({ data }: { data: PhaseStatusCell[] }) {
  const rows = pivot(data);

  return (
    <div className="rounded-xl border border-edge border-t-4 border-t-accent bg-gradient-to-br from-indigo-50 to-70% to-surface p-4 dark:from-indigo-500/10 shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
            <rect x="4" y="5" width="16" height="15" rx="1.5" />
            <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
          </svg>
        </span>
        <h3 className="text-sm font-semibold text-fg">
          Projects by phase &amp; status
        </h3>
      </div>

      {/* Desktop: stacked bar chart */}
      <div className="hidden h-64 sm:block">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="phaseLabel" tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--chart-axis)" }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: "var(--chart-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", fontSize: 12 }}
              labelStyle={{ color: "var(--chart-text-primary)" }}
            />
            <Legend
              formatter={(value) => OVERALL_STATUS_LABELS[value as OverallStatus]}
              wrapperStyle={{ fontSize: 12, color: "var(--chart-text-secondary)" }}
            />
            {STATUS_ORDER.map((status) => (
              <Bar
                key={status}
                dataKey={status}
                stackId="a"
                fill={STATUS_COLOR_VAR[status]}
                name={status}
                radius={status === "blocked" ? [0, 0, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Mobile: vertical list with inline segment bars */}
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <div key={row.phase as string} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-fg">{row.phaseLabel as string}</span>
              <span className="text-fg-muted">{row.total} project{row.total === 1 ? "" : "s"}</span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
              {STATUS_ORDER.map((status) => {
                const count = row[status] as number;
                if (count === 0) return null;
                const pct = ((count / (row.total as number)) * 100).toFixed(1);
                return (
                  <div
                    key={status}
                    style={{ width: `${pct}%`, backgroundColor: STATUS_COLOR_VAR[status] }}
                    title={`${OVERALL_STATUS_LABELS[status]}: ${count}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          {STATUS_ORDER.map((status) => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_COLOR_VAR[status] }}
              />
              {OVERALL_STATUS_LABELS[status]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
