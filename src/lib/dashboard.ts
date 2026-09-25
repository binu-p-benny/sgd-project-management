import { prisma } from "@/lib/prisma";
import { isProcurementItemOverrun, isStepOverrun, getEffectiveOverallStatus, projectHasOverrun } from "@/lib/overrun";
import { withLiveExpectedArrivalDates } from "@/lib/procurement";

// Reused across every query below that needs projectHasOverrun's Glass PO argument — see its own
// doc comment in overrun.ts for why these (unlike a ProcurementItem's other stages) are cheap:
// real stored columns, not a computed anchor chain.
export const GLASS_PO_OVERRUN_SELECT = {
  requirementCreatedAt: true,
  requirementPlannedDate: true,
  quoteCreatedAt: true,
  quotePlannedDate: true,
  paymentSettledAt: true,
  paymentPlannedDate: true,
  orderConfirmedAt: true,
  orderPlannedDate: true,
  actualArrivalDate: true,
  arrivalPlannedDate: true,
  qcCheckedAt: true,
  qcPlannedDate: true,
} as const;

// A ProcurementItem's full override/actual chain — everything withLiveExpectedArrivalDates
// needs to compute each item's *entire* live stage-by-stage lifecycle (see its own doc comment
// in procurement.ts), reused across every query below that used to select just
// {expectedArrivalDate, actualArrivalDate} — that frozen legacy column, and arrival-only scope,
// both drift from what the procurement tracker itself displays as items actually progress.
export const PROCUREMENT_ITEM_OVERRUN_SELECT = {
  itemType: true,
  requirementCreatedAt: true,
  quoteCreatedAt: true,
  paymentSettledAt: true,
  actualArrivalDate: true,
  qcCheckedAt: true,
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
} as const;
import { getServiceStatus, type ServiceStatus } from "@/lib/service";
import type { Department, ItemType, OverallStatus, PaymentStatus, ProjectPhase, StepStatus } from "@prisma/client";

// Fixed across every project regardless of which phases have been seeded so far
// (phase 2/3 steps don't exist in the DB until the prior phase gate completes) —
// so progress-toward-completion has to divide by this constant, not by
// `phaseSteps.length`, or an early-phase project reads as artificially "done".
const TOTAL_STEPS_PER_PROJECT = 14;

export interface PhaseStatusCell {
  phase: ProjectPhase;
  status: OverallStatus;
  count: number;
}

export async function getPhaseStatusSummary(): Promise<PhaseStatusCell[]> {
  // Can't group by overallStatus in SQL — `delayed` is computed (date-driven), not
  // a value ever stored in the column. See overrun.ts.
  const projects = await prisma.project.findMany({
    select: {
      currentPhase: true,
      overallStatus: true,
      phaseSteps: { select: { plannedEndDate: true, status: true, stepCode: true, actualEndDate: true, delayCategory: true } },
      procurementItems: { select: PROCUREMENT_ITEM_OVERRUN_SELECT },
      glassPurchaseOrder: { select: GLASS_PO_OVERRUN_SELECT },
    },
  });

  const counts = new Map<string, number>();
  for (const p of projects) {
    const oneD = p.phaseSteps.find((s) => s.stepCode === "1D");
    const status = getEffectiveOverallStatus(
      p.overallStatus,
      projectHasOverrun(p.phaseSteps, withLiveExpectedArrivalDates(p.procurementItems, oneD), p.glassPurchaseOrder)
    );
    const key = `${p.currentPhase}::${status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([key, count]) => {
    const [phase, status] = key.split("::") as [ProjectPhase, OverallStatus];
    return { phase, status, count };
  });
}

export interface ProjectSituationCounts {
  total: number;
  onTrack: number;
  delayed: number;
  blocked: number;
  completed: number;
  newLast30Days: number;
  overdueSteps: number;
  paymentPending: number;
}

/** The at-a-glance stat-tile row above the charts — project counts by situation. */
export async function getProjectSituationCounts(): Promise<ProjectSituationCounts> {
  const projects = await prisma.project.findMany({
    select: {
      createdAt: true,
      overallStatus: true,
      paymentStatus: true,
      phaseSteps: { select: { plannedEndDate: true, status: true, stepCode: true, actualEndDate: true, delayCategory: true } },
      procurementItems: { select: PROCUREMENT_ITEM_OVERRUN_SELECT },
      glassPurchaseOrder: { select: GLASS_PO_OVERRUN_SELECT },
    },
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const counts: ProjectSituationCounts = {
    total: projects.length,
    onTrack: 0,
    delayed: 0,
    blocked: 0,
    completed: 0,
    newLast30Days: 0,
    overdueSteps: 0,
    paymentPending: 0,
  };

  for (const p of projects) {
    const oneD = p.phaseSteps.find((s) => s.stepCode === "1D");
    const status = getEffectiveOverallStatus(
      p.overallStatus,
      projectHasOverrun(p.phaseSteps, withLiveExpectedArrivalDates(p.procurementItems, oneD), p.glassPurchaseOrder)
    );
    if (status === "on_track") counts.onTrack += 1;
    else if (status === "delayed") counts.delayed += 1;
    else if (status === "blocked") counts.blocked += 1;
    else if (status === "completed") counts.completed += 1;

    if (p.createdAt >= thirtyDaysAgo) counts.newLast30Days += 1;
    if (p.paymentStatus === "pending") counts.paymentPending += 1;

    for (const step of p.phaseSteps) {
      if (isStepOverrun(step.plannedEndDate, step.status)) counts.overdueSteps += 1;
    }
  }

  return counts;
}

export interface BlockedStepRow {
  stepId: string;
  stepCode: string;
  stepName: string;
  projectId: string;
  projectName: string;
  blockedReason: string | null;
  blockedNote: string | null;
  daysBlocked: number;
  blockedAt: Date;
}

export async function getBlockedStepsSorted(): Promise<BlockedStepRow[]> {
  const steps = await prisma.phaseStep.findMany({
    where: { status: "blocked" },
    include: { project: { select: { id: true, name: true } } },
  });

  const msPerDay = 1000 * 60 * 60 * 24;
  const rows: BlockedStepRow[] = [];

  for (const step of steps) {
    const lastBlockLog = await prisma.stepStatusLog.findFirst({
      where: { phaseStepId: step.id, newStatus: "blocked" },
      orderBy: { changedAt: "desc" },
    });
    const blockedAt = lastBlockLog?.changedAt ?? step.updatedAt;

    rows.push({
      stepId: step.id,
      stepCode: step.stepCode,
      stepName: step.stepName,
      projectId: step.project.id,
      projectName: step.project.name,
      blockedReason: step.blockedReason,
      blockedNote: step.blockedNote,
      daysBlocked: Math.floor((Date.now() - blockedAt.getTime()) / msPerDay),
      blockedAt,
    });
  }

  return rows.sort((a, b) => b.daysBlocked - a.daysBlocked);
}

export interface DurationVarianceRow {
  stepCode: string;
  sampleSize: number;
  avgPlannedDays: number;
  avgActualDays: number;
  varianceDays: number;
}

export async function getDurationVariance(): Promise<DurationVarianceRow[]> {
  const steps = await prisma.phaseStep.findMany({
    where: {
      status: "completed",
      actualStartDate: { not: null },
      actualEndDate: { not: null },
      plannedDurationDays: { not: null },
    },
    select: { stepCode: true, plannedDurationDays: true, actualStartDate: true, actualEndDate: true },
  });

  const byCode = new Map<string, { plannedTotal: number; actualTotal: number; n: number }>();
  const msPerDay = 1000 * 60 * 60 * 24;

  for (const s of steps) {
    const actualDays = (s.actualEndDate!.getTime() - s.actualStartDate!.getTime()) / msPerDay;
    const entry = byCode.get(s.stepCode) ?? { plannedTotal: 0, actualTotal: 0, n: 0 };
    entry.plannedTotal += s.plannedDurationDays!;
    entry.actualTotal += actualDays;
    entry.n += 1;
    byCode.set(s.stepCode, entry);
  }

  return Array.from(byCode.entries())
    .map(([stepCode, { plannedTotal, actualTotal, n }]) => {
      const avgPlannedDays = plannedTotal / n;
      const avgActualDays = actualTotal / n;
      return {
        stepCode,
        sampleSize: n,
        avgPlannedDays: Math.round(avgPlannedDays * 10) / 10,
        avgActualDays: Math.round(avgActualDays * 10) / 10,
        varianceDays: Math.round((avgActualDays - avgPlannedDays) * 10) / 10,
      };
    })
    .sort((a, b) => b.varianceDays - a.varianceDays);
}

export interface DepartmentWorkloadRow {
  department: Department;
  openCount: number;
}

export async function getDepartmentWorkload(): Promise<DepartmentWorkloadRow[]> {
  const rows = await prisma.phaseStep.groupBy({
    by: ["owningDepartment"],
    where: { status: { not: "completed" } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ department: r.owningDepartment, openCount: r._count._all }))
    .sort((a, b) => b.openCount - a.openCount);
}

export interface PaymentStatusRow {
  status: PaymentStatus;
  count: number;
  totalFinalCost: number;
  totalReceived: number;
}

export async function getPaymentStatusSummary(): Promise<PaymentStatusRow[]> {
  const projects = await prisma.project.findMany({
    select: { paymentStatus: true, finalCost: true, amountReceived: true },
  });

  const byStatus = new Map<PaymentStatus, { count: number; finalCost: number; received: number }>();
  for (const p of projects) {
    const entry = byStatus.get(p.paymentStatus) ?? { count: 0, finalCost: 0, received: 0 };
    entry.count += 1;
    entry.finalCost += Number(p.finalCost);
    entry.received += Number(p.amountReceived);
    byStatus.set(p.paymentStatus, entry);
  }

  const order: PaymentStatus[] = ["pending", "partial", "received"];
  return order.map((status) => {
    const entry = byStatus.get(status) ?? { count: 0, finalCost: 0, received: 0 };
    return { status, count: entry.count, totalFinalCost: entry.finalCost, totalReceived: entry.received };
  });
}

export interface ProcurementDelayRow {
  itemType: ItemType;
  totalCount: number;
  overrunCount: number;
  overrunRate: number;
}

export async function getProcurementDelayBreakdown(): Promise<ProcurementDelayRow[]> {
  const items = await prisma.procurementItem.findMany({
    select: {
      projectId: true,
      ...PROCUREMENT_ITEM_OVERRUN_SELECT,
      project: {
        select: { phaseSteps: { where: { stepCode: "1D" }, select: { plannedEndDate: true, actualEndDate: true, delayCategory: true } } },
      },
    },
  });

  // Grouped by project, same as unified-tasks.ts' buildProcurementStageTasks — sibling items in
  // the same project share one 1D-derived anchor (see withLiveExpectedArrivalDates), so it's
  // resolved once per project rather than once per item.
  const itemsByProject = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByProject.get(item.projectId) ?? [];
    list.push(item);
    itemsByProject.set(item.projectId, list);
  }

  const byType = new Map<ItemType, { total: number; overrun: number }>();
  for (const [, projectItems] of itemsByProject) {
    const oneD = projectItems[0]?.project.phaseSteps[0];
    for (const item of withLiveExpectedArrivalDates(projectItems, oneD)) {
      const entry = byType.get(item.itemType) ?? { total: 0, overrun: 0 };
      entry.total += 1;
      if (isProcurementItemOverrun(item.expectedArrivalDate, item.actualArrivalDate)) entry.overrun += 1;
      byType.set(item.itemType, entry);
    }
  }

  const order: ItemType[] = ["section", "hardware", "gasket"];
  return order.map((itemType) => {
    const entry = byType.get(itemType) ?? { total: 0, overrun: 0 };
    return {
      itemType,
      totalCount: entry.total,
      overrunCount: entry.overrun,
      overrunRate: entry.total > 0 ? Math.round((entry.overrun / entry.total) * 100) : 0,
    };
  });
}

export interface RecentActivityRow {
  id: string;
  stepCode: string;
  stepName: string;
  projectId: string;
  projectName: string;
  department: Department;
  oldStatus: StepStatus;
  newStatus: StepStatus;
  changedByName: string;
  reason: string | null;
  changedAt: Date;
}

export interface RecentActivityPage {
  rows: RecentActivityRow[];
  nextCursor: string | null;
}

/**
 * Most recent step status transitions across every project, newest first, cursor-paged
 * by log id. `changedAt` alone isn't a stable sort key — batch operations (like reschedule)
 * can write several logs with the same timestamp — so ordering and the cursor both include
 * `id` as a tiebreaker.
 */
export async function getRecentActivity(options: { limit?: number; cursor?: string } = {}): Promise<RecentActivityPage> {
  const limit = options.limit ?? 15;
  const logs = await prisma.stepStatusLog.findMany({
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: {
      phaseStep: {
        select: {
          stepCode: true,
          stepName: true,
          owningDepartment: true,
          project: { select: { id: true, name: true } },
        },
      },
      changedByUser: { select: { name: true } },
    },
  });

  const hasMore = logs.length > limit;
  const page = hasMore ? logs.slice(0, limit) : logs;

  return {
    rows: page.map((log) => ({
      id: log.id,
      stepCode: log.phaseStep.stepCode,
      stepName: log.phaseStep.stepName,
      projectId: log.phaseStep.project.id,
      projectName: log.phaseStep.project.name,
      department: log.phaseStep.owningDepartment,
      oldStatus: log.oldStatus,
      newStatus: log.newStatus,
      changedByName: log.changedByUser.name,
      reason: log.reason,
      changedAt: log.changedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export interface ProjectProgressRow {
  projectId: string;
  projectName: string;
  phase: ProjectPhase;
  effectiveStatus: OverallStatus;
  completedSteps: number;
  percentComplete: number;
}

export interface ProjectProgressPage {
  rows: ProjectProgressRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/**
 * Active (non-completed) projects ranked by how much of the fixed 14-step lifecycle
 * is done, least progress first — a quick "who's earliest in the pipeline / most at
 * risk of falling further behind" view. Page-based (not cursor-based) since the full
 * ranking is cheap to recompute and a viewer may want to step back and forth.
 */
export async function getProjectProgressList(
  options: { page?: number; pageSize?: number } = {}
): Promise<ProjectProgressPage> {
  const pageSize = options.pageSize ?? 5;

  const projects = await prisma.project.findMany({
    where: { overallStatus: { not: "completed" } },
    select: {
      id: true,
      name: true,
      currentPhase: true,
      overallStatus: true,
      phaseSteps: { select: { status: true, plannedEndDate: true, stepCode: true, actualEndDate: true, delayCategory: true } },
      procurementItems: { select: PROCUREMENT_ITEM_OVERRUN_SELECT },
      glassPurchaseOrder: { select: GLASS_PO_OVERRUN_SELECT },
    },
  });

  const rows: ProjectProgressRow[] = projects.map((p) => {
    const completedSteps = p.phaseSteps.filter((s) => s.status === "completed").length;
    const oneD = p.phaseSteps.find((s) => s.stepCode === "1D");
    const effectiveStatus = getEffectiveOverallStatus(
      p.overallStatus,
      projectHasOverrun(p.phaseSteps, withLiveExpectedArrivalDates(p.procurementItems, oneD), p.glassPurchaseOrder)
    );
    return {
      projectId: p.id,
      projectName: p.name,
      phase: p.currentPhase,
      effectiveStatus,
      completedSteps,
      percentComplete: Math.round((completedSteps / TOTAL_STEPS_PER_PROJECT) * 100),
    };
  });

  const sorted = rows.sort((a, b) => a.percentComplete - b.percentComplete);
  const totalCount = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(1, options.page ?? 1), totalPages);
  const start = (page - 1) * pageSize;

  return { rows: sorted.slice(start, start + pageSize), page, pageSize, totalCount, totalPages };
}

export interface UpcomingStepRow {
  stepId: string;
  stepCode: string;
  stepName: string;
  projectId: string;
  projectName: string;
  department: Department;
  plannedEndDate: Date;
  daysRemaining: number;
}

/**
 * Not-yet-overdue steps due within the next 7 days — a forward-looking companion to
 * the "Overdue steps" alert tile, which only looks backward. Blocked steps are
 * excluded: their planned date isn't a real target until they're unblocked.
 */
export async function getStepsDueThisWeek(limit = 15): Promise<UpcomingStepRow[]> {
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const steps = await prisma.phaseStep.findMany({
    where: {
      status: { in: ["not_started", "in_progress"] },
      plannedEndDate: { gte: now, lte: weekOut },
    },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { plannedEndDate: "asc" },
    take: limit,
  });

  const msPerDay = 1000 * 60 * 60 * 24;
  return steps.map((step) => ({
    stepId: step.id,
    stepCode: step.stepCode,
    stepName: step.stepName,
    projectId: step.project.id,
    projectName: step.project.name,
    department: step.owningDepartment,
    plannedEndDate: step.plannedEndDate!,
    daysRemaining: Math.ceil((step.plannedEndDate!.getTime() - now.getTime()) / msPerDay),
  }));
}

export type ServiceOverview = { total: number } & Record<ServiceStatus, number>;

/** Service counts by status, same "compute at read time" status as the services list itself
 *  (see getServiceStatus) — services have no phase/procurement machinery, so this is the whole
 *  overview rather than one slice of it. */
export async function getServiceOverview(): Promise<ServiceOverview> {
  const services = await prisma.service.findMany({
    select: {
      completedAt: true,
      reviewCompletedAt: true,
      items: { select: { plannedDate: true, actualDate: true } },
    },
  });

  const counts: ServiceOverview = {
    total: services.length,
    not_started: 0,
    in_progress: 0,
    delayed: 0,
    completed: 0,
    review_not_completed: 0,
  };

  for (const s of services) {
    counts[getServiceStatus(s.items, s.completedAt, s.reviewCompletedAt)] += 1;
  }

  return counts;
}
