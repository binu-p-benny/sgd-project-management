import Link from "next/link";
import type { ProjectSituationCounts } from "@/lib/dashboard";

type Severity = "good" | "warning" | "serious" | "critical";

interface Tile {
  label: string;
  subtitle: string;
  value: number;
  color: Severity;
  href: string;
}

const COLOR_VAR: Record<Severity, string> = {
  good: "var(--chart-status-good)",
  warning: "var(--chart-status-warning)",
  serious: "var(--chart-status-serious)",
  critical: "var(--chart-status-critical)",
};

function StatTile({ tile }: { tile: Tile }) {
  return (
    <Link
      href={tile.href}
      className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
      style={{ borderTopWidth: 4, borderTopColor: COLOR_VAR[tile.color] }}
    >
      <div className="flex items-start justify-between gap-2 p-3 sm:p-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            {tile.label}
          </div>
          <div className="text-xs text-zinc-400 dark:text-zinc-500">{tile.subtitle}</div>
        </div>
        <div className="shrink-0 text-2xl font-bold text-zinc-900 sm:text-3xl dark:text-zinc-50">{tile.value}</div>
      </div>
    </Link>
  );
}

/**
 * A 4-step severity ramp (good → warning → serious → critical) driven by count, with
 * thresholds tuned per metric so the color reflects how alarming that count actually is
 * for that specific situation — not a single generic scale reused everywhere. 0 is
 * always "good" regardless of thresholds.
 */
function severity(count: number, warningAt: number, seriousAt: number, criticalAt: number): Severity {
  if (count <= 0) return "good";
  if (count >= criticalAt) return "critical";
  if (count >= seriousAt) return "serious";
  if (count >= warningAt) return "warning";
  return "good";
}

export function ProjectStatTiles({ counts }: { counts: ProjectSituationCounts }) {
  const overview: Tile[] = [
    { label: "Total projects", subtitle: "All time", value: counts.total, color: "good", href: "/projects" },
    {
      label: "On track",
      subtitle: "Current",
      value: counts.onTrack,
      color: "good",
      href: "/projects?status=on_track",
    },
    {
      label: "Completed",
      subtitle: "All time",
      value: counts.completed,
      color: "good",
      href: "/projects?status=completed",
    },
    {
      label: "New projects",
      subtitle: "Last 30 days",
      value: counts.newLast30Days,
      color: "good",
      href: "/projects?newDays=30",
    },
  ];

  const alerts: Tile[] = [
    // Blocked is the most severe situation in this app's own status hierarchy (see
    // overrun.ts's getEffectiveOverallStatus) — work has literally stopped, so any count
    // at all jumps straight to critical rather than ramping up gradually.
    {
      label: "Blocked",
      subtitle: "Projects",
      value: counts.blocked,
      color: severity(counts.blocked, 1, 1, 1),
      href: "/projects?status=blocked",
    },
    // Schedule slippage across the whole portfolio — serious well before it reaches
    // "blocked" territory, since a growing pile of overdue steps is a leading indicator
    // of more projects becoming delayed or blocked soon. Links to the projects that
    // contain at least one overdue step (a step-level count, but a project-level view).
    {
      label: "Overdue steps",
      subtitle: "Across all projects",
      value: counts.overdueSteps,
      color: severity(counts.overdueSteps, 1, 3, 8),
      href: "/projects?overdue=1",
    },
    // Delayed projects are real but one tier down from blocked — work is still moving,
    // just behind schedule.
    {
      label: "Delayed",
      subtitle: "Projects",
      value: counts.delayed,
      color: severity(counts.delayed, 1, 4, 10),
      href: "/projects?status=delayed",
    },
    // Payment follow-up matters but isn't a delivery blocker the way the others are, so
    // it takes a larger volume before it reads as more than a mild warning.
    {
      label: "Payment pending",
      subtitle: "Projects",
      value: counts.paymentPending,
      color: severity(counts.paymentPending, 1, 6, 15),
      href: "/projects?paymentStatus=pending",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Projects</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {overview.map((tile) => (
            <StatTile key={tile.label} tile={tile} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Alerts</h2>
          <div className="flex items-center gap-3 text-[10px] text-zinc-400 dark:text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_VAR.warning }} /> Watch
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_VAR.serious }} /> Serious
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR_VAR.critical }} /> Critical
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {alerts.map((tile) => (
            <StatTile key={tile.label} tile={tile} />
          ))}
        </div>
      </div>
    </div>
  );
}
