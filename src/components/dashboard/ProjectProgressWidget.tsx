"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProjectProgressPage, ProjectProgressRow } from "@/lib/dashboard";
import { PHASE_LABELS, OVERALL_STATUS_LABELS, OVERALL_STATUS_COLORS } from "@/lib/labels";
import type { OverallStatus } from "@prisma/client";

const BAR_COLOR: Record<OverallStatus, string> = {
  on_track: "bg-emerald-500",
  delayed: "bg-amber-500",
  blocked: "bg-red-500",
  completed: "bg-fg-subtle",
};

function ProgressRow({ row }: { row: ProjectProgressRow }) {
  return (
    <li>
      <Link
        href={`/projects/${row.projectId}`}
        className="-mx-1 flex flex-col gap-1.5 rounded-lg p-1 hover:bg-overlay"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-fg">{row.projectName}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${OVERALL_STATUS_COLORS[row.effectiveStatus]}`}
          >
            {OVERALL_STATUS_LABELS[row.effectiveStatus]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className={`h-full rounded-full ${BAR_COLOR[row.effectiveStatus]}`}
              style={{ width: `${row.percentComplete}%` }}
            />
          </div>
          <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">
            {row.percentComplete}%
          </span>
        </div>
        <div className="text-xs text-fg-subtle">
          {PHASE_LABELS[row.phase]} · {row.completedSteps}/14 steps done
        </div>
      </Link>
    </li>
  );
}

export function ProjectProgressWidget({ initialData }: { initialData: ProjectProgressPage }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function goToPage(page: number) {
    if (loading || page < 1 || page > data.totalPages || page === data.page) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/project-progress?page=${page}`);
      if (!res.ok) throw new Error("Failed to load page");
      setData(await res.json());
    } catch {
      setError("Couldn't load that page. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-edge border-t-4 border-t-accent bg-gradient-to-br from-indigo-50 to-70% to-surface p-4 dark:from-indigo-500/10 shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
              <path d="M4 15.5 9.5 10l3.5 3.5L20 6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M15 6h5v5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h3 className="text-sm font-semibold text-fg">Project progress</h3>
        </div>
        <Link href="/projects" className="text-xs font-medium text-fg-muted hover:text-fg hover:underline">
          View all →
        </Link>
      </div>

      {data.totalCount === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">No active projects.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {data.rows.map((row) => (
              <ProgressRow key={row.projectId} row={row} />
            ))}
          </ul>

          {error && <p className="mt-3 text-center text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="mt-4 flex items-center justify-between border-t border-edge pt-3">
            <button
              type="button"
              onClick={() => goToPage(data.page - 1)}
              disabled={loading || data.page <= 1}
              className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Previous
            </button>
            <span className="font-mono text-xs tabular-nums text-fg-muted">
              Page {data.page} of {data.totalPages}
            </span>
            <button
              type="button"
              onClick={() => goToPage(data.page + 1)}
              disabled={loading || data.page >= data.totalPages}
              className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
