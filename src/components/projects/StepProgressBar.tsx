import { PHASE_LABELS, STEP_STATUS_LABELS, BLOCKED_REASON_LABELS } from "@/lib/labels";
import { isStepOverrun, daysBlocked } from "@/lib/overrun";
import type { BlockedReason, StepPhase, StepStatus } from "@prisma/client";

interface ProgressStep {
  id: string;
  stepCode: string;
  stepName: string;
  phase: StepPhase;
  status: StepStatus;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  actualEndDate: Date | null;
  blockedReason: BlockedReason | null;
  blockedNote: string | null;
  updatedAt: Date;
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

/** Status label plus the concrete detail behind it — the note, the date, the count. */
function getStatusDetail(step: ProgressStep): { primary: string; secondary: string | null } {
  if (step.status === "blocked") {
    const reason = step.blockedReason ? BLOCKED_REASON_LABELS[step.blockedReason] : null;
    const days = daysBlocked(step.updatedAt);
    const parts = [step.blockedNote, `blocked ${days}d`].filter(Boolean);
    return { primary: reason ? `Blocked: ${reason}` : "Blocked", secondary: parts.join(" · ") || null };
  }

  if (step.status === "completed") {
    return {
      primary: "Completed",
      secondary: step.actualEndDate ? `on ${formatShortDate(step.actualEndDate)}` : null,
    };
  }

  if (step.status === "in_progress") {
    const overdue = isStepOverrun(step.plannedEndDate, step.status);
    return {
      primary: "In progress",
      secondary: step.plannedEndDate
        ? `${overdue ? "was due" : "due"} ${formatShortDate(step.plannedEndDate)}`
        : null,
    };
  }

  return {
    primary: "Not started",
    secondary: step.plannedStartDate ? `starts ${formatShortDate(step.plannedStartDate)}` : null,
  };
}

const ICON_RING: Record<StepStatus, string> = {
  completed: "bg-emerald-600 border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500",
  in_progress: "bg-blue-600 border-blue-600 dark:bg-blue-500 dark:border-blue-500",
  blocked: "bg-red-600 border-red-600 dark:bg-red-500 dark:border-red-500",
  not_started: "bg-white border-zinc-300 dark:bg-zinc-900 dark:border-zinc-700",
};

const LABEL_COLOR: Record<StepStatus, string> = {
  completed: "text-emerald-700 dark:text-emerald-400",
  in_progress: "text-blue-700 dark:text-blue-400",
  blocked: "text-red-700 dark:text-red-400",
  not_started: "text-zinc-400 dark:text-zinc-500",
};

function StepIcon({ status }: { status: StepStatus }) {
  const iconClass = "h-4 w-4 sm:h-5 sm:w-5";
  if (status === "completed") {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className={`${iconClass} stroke-white`}>
        <path d="M5 12.5 10 17l9-10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "blocked") {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className={`${iconClass} stroke-white`}>
        <path d="M12 8v5" strokeLinecap="round" />
        <circle cx="12" cy="16.3" r="1" fill="white" stroke="none" />
      </svg>
    );
  }
  if (status === "in_progress") {
    return <span className="h-2 w-2 rounded-full bg-white sm:h-2.5 sm:w-2.5" />;
  }
  return null; // not_started: empty ring, no icon
}

/**
 * Icon-based progress indicator for a project's phase_steps, one row per phase.
 * Purely a quick-glance summary — the full audit trail (who changed what, when)
 * still lives in the step timeline and blocker history below it. Order within each
 * phase follows the step template's topological order (matches how the timeline
 * already lists them), not a full dependency graph.
 */
export function StepProgressBar({ steps }: { steps: ProgressStep[] }) {
  const phases: StepPhase[] = ["phase_1", "phase_2", "phase_3"];
  const rows = phases
    .map((phase) => ({ phase, steps: steps.filter((s) => s.phase === phase) }))
    .filter((row) => row.steps.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
      {rows.map(({ phase, steps: phaseSteps }) => (
        <div key={phase} className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {PHASE_LABELS[phase]}
          </span>
          <div className="flex items-start">
            {phaseSteps.map((step, i) => {
              const overdue = isStepOverrun(step.plannedEndDate, step.status);
              const { primary, secondary } = getStatusDetail(step);
              return (
                <div key={step.id} className="flex flex-1 items-start last:flex-none">
                  <div className="flex w-20 flex-col items-center gap-1 sm:w-28">
                    <div className="relative">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full border-2 sm:h-9 sm:w-9 ${ICON_RING[step.status]}`}
                        title={`${step.stepCode} ${step.stepName} — ${step.status.replace("_", " ")}`}
                      >
                        <StepIcon status={step.status} />
                      </div>
                      {overdue && (
                        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500 dark:border-zinc-900" />
                      )}
                    </div>
                    <span
                      className={`line-clamp-2 text-center text-[10px] font-semibold leading-tight break-words sm:text-xs ${LABEL_COLOR[step.status]}`}
                    >
                      {step.stepName}
                    </span>
                    <span
                      className={`text-center text-[9px] font-medium leading-tight break-words sm:text-[11px] ${LABEL_COLOR[step.status]}`}
                    >
                      {primary}
                    </span>
                    {secondary && (
                      <span className="text-center text-[9px] leading-tight break-words text-zinc-400 sm:text-[10px] dark:text-zinc-500">
                        {secondary}
                      </span>
                    )}
                  </div>
                  {i < phaseSteps.length - 1 && (
                    <div
                      className={`mx-1 mt-[14px] h-0.5 flex-1 sm:mx-2 sm:mt-[18px] ${
                        step.status === "completed" ? "bg-emerald-600 dark:bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-800"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 dark:bg-emerald-500" /> Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600 dark:bg-blue-500" /> In progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-600 dark:bg-red-500" /> Blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900" /> Not
          started
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Overdue
        </span>
      </div>
    </div>
  );
}
