import Link from "next/link";
import type { ProjectSituationCounts } from "@/lib/dashboard";

type Severity = "good" | "warning" | "serious" | "critical";
// Overview tiles get a decorative hue (no severity meaning); alert tiles map their
// severity onto one of these so red/orange/amber keep their warning connotation.
type Hue = "indigo" | "violet" | "teal" | "emerald" | "amber" | "orange" | "red";
type IconName = "folder" | "check" | "checks" | "trend" | "block" | "clock" | "wallet";

interface Tile {
  label: string;
  subtitle: string;
  value: number;
  hue: Hue;
  href: string;
  icon: IconName;
}

const SEVERITY_TO_HUE: Record<Severity, Hue> = {
  good: "emerald",
  warning: "amber",
  serious: "orange",
  critical: "red",
};

const HUE_ICON_WRAP: Record<Hue, string> = {
  indigo: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/25",
  violet: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/25",
  teal: "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/25",
  emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25",
  orange: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/25",
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25",
};

const HUE_BORDER_VAR: Record<Hue, string> = {
  indigo: "#6366f1",
  violet: "#8b5cf6",
  teal: "#0d9488",
  emerald: "var(--chart-status-good)",
  amber: "var(--chart-status-warning)",
  orange: "var(--chart-status-serious)",
  red: "var(--chart-status-critical)",
};

// Soft tinted wash from a hue-50 corner into the card surface — gives each tile its
// own identity without turning the dashboard into a wall of flat white cards.
const HUE_WASH: Record<Hue, string> = {
  indigo: "from-indigo-50 dark:from-indigo-500/10",
  violet: "from-violet-50 dark:from-violet-500/10",
  teal: "from-teal-50 dark:from-teal-500/10",
  emerald: "from-emerald-50 dark:from-emerald-500/10",
  amber: "from-amber-50 dark:from-amber-500/10",
  orange: "from-orange-50 dark:from-orange-500/10",
  red: "from-red-50 dark:from-red-500/10",
};

function TileIcon({ name, className }: { name: IconName; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, className };
  switch (name) {
    case "folder":
      return (
        <svg {...common}>
          <path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z" strokeLinejoin="round" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8.5 12.3l2.2 2.2 4.8-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "checks":
      return (
        <svg {...common}>
          <path d="M3.5 12.5 7 16l7-8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11.5 12.5 15 16l7-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "trend":
      return (
        <svg {...common}>
          <path d="M4 15.5 9.5 10l3.5 3.5L20 6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 6h5v5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "block":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M6.4 6.4 17.6 17.6" strokeLinecap="round" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <rect x="3.5" y="6.5" width="17" height="12" rx="2" />
          <path d="M3.5 10.5h17" />
          <circle cx="16.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

function StatTile({ tile }: { tile: Tile }) {
  return (
    <Link
      href={tile.href}
      className={`group relative flex flex-col overflow-hidden rounded-xl border border-edge bg-gradient-to-br to-70% to-surface p-4 shadow-[var(--shadow-sm)] transition-all hover:-translate-y-0.5 hover:border-edge-2 hover:shadow-[var(--shadow-md)] sm:p-5 ${HUE_WASH[tile.hue]}`}
      style={{ borderTopWidth: 3, borderTopColor: HUE_BORDER_VAR[tile.hue] }}
    >
      <div className="flex items-center gap-2.5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${HUE_ICON_WRAP[tile.hue]}`}>
          <TileIcon name={tile.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{tile.label}</div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <span className="font-mono text-3xl font-semibold tabular-nums text-fg transition-colors group-hover:text-accent sm:text-4xl">
          {tile.value}
        </span>
        <span className="pb-1 text-xs text-fg-subtle">{tile.subtitle}</span>
      </div>
    </Link>
  );
}

function severity(count: number, warningAt: number, seriousAt: number, criticalAt: number): Severity {
  if (count <= 0) return "good";
  if (count >= criticalAt) return "critical";
  if (count >= seriousAt) return "serious";
  if (count >= warningAt) return "warning";
  return "good";
}

export function ProjectStatTiles({ counts }: { counts: ProjectSituationCounts }) {
  const overview: Tile[] = [
    {
      label: "Total projects",
      subtitle: "All time",
      value: counts.total,
      hue: "indigo",
      href: "/projects",
      icon: "folder",
    },
    {
      label: "On track",
      subtitle: "Current",
      value: counts.onTrack,
      hue: "emerald",
      href: "/projects?status=on_track",
      icon: "check",
    },
    {
      label: "Completed",
      subtitle: "All time",
      value: counts.completed,
      hue: "teal",
      href: "/projects?status=completed",
      icon: "checks",
    },
    {
      label: "New projects",
      subtitle: "Last 30 days",
      value: counts.newLast30Days,
      hue: "violet",
      href: "/projects?newDays=30",
      icon: "trend",
    },
  ];

  const alerts: Tile[] = [
    {
      label: "Blocked",
      subtitle: "Projects",
      value: counts.blocked,
      hue: SEVERITY_TO_HUE[severity(counts.blocked, 1, 1, 1)],
      href: "/projects?status=blocked",
      icon: "block",
    },
    {
      label: "Delayed",
      subtitle: "Projects",
      value: counts.delayed,
      hue: SEVERITY_TO_HUE[severity(counts.delayed, 1, 4, 10)],
      href: "/projects?status=delayed",
      icon: "clock",
    },
    {
      label: "Payment pending",
      subtitle: "Projects",
      value: counts.paymentPending,
      hue: SEVERITY_TO_HUE[severity(counts.paymentPending, 1, 6, 15)],
      href: "/projects?paymentStatus=pending",
      icon: "wallet",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-fg">Projects</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {overview.map((tile) => (
            <StatTile key={tile.label} tile={tile} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Alerts</h2>
          <div className="flex items-center gap-3 text-[10px] text-fg-subtle">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Watch
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-orange-400" /> Serious
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-400" /> Critical
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {alerts.map((tile) => (
            <StatTile key={tile.label} tile={tile} />
          ))}
        </div>
      </div>
    </div>
  );
}
