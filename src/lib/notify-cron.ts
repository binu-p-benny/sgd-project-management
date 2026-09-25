import { prisma } from "@/lib/prisma";
import { formatShortDate, notifyDepartments } from "@/lib/notifications";
import { GLASS_PO_OVERRUN_SELECT, PROCUREMENT_ITEM_OVERRUN_SELECT } from "@/lib/dashboard";
import { getProjectDelayReasons, isContractorSelectionOverdue } from "@/lib/overrun";
import { withLiveExpectedArrivalDates } from "@/lib/procurement";
import { MANUAL_CONTRACTOR_STEP_CODES } from "@/lib/step-actions";
import { addDays } from "@/lib/step-template";
import type { Department } from "@prisma/client";

/**
 * The scheduled notifications other than the overdue-step one (see notify-overdue.ts, which
 * keeps its own older guard column). Everything here is idempotent through Notification's
 * dedupe_key rather than a per-row guard: the key embeds the planned date it was raised
 * against, so re-running the cron the same day is a no-op while a date that actually moves
 * raises a fresh one.
 */

const ITEM_TYPE_LABEL: Record<string, string> = { section: "Section", hardware: "Hardware", gasket: "Gasket" };

/**
 * Which department owns each lifecycle stage — the same ownership PROCUREMENT_STAGES and
 * GLASS_PO_FULL_STAGES encode, keyed here by the display label getProjectDelayReasons returns
 * (it deals in labels, not field names). Both item and Glass PO stages share this map because
 * both lists assign the same departments to the same stages.
 */
const STAGE_DEPARTMENTS: Record<string, Department[]> = {
  "Requirement created": ["design_engineer"],
  "Quote created": ["purchase"],
  "Payment done": ["accounts", "purchase"],
  "Order confirmed": ["purchase"],
  "Material despatch": ["purchase"],
  "Arrived for powder coating": ["purchase"],
  "Actual arrival": ["purchase"],
  "QC checked": ["purchase"],
};

/** A yyyy-mm-dd stamp for dedupe keys — day-level, since planned dates are day-level. */
function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Procurement items and the Glass PO, which the overdue-step cron never looked at: a project
 * could sit with Section's Quote a fortnight late and nobody was told, because only
 * phase_steps.planned_end_date was ever checked. Reuses getProjectDelayReasons — the exact same
 * overdue signals /projects and the dashboard already display — with the step list left empty,
 * since notifyOverdueSteps owns those.
 */
export async function notifyOverdueProcurement(): Promise<{ notified: number }> {
  const projects = await prisma.project.findMany({
    where: { currentPhase: { not: "completed" } },
    select: {
      id: true,
      name: true,
      phaseSteps: {
        select: { stepCode: true, plannedEndDate: true, actualEndDate: true, delayCategory: true },
      },
      procurementItems: { select: PROCUREMENT_ITEM_OVERRUN_SELECT },
      glassPurchaseOrder: { select: GLASS_PO_OVERRUN_SELECT },
    },
  });

  let notified = 0;

  for (const project of projects) {
    const oneD = project.phaseSteps.find((s) => s.stepCode === "1D");
    const items = withLiveExpectedArrivalDates(project.procurementItems, oneD);
    const reasons = getProjectDelayReasons([], items, project.glassPurchaseOrder);

    for (const reason of reasons) {
      if (reason.kind === "step") continue; // notifyOverdueSteps' job, not this one

      const label =
        reason.kind === "item"
          ? `${ITEM_TYPE_LABEL[reason.itemType] ?? reason.itemType} — ${reason.stageLabel}`
          : `Glass PO — ${reason.stageLabel}`;

      const written = await notifyDepartments({
        type: reason.kind === "item" ? "procurement_overdue" : "glass_po_overdue",
        message: `${label} on ${project.name} is overdue — was due ${formatShortDate(reason.plannedDate)}`,
        departments: STAGE_DEPARTMENTS[reason.stageLabel] ?? ["purchase"],
        projectId: project.id,
        dedupeKey: `${reason.kind === "item" ? `item:${reason.itemType}` : "glass_po"}:${project.id}:${
          reason.stageLabel
        }:${dayStamp(reason.plannedDate)}`,
      });
      if (written > 0) notified += 1;
    }
  }

  return { notified };
}

/**
 * 3C1 sitting past the date the aluminum contractor should have been lined up by (the Section
 * item's own Requirement created date — see contractorPlannedDate in my-tasks.ts) with nobody
 * chosen. The step itself isn't overdue in the planned_end_date sense, so the overdue-step cron
 * never catches this.
 */
export async function notifyContractorNotAssigned(): Promise<{ notified: number }> {
  const steps = await prisma.phaseStep.findMany({
    where: {
      stepCode: { in: Array.from(MANUAL_CONTRACTOR_STEP_CODES) },
      status: { not: "completed" },
      contractorId: null,
    },
    include: { project: { select: { id: true, name: true } } },
  });
  if (steps.length === 0) return { notified: 0 };

  const sections = await prisma.procurementItem.findMany({
    where: { projectId: { in: steps.map((s) => s.projectId) }, itemType: "section" },
    select: { projectId: true, requirementCreatedAt: true },
  });
  const requirementByProject = new Map(sections.map((s) => [s.projectId, s.requirementCreatedAt]));

  let notified = 0;

  for (const step of steps) {
    const plannedDate = requirementByProject.get(step.projectId) ?? null;
    if (!isContractorSelectionOverdue(plannedDate, step.contractorId)) continue;

    const written = await notifyDepartments({
      type: "contractor_overdue",
      message: `${step.stepCode} ${step.stepName} on ${step.project.name} still has no contractor — was due ${formatShortDate(
        plannedDate!
      )}`,
      departments: [step.owningDepartment, step.secondaryDepartment],
      projectId: step.projectId,
      phaseStepId: step.id,
      dedupeKey: `contractor_overdue:${step.id}:${dayStamp(plannedDate!)}`,
    });
    if (written > 0) notified += 1;
  }

  return { notified };
}

/** How long an unanswered website review waits before HR is reminded about it again. */
const WEBSITE_REVIEW_REMINDER_DAYS = 7;

/**
 * The Phase 3 website review (see the website_review task in unified-tasks.ts): opens a day
 * after 3E's actual end and then just sits in /my-tasks until someone answers Yes or No.
 * Notified once when it opens and once a week after that while it stays unanswered — the weekly
 * bucket is part of the dedupe key, so each reminder is a new key and every run in between is a
 * no-op.
 */
export async function notifyWebsiteReviewDue(): Promise<{ notified: number }> {
  const projects = await prisma.project.findMany({
    where: {
      websiteReviewAsked: null,
      phaseSteps: { some: { stepCode: "3E", actualEndDate: { not: null } } },
    },
    select: {
      id: true,
      name: true,
      phaseSteps: { where: { stepCode: "3E" }, select: { actualEndDate: true } },
    },
  });

  const now = new Date();
  let notified = 0;

  for (const project of projects) {
    const actualEnd = project.phaseSteps[0]?.actualEndDate;
    if (!actualEnd) continue;

    const plannedDate = addDays(actualEnd, 1);
    if (plannedDate > now) continue;

    const daysWaiting = Math.floor((now.getTime() - plannedDate.getTime()) / 86_400_000);
    const reminder = Math.floor(daysWaiting / WEBSITE_REVIEW_REMINDER_DAYS);

    const written = await notifyDepartments({
      type: "website_review_due",
      message:
        reminder === 0
          ? `Website review for ${project.name} is due — planned ${formatShortDate(plannedDate)}`
          : `Website review for ${project.name} is still unanswered — planned ${formatShortDate(plannedDate)}`,
      departments: ["hr_admin"],
      projectId: project.id,
      dedupeKey: `website_review:${project.id}:${dayStamp(plannedDate)}:${reminder}`,
    });
    if (written > 0) notified += 1;
  }

  return { notified };
}
