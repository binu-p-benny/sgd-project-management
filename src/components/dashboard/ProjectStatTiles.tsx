import Link from "next/link";
import type { ProjectSituationCounts } from "@/lib/dashboard";

type Severity = "good" | "warning" | "serious" | "critical";
type IconName = "folder" | "check" | "checks" | "trend" | "block" | "clock" | "wallet";

interface Tile {
  label: string;
  subtitle: string;
  value: number;
  color: Severity;
  href: string;
  icon: IconName;
}

const SEVERITY_ICON_WRAP: Record<Severity, string> = {
  good: "bg-emerald-500/10 text-emerald-400",
  warning: "bg-amber-500/10 text-amber-400",
  serious: "bg-orange-500/10 text-orange-400",
  critical: "bg-red-500/10 text-red-400",
};

const SEVERITY_BORDER_VAR: Record<Severity, string> = {
  good: "var(--chart-status-good)",
  warning: "var(--chart-status-warning)",
  serious: "var(--chart-status-serious)",
  critical: "var(--chart-status-critical)",
};

function TileIcon({ name, className }: { name: IconName; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", strokeWidth: 1.8, className };
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
      className="group flex flex-col overflow-hidden rounded-xl border border-edge bg-surface p-4 transition-all hover:border-edge-2 hover:bg-surface-2 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.04)] sm:p-5"
      style={{ borderTopWidth: 3, borderTopColor: SEVERITY_BORDER_VAR[tile.color] }}
    >
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${SEVERITY_ICON_WRAP[tile.color]}`}>
          <TileIcon name={tile.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{tile.label}</div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <span className="font-mono text-3xl font-semibold tabular-nums text-fg transition-colors group-hover:text-white sm:text-4xl">
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
      color: "good",
      href: "/projects",
      icon: "folder",
    },
    {
      label: "On track",
      subtitle: "Current",
      value: counts.onTrack,
      color: "good",
      href: "/projects?status=on_track",
      icon: "check",
    },
    {
      label: "Completed",
      subtitle: "All time",
      value: counts.completed,
      color: "good",
      href: "/projects?status=completed",
      icon: "checks",
    },
    {
      label: "New projects",
      subtitle: "Last 30 days",
      value: counts.newLast30Days,
      color: "good",
      href: "/projects?newDays=30",
      icon: "trend",
    },
  ];

  const alerts: Tile[] = [
    {
      label: "Blocked",
      subtitle: "Projects",
      value: counts.blocked,
      color: severity(counts.blocked, 1, 1, 1),
      href: "/projects?status=blocked",
      icon: "block",
    },
    {
      label: "Delayed",
      subtitle: "Projects",
      value: counts.delayed,
      color: severity(counts.delayed, 1, 4, 10),
      href: "/projects?status=delayed",
      icon: "clock",
    },
    {
      label: "Payment pending",
      subtitle: "Projects",
      value: counts.paymentPending,
      color: severity(counts.paymentPending, 1, 6, 15),
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
