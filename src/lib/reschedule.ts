import { prisma } from "@/lib/prisma";
import {
  computeItemArrivalPlanned,
  computePhase2PlanAnchor,
  computeSectionOrderConfirmedPlanned,
  computeExpectedFinalMeasurementDate,
  computeSectionQCPlanned,
  computeAllProcurementPlannedDates,
  computeInstallationPlannedWindow,
} from "@/lib/procurement";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export interface DelayGraphNode {
  stepCode: string;
  dependsOn: string[];
  delayCategory: string | null;
}

/**
 * Walks the dependsOn graph upward from `stepCode` and returns the nearest ancestor that
 * completed with a delay_category set, however many hops back — not just a direct dependency.
 * A step's own planned dates only ever move (or freeze) because of the endDates logic above,
 * but that effect propagates forward through the whole chain (1B -> 1C -> 1D -> 2A -> ...), so
 * every step downstream of a delayed one is worth explaining, not just the one right after it.
 * Returns null once nothing upstream was ever delayed.
 */
export function findUpstreamDelay(
  stepCode: string,
  nodes: DelayGraphNode[]
): { stepCode: string; category: string } | null {
  const byCode = new Map(nodes.map((n) => [n.stepCode, n]));
  const cache = new Map<string, { stepCode: string; category: string } | null>();

  function resolve(code: string, seen: Set<string>): { stepCode: string; category: string } | null {
    if (cache.has(code)) return cache.get(code)!;
    if (seen.has(code)) return null; // guards against a cycle, which shouldn't exist in practice
    seen.add(code);

    const node = byCode.get(code);
    let result: { stepCode: string; category: string } | null = null;
    if (node) {
      for (const dep of node.dependsOn) {
        const depNode = byCode.get(dep);
        if (depNode?.delayCategory) {
          result = { stepCode: dep, category: depNode.delayCategory };
          break;
        }
        const upstream = resolve(dep, seen);
        if (upstream) {
          result = upstream;
          break;
        }
      }
    }
    cache.set(code, result);
    return result;
  }

  return resolve(stepCode, new Set());
}

/**
 * Recomputes planned_start_date/planned_end_date for every not-yet-completed Phase 1/2
 * step in a project whenever a date changes anywhere upstream — an actual-date edit, or
 * a step completing early/late. Runs as a fixed-point pass over the *live* depends_on
 * graph (not the static template, since that's what's actually stored per step):
 * repeatedly walk every open step, and if all its dependencies now have a resolved end
 * date, recompute its own start/end from them. Repeat until nothing changes.
 *
 * Completed steps are never touched — their dates are historical record, not a
 * projection. A dependency that's still unresolved (e.g. 1B before visit_urgency sets
 * its duration) correctly leaves everything downstream of it unresolved too, same as
 * the baseline scheduler in step-template.ts. Phase 3 is otherwise skipped entirely — its
 * actual dates come only from step status transitions — except for 3C2, handled separately
 * below: it's the one Phase 3 step with a planned date this function still keeps current, a
 * rough default off the Installation planned window that an admin's own override (see
 * plannedStartDateOverride/plannedEndDateOverride) always wins over.
 *
 * 2D1 ("Materials arrived") and 2D2 ("Final tight measurement at site") are the two steps whose
 * *planned end* doesn't come from start+duration like everything else. 2D1's is the latest of
 * Section/hardware/gasket's own "Actual arrival" planned dates (see computeItemArrivalPlanned),
 * since 2D1 can't be done until every item has arrived. 2D2's is Section's own "Order confirmed"
 * planned date + 18 working days (see computeSectionOrderConfirmedPlanned /
 * computeExpectedFinalMeasurementDate). Both steps' planned *start* still follows the generic
 * dependsOn rule (2A's end). Before procurement items exist yet (pre-1D, day one), or while the
 * relevant item(s) don't resolve to a date, each falls back to the same start+duration estimate
 * every other step uses, so it still gets an immediate day-one forecast rather than sitting blank.
 */
export async function rescheduleProjectDates(projectId: string): Promise<void> {
  const steps = await prisma.phaseStep.findMany({
    where: { projectId, phase: { not: "phase_3" } },
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
      delayCategory: true,
    },
  });

  const procurementItems = await prisma.procurementItem.findMany({
    where: { projectId },
    select: {
      itemType: true,
      planAnchorOverride: true,
      requirementPlannedOverride: true,
      quotePlannedOverride: true,
      paymentPlannedOverride: true,
      orderPlannedOverride: true,
      arrivalPlannedOverride: true,
      qcPlannedOverride: true,
      orderConfirmedAt: true,
      materialDespatchAt: true,
      materialDespatchPlannedOverride: true,
      arrivedForPowderCoatingAt: true,
      arrivedForPowderCoatingPlannedOverride: true,
    },
  });

  const oneD = steps.find((s) => s.stepCode === "1D");
  const phase2PlanAnchor = oneD
    ? computePhase2PlanAnchor(oneD.plannedEndDate, oneD.actualEndDate, oneD.delayCategory)
    : null;
  const itemArrivalDates = procurementItems
    .map((item) => computeItemArrivalPlanned(item, phase2PlanAnchor))
    .filter((d): d is Date => d instanceof Date);
  const materialsArrivedPlanned =
    itemArrivalDates.length > 0 ? new Date(Math.max(...itemArrivalDates.map((d) => d.getTime()))) : null;

  const sectionItem = procurementItems.find((i) => i.itemType === "section");
  const sectionOrderConfirmedPlanned = sectionItem
    ? computeSectionOrderConfirmedPlanned(sectionItem, phase2PlanAnchor)
    : null;
  const finalMeasurementPlanned = sectionOrderConfirmedPlanned
    ? computeExpectedFinalMeasurementDate(sectionOrderConfirmedPlanned)
    : null;

  // 3C2 ("Installation")'s own planned start/end — see computeInstallationPlannedWindow. Reuses
  // the exact same procurementItems/phase2PlanAnchor this function already loaded above, so this
  // can never drift from what the project detail page's own Installation planned window card
  // shows. Resolves to a forecast as soon as phase2PlanAnchor does (1D completing), well before
  // 3C2 itself exists — harmless: the update below only ever applies once there's a real 3C2 row
  // to apply it to.
  const sectionQCPlanned = sectionItem ? computeSectionQCPlanned(sectionItem, phase2PlanAnchor) : null;
  const itemQCPlannedDates = procurementItems.map(
    (item) => computeAllProcurementPlannedDates(item, phase2PlanAnchor, sectionQCPlanned).qc
  );
  const installationWindow = computeInstallationPlannedWindow(itemQCPlannedDates);

  // Ground truth for a step's "end", for the purposes of scheduling what comes after it:
  // a completed step's actual end date if known, else its current planned end date. A step
  // completed with an in_house delayCategory is the one exception — everything downstream
  // schedules as if it had finished on its planned end date instead, so an internal delay
  // doesn't buy the rest of the chain any slack (a client_side delay still uses the real,
  // late actual end, same as before delayCategory existed).
  const endDates = new Map<string, Date | null>(
    steps.map((s) => [
      s.stepCode,
      s.status === "completed"
        ? s.delayCategory === "in_house"
          ? s.plannedEndDate
          : (s.actualEndDate ?? s.plannedEndDate)
        : s.plannedEndDate,
    ])
  );

  const updates = new Map<
    string,
    { plannedStartDate: Date | null; plannedEndDate: Date | null; notifiedOverdueAt?: null }
  >();

  // Bounded fixed-point iteration: the graph's longest chain is a handful of steps deep,
  // so this converges well within `steps.length` passes; the bound just guards against
  // any future template change accidentally introducing a cycle.
  for (let pass = 0; pass < steps.length + 1; pass++) {
    let changed = false;

    for (const step of steps) {
      if (step.status === "completed") continue;

      let newStart: Date | null;
      if (step.dependsOn.length === 0) {
        newStart = step.plannedStartDate; // no upstream to react to — leave as is
      } else {
        const depEnds = step.dependsOn.map((code) => endDates.get(code));
        const allResolved = depEnds.every((d): d is Date => d instanceof Date);
        newStart = allResolved ? new Date(Math.max(...(depEnds as Date[]).map((d) => d.getTime()))) : null;
      }

      const newEnd =
        newStart === null
          ? null
          : step.stepCode === "2D1" && materialsArrivedPlanned !== null
            ? materialsArrivedPlanned
            : step.stepCode === "2D2" && finalMeasurementPlanned !== null
              ? finalMeasurementPlanned
              : step.plannedDurationDays !== null
                ? addDays(newStart, step.plannedDurationDays)
                : null;

      const prevStart = updates.get(step.stepCode)?.plannedStartDate ?? step.plannedStartDate;
      const prevEnd = updates.get(step.stepCode)?.plannedEndDate ?? step.plannedEndDate;
      const startMoved = (newStart?.getTime() ?? null) !== (prevStart?.getTime() ?? null);
      const endMoved = (newEnd?.getTime() ?? null) !== (prevEnd?.getTime() ?? null);

      if (startMoved || endMoved) {
        updates.set(step.stepCode, {
          plannedStartDate: newStart,
          plannedEndDate: newEnd,
          // A shifted end date makes any prior overdue notification stale — this step is
          // eligible to be (re-)evaluated by the overdue cron again. See notify-overdue.ts.
          ...(endMoved ? { notifiedOverdueAt: null } : {}),
        });
        endDates.set(step.stepCode, newEnd);
        changed = true;
      }
    }

    if (!changed) break;
  }

  const transactionOps = Array.from(updates.entries()).map(([stepCode, dates]) =>
    prisma.phaseStep.updateMany({
      where: { projectId, stepCode },
      data: dates,
    })
  );

  // 3C2 lives outside the loop above (it's excluded from `steps`, same as the rest of Phase 3),
  // so it gets its own small, separately-guarded write — same "completed steps are historical,
  // only write on an actual change, and re-arm the overdue notification when the end date moves"
  // rules as everything above, just evaluated against installationWindow instead of the
  // dependsOn/duration chain. An admin's own override (see plannedStartDateOverride/
  // plannedEndDateOverride and POST /api/phase-steps/[id]/dates) wins outright over the window,
  // same "override always wins" rule every procurement/glass-PO stage's own override already
  // follows — the window is only ever a rough default for whichever half hasn't been overridden.
  const threeC2 = await prisma.phaseStep.findFirst({
    where: { projectId, stepCode: "3C2" },
    select: {
      id: true,
      status: true,
      plannedStartDate: true,
      plannedEndDate: true,
      plannedStartDateOverride: true,
      plannedEndDateOverride: true,
    },
  });
  if (threeC2 && threeC2.status !== "completed") {
    const effectiveStart = threeC2.plannedStartDateOverride ?? installationWindow?.start ?? null;
    const effectiveEnd = threeC2.plannedEndDateOverride ?? installationWindow?.end ?? null;
    const startMoved = (effectiveStart?.getTime() ?? null) !== (threeC2.plannedStartDate?.getTime() ?? null);
    const endMoved = (effectiveEnd?.getTime() ?? null) !== (threeC2.plannedEndDate?.getTime() ?? null);
    if (startMoved || endMoved) {
      transactionOps.push(
        prisma.phaseStep.updateMany({
          where: { id: threeC2.id },
          data: {
            plannedStartDate: effectiveStart,
            plannedEndDate: effectiveEnd,
            ...(endMoved ? { notifiedOverdueAt: null } : {}),
          },
        })
      );
    }
  }

  if (transactionOps.length === 0) return;

  await prisma.$transaction(transactionOps);
}
