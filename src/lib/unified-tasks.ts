import type { BlockedReason, Department, StepStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isStepOverrun, isProcurementStageOverrun, isContractorSelectionOverdue } from "@/lib/overrun";
import {
  computePhase2PlanAnchor,
  computeAllProcurementPlannedDates,
  computeSectionQCPlanned,
  computeExpectedActionPlanDate,
  getRequirementCreatedStatus,
} from "@/lib/procurement";
import { PROCUREMENT_STAGES, firstUnfilledStage, type StageSpec } from "@/lib/project-filters";
import { DERIVED_STEP_CODES, MANUAL_CONTRACTOR_STEP_CODES } from "@/lib/step-actions";
import { checkDependencyGate } from "@/lib/dependency-gate";

export type TaskKind = "phase_step" | "procurement_stage" | "glass_po_stage" | "action_item" | "service_item";

// Field -> human label/note-field, shared by procurement items and the glass PO tracker (which
// reuse the exact same stage names) — see the fixed stage arrays built inline in the project
// detail page, which this mirrors rather than reads from (that page's arrays carry planned-date
// wiring specific to its own render loop, not reusable here).
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
const STAGE_NOTE_FIELD: Record<string, string> = {
  requirementCreatedAt: "requirementNote",
  quoteCreatedAt: "quoteNote",
  paymentSettledAt: "paymentNote",
  orderConfirmedAt: "orderNote",
  materialDespatchAt: "materialDespatchNote",
  arrivedForPowderCoatingAt: "arrivedForPowderCoatingNote",
  actualArrivalDate: "arrivalNote",
  qcCheckedAt: "qcNote",
};

export interface UnifiedTask {
  id: string;
  kind: TaskKind;
  // "service" for kind === "service_item" — a Service has no phase concept at all, this is
  // just the least-bad fit for a field every other kind already needs.
  phase: "phase_1" | "phase_2" | "phase_3" | "service";
  taskLabel: string;
  subTaskLabel: string | null;
  // The project this task belongs to — or, for kind === "service_item", the Service instead
  // (id/name/client all still make sense there, a Service has its own client the same way a
  // Project does; TaskTable branches on kind to link to /services/ instead of /projects/).
  project: { id: string; name: string; client: { name: string } };
  department: Department;
  secondaryDepartment: Department | null;
  status: StepStatus;
  plannedDate: string | null;
  actualDate: string | null;
  overrun: boolean;
  qcPassed: boolean | null;
  notes: string | null;
  blockedReason: BlockedReason | null;
  blockedNote: string | null;
  gateBlockedBy: string[] | null;
  // Whether this row's completion needs a Pass/Fail pair instead of one "Mark complete" button.
  isPassFail: boolean;
  // Enough for the client to PATCH the right endpoint with the right body — see /my-tasks'
  // TaskTable, which branches on `kind` to decide which of these fields it actually needs.
  refId: string;
  dateField: string | null;
  noteField: string | null;
  stepCode: string | null;
  // kind === "action_item" only — which of the 3 action-item tables (and so which API route)
  // this row's refId belongs to. Null for every other kind.
  actionItemSource: "procurement" | "glass" | "phase_step" | null;
  // 3C1's phase_step row only (see MANUAL_CONTRACTOR_STEP_CODES) — null/false for every other
  // row. contractorPlannedDate is the Section item's own Requirement created date: once that
  // material requirement is known, a contractor should already be lined up, so it's usually
  // already in the past by the time 3C1 itself even exists (see maybeEarlyUnlockPhase3 in
  // step-actions.ts) — contractorOverdue reads true immediately in that case. TaskTable PATCHes
  // /api/phase-steps/[id]/contractor (refId) to set contractorId, separately from this row's own
  // dateField-driven Start/Complete actions.
  contractorId: string | null;
  contractorName: string | null;
  contractorPlannedDate: string | null;
  contractorOverdue: boolean;
}

/** Builds one procurement-stage or glass-PO-stage task row — same shape either way, just a
 *  different id prefix/refId source, so both call sites below share this instead of repeating
 *  the same object literal. */
function buildStageTask(args: {
  kind: "procurement_stage" | "glass_po_stage";
  phase: "phase_2" | "phase_3";
  refId: string;
  itemLabel: string; // "Hardware" / "Section" / "Glass PO"
  stage: StageSpec<Record<string, unknown>>;
  plannedDate: Date | null;
  actualDate: null; // always null — only ever built for the *next unfilled* stage
  project: { id: string; name: string; client: { name: string } };
}): UnifiedTask {
  const fieldName = String(args.stage.field);
  return {
    id: `${args.kind}:${args.refId}:${fieldName}`,
    kind: args.kind,
    phase: args.phase,
    taskLabel: STAGE_LABEL[fieldName] ?? fieldName,
    subTaskLabel: args.itemLabel,
    project: args.project,
    department: args.stage.department,
    secondaryDepartment: args.stage.secondaryDepartment ?? null,
    status: "not_started",
    plannedDate: args.plannedDate ? args.plannedDate.toISOString() : null,
    actualDate: null,
    overrun: isProcurementStageOverrun(args.plannedDate, null),
    qcPassed: null,
    notes: null,
    blockedReason: null,
    blockedNote: null,
    gateBlockedBy: null,
    isPassFail: fieldName === "qcCheckedAt",
    refId: args.refId,
    dateField: fieldName,
    noteField: STAGE_NOTE_FIELD[fieldName] ?? null,
    stepCode: null,
    actionItemSource: null,
    contractorId: null,
    contractorName: null,
    contractorPlannedDate: null,
    contractorOverdue: false,
  };
}

/** The Action plan row that appears once an item/glass-PO fails QC and hasn't recorded one yet —
 *  same shape as a fixed stage, just not part of the normal 6/8-stage chain (see page.tsx's own
 *  dynamic "actionPlan" entry, added to its stages array only when qcPassed === false). */
function buildActionPlanTask(args: {
  kind: "procurement_stage" | "glass_po_stage";
  phase: "phase_2" | "phase_3";
  refId: string;
  itemLabel: string;
  qcCheckedAt: Date;
  project: { id: string; name: string; client: { name: string } };
}): UnifiedTask {
  const plannedDate = computeExpectedActionPlanDate(args.qcCheckedAt);
  return {
    id: `${args.kind}:${args.refId}:actionPlanAt`,
    kind: args.kind,
    phase: args.phase,
    taskLabel: "Action plan",
    subTaskLabel: args.itemLabel,
    project: args.project,
    department: "purchase",
    secondaryDepartment: null,
    status: "not_started",
    plannedDate: plannedDate.toISOString(),
    actualDate: null,
    overrun: isProcurementStageOverrun(plannedDate, null),
    qcPassed: null,
    notes: null,
    blockedReason: null,
    blockedNote: null,
    gateBlockedBy: null,
    isPassFail: false,
    refId: args.refId,
    dateField: "actionPlanAt",
    noteField: "actionPlanNote",
    stepCode: null,
    actionItemSource: null,
    contractorId: null,
    contractorName: null,
    contractorPlannedDate: null,
    contractorOverdue: false,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function buildPhaseStepTasks(department: Department | null): Promise<UnifiedTask[]> {
  const steps = await prisma.phaseStep.findMany({
    where: {
      status: { not: "completed" },
      // 2A/2D1/2F are derived from procurement_items — never independently actionable, and
      // their own sub-parts already surface as procurement_stage rows below. 3A/3B are the same
      // idea for the glass PO tracker. Showing both would just duplicate the same work twice.
      stepCode: { notIn: [...DERIVED_STEP_CODES, "3A", "3B"] },
      ...(department ? { OR: [{ owningDepartment: department }, { secondaryDepartment: department }] } : {}),
    },
    include: {
      project: { select: { id: true, name: true, client: { select: { name: true } } } },
      contractor: { select: { id: true, name: true } },
    },
  });

  const tasks: UnifiedTask[] = [];
  for (const step of steps) {
    let gateBlockedBy: string[] | null = null;
    if (step.status === "not_started" || step.status === "in_progress") {
      const gate = await checkDependencyGate(step.id);
      // Names ("Site measurement & drawing"), not codes ("3C1") — this only ever feeds the
      // "Waiting on: …" hint on TaskTable, which is meant to read as prose.
      gateBlockedBy = gate.allowed ? [] : gate.blockedByLabels;
    }
    // A not_started step still waiting on an incomplete dependency isn't real work for this
    // department *yet* — it can't be started or completed until that gate clears, so it isn't
    // a task to act on today. Once it's actually reachable (gate clears, so it auto-starts —
    // see autoStartStep in step-actions.ts) or someone reports it blocked, it shows up same as
    // any other task. Same "don't show what isn't actionable yet" principle as procurement's
    // firstUnfilledStage, just enforced here instead of structurally.
    if (step.status === "not_started" && gateBlockedBy && gateBlockedBy.length > 0) {
      continue;
    }

    let contractorPlannedDate: Date | null = null;
    if (MANUAL_CONTRACTOR_STEP_CODES.has(step.stepCode)) {
      const s = await getRequirementCreatedStatus(step.projectId);
      contractorPlannedDate = s.items.find((i) => i.itemType === "section")?.requirementCreatedAt ?? null;
    }

    tasks.push({
      id: `phase_step:${step.id}`,
      kind: "phase_step",
      phase: step.phase,
      // No stepCode prefix here — the UI (TaskTable) already renders task.stepCode as its own
      // badge next to this label; including it in both produced a visible "1D 1D Revised..." duplication.
      taskLabel: step.stepName,
      subTaskLabel: null,
      project: step.project,
      department: step.owningDepartment,
      secondaryDepartment: step.secondaryDepartment,
      status: step.status,
      plannedDate: step.plannedEndDate?.toISOString() ?? null,
      actualDate: step.actualEndDate?.toISOString() ?? null,
      overrun: isStepOverrun(step.plannedEndDate, step.status),
      qcPassed: step.qcPassed,
      notes: step.notes,
      blockedReason: step.blockedReason,
      blockedNote: step.blockedNote,
      gateBlockedBy,
      isPassFail: step.stepCode === "3E",
      refId: step.id,
      dateField: null,
      noteField: null,
      stepCode: step.stepCode,
      actionItemSource: null,
      contractorId: step.contractorId,
      contractorName: step.contractor?.name ?? null,
      contractorPlannedDate: contractorPlannedDate?.toISOString() ?? null,
      contractorOverdue: isContractorSelectionOverdue(contractorPlannedDate, step.contractorId),
    });
  }
  return tasks;
}

async function buildProcurementStageTasks(department: Department | null): Promise<UnifiedTask[]> {
  const items = await prisma.procurementItem.findMany({
    where: {
      project: { currentPhase: { not: "phase_1" } }, // day-one rows exist before anyone can act on them — see getProjectActiveDepartments
    },
    include: { project: { select: { id: true, name: true, client: { select: { name: true } }, phaseSteps: { where: { stepCode: "1D" }, select: { plannedEndDate: true, actualEndDate: true, delayCategory: true } } } } },
  });

  const itemsByProject = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByProject.get(item.projectId) ?? [];
    list.push(item);
    itemsByProject.set(item.projectId, list);
  }

  const tasks: UnifiedTask[] = [];
  for (const [, projectItems] of itemsByProject) {
    const oneD = projectItems[0]?.project.phaseSteps[0];
    const phase2PlanAnchor = oneD
      ? computePhase2PlanAnchor(oneD.plannedEndDate, oneD.actualEndDate, oneD.delayCategory)
      : null;
    const sectionItem = projectItems.find((i) => i.itemType === "section");
    const sectionQCPlanned = sectionItem
      ? computeSectionQCPlanned(sectionItem, phase2PlanAnchor)
      : null;

    for (const item of projectItems) {
      const stage = firstUnfilledStage(item, PROCUREMENT_STAGES[item.itemType]);
      const project = { id: item.project.id, name: item.project.name, client: item.project.client };
      const itemLabel = capitalize(item.itemType);

      if (stage) {
        if (department && stage.department !== department && stage.secondaryDepartment !== department) continue;
        const planned = computeAllProcurementPlannedDates(item, phase2PlanAnchor, sectionQCPlanned);
        const plannedByField: Record<string, Date | null> = {
          requirementCreatedAt: planned.requirement,
          quoteCreatedAt: planned.quote,
          paymentSettledAt: planned.payment,
          orderConfirmedAt: planned.order,
          materialDespatchAt: planned.materialDespatch,
          arrivedForPowderCoatingAt: planned.arrivedForPowderCoating,
          actualArrivalDate: planned.arrival,
          qcCheckedAt: planned.qc,
        };
        tasks.push(
          buildStageTask({
            kind: "procurement_stage",
            phase: "phase_2",
            refId: item.id,
            itemLabel,
            stage: stage as StageSpec<Record<string, unknown>>,
            plannedDate: plannedByField[String(stage.field)] ?? null,
            actualDate: null,
            project,
          })
        );
      } else if (item.qcPassed === false && !item.actionPlanAt && item.qcCheckedAt) {
        if (department && department !== "purchase") continue;
        tasks.push(
          buildActionPlanTask({
            kind: "procurement_stage",
            phase: "phase_2",
            refId: item.id,
            itemLabel,
            qcCheckedAt: item.qcCheckedAt,
            project,
          })
        );
      }
    }
  }
  return tasks;
}

// Glass PO's own full stage sequence, including Actual arrival + QC checked — deliberately
// separate from GLASS_PO_STAGES in project-filters.ts (which only carries the first 4, enough
// for the "currently with" filter's own needs) rather than widening that shared list and risking
// its existing behavior/tests. See page.tsx's own glassStages array, which this mirrors.
// Exported for the department-KPI lib (department-kpi.ts), which scores each of these stages'
// completion against its planned date the same way this file surfaces the next one as a task.
export const GLASS_PO_FULL_STAGES: StageSpec<Record<string, unknown>>[] = [
  { field: "requirementCreatedAt", department: "design_engineer" },
  { field: "quoteCreatedAt", department: "purchase" },
  { field: "paymentSettledAt", department: "accounts", secondaryDepartment: "purchase" },
  { field: "orderConfirmedAt", department: "purchase" },
  { field: "actualArrivalDate", department: "purchase" },
  { field: "qcCheckedAt", department: "purchase" },
];

async function buildGlassPOStageTasks(department: Department | null): Promise<UnifiedTask[]> {
  const rows = await prisma.glassPurchaseOrder.findMany({
    include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
  });

  const tasks: UnifiedTask[] = [];
  for (const po of rows) {
    const stage = firstUnfilledStage(po as unknown as Record<string, unknown>, GLASS_PO_FULL_STAGES);
    const project = { id: po.project.id, name: po.project.name, client: po.project.client };

    if (stage) {
      if (department && stage.department !== department && stage.secondaryDepartment !== department) continue;
      const plannedByField: Record<string, Date | null> = {
        requirementCreatedAt: po.requirementPlannedDate,
        quoteCreatedAt: po.quotePlannedDate,
        paymentSettledAt: po.paymentPlannedDate,
        orderConfirmedAt: po.orderPlannedDate,
        actualArrivalDate: po.arrivalPlannedDate,
        qcCheckedAt: po.qcPlannedDate,
      };
      tasks.push(
        buildStageTask({
          kind: "glass_po_stage",
          phase: "phase_3",
          refId: po.id,
          itemLabel: "Glass PO",
          stage,
          plannedDate: plannedByField[String(stage.field)] ?? null,
          actualDate: null,
          project,
        })
      );
    } else if (po.qcPassed === false && !po.actionPlanAt && po.qcCheckedAt) {
      if (department && department !== "purchase") continue;
      tasks.push(
        buildActionPlanTask({
          kind: "glass_po_stage",
          phase: "phase_3",
          refId: po.id,
          itemLabel: "Glass PO",
          qcCheckedAt: po.qcCheckedAt,
          project,
        })
      );
    }
  }
  return tasks;
}

async function buildActionItemTasks(department: Department | null): Promise<UnifiedTask[]> {
  const [procurementItems, glassItems, phaseStepItems] = await Promise.all([
    prisma.procurementActionItem.findMany({
      where: { actualDate: null, ...(department ? { department } : {}) },
      include: {
        procurementItem: {
          select: { itemType: true, project: { select: { id: true, name: true, client: { select: { name: true } } } } },
        },
      },
    }),
    prisma.glassActionItem.findMany({
      where: { actualDate: null, ...(department ? { department } : {}) },
      include: {
        glassPurchaseOrder: { select: { project: { select: { id: true, name: true, client: { select: { name: true } } } } } },
      },
    }),
    prisma.phaseStepActionItem.findMany({
      where: { actualDate: null, ...(department ? { department } : {}) },
      include: {
        phaseStep: {
          select: { stepCode: true, project: { select: { id: true, name: true, client: { select: { name: true } } } } },
        },
      },
    }),
  ]);

  const tasks: UnifiedTask[] = [];

  for (const a of procurementItems) {
    tasks.push({
      id: `action_item:procurement:${a.id}`,
      kind: "action_item",
      phase: "phase_2",
      taskLabel: a.taskLabel,
      subTaskLabel: `${capitalize(a.procurementItem.itemType)} — action plan`,
      project: a.procurementItem.project,
      department: a.department,
      secondaryDepartment: null,
      status: "not_started",
      plannedDate: a.plannedDate.toISOString(),
      actualDate: null,
      overrun: isProcurementStageOverrun(a.plannedDate, null),
      qcPassed: a.qcPassed,
      notes: a.note,
      blockedReason: null,
      blockedNote: null,
      gateBlockedBy: null,
      isPassFail: a.isPassFail,
      refId: a.id,
      dateField: "actualDate",
      noteField: "note",
      stepCode: null,
      actionItemSource: "procurement",
      contractorId: null,
      contractorName: null,
      contractorPlannedDate: null,
      contractorOverdue: false,
    });
  }

  for (const a of glassItems) {
    tasks.push({
      id: `action_item:glass:${a.id}`,
      kind: "action_item",
      phase: "phase_3",
      taskLabel: a.taskLabel,
      subTaskLabel: "Glass PO — action plan",
      project: a.glassPurchaseOrder.project,
      department: a.department,
      secondaryDepartment: null,
      status: "not_started",
      plannedDate: a.plannedDate.toISOString(),
      actualDate: null,
      overrun: isProcurementStageOverrun(a.plannedDate, null),
      qcPassed: a.qcPassed,
      notes: a.note,
      blockedReason: null,
      blockedNote: null,
      gateBlockedBy: null,
      isPassFail: a.isPassFail,
      refId: a.id,
      dateField: "actualDate",
      noteField: "note",
      stepCode: null,
      actionItemSource: "glass",
      contractorId: null,
      contractorName: null,
      contractorPlannedDate: null,
      contractorOverdue: false,
    });
  }

  for (const a of phaseStepItems) {
    tasks.push({
      id: `action_item:phase_step:${a.id}`,
      kind: "action_item",
      phase: "phase_3", // only ever created under 3E in practice
      taskLabel: a.taskLabel,
      subTaskLabel: `${a.phaseStep.stepCode} — action plan`,
      project: a.phaseStep.project,
      department: a.department,
      secondaryDepartment: null,
      status: "not_started",
      plannedDate: a.plannedDate.toISOString(),
      actualDate: null,
      overrun: isProcurementStageOverrun(a.plannedDate, null),
      qcPassed: a.qcPassed,
      notes: a.note,
      blockedReason: null,
      blockedNote: null,
      gateBlockedBy: null,
      isPassFail: a.isPassFail,
      refId: a.id,
      dateField: "actualDate",
      noteField: "note",
      stepCode: null,
      actionItemSource: "phase_step",
      contractorId: null,
      contractorName: null,
      contractorPlannedDate: null,
      contractorOverdue: false,
    });
  }

  return tasks;
}

/**
 * A service's own flat work-item list (see ServiceItem/ServiceTracker.tsx) — structurally the
 * same "one date field + one note field, optional pass/fail" shape as the 3 action-item tables
 * above, just scoped to a Service instead of a Project. Excludes items under a service that's
 * already been explicitly marked completed (see getServiceStatus's "never inferred from items"
 * rule) — once an admin has closed a service out, its stray unfinished rows shouldn't keep
 * nagging a department that no longer has anything to act on.
 */
async function buildServiceItemTasks(department: Department | null): Promise<UnifiedTask[]> {
  const items = await prisma.serviceItem.findMany({
    where: {
      actualDate: null,
      service: { completedAt: null },
      ...(department ? { department } : {}),
    },
    include: { service: { select: { id: true, title: true, client: { select: { name: true } } } } },
  });

  return items.map((item) => ({
    id: `service_item:${item.id}`,
    kind: "service_item" as const,
    phase: "service" as const,
    taskLabel: item.taskLabel,
    subTaskLabel: null,
    project: { id: item.service.id, name: item.service.title, client: item.service.client },
    department: item.department,
    secondaryDepartment: null,
    status: "not_started" as const,
    plannedDate: item.plannedDate.toISOString(),
    actualDate: null,
    overrun: isProcurementStageOverrun(item.plannedDate, null),
    qcPassed: item.qcPassed,
    notes: item.note,
    blockedReason: null,
    blockedNote: null,
    gateBlockedBy: null,
    isPassFail: item.isPassFail,
    refId: item.id,
    dateField: "actualDate",
    noteField: "note",
    stepCode: null,
    actionItemSource: null,
    contractorId: null,
    contractorName: null,
    contractorPlannedDate: null,
    contractorOverdue: false,
  }));
}

/**
 * Every open task a department (or everyone, for owner_admin/HR & Admin — see /my-tasks) needs
 * to act on, across every project — not just PhaseStep rows (getMyTasks' own scope) but each
 * procurement item's and the glass PO's own *next* unfilled stage, and any custom follow-up
 * (action-item) rows still open. This is what actually matches a department's day-to-day work:
 * Purchase's real queue lives almost entirely in the granular procurement/glass-PO stages, which
 * getMyTasks never surfaced (its own 2A/2D1/2F rows are just auto-computed summaries of exactly
 * this data) — see the /my-tasks table redesign this was built for. Service work-items (a
 * separate, project-less lifecycle — see Service/ServiceItem) are included the same way.
 *
 * Sorted by planned date ascending, nulls last — the earliest-due (including anything already
 * overdue) always sorts first, with no separate "overdue" tier needed on top of that.
 */
export async function getUnifiedMyTasks(department: Department | null): Promise<UnifiedTask[]> {
  const [phaseSteps, procurementStages, glassPOStages, actionItems, serviceItems] = await Promise.all([
    buildPhaseStepTasks(department),
    buildProcurementStageTasks(department),
    buildGlassPOStageTasks(department),
    buildActionItemTasks(department),
    buildServiceItemTasks(department),
  ]);

  const all = [...phaseSteps, ...procurementStages, ...glassPOStages, ...actionItems, ...serviceItems];
  return all.sort((a, b) => {
    if (a.plannedDate === null && b.plannedDate === null) return 0;
    if (a.plannedDate === null) return 1;
    if (b.plannedDate === null) return -1;
    return a.plannedDate.localeCompare(b.plannedDate);
  });
}
