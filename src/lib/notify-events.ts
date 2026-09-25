import { prisma } from "@/lib/prisma";
import { formatShortDate, notifyQuietly } from "@/lib/notifications";

/**
 * Notifications that fire from inside a request, as a side effect of the write that caused them
 * — as opposed to the ones a scheduled run produces (notify-overdue.ts, notify-cron.ts). They
 * live here rather than in the routes so the routes stay thin and the rules are testable
 * directly; every one returns how many rows it wrote, and none of them can fail a request (see
 * notifyQuietly).
 */

const ITEM_TYPE_LABEL: Record<string, string> = { section: "Section", hardware: "Hardware", gasket: "Gasket" };

/**
 * Fires when the last outstanding row of a "Blocked work" block gets its actual date — the same
 * "every task done" rule /projects' Status column shows as "· ready to resume" (see
 * getBlockedTaskProgress there), pushed to whoever can actually lift the block instead of
 * waiting to be spotted on a list. No-ops unless this block is tied to a step (blocks created
 * outside the "Confirm block" modal aren't about resuming anything) and that step is still
 * blocked.
 *
 * The dedupe key carries the task count, so adding a further task to an already-announced block
 * and completing that one announces it again, while a row being un-completed and re-completed
 * stays quiet.
 */
export async function notifyBlockedWorkReady(workBlockId: string, actorId?: string | null): Promise<number> {
  const block = await prisma.workBlock.findUnique({
    where: { id: workBlockId },
    include: {
      tasks: { select: { actualDate: true } },
      project: { select: { id: true, name: true } },
      blockedPhaseStep: {
        select: {
          id: true,
          stepCode: true,
          stepName: true,
          phase: true,
          status: true,
          owningDepartment: true,
          secondaryDepartment: true,
        },
      },
    },
  });

  const step = block?.blockedPhaseStep;
  if (!block || !step || step.status !== "blocked") return 0;
  if (block.tasks.length === 0 || block.tasks.some((t) => t.actualDate === null)) return 0;

  const count = block.tasks.length;
  return notifyQuietly({
    type: "block_ready",
    message: `${
      count === 1 ? "The blocked-work task" : `All ${count} blocked-work tasks`
    } on ${block.project.name} ${count === 1 ? "is" : "are"} done — ${step.stepCode} ${
      step.stepName
    } is ready to resume`,
    departments: [step.owningDepartment, step.secondaryDepartment],
    projectId: block.project.id,
    phaseStepId: step.id,
    dedupeKey: `block_ready:${block.id}:${count}`,
    exceptUserId: actorId,
  });
}

/** Shared tail for the QC messages: names the corrective plan's date when one has been set. */
function actionPlanSuffix(actionPlanAt: Date | null): string {
  return actionPlanAt ? ` — action plan due ${formatShortDate(actionPlanAt)}` : "";
}

/**
 * 3E's final on-site QC came back a failure. Unlike a procurement item's QC this doesn't move
 * the step's status at all (3E sits at in_progress until QC actually passes — see
 * /api/phase-steps/[id]), so without this nothing announces that the project just stopped being
 * one step from done.
 */
export async function notifyStepQcFailed(stepId: string, actorId?: string | null): Promise<number> {
  const step = await prisma.phaseStep.findUnique({
    where: { id: stepId },
    include: { project: { select: { id: true, name: true } } },
  });
  if (!step || step.qcPassed !== false) return 0;

  return notifyQuietly({
    type: "qc_failed",
    message: `${step.stepCode} ${step.stepName} on ${step.project.name} failed final QC${actionPlanSuffix(
      step.actionPlanAt
    )}`,
    departments: [step.owningDepartment, step.secondaryDepartment],
    projectId: step.projectId,
    phaseStepId: step.id,
    // One notification per check, not per save: correcting the note on an already-failed check
    // reuses the same qc_checked_at and so the same key.
    dedupeKey: `qc_failed:step:${step.id}:${step.qcCheckedAt?.toISOString() ?? "unchecked"}`,
    exceptUserId: actorId,
  });
}

/** A Section/Hardware/Gasket item failed its material QC — 2F stays incomplete and Phase 3 waits. */
export async function notifyProcurementQcFailed(itemId: string, actorId?: string | null): Promise<number> {
  const item = await prisma.procurementItem.findUnique({
    where: { id: itemId },
    include: { project: { select: { id: true, name: true } } },
  });
  if (!item || item.qcPassed !== false) return 0;

  return notifyQuietly({
    type: "qc_failed",
    message: `${ITEM_TYPE_LABEL[item.itemType] ?? item.itemType} failed material QC on ${
      item.project.name
    }${actionPlanSuffix(item.actionPlanAt)}`,
    // The QC checked stage belongs to purchase on every item type (see PROCUREMENT_STAGES).
    departments: ["purchase"],
    projectId: item.projectId,
    dedupeKey: `qc_failed:item:${item.id}:${item.qcCheckedAt?.toISOString() ?? "unchecked"}`,
    exceptUserId: actorId,
  });
}

/** The glass order failed QC — same shape as the procurement one, one row per project. */
export async function notifyGlassQcFailed(glassPOId: string, actorId?: string | null): Promise<number> {
  const po = await prisma.glassPurchaseOrder.findUnique({
    where: { id: glassPOId },
    include: { project: { select: { id: true, name: true } } },
  });
  if (!po || po.qcPassed !== false) return 0;

  return notifyQuietly({
    type: "qc_failed",
    message: `Glass PO failed QC on ${po.project.name}${actionPlanSuffix(po.actionPlanAt)}`,
    departments: ["purchase"],
    projectId: po.projectId,
    dedupeKey: `qc_failed:glass_po:${po.id}:${po.qcCheckedAt?.toISOString() ?? "unchecked"}`,
    exceptUserId: actorId,
  });
}
