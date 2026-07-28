"use client";

import { useState } from "react";
import Link from "next/link";
import type { UpcomingStepRow } from "@/lib/dashboard";
import { DEPARTMENT_LABELS } from "@/lib/labels";

const PAGE_SIZE = 5;

function formatDueLabel(daysRemaining: number): string {
  if (daysRemaining <= 0) return "Today";
  if (daysRemaining === 1) return "Tomorrow";
  return `In ${daysRemaining}d`;
}

function urgencyClasses(daysRemaining: number): string {
  if (daysRemaining <= 1) return "bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/25";
  return "bg-white/[0.06] text-fg-muted ring-1 ring-inset ring-white/10";
}

export function UpcomingStepsWidget({ data }: { data: UpcomingStepRow[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const pageData = data.slice(start, start + PAGE_SIZE);

  return (
    <div className="rounded-xl border border-edge bg-surface p-4 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold text-fg">Due this week ({data.length})</h3>

      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">Nothing due in the next 7 days.</p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {pageData.map((row) => (
              <Link
                key={row.stepId}
                href={`/projects/${row.projectId}`}
                className="flex flex-col gap-1 rounded-lg border border-edge p-3 transition-colors hover:border-edge-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-fg">{row.projectName}</span>
                  <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${urgencyClasses(row.daysRemaining)}`}>
                    {formatDueLabel(row.daysRemaining)}
                  </span>
                </div>
                <div className="text-xs text-fg-muted">
                  <span className="font-mono">{row.stepCode}</span> {row.stepName}
                </div>
                <div className="text-xs text-fg-subtle">{DEPARTMENT_LABELS[row.department]}</div>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-fg-subtle">
                <tr>
                  <th className="py-2 pr-4 font-medium">Project</th>
                  <th className="py-2 pr-4 font-medium">Step</th>
                  <th className="py-2 pr-4 font-medium">Department</th>
                  <th className="py-2 pr-4 text-right font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {pageData.map((row) => (
                  <tr key={row.stepId}>
                    <td className="py-2 pr-4">
                      <Link href={`/projects/${row.projectId}`} className="text-fg hover:underline">
                        {row.projectName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-fg-muted">
                      <span className="font-mono text-xs text-fg-subtle">{row.stepCode}</span> {row.stepName}
                    </td>
                    <td className="py-2 pr-4 text-fg-muted">{DEPARTMENT_LABELS[row.department]}</td>
                    <td className="py-2 pr-4 text-right">
                      <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${urgencyClasses(row.daysRemaining)}`}>
                        {formatDueLabel(row.daysRemaining)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-edge pt-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-white/[0.04] hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Previous
              </button>
              <span className="font-mono text-xs tabular-nums text-fg-muted">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-white/[0.04] hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
