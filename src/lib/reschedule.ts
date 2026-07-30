import { prisma } from "@/lib/prisma";
import { PHASE_GATE_STEP_CODE } from "@/lib/step-template";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Recomputes planned_start_date/planned_end_date for every not-yet-completed step in
 * a project whenever a date changes anywhere upstream — a manual admin edit, or a step
 * completing early/late. Runs as a fixed-point pass over the *live* depends_on graph
 * (not the static template, since that's what's actually stored per step): repeatedly
 * walk every open step, and if all its dependencies now have a resolved end date,
 * recompute its own start/end from them. Repeat until nothing changes.
 *
 * Completed steps are never touched — their dates are historical record, not a
 * projection. A dependency that's still unresolved (e.g. 1B before visit_urgency sets
 * its duration) correctly leaves everything downstream of it unresolved too, same as
 * the baseline scheduler in step-template.ts.
 *
 * `pinnedStepCode`, if given, is excluded from recomputation — it's the step that was
 * just directly hand-edited, so its new dates are ground truth for this pass, not
 * something to immediately recompute from its own dependencies and overwrite back to
 * whatever the formula would have said anyway.
 */
export async function rescheduleProjectDates(projectId: string, pinnedStepCode?: string): Promise<void> {
  const steps = await prisma.phaseStep.findMany({
    where: { projectId },
    select: {
      id: true,
      stepCode: true,
      phase: true,
      dependsOn: true,
      status: true,
      plannedDurationDays: true,
      plannedStartDate: true,
      plannedEndDate: true,
      actualEndDate: true,
    },
  });

  const statusByCode = new Map(steps.map((s) => [s.stepCode, s.status]));

  /**
   * A phase's steps only carry a schedule once the gate step that unlocks the phase is complete.
   * Normally that is automatic — the rows are seeded at the moment the gate completes — but a
   * revert can un-complete a gate while its phase's rows are already there. Those rows must then
   * go back to having no planned dates rather than projecting from a gate that, as far as the
   * record now goes, has not finished: a fresh project has no phase 2 schedule either.
   */
  const phaseIsUnlocked = (phase: keyof typeof PHASE_GATE_STEP_CODE | "phase_1") => {
    const gate = PHASE_GATE_STEP_CODE[phase as keyof typeof PHASE_GATE_STEP_CODE];
    return !gate || statusByCode.get(gate) === "completed";
  };

  // Ground truth for a step's "end", for the purposes of scheduling what comes after it:
  // a completed step's actual end date if known, else its current planned end date.
  const endDates = new Map<string, Date | null>(
    steps.map((s) => [s.stepCode, s.status === "completed" ? (s.actualEndDate ?? s.plannedEndDate) : s.plannedEndDate])
  );

  const updates = new Map<string, { plannedStartDate: Date | null; plannedEndDate: Date | null }>();

  // Bounded fixed-point iteration: the graph's longest chain is a handful of steps deep,
  // so this converges well within `steps.length` passes; the bound just guards against
  // any future template change accidentally introducing a cycle.
  for (let pass = 0; pass < steps.length + 1; pass++) {
    let changed = false;

    for (const step of steps) {
      if (step.status === "completed") continue;
      if (step.stepCode === pinnedStepCode) continue;

      let newStart: Date | null;
      if (!phaseIsUnlocked(step.phase)) {
        newStart = null; // phase not unlocked — nothing here is scheduled yet
      } else if (step.dependsOn.length === 0) {
        newStart = step.plannedStartDate; // no upstream to react to — leave as is
      } else {
        const depEnds = step.dependsOn.map((code) => endDates.get(code));
        const allResolved = depEnds.every((d): d is Date => d instanceof Date);
        newStart = allResolved ? new Date(Math.max(...(depEnds as Date[]).map((d) => d.getTime()))) : null;
      }

      const newEnd =
        newStart !== null && step.plannedDurationDays !== null ? addDays(newStart, step.plannedDurationDays) : null;

      const prevStart = updates.get(step.stepCode)?.plannedStartDate ?? step.plannedStartDate;
      const prevEnd = updates.get(step.stepCode)?.plannedEndDate ?? step.plannedEndDate;
      const startMoved = (newStart?.getTime() ?? null) !== (prevStart?.getTime() ?? null);
      const endMoved = (newEnd?.getTime() ?? null) !== (prevEnd?.getTime() ?? null);

      if (startMoved || endMoved) {
        updates.set(step.stepCode, { plannedStartDate: newStart, plannedEndDate: newEnd });
        endDates.set(step.stepCode, newEnd);
        changed = true;
      }
    }

    if (!changed) break;
  }

  if (updates.size === 0) return;

  await prisma.$transaction(
    Array.from(updates.entries()).map(([stepCode, dates]) =>
      prisma.phaseStep.updateMany({
        where: { projectId, stepCode },
        data: dates,
      })
    )
  );
}
