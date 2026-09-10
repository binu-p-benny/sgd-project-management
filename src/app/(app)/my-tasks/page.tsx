import { getSession, isAdminEditor } from "@/lib/auth";
import { getUnifiedMyTasks } from "@/lib/unified-tasks";
import { TaskTable } from "@/components/my-tasks/TaskTable";
import { DEPARTMENT_LABELS } from "@/lib/labels";

export default async function MyTasksPage() {
  const session = await getSession();
  const department = session && session.department !== "owner_admin" ? session.department : null;
  const items = await getUnifiedMyTasks(department);
  // Only admin/owner can actually open /projects/[id] (see its own layout.tsx) — everyone else's
  // Project name here would just link to a page that immediately bounces them back here.
  const isAdmin = !!session && isAdminEditor(session);

  // The "needs attention" read for whoever's looking at this list — overdue and blocked can
  // overlap (a blocked step past its planned date counts in both), same as the status filters
  // in TaskTable treat them. Shown only when non-zero so a clean queue stays visually quiet.
  const overdueCount = items.filter((t) => t.overrun).length;
  const blockedCount = items.filter((t) => t.status === "blocked").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
            <path d="M4 11.5 12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 10v9a1 1 0 0 0 1 1h3v-5.5h4V20h3a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h1 className="text-xl font-semibold text-fg">My Tasks</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
            <span>
              {department ? DEPARTMENT_LABELS[department] : "All departments"} · {items.length} open task
              {items.length === 1 ? "" : "s"}
            </span>
            {overdueCount > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25">
                {overdueCount} overdue
              </span>
            )}
            {blockedCount > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25">
                {blockedCount} blocked
              </span>
            )}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge-2 py-10 text-center text-sm text-fg-muted">
          Nothing open right now.
        </p>
      ) : (
        <TaskTable tasks={items} isAdmin={isAdmin} />
      )}
    </div>
  );
}
