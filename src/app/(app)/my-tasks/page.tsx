import Link from "next/link";
import { getSession, isAdminEditor, isOperationsManager } from "@/lib/auth";
import { getUnifiedMyTasks } from "@/lib/unified-tasks";
import { getReviewQueueTasks } from "@/lib/task-reviews";
import { TaskTable } from "@/components/my-tasks/TaskTable";
import { DEPARTMENT_LABELS } from "@/lib/labels";

export default async function MyTasksPage() {
  const session = await getSession();
  const department = session ? session.department : null;
  // Reviewing what other departments already finished is Operations Manager's primary job, so
  // its /my-tasks leads with the review queue instead of a plain department task list (see
  // task-reviews.ts). It's still a normal work-owning department underneath, though (see
  // ASSIGNABLE_DEPARTMENTS) — ownTasks below covers anything handed to it directly, same as
  // Owner or anyone else gets from the plain `getUnifiedMyTasks(department)` branch.
  const isReviewQueue = !!session && isOperationsManager(session);
  const [items, ownTasks] = await Promise.all([
    isReviewQueue ? getReviewQueueTasks() : department ? getUnifiedMyTasks(department) : Promise.resolve([]),
    isReviewQueue && department ? getUnifiedMyTasks(department) : Promise.resolve([]),
  ]);
  // Only admin/owner can actually open /projects/[id] (see its own layout.tsx) — everyone else's
  // Project name here would just link to a page that immediately bounces them back here.
  const isAdmin = !!session && isAdminEditor(session);

  // The "needs attention" read for whoever's looking at this list — overdue and blocked can
  // overlap (a blocked step past its planned date counts in both), same as the status filters
  // in TaskTable treat them. Shown only when non-zero so a clean queue stays visually quiet.
  const overdueCount = items.filter((t) => t.overrun).length;
  const blockedCount = items.filter((t) => t.status === "blocked").length;
  const ownOverdueCount = ownTasks.filter((t) => t.overrun).length;

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
          <h1 className="text-xl font-semibold text-fg">{isReviewQueue ? "Review completed work" : "My Tasks"}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
            <span>
              {isReviewQueue
                ? `${items.length} pending review${items.length === 1 ? "" : "s"}`
                : `${department ? DEPARTMENT_LABELS[department] : "My tasks"} · ${items.length} open task${
                    items.length === 1 ? "" : "s"
                  }`}
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
          {isReviewQueue ? "Nothing pending review." : "Nothing open right now."}
        </p>
      ) : (
        <TaskTable tasks={items} isAdmin={isAdmin} groupByUrgency={isReviewQueue} />
      )}

      {isReviewQueue && (
        <>
          <hr className="border-edge" />
          <div>
            <h2 className="text-lg font-semibold text-fg">Assigned to you</h2>
            <p className="text-sm text-fg-muted">
              Work handed to Operations Manager directly, same as any other department — {ownTasks.length} open task
              {ownTasks.length === 1 ? "" : "s"}
              {ownOverdueCount > 0 ? `, ${ownOverdueCount} overdue` : ""}.
            </p>
          </div>
          {ownTasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-edge-2 py-10 text-center text-sm text-fg-muted">
              Nothing assigned to you directly.
            </p>
          ) : (
            <TaskTable tasks={ownTasks} isAdmin={isAdmin} />
          )}
          <hr className="border-edge" />
          {/* The whole-company "every department's open work" view used to live inline here —
              now its own page (see open-work/page.tsx), so this list stays focused on review
              and what's assigned to Operations Manager directly. */}
          <Link
            href="/open-work"
            className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-surface px-4 py-3 text-sm font-medium text-fg transition-colors hover:border-edge-2 hover:bg-overlay"
          >
            See every department&apos;s open work
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-4 w-4 shrink-0 stroke-current text-fg-muted">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </>
      )}
    </div>
  );
}
