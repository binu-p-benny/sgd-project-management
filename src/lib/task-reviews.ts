import type { Department } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/lib/step-template";
import { isProcurementStageOverrun } from "@/lib/overrun";
import { PROCUREMENT_STAGES } from "@/lib/project-filters";
import { GLASS_PO_FULL_STAGES } from "@/lib/unified-tasks";
import { DERIVED_STEP_CODES } from "@/lib/step-actions";
import { DEPARTMENT_LABELS } from "@/lib/labels";
import type { UnifiedTask } from "@/lib/unified-tasks";

/** How long the operation manager has to review a completed unit of work before it reads as
 *  due, same "date-driven, computed at read time" convention as every other overdue check in
 *  the app (see overrun.ts) — not the customer-facing SERVICE_REVIEW_DUE_DAYS in service.ts,
 *  which is a completely separate review (the client's, not internal QA). */
export const REVIEW_DUE_DAYS = 1;

// Mirrors unified-tasks.ts' own STAGE_LABEL — kept as a separate copy rather than exported from
// there, since that one only needs to cover the *next unfilled* stage while this needs every
// stage regardless of fill order.
const STAGE_LABEL: Record<string, string> = {
  requirementCreatedAt: "Requirement created",
  quoteCreatedAt: "Quote created",
  paymentSettledAt: "Payment done",
  orderConfirmedAt: "Order confirmed",
  materialDespatchAt: "Material despatch",
  arrivedForPowderCoatingAt: "Arrived for powder coating",
  actualArrivalDate: "Actual arrival",
  qcCheckedAt: "QC checked",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** subTaskLabel for a review row — which item (if any) this belongs to, who completed it, and
 *  when, e.g. "Section — Completed by Purchase on 12 Sep 2026". */
function completedBySummary(itemLabel: string | null, department: Department, completedAt: Date): string {
  const prefix = itemLabel ? `${itemLabel} — ` : "";
  return `${prefix}Completed by ${DEPARTMENT_LABELS[department]} on ${formatDate(completedAt)}`;
}

async function reviewedTaskIdSet(): Promise<Set<string>> {
  const rows = await prisma.taskReview.findMany({ select: { taskId: true } });
  return new Set(rows.map((r) => r.taskId));
}

function buildReviewTask(args: {
  taskId: string;
  taskLabel: string;
  subTaskLabel: string;
  phase: UnifiedTask["phase"];
  project: { id: string; name: string; client: { name: string } };
  completedAt: Date;
  completedByDepartment: Department;
}): UnifiedTask {
  const dueDate = addDays(args.completedAt, REVIEW_DUE_DAYS);
  return {
    id: `review_completed:${args.taskId}`,
    kind: "review_completed",
    phase: args.phase,
    taskLabel: args.taskLabel,
    subTaskLabel: args.subTaskLabel,
    project: args.project,
    department: "operations_manager",
    completedByDepartment: args.completedByDepartment,
    secondaryDepartment: null,
    status: "not_started",
    plannedDate: dueDate.toISOString(),
    actualDate: null,
    overrun: isProcurementStageOverrun(dueDate, null),
    qcPassed: null,
    notes: null,
    blockedReason: null,
    blockedNote: null,
    gateBlockedBy: null,
    isPassFail: false,
    refId: args.taskId,
    dateField: null,
    noteField: "reviewNote",
    stepCode: null,
    actionItemSource: null,
    contractorId: null,
    contractorName: null,
    contractorPlannedDate: null,
    contractorOverdue: false,
    manualPlannedStartDate: null,
    manualPlannedEndDate: null,
  };
}

// A completed PhaseStep the operation manager hasn't reviewed yet. Same DERIVED_STEP_CODES/3A/3B
// exclusion buildPhaseStepTasks applies, for the same reason: those steps are never independently
// actionable, and their own sub-parts already surface (and get reviewed) as procurement_stage/
// glass_po_stage rows below — reviewing the derived step too would just double up the same work.
async function phaseStepReviewTasks(reviewed: Set<string>): Promise<UnifiedTask[]> {
  const steps = await prisma.phaseStep.findMany({
    where: { status: "completed", stepCode: { notIn: [...DERIVED_STEP_CODES, "3A", "3B"] } },
    include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
  });

  const tasks: UnifiedTask[] = [];
  for (const step of steps) {
    if (!step.actualEndDate) continue;
    const taskId = `phase_step:${step.id}`;
    if (reviewed.has(taskId)) continue;
    tasks.push(
      buildReviewTask({
        taskId,
        taskLabel: step.stepName,
        subTaskLabel: completedBySummary(null, step.owningDepartment, step.actualEndDate),
        phase: step.phase,
        project: step.project,
        completedAt: step.actualEndDate,
        completedByDepartment: step.owningDepartment,
      })
    );
  }
  return tasks;
}

// Every already-filled procurement stage field, not just each item's *next* one (unlike
// buildProcurementStageTasks, which only ever surfaces the next open stage as a task) — each
// fill-in is its own reviewable unit of work.
async function procurementStageReviewTasks(reviewed: Set<string>): Promise<UnifiedTask[]> {
  const items = await prisma.procurementItem.findMany({
    include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
  });

  const tasks: UnifiedTask[] = [];
  for (const item of items) {
    const itemLabel = capitalize(item.itemType);
    const record = item as unknown as Record<string, unknown>;
    for (const stage of PROCUREMENT_STAGES[item.itemType]) {
      const field = String(stage.field);
      const value = record[field];
      if (!(value instanceof Date)) continue;
      const taskId = `procurement_stage:${item.id}:${field}`;
      if (reviewed.has(taskId)) continue;
      tasks.push(
        buildReviewTask({
          taskId,
          taskLabel: STAGE_LABEL[field] ?? field,
          subTaskLabel: completedBySummary(itemLabel, stage.department, value),
          phase: "phase_2",
          project: item.project,
          completedAt: value,
          completedByDepartment: stage.department,
        })
      );
    }
    if (item.qcPassed === false && item.actionPlanAt) {
      const taskId = `procurement_stage:${item.id}:actionPlanAt`;
      if (!reviewed.has(taskId)) {
        tasks.push(
          buildReviewTask({
            taskId,
            taskLabel: "Action plan",
            subTaskLabel: completedBySummary(itemLabel, "purchase", item.actionPlanAt),
            phase: "phase_2",
            project: item.project,
            completedAt: item.actionPlanAt,
            completedByDepartment: "purchase",
          })
        );
      }
    }
  }
  return tasks;
}

// Same "every already-filled stage, not just the next one" idea as procurementStageReviewTasks,
// for the glass PO's own 6-stage sequence (see GLASS_PO_FULL_STAGES).
async function glassPOStageReviewTasks(reviewed: Set<string>): Promise<UnifiedTask[]> {
  const rows = await prisma.glassPurchaseOrder.findMany({
    include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
  });

  const tasks: UnifiedTask[] = [];
  for (const po of rows) {
    const record = po as unknown as Record<string, unknown>;
    for (const stage of GLASS_PO_FULL_STAGES) {
      const field = String(stage.field);
      const value = record[field];
      if (!(value instanceof Date)) continue;
      const taskId = `glass_po_stage:${po.id}:${field}`;
      if (reviewed.has(taskId)) continue;
      tasks.push(
        buildReviewTask({
          taskId,
          taskLabel: STAGE_LABEL[field] ?? field,
          subTaskLabel: completedBySummary("Glass PO", stage.department, value),
          phase: "phase_3",
          project: po.project,
          completedAt: value,
          completedByDepartment: stage.department,
        })
      );
    }
    if (po.qcPassed === false && po.actionPlanAt) {
      const taskId = `glass_po_stage:${po.id}:actionPlanAt`;
      if (!reviewed.has(taskId)) {
        tasks.push(
          buildReviewTask({
            taskId,
            taskLabel: "Action plan",
            subTaskLabel: completedBySummary("Glass PO", "purchase", po.actionPlanAt),
            phase: "phase_3",
            project: po.project,
            completedAt: po.actionPlanAt,
            completedByDepartment: "purchase",
          })
        );
      }
    }
  }
  return tasks;
}

// The 3 action-item tables' own completed (actualDate filled) rows — same 3-way split as
// buildActionItemTasks, just querying the done ones instead of the open ones.
async function actionItemReviewTasks(reviewed: Set<string>): Promise<UnifiedTask[]> {
  const [procurementItems, glassItems, phaseStepItems] = await Promise.all([
    prisma.procurementActionItem.findMany({
      where: { actualDate: { not: null } },
      include: {
        procurementItem: {
          select: { itemType: true, project: { select: { id: true, name: true, client: { select: { name: true } } } } },
        },
      },
    }),
    prisma.glassActionItem.findMany({
      where: { actualDate: { not: null } },
      include: {
        glassPurchaseOrder: { select: { project: { select: { id: true, name: true, client: { select: { name: true } } } } } },
      },
    }),
    prisma.phaseStepActionItem.findMany({
      where: { actualDate: { not: null } },
      include: {
        phaseStep: {
          select: { stepCode: true, project: { select: { id: true, name: true, client: { select: { name: true } } } } },
        },
      },
    }),
  ]);

  const tasks: UnifiedTask[] = [];

  for (const a of procurementItems) {
    if (!a.actualDate) continue;
    const taskId = `action_item:procurement:${a.id}`;
    if (reviewed.has(taskId)) continue;
    tasks.push(
      buildReviewTask({
        taskId,
        taskLabel: a.taskLabel,
        subTaskLabel: completedBySummary(`${capitalize(a.procurementItem.itemType)} — action plan`, a.department, a.actualDate),
        phase: "phase_2",
        project: a.procurementItem.project,
        completedAt: a.actualDate,
        completedByDepartment: a.department,
      })
    );
  }

  for (const a of glassItems) {
    if (!a.actualDate) continue;
    const taskId = `action_item:glass:${a.id}`;
    if (reviewed.has(taskId)) continue;
    tasks.push(
      buildReviewTask({
        taskId,
        taskLabel: a.taskLabel,
        subTaskLabel: completedBySummary("Glass PO — action plan", a.department, a.actualDate),
        phase: "phase_3",
        project: a.glassPurchaseOrder.project,
        completedAt: a.actualDate,
        completedByDepartment: a.department,
      })
    );
  }

  for (const a of phaseStepItems) {
    if (!a.actualDate) continue;
    const taskId = `action_item:phase_step:${a.id}`;
    if (reviewed.has(taskId)) continue;
    tasks.push(
      buildReviewTask({
        taskId,
        taskLabel: a.taskLabel,
        subTaskLabel: completedBySummary(`${a.phaseStep.stepCode} — action plan`, a.department, a.actualDate),
        phase: "phase_3",
        project: a.phaseStep.project,
        completedAt: a.actualDate,
        completedByDepartment: a.department,
      })
    );
  }

  return tasks;
}

// A service's own completed (actualDate filled) work items — reviewable even after the whole
// service has been closed out (unlike buildServiceItemTasks' own open-task list, which stops
// nagging a department once a service is marked completed): the work still happened and still
// needs reviewing regardless of whether the service itself is still open.
async function serviceItemReviewTasks(reviewed: Set<string>): Promise<UnifiedTask[]> {
  const items = await prisma.serviceItem.findMany({
    where: { actualDate: { not: null } },
    include: { service: { select: { id: true, title: true, client: { select: { name: true } } } } },
  });

  const tasks: UnifiedTask[] = [];
  for (const item of items) {
    if (!item.actualDate) continue;
    const taskId = `service_item:${item.id}`;
    if (reviewed.has(taskId)) continue;
    tasks.push(
      buildReviewTask({
        taskId,
        taskLabel: item.taskLabel,
        subTaskLabel: completedBySummary(null, item.department, item.actualDate),
        phase: "service",
        project: { id: item.service.id, name: item.service.title, client: item.service.client },
        completedAt: item.actualDate,
        completedByDepartment: item.department,
      })
    );
  }
  return tasks;
}

/**
 * Every completed unit of work — across every project and service, every department — that the
 * operation manager hasn't reviewed yet (see TaskReview). This is the Operations Manager
 * department's entire /my-tasks queue: unlike every other department, they own no phase steps or
 * service items of their own, so getUnifiedMyTasks(department) would just come back empty for
 * them. Sorted by review due date ascending, same "earliest due first" convention as
 * getUnifiedMyTasks — nothing here is ever without a due date, so there's no nulls-last case to
 * handle.
 *
 * contractor_selection and planned_date_edit tasks are deliberately excluded — neither has a
 * real completion timestamp for "work performed" (contractorId/plannedDate are just data entry
 * enabling someone else's future work, not a finished output), so there's nothing meaningful to
 * review there.
 */
export async function getReviewQueueTasks(): Promise<UnifiedTask[]> {
  const reviewed = await reviewedTaskIdSet();
  const [phaseSteps, procurementStages, glassPOStages, actionItems, serviceItems] = await Promise.all([
    phaseStepReviewTasks(reviewed),
    procurementStageReviewTasks(reviewed),
    glassPOStageReviewTasks(reviewed),
    actionItemReviewTasks(reviewed),
    serviceItemReviewTasks(reviewed),
  ]);

  const all = [...phaseSteps, ...procurementStages, ...glassPOStages, ...actionItems, ...serviceItems];
  return all.sort((a, b) => (a.plannedDate ?? "").localeCompare(b.plannedDate ?? ""));
}

/** Marks one completed unit of work as reviewed — taskId is the same composite id every review
 *  candidate above (and unified-tasks.ts' own open-task builders) already uses. Upsert rather
 *  than create: re-submitting a review (e.g. to fix a typo'd note) just overwrites the note and
 *  reviewedAt instead of erroring. */
interface ReviewContext {
  completedAt: Date;
  taskLabel: string;
  contextName: string;
  projectId: string;
}

/**
 * Looks up the one thing being reviewed — its own completion date plus enough to display it —
 * straight from whichever of the 5 source tables taskId's kind prefix points at. Only ever
 * called at review time (see markTaskReviewed), which snapshots the result onto the TaskReview
 * row itself so the department-KPI report never needs to re-join back to these tables later. A
 * mirror of the per-kind label logic the candidate builders above already use, just resolving
 * one row by id instead of building the whole pending list.
 */
async function resolveReviewContext(taskId: string): Promise<ReviewContext | null> {
  const [kind, ...rest] = taskId.split(":");

  if (kind === "phase_step") {
    const step = await prisma.phaseStep.findUnique({
      where: { id: rest[0] },
      select: { actualEndDate: true, stepName: true, project: { select: { id: true, name: true } } },
    });
    if (!step?.actualEndDate) return null;
    return { completedAt: step.actualEndDate, taskLabel: step.stepName, contextName: step.project.name, projectId: step.project.id };
  }

  if (kind === "procurement_stage") {
    const [itemId, field] = rest;
    const item = await prisma.procurementItem.findUnique({
      where: { id: itemId },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!item) return null;
    const value = (item as unknown as Record<string, unknown>)[field];
    if (!(value instanceof Date)) return null;
    const label = field === "actionPlanAt" ? "Action plan" : (STAGE_LABEL[field] ?? field);
    return {
      completedAt: value,
      taskLabel: `${label} — ${capitalize(item.itemType)}`,
      contextName: item.project.name,
      projectId: item.project.id,
    };
  }

  if (kind === "glass_po_stage") {
    const [poId, field] = rest;
    const po = await prisma.glassPurchaseOrder.findUnique({
      where: { id: poId },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!po) return null;
    const value = (po as unknown as Record<string, unknown>)[field];
    if (!(value instanceof Date)) return null;
    const label = field === "actionPlanAt" ? "Action plan" : (STAGE_LABEL[field] ?? field);
    return { completedAt: value, taskLabel: `${label} — Glass PO`, contextName: po.project.name, projectId: po.project.id };
  }

  if (kind === "action_item") {
    const [source, id] = rest;
    if (source === "procurement") {
      const a = await prisma.procurementActionItem.findUnique({
        where: { id },
        include: { procurementItem: { select: { itemType: true, project: { select: { id: true, name: true } } } } },
      });
      if (!a?.actualDate) return null;
      return {
        completedAt: a.actualDate,
        taskLabel: `${a.taskLabel} — ${capitalize(a.procurementItem.itemType)} action plan`,
        contextName: a.procurementItem.project.name,
        projectId: a.procurementItem.project.id,
      };
    }
    if (source === "glass") {
      const a = await prisma.glassActionItem.findUnique({
        where: { id },
        include: { glassPurchaseOrder: { select: { project: { select: { id: true, name: true } } } } },
      });
      if (!a?.actualDate) return null;
      return {
        completedAt: a.actualDate,
        taskLabel: `${a.taskLabel} — Glass PO action plan`,
        contextName: a.glassPurchaseOrder.project.name,
        projectId: a.glassPurchaseOrder.project.id,
      };
    }
    const a = await prisma.phaseStepActionItem.findUnique({
      where: { id },
      include: { phaseStep: { select: { stepCode: true, project: { select: { id: true, name: true } } } } },
    });
    if (!a?.actualDate) return null;
    return {
      completedAt: a.actualDate,
      taskLabel: `${a.taskLabel} — ${a.phaseStep.stepCode} action plan`,
      contextName: a.phaseStep.project.name,
      projectId: a.phaseStep.project.id,
    };
  }

  if (kind === "service_item") {
    const item = await prisma.serviceItem.findUnique({
      where: { id: rest[0] },
      include: { service: { select: { id: true, title: true } } },
    });
    if (!item?.actualDate) return null;
    return { completedAt: item.actualDate, taskLabel: item.taskLabel, contextName: item.service.title, projectId: item.service.id };
  }

  return null;
}

export async function markTaskReviewed(
  taskId: string,
  note: string | null,
  autoReviewed = false
): Promise<void> {
  const context = await resolveReviewContext(taskId);
  const reviewedAt = new Date();
  // Falls back to something inert rather than throwing — the row being reviewed right now was
  // just shown to the user, so a missing context here would mean the underlying record changed
  // out from under the request. Rare enough not to block the review over; the KPI report just
  // won't have anything meaningful to show for this one row.
  const data = context
    ? { reviewedAt, reviewNote: note, completedAt: context.completedAt, taskLabel: context.taskLabel, contextName: context.contextName, projectId: context.projectId, autoReviewed }
    : { reviewedAt, reviewNote: note, completedAt: reviewedAt, taskLabel: "Unknown", contextName: "", projectId: "", autoReviewed };

  await prisma.taskReview.upsert({
    where: { taskId },
    update: data,
    create: { taskId, ...data },
  });
}

/** Batched lookup for rendering a "Reviewed" chip next to individual rows elsewhere in the app
 *  (project/service detail pages) — keyed the same composite-id way as everything above, so a
 *  caller that already knows a row's taskId (e.g. `phase_step:<id>`) can look it up directly. */
export async function getTaskReviewsByIds(
  taskIds: string[]
): Promise<Map<string, { reviewedAt: Date; reviewNote: string | null }>> {
  if (taskIds.length === 0) return new Map();
  const rows = await prisma.taskReview.findMany({ where: { taskId: { in: taskIds } } });
  return new Map(rows.map((r) => [r.taskId, { reviewedAt: r.reviewedAt, reviewNote: r.reviewNote }]));
}
