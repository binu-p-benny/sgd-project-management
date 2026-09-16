"use client";

import { useState } from "react";
import Link from "next/link";
import type { UnifiedTask } from "@/lib/unified-tasks";
import { DEPARTMENT_LABELS } from "@/lib/labels";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
function daysOverdue(plannedIso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(plannedIso).getTime()) / (1000 * 60 * 60 * 24)));
}
function formatPhase(phase: UnifiedTask["phase"]): string {
  if (phase === "service") return "Service";
  return phase === "phase_1" ? "Phase 1" : phase === "phase_2" ? "Phase 2" : "Phase 3";
}
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

interface Bucket {
  key: string;
  title: string;
  hint: string;
  tasks: UnifiedTask[];
  defaultOpen: boolean;
  emptyText: string;
}

/**
 * Splits every department's still-open work (see getUnifiedMyTasks(null)) into the same 4
 * buckets a person would naturally ask about — what's already late, what's due today, what's
 * coming up, and what can't even be bucketed yet because nobody's set its planned date (only
 * ever kind === "planned_date_edit" — see unified-tasks.ts). Checked in this order because
 * `overrun` is a precise now-vs-planned-timestamp comparison (not a calendar-day one — see
 * overrun.ts), so it always wins regardless of what time of day a plannedDate itself carries.
 */
function bucketTasks(tasks: UnifiedTask[]): { overdue: UnifiedTask[]; dueToday: UnifiedTask[]; upcoming: UnifiedTask[]; unscheduled: UnifiedTask[] } {
  const todayStart = startOfToday();
  const todayEnd = endOfToday();
  const overdue: UnifiedTask[] = [];
  const dueToday: UnifiedTask[] = [];
  const upcoming: UnifiedTask[] = [];
  const unscheduled: UnifiedTask[] = [];

  for (const task of tasks) {
    if (task.overrun) {
      overdue.push(task);
      continue;
    }
    if (!task.plannedDate) {
      unscheduled.push(task);
      continue;
    }
    const planned = new Date(task.plannedDate);
    if (planned >= todayStart && planned <= todayEnd) {
      dueToday.push(task);
    } else {
      upcoming.push(task);
    }
  }

  const byPlannedDate = (a: UnifiedTask, b: UnifiedTask) => (a.plannedDate ?? "").localeCompare(b.plannedDate ?? "");
  overdue.sort(byPlannedDate);
  dueToday.sort(byPlannedDate);
  upcoming.sort(byPlannedDate);

  return { overdue, dueToday, upcoming, unscheduled };
}

const CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 shrink-0 stroke-current text-fg-muted transition-transform duration-200">
    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function TaskRow({ task }: { task: UnifiedTask }) {
  const isService = task.phase === "service";
  return (
    <div className="flex flex-col gap-1.5 border-t border-edge px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={isService ? `/services/${task.project.id}` : `/projects/${task.project.id}`}
            className="truncate text-sm font-medium text-fg hover:underline"
          >
            {task.project.name}
          </Link>
          <span className="rounded-full bg-overlay px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-edge">
            {DEPARTMENT_LABELS[task.department]}
          </span>
        </div>
        <div className="truncate text-xs text-fg-muted">{task.project.client.name}</div>
        <div className="text-sm text-fg">
          {task.taskLabel}
          {task.subTaskLabel ? <span className="text-fg-muted"> — {task.subTaskLabel}</span> : null}
          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-fg-subtle">{formatPhase(task.phase)}</span>
        </div>
      </div>
      <div className="shrink-0 text-left text-xs text-fg-muted sm:text-right">
        {task.plannedDate ? (
          <span className={task.overrun ? "font-medium text-amber-700 dark:text-amber-400" : undefined}>
            {formatDate(task.plannedDate)}
            {task.overrun && <span className="block">Overdue {daysOverdue(task.plannedDate)}d</span>}
          </span>
        ) : (
          "No planned date yet"
        )}
      </div>
    </div>
  );
}

function AccordionSection({ bucket }: { bucket: Bucket }) {
  const [open, setOpen] = useState(bucket.defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-edge">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-surface px-4 py-3 text-left transition-colors hover:bg-overlay/60"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">{bucket.title}</span>
            <span className="rounded-full bg-overlay px-2 py-0.5 text-xs font-medium text-fg-muted ring-1 ring-inset ring-edge">
              {bucket.tasks.length}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">{bucket.hint}</p>
        </div>
        <span className={open ? "rotate-180" : ""}>{CHEVRON}</span>
      </button>
      {open && (
        <div className="border-t border-edge bg-surface">
          {bucket.tasks.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-muted">{bucket.emptyText}</p>
          ) : (
            bucket.tasks.map((task) => <TaskRow key={task.id} task={task} />)
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A read-only, whole-company view of every department's still-open work, grouped by urgency —
 * Operations Manager's own tasks are reviewing what's already *done* (see the review queue
 * above this on /my-tasks), but managing every department means also seeing what's still
 * outstanding everywhere, before it becomes something to review. No action buttons here on
 * purpose: acting on a task is still that department's own job (via their own /my-tasks), this
 * is visibility only.
 */
export function DepartmentTaskOverview({ tasks }: { tasks: UnifiedTask[] }) {
  const { overdue, dueToday, upcoming, unscheduled } = bucketTasks(tasks);

  const buckets: Bucket[] = [
    {
      key: "overdue",
      title: "Overdue — not completed, past due, across every department",
      hint: "Already past its planned date and still not done, whichever department owns it.",
      tasks: overdue,
      defaultOpen: overdue.length > 0,
      emptyText: "Nothing overdue anywhere right now.",
    },
    {
      key: "due_today",
      title: "Due today, across every department",
      hint: "Planned to be finished today.",
      tasks: dueToday,
      defaultOpen: false,
      emptyText: "Nothing due today.",
    },
    {
      key: "upcoming",
      title: "Upcoming — future tasks, across every department",
      hint: "Planned for a later date — not due yet.",
      tasks: upcoming,
      defaultOpen: false,
      emptyText: "Nothing scheduled ahead.",
    },
    {
      key: "unscheduled",
      title: "Not yet scheduled",
      hint: "No planned date has been set yet, so it can't be bucketed above — usually a planned-date pending admin sign-off.",
      tasks: unscheduled,
      defaultOpen: false,
      emptyText: "Nothing waiting on a planned date.",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-fg">Every department&apos;s open work</h2>
        <p className="text-sm text-fg-muted">
          A whole-company view — {tasks.length} open task{tasks.length === 1 ? "" : "s"} across every department, so
          nothing is a surprise once it lands in the review queue above.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {buckets.map((bucket) => (
          <AccordionSection key={bucket.key} bucket={bucket} />
        ))}
      </div>
    </div>
  );
}
