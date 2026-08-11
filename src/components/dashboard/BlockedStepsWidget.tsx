import Link from "next/link";
import type { BlockedStepRow } from "@/lib/dashboard";
import { BLOCKED_REASON_LABELS } from "@/lib/labels";
import type { BlockedReason } from "@prisma/client";

export function BlockedStepsWidget({ data }: { data: BlockedStepRow[] }) {
  return (
    <div className="rounded-xl border border-edge border-t-4 border-t-red-500 bg-gradient-to-br from-red-50 to-70% to-surface p-4 dark:from-red-500/10 shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M6.4 6.4 17.6 17.6" strokeLinecap="round" />
          </svg>
        </span>
        <h3 className="text-sm font-semibold text-fg">Currently blocked ({data.length})</h3>
      </div>

      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">Nothing is blocked right now.</p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {data.map((row) => (
              <Link
                key={row.stepId}
                href={`/projects/${row.projectId}`}
                className="flex flex-col gap-1 rounded-lg border border-edge p-3 transition-colors hover:border-edge-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-fg">{row.projectName}</span>
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-mono text-xs font-medium tabular-nums text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
                    {row.daysBlocked}d
                  </span>
                </div>
                <div className="text-xs text-fg-muted">
                  <span className="font-mono">{row.stepCode}</span> {row.stepName}
                </div>
                {row.blockedReason && (
                  <div className="text-xs text-fg-muted">{BLOCKED_REASON_LABELS[row.blockedReason as BlockedReason]}</div>
                )}
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
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 text-right font-medium">Blocked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {data.map((row) => (
                  <tr key={row.stepId}>
                    <td className="py-2 pr-4">
                      <Link href={`/projects/${row.projectId}`} className="text-fg hover:underline">
                        {row.projectName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-fg-muted">
                      <span className="font-mono text-xs text-fg-subtle">{row.stepCode}</span> {row.stepName}
                    </td>
                    <td className="py-2 pr-4 text-fg-muted">
                      {row.blockedReason ? BLOCKED_REASON_LABELS[row.blockedReason as BlockedReason] : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-mono text-xs font-medium tabular-nums text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
                        {row.daysBlocked}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
