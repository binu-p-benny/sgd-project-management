import Link from "next/link";
import type { UnifiedTask } from "@/lib/unified-tasks";
import { DEPARTMENT_LABELS } from "@/lib/labels";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
function formatPhase(phase: UnifiedTask["phase"]): string {
  if (phase === "service") return "Service";
  if (phase === "general") return "General";
  return phase === "phase_1" ? "Phase 1" : phase === "phase_2" ? "Phase 2" : "Phase 3";
}

function FutureTaskRow({ task }: { task: UnifiedTask }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-edge px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/projects/${task.project.id}`} className="truncate text-sm font-medium text-fg hover:underline">
            {task.project.name}
          </Link>
          <span className="rounded-full bg-overlay px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-edge">
            {DEPARTMENT_LABELS[task.department]}
          </span>
        </div>
        <div className="truncate text-xs text-fg-muted">{task.project.client.name}</div>
        <div className="text-sm text-fg">
          {task.stepCode ? <span className="mr-1 text-fg-muted">{task.stepCode}</span> : null}
          {task.taskLabel}
          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-fg-subtle">{formatPhase(task.phase)}</span>
        </div>
        {task.gateBlockedBy && task.gateBlockedBy.length > 0 && (
          <div className="mt-0.5 text-xs text-fg-subtle">Waiting on: {task.gateBlockedBy.join(", ")}</div>
        )}
      </div>
      <div className="shrink-0 text-left text-xs text-fg-muted sm:text-right">
        {task.plannedDate ? formatDate(task.plannedDate) : "No planned date yet"}
      </div>
    </div>
  );
}

/**
 * /my-tasks' own "coming up" pipeline preview — every not-yet-reachable step still gated behind
 * an earlier, unfinished dependency (see getFutureWorkTasks/buildFutureStepTasks in
 * unified-tasks.ts), read-only and collapsed by default so it doesn't compete with this
 * department's actually-actionable work above it. A plain <details>/<summary> rather than the
 * client-side accordion DepartmentTaskOverview.tsx uses for its own urgency buckets — this is a
 * server component, and native disclosure needs no interactivity of its own.
 */
export function FutureWorkSection({ tasks }: { tasks: UnifiedTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <details className="overflow-hidden rounded-xl border border-edge">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-surface px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">Coming up — not yet reachable</span>
            <span className="rounded-full bg-overlay px-2 py-0.5 text-xs font-medium text-fg-muted ring-1 ring-inset ring-edge">
              {tasks.length}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            Still waiting on an earlier step to finish first — nothing to do yet, just a look ahead.
          </p>
        </div>
      </summary>
      <div className="border-t border-edge bg-surface">
        {tasks.map((task) => (
          <FutureTaskRow key={task.id} task={task} />
        ))}
      </div>
    </details>
  );
}
