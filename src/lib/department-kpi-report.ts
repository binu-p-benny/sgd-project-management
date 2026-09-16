import type { Department } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computePhase2PlanAnchor,
  computeSectionQCPlanned,
  computeAllProcurementPlannedDates,
  type ProcurementStagePlannedDates,
} from "@/lib/procurement";
import { addDays } from "@/lib/step-template";
import { PROCUREMENT_STAGES } from "@/lib/project-filters";
import { GLASS_PO_FULL_STAGES, getUnifiedMyTasks } from "@/lib/unified-tasks";
import { REVIEW_DUE_DAYS, getReviewQueueTasks } from "@/lib/task-reviews";
import { ASSIGNABLE_DEPARTMENTS, DEPARTMENT_LABELS } from "@/lib/labels";
import {
  classifyCompletion,
  scoreDepartment,
  inRange,
  type KpiRange,
  type CompletedUnitRow,
  type ScoreComponents,
  type DepartmentKpiRow,
  type DepartmentKpiResult,
} from "@/lib/department-kpi";

/**
 * The database side of the department-performance feature — reads dates already in the schema
 * and hands the pure helpers in department-kpi.ts the raw material. Server-only (imports Prisma).
 * Derived phase steps (2A/2D1/2F/3A/3B) are skipped — they're rollups of the procurement /
 * glass-PO stages, which are scored directly.
 */

// Non-derived, manually-completed phase steps only.
const SCORED_STEP_CODES = ["1A", "1B", "1C", "1D", "2D2", "3C1", "3C2", "3E"];

// ASSIGNABLE_DEPARTMENTS plus Operations Manager — scored here even though it's deliberately
// left out of ASSIGNABLE_DEPARTMENTS itself (that list is for assigning *new* work — action
// items, service rows — to a real work-performing department; Operations Manager never gets
// handed one of those, it only reviews what other departments already finished). Kept local
// to this file rather than widening the shared constant everyone else's dropdowns read from.
const KPI_DEPARTMENTS = [...ASSIGNABLE_DEPARTMENTS, "operations_manager"] as const satisfies readonly Department[];

// Actual-timestamp field -> its key in ProcurementStagePlannedDates (mirrors the plannedByField
// map in unified-tasks.ts' buildProcurementStageTasks).
const PROCUREMENT_PLANNED_KEY: Record<string, keyof ProcurementStagePlannedDates> = {
  requirementCreatedAt: "requirement",
  quoteCreatedAt: "quote",
  paymentSettledAt: "payment",
  orderConfirmedAt: "order",
  materialDespatchAt: "materialDespatch",
  arrivedForPowderCoatingAt: "arrivedForPowderCoating",
  actualArrivalDate: "arrival",
  qcCheckedAt: "qc",
};

// Actual-timestamp field -> its stored planned-date column on GlassPurchaseOrder.
const GLASS_PLANNED_COLUMN: Record<string, string> = {
  requirementCreatedAt: "requirementPlannedDate",
  quoteCreatedAt: "quotePlannedDate",
  paymentSettledAt: "paymentPlannedDate",
  orderConfirmedAt: "orderPlannedDate",
  actualArrivalDate: "arrivalPlannedDate",
  qcCheckedAt: "qcPlannedDate",
};

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

/**
 * Every unit of work finished within `range`, one row each, tagged with the department that
 * owned it and whether it landed on time. Raw material for the per-department aggregation and
 * the drill-down.
 */
export async function getCompletedUnits(range: KpiRange): Promise<CompletedUnitRow[]> {
  const [
    phaseSteps,
    procurementItems,
    glassOrders,
    procActionItems,
    glassActionItems,
    stepActionItems,
    serviceItems,
    reviews,
  ] = await Promise.all([
      prisma.phaseStep.findMany({
        where: { status: "completed", stepCode: { in: SCORED_STEP_CODES }, actualEndDate: { not: null } },
        include: { project: { select: { id: true, name: true } } },
      }),
      prisma.procurementItem.findMany({
        include: {
          project: {
            select: {
              id: true,
              name: true,
              phaseSteps: {
                where: { stepCode: "1D" },
                select: { plannedEndDate: true, actualEndDate: true, delayCategory: true },
              },
            },
          },
        },
      }),
      prisma.glassPurchaseOrder.findMany({ include: { project: { select: { id: true, name: true } } } }),
      prisma.procurementActionItem.findMany({
        where: { actualDate: { not: null } },
        include: {
          procurementItem: { select: { itemType: true, project: { select: { id: true, name: true } } } },
        },
      }),
      prisma.glassActionItem.findMany({
        where: { actualDate: { not: null } },
        include: { glassPurchaseOrder: { select: { project: { select: { id: true, name: true } } } } },
      }),
      prisma.phaseStepActionItem.findMany({
        where: { actualDate: { not: null } },
        include: { phaseStep: { select: { stepCode: true, project: { select: { id: true, name: true } } } } },
      }),
      prisma.serviceItem.findMany({
        where: { actualDate: { not: null } },
        include: { service: { select: { id: true, title: true } } },
      }),
      prisma.taskReview.findMany(),
    ]);

  const rows: CompletedUnitRow[] = [];

  // --- Phase steps ---
  for (const step of phaseSteps) {
    const completedDate = step.actualEndDate!;
    if (!inRange(completedDate, range)) continue;
    const { outcome, daysLate } = classifyCompletion(step.plannedEndDate, completedDate, step.delayCategory);
    rows.push({
      department: step.owningDepartment,
      source: "phase_step",
      taskLabel: `${step.stepCode} ${step.stepName}`,
      contextName: step.project.name,
      projectId: step.project.id,
      plannedDate: step.plannedEndDate,
      completedDate,
      daysLate,
      outcome,
      isQc: step.stepCode === "3E",
      qcPassed: step.stepCode === "3E" ? step.qcPassed : null,
    });
  }

  // --- Procurement item fixed stages ---
  const itemsByProject = new Map<string, typeof procurementItems>();
  for (const item of procurementItems) {
    const list = itemsByProject.get(item.projectId) ?? [];
    list.push(item);
    itemsByProject.set(item.projectId, list);
  }
  for (const [, projectItems] of itemsByProject) {
    const oneD = projectItems[0]?.project.phaseSteps[0];
    const phase2PlanAnchor = oneD
      ? computePhase2PlanAnchor(oneD.plannedEndDate, oneD.actualEndDate, oneD.delayCategory)
      : null;
    const sectionItem = projectItems.find((i) => i.itemType === "section");
    const sectionQCPlanned = sectionItem ? computeSectionQCPlanned(sectionItem, phase2PlanAnchor) : null;

    for (const item of projectItems) {
      const planned = computeAllProcurementPlannedDates(item, phase2PlanAnchor, sectionQCPlanned);
      for (const stage of PROCUREMENT_STAGES[item.itemType]) {
        const field = stage.field as string;
        const actual = item[stage.field] as Date | null;
        if (!actual || !inRange(actual, range)) continue;
        const plannedDate = planned[PROCUREMENT_PLANNED_KEY[field]] ?? null;
        const isQc = field === "qcCheckedAt";
        const { outcome, daysLate } = classifyCompletion(plannedDate, actual, null);
        rows.push({
          department: stage.department,
          source: "procurement_stage",
          taskLabel: `${STAGE_LABEL[field]} — ${capitalize(item.itemType)}`,
          contextName: item.project.name,
          projectId: item.project.id,
          plannedDate,
          completedDate: actual,
          daysLate,
          outcome,
          isQc,
          qcPassed: isQc ? item.qcPassed : null,
        });
      }
    }
  }

  // --- Glass PO fixed stages ---
  for (const po of glassOrders) {
    for (const stage of GLASS_PO_FULL_STAGES) {
      const field = stage.field as string;
      const actual = (po as unknown as Record<string, Date | null>)[field];
      if (!actual || !inRange(actual, range)) continue;
      const plannedDate = (po as unknown as Record<string, Date | null>)[GLASS_PLANNED_COLUMN[field]] ?? null;
      const isQc = field === "qcCheckedAt";
      const { outcome, daysLate } = classifyCompletion(plannedDate, actual, null);
      rows.push({
        department: stage.department,
        source: "glass_po_stage",
        taskLabel: `${STAGE_LABEL[field]} — Glass PO`,
        contextName: po.project.name,
        projectId: po.project.id,
        plannedDate,
        completedDate: actual,
        daysLate,
        outcome,
        isQc,
        qcPassed: isQc ? po.qcPassed : null,
      });
    }
  }

  // --- Action items (procurement / glass / phase-step) + service items ---
  const simpleRows: {
    department: Department;
    source: "action_item" | "service_item";
    taskLabel: string;
    contextName: string;
    projectId: string;
    plannedDate: Date;
    completedDate: Date;
    isPassFail: boolean;
    qcPassed: boolean | null;
  }[] = [];

  for (const a of procActionItems) {
    simpleRows.push({
      department: a.department,
      source: "action_item",
      taskLabel: `${a.taskLabel} — ${capitalize(a.procurementItem.itemType)} action plan`,
      contextName: a.procurementItem.project.name,
      projectId: a.procurementItem.project.id,
      plannedDate: a.plannedDate,
      completedDate: a.actualDate!,
      isPassFail: a.isPassFail,
      qcPassed: a.qcPassed,
    });
  }
  for (const a of glassActionItems) {
    simpleRows.push({
      department: a.department,
      source: "action_item",
      taskLabel: `${a.taskLabel} — Glass PO action plan`,
      contextName: a.glassPurchaseOrder.project.name,
      projectId: a.glassPurchaseOrder.project.id,
      plannedDate: a.plannedDate,
      completedDate: a.actualDate!,
      isPassFail: a.isPassFail,
      qcPassed: a.qcPassed,
    });
  }
  for (const a of stepActionItems) {
    simpleRows.push({
      department: a.department,
      source: "action_item",
      taskLabel: `${a.taskLabel} — ${a.phaseStep.stepCode} action plan`,
      contextName: a.phaseStep.project.name,
      projectId: a.phaseStep.project.id,
      plannedDate: a.plannedDate,
      completedDate: a.actualDate!,
      isPassFail: a.isPassFail,
      qcPassed: a.qcPassed,
    });
  }
  for (const item of serviceItems) {
    simpleRows.push({
      department: item.department,
      source: "service_item",
      taskLabel: item.taskLabel,
      contextName: item.service.title,
      projectId: item.service.id,
      plannedDate: item.plannedDate,
      completedDate: item.actualDate!,
      isPassFail: item.isPassFail,
      qcPassed: item.qcPassed,
    });
  }

  for (const r of simpleRows) {
    if (!inRange(r.completedDate, range)) continue;
    const { outcome, daysLate } = classifyCompletion(r.plannedDate, r.completedDate, null);
    rows.push({
      department: r.department,
      source: r.source,
      taskLabel: r.taskLabel,
      contextName: r.contextName,
      projectId: r.projectId,
      plannedDate: r.plannedDate,
      completedDate: r.completedDate,
      daysLate,
      outcome,
      isQc: r.isPassFail,
      qcPassed: r.isPassFail ? r.qcPassed : null,
    });
  }

  // --- Operations Manager's own reviews of other departments' completed work ---
  // Always credited to operations_manager, regardless of which department did the original
  // work being reviewed — this scores the review itself, not a second time the same unit.
  // "Planned" here is the review's own due date (REVIEW_DUE_DAYS after the original
  // completion, snapshotted onto the row at review time — see resolveReviewContext), not the
  // original unit's own planned date. No client-caused concept for a review.
  for (const r of reviews) {
    if (!inRange(r.reviewedAt, range)) continue;
    const dueDate = addDays(r.completedAt, REVIEW_DUE_DAYS);
    const { outcome, daysLate } = classifyCompletion(dueDate, r.reviewedAt, null);
    rows.push({
      department: "operations_manager",
      source: "review",
      taskLabel: r.taskLabel,
      contextName: r.contextName,
      projectId: r.projectId,
      plannedDate: dueDate,
      completedDate: r.reviewedAt,
      daysLate,
      outcome,
      isQc: false,
      qcPassed: null,
    });
  }

  return rows;
}

/** Open work a department is currently sitting on, and how much of it is already overdue —
 *  read straight off getUnifiedMyTasks (which already excludes derived steps and not-yet-
 *  reachable ones), grouped by the task's primary department. Operations Manager owns none of
 *  those (nothing in getUnifiedMyTasks is ever assigned to it) — its own backlog is the pending
 *  review queue instead (see getReviewQueueTasks), merged in the same shape. */
async function getBacklogByDepartment(): Promise<Map<Department, { openOwned: number; overdueOpen: number }>> {
  const [openTasks, reviewQueue] = await Promise.all([getUnifiedMyTasks(null), getReviewQueueTasks()]);
  const map = new Map<Department, { openOwned: number; overdueOpen: number }>();
  for (const task of openTasks) {
    const entry = map.get(task.department) ?? { openOwned: 0, overdueOpen: 0 };
    entry.openOwned += 1;
    if (task.overrun) entry.overdueOpen += 1;
    map.set(task.department, entry);
  }
  map.set("operations_manager", {
    openOwned: reviewQueue.length,
    overdueOpen: reviewQueue.filter((t) => t.overrun).length,
  });
  return map;
}

export async function getDepartmentKpis(range: KpiRange): Promise<DepartmentKpiResult> {
  const [units, backlog] = await Promise.all([getCompletedUnits(range), getBacklogByDepartment()]);

  const rows: DepartmentKpiRow[] = KPI_DEPARTMENTS.map((department) => {
    const own = units.filter((u) => u.department === department);
    const assessedUnits = own.filter((u) => u.plannedDate !== null);
    const onTime = assessedUnits.filter((u) => u.outcome === "on_time").length;
    const late = assessedUnits.filter((u) => u.outcome === "late").length;
    const clientCaused = assessedUnits.filter((u) => u.outcome === "client_caused").length;
    const lateDays = assessedUnits.filter((u) => u.outcome === "late").map((u) => u.daysLate);

    const qcUnits = own.filter((u) => u.isQc && u.qcPassed !== null);
    const qcPassed = qcUnits.filter((u) => u.qcPassed === true).length;
    const qcFailed = qcUnits.filter((u) => u.qcPassed === false).length;

    const b = backlog.get(department) ?? { openOwned: 0, overdueOpen: 0 };

    const components: ScoreComponents = {
      onTimeRate: assessedUnits.length > 0 ? (onTime + clientCaused) / assessedUnits.length : null,
      qcPassRate: qcUnits.length > 0 ? qcPassed / qcUnits.length : null,
      backlogHealth: b.openOwned > 0 ? 1 - b.overdueOpen / b.openOwned : null,
    };

    return {
      department,
      label: DEPARTMENT_LABELS[department],
      rank: 0,
      score: scoreDepartment(components),
      components,
      completed: own.length,
      assessed: assessedUnits.length,
      onTime,
      late,
      clientCaused,
      avgDaysLate:
        lateDays.length > 0 ? Math.round((lateDays.reduce((s, n) => s + n, 0) / lateDays.length) * 10) / 10 : null,
      qcPassed,
      qcFailed,
      openOwned: b.openOwned,
      overdueOpen: b.overdueOpen,
    };
  });

  rows.sort((a, b) => b.score - a.score || b.completed - a.completed);
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  const lateUnits = units
    .filter((u) => u.outcome !== "on_time")
    .sort((a, b) => b.completedDate.getTime() - a.completedDate.getTime());

  return { range, rows, lateUnits };
}
