import Link from "next/link";
import type { ServiceOverview } from "@/lib/dashboard";
import { SERVICE_STATUS_LABELS } from "@/lib/labels";
import type { ServiceStatus } from "@/lib/service";

// Same order the Services list's own status filter would read top-to-bottom, not alphabetical —
// "in progress" (the everyday state) before the two exception states, "not started" first since
// it's the newest / least worked-on.
const STATUS_ORDER: ServiceStatus[] = ["not_started", "in_progress", "delayed", "review_not_completed", "completed"];

// A plain dot rather than SERVICE_STATUS_COLORS' full badge classes (built for text-on-a-pill,
// not a small swatch) — same "not_started/completed both read as neutral" pairing as the badge
// set them mirrors, kept as its own small map for that reason.
const STATUS_DOT: Record<ServiceStatus, string> = {
  not_started: "bg-fg-subtle",
  in_progress: "bg-emerald-500",
  delayed: "bg-amber-500",
  completed: "bg-fg-subtle",
  review_not_completed: "bg-fuchsia-500",
};

export function ServiceStatusWidget({ data }: { data: ServiceOverview }) {
  return (
    <div className="rounded-xl border border-edge border-t-4 border-t-sky-500 bg-gradient-to-br from-sky-50 to-70% to-surface p-4 dark:from-sky-500/10 shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/25">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
              <path
                d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.6L4 17v3h3l5.9-5.9a3.5 3.5 0 0 0 4.6-4.6l-2.3 2.3-2-2 2.3-2.3Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h3 className="text-sm font-semibold text-fg">Services</h3>
        </div>
        <Link href="/services" className="text-xs font-medium text-accent hover:underline">
          {data.total} total →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            className="flex flex-col gap-1 rounded-lg border border-edge p-3 transition-colors hover:border-edge-2 hover:bg-overlay"
          >
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
              <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                {SERVICE_STATUS_LABELS[status]}
              </span>
            </div>
            <div className="text-2xl font-semibold text-fg">{data[status]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
