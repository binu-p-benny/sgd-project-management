import Link from "next/link";
import { listCommonTasks } from "@/lib/common-tasks";
import { CommonTaskMobileCard, CommonTaskDesktopRow } from "@/components/common-tasks/CommonTaskRow";

export default async function CommonTasksPage() {
  const tasks = await listCommonTasks();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {/* Violet — distinct from every other admin list's own identity color (Projects'
              indigo, Services' teal, Contractors' orange, Clients' cyan). */}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/25">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
              <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="8.5" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold text-fg">Common Tasks</h1>
            <p className="text-sm text-fg-muted">
              Day-to-day and recurring chores, outside any project — {tasks.length} tracked
            </p>
          </div>
        </div>
        <Link
          href="/common-tasks/new"
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-2"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} className="h-5 w-5 stroke-current">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add task
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-violet-500/40 bg-violet-500/5 py-10 text-center text-sm text-fg-muted dark:border-violet-500/30 dark:bg-violet-500/[0.04]">
          Nothing set up yet.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {tasks.map((task) => (
              <CommonTaskMobileCard key={task.id} task={task} />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-violet-500/30 bg-violet-500/5 dark:border-violet-500/25 dark:bg-violet-500/[0.04] sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-violet-500/10 text-[11px] uppercase tracking-wider text-fg-subtle dark:bg-violet-500/[0.08]">
                <tr>
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Recurs</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Last done</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {tasks.map((task) => (
                  <CommonTaskDesktopRow key={task.id} task={task} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
