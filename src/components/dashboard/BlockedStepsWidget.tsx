import Link from "next/link";
import type { BlockedStepRow } from "@/lib/dashboard";
import { BLOCKED_REASON_LABELS } from "@/lib/labels";
import type { BlockedReason } from "@prisma/client";

export function BlockedStepsWidget({ data }: { data: BlockedStepRow[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Currently blocked ({data.length})
      </h3>

      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Nothing is blocked right now.</p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {data.map((row) => (
              <Link
                key={row.stepId}
                href={`/projects/${row.projectId}`}
                className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{row.projectName}</span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                    {row.daysBlocked}d
                  </span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono">{row.stepCode}</span> {row.stepName}
                </div>
                {row.blockedReason && (
                  <div className="text-xs text-zinc-600 dark:text-zinc-300">
                    {BLOCKED_REASON_LABELS[row.blockedReason as BlockedReason]}
                  </div>
                )}
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Project</th>
                  <th className="py-2 pr-4 font-medium">Step</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 text-right font-medium">Blocked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.map((row) => (
                  <tr key={row.stepId}>
                    <td className="py-2 pr-4">
                      <Link href={`/projects/${row.projectId}`} className="text-zinc-900 hover:underline dark:text-zinc-50">
                        {row.projectName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-300">
                      <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{row.stepCode}</span>{" "}
                      {row.stepName}
                    </td>
                    <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-300">
                      {row.blockedReason ? BLOCKED_REASON_LABELS[row.blockedReason as BlockedReason] : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
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
