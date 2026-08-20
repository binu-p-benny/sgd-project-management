import type { Department } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkDependencyGate } from "@/lib/dependency-gate";
import { getRequirementCreatedStatus, getMaterialsArrivedStatus, getMaterialQCStatus } from "@/lib/procurement";
import { isStepOverrun, daysBlocked } from "@/lib/overrun";
import { findUpstreamDelay, type DelayGraphNode } from "@/lib/reschedule";
import { DERIVED_STEP_CODES } from "@/lib/step-actions";

export interface MyTaskItem {
  id: string;
  stepCode: string;
  stepName: string;
  phase: string;
  owningDepartment: Department;
  secondaryDepartment: Department | null;
  status: "not_started" | "in_progress" | "blocked" | "completed";
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  blockedReason: string | null;
  blockedNote: string | null;
  delayCategory: string | null;
  notes: string | null;
  project: { id: string; name: string; clientName: string };
  overrun: boolean;
  daysBlocked: number | null;
  // Distinct times the overdue cron has flagged this step, and the most recent one — from
  // Notification rows (type step_overdue), which persist even after the step catches up or
  // notified_overdue_at gets cleared by a reschedule. 0/null means it's never slipped.
  timesOverdue: number;
  lastOverdueAt: string | null;
  // Set when a step somewhere upstream of this one (not necessarily a direct dependency)
  // completed late with a delay_category — explains why this step's own planned finish did or
  // didn't move (see reschedule.ts): in_house freezes the chain at what was first computed,
  // client_side lets it shift with the late actual end as normal.
  upstreamDelay: { stepCode: string; category: string } | null;
  isDerived: boolean;
  derivedSummary: { itemType: string; done: boolean }[] | null;
  gateBlockedBy: string[] | null;
}

export interface GetMyTasksOptions {
  /** Scope to one project (e.g. its full step timeline) instead of across all projects. */
  projectId?: string;
  /** Include completed steps too — off by default since /my-tasks and /admin only care about open work. */
  includeCompleted?: boolean;
  /** 'priority' (blocked/overdue first — the daily-use default) or 'stepCode' (natural workflow order, for viewing one project's whole timeline). */
  sortBy?: "priority" | "stepCode";
}

/** Full data set for the /my-tasks, /admin, and project-detail-timeline screens: steps
 * enriched with overrun flags, blocked-duration, and (for not_started/in_progress)
 * whether their dependency gate is currently satisfied — so the UI can explain why
 * "Start" is disabled instead of making the user find out by trial and error. */
export async function getMyTasks(
  department: Department | null,
  options: GetMyTasksOptions = {}
): Promise<MyTaskItem[]> {
  const { projectId, includeCompleted = false, sortBy = "priority" } = options;

  const steps = await prisma.phaseStep.findMany({
    where: {
      ...(includeCompleted ? {} : { status: { not: "completed" } }),
      ...(projectId ? { projectId } : {}),
      ...(department
        ? { OR: [{ owningDepartment: department }, { secondaryDepartment: department }] }
        : {}),
    },
    include: { project: { select: { id: true, name: true, clientName: true } } },
    orderBy: [{ updatedAt: "asc" }],
  });

  // Batched once for every step in this result set, rather than per-step: which of them have
  // ever been flagged overdue by the cron (see notify-overdue.ts). Notification rows for the
  // same overdue episode share one createdAt (Postgres's now() is stable within the createMany
  // transaction that wrote them), so grouping by exact timestamp counts distinct episodes
  // rather than one row per notified department.
  const overdueNotifications = steps.length
    ? await prisma.notification.findMany({
        where: { phaseStepId: { in: steps.map((s) => s.id) }, type: "step_overdue" },
        select: { phaseStepId: true, createdAt: true },
      })
    : [];
  const overdueHistoryByStep = new Map<string, Date[]>();
  for (const n of overdueNotifications) {
    if (!n.phaseStepId) continue;
    const list = overdueHistoryByStep.get(n.phaseStepId) ?? [];
    list.push(n.createdAt);
    overdueHistoryByStep.set(n.phaseStepId, list);
  }

  // Batched the same way: the full dependsOn/delay_category graph for every project referenced
  // here — needed to trace an upstream delay transitively (e.g. 2F depends on 2D1 depends on
  // 2A depends on 1D depends on 1C depends on 1B), not just one hop back. A department-filtered
  // call might not include every ancestor step in `steps` itself, so this is fetched separately
  // rather than reused from it. See findUpstreamDelay in reschedule.ts.
  const projectIds = [...new Set(steps.map((s) => s.projectId))];
  const allProjectSteps = projectIds.length
    ? await prisma.phaseStep.findMany({
        where: { projectId: { in: projectIds } },
        select: { projectId: true, stepCode: true, dependsOn: true, delayCategory: true },
      })
    : [];
  const graphNodesByProject = new Map<string, DelayGraphNode[]>();
  for (const s of allProjectSteps) {
    const list = graphNodesByProject.get(s.projectId) ?? [];
    list.push({ stepCode: s.stepCode, dependsOn: s.dependsOn, delayCategory: s.delayCategory });
    graphNodesByProject.set(s.projectId, list);
  }

  const items: MyTaskItem[] = [];

  for (const step of steps) {
    const isDerived = DERIVED_STEP_CODES.has(step.stepCode);

    let derivedSummary: MyTaskItem["derivedSummary"] = null;
    if (step.stepCode === "2A") {
      const s = await getRequirementCreatedStatus(step.projectId);
      derivedSummary = s.items.map((i) => ({ itemType: i.itemType, done: i.created }));
    } else if (step.stepCode === "2D1") {
      const s = await getMaterialsArrivedStatus(step.projectId);
      derivedSummary = s.items.map((i) => ({ itemType: i.itemType, done: i.arrived }));
    } else if (step.stepCode === "2F") {
      const s = await getMaterialQCStatus(step.projectId);
      // A failed item isn't "done" — checked-but-failed still needs correcting and
      // re-checking before it counts, same as the completion gate itself.
      derivedSummary = s.items.map((i) => ({ itemType: i.itemType, done: i.qcChecked && i.qcPassed === true }));
    }

    let gateBlockedBy: string[] | null = null;
    if (!isDerived && (step.status === "not_started" || step.status === "in_progress")) {
      const gate = await checkDependencyGate(step.id);
      gateBlockedBy = gate.allowed ? [] : gate.blockedBy;
    }

    const overdueDates = overdueHistoryByStep.get(step.id) ?? [];
    const timesOverdue = new Set(overdueDates.map((d) => d.getTime())).size;
    const lastOverdueAt =
      overdueDates.length > 0 ? new Date(Math.max(...overdueDates.map((d) => d.getTime()))) : null;

    const upstreamDelay = findUpstreamDelay(step.stepCode, graphNodesByProject.get(step.projectId) ?? []);

    items.push({
      id: step.id,
      stepCode: step.stepCode,
      stepName: step.stepName,
      phase: step.phase,
      owningDepartment: step.owningDepartment,
      secondaryDepartment: step.secondaryDepartment,
      status: step.status,
      plannedStartDate: step.plannedStartDate?.toISOString() ?? null,
      plannedEndDate: step.plannedEndDate?.toISOString() ?? null,
      actualStartDate: step.actualStartDate?.toISOString() ?? null,
      actualEndDate: step.actualEndDate?.toISOString() ?? null,
      blockedReason: step.blockedReason,
      blockedNote: step.blockedNote,
      delayCategory: step.delayCategory,
      notes: step.notes,
      project: step.project,
      overrun: isStepOverrun(step.plannedEndDate, step.status),
      daysBlocked: step.status === "blocked" ? daysBlocked(step.updatedAt) : null,
      timesOverdue,
      lastOverdueAt: lastOverdueAt?.toISOString() ?? null,
      upstreamDelay,
      isDerived,
      derivedSummary,
      gateBlockedBy,
    });
  }

  if (sortBy === "stepCode") {
    return items.sort((a, b) => a.stepCode.localeCompare(b.stepCode));
  }

  const priority = (item: MyTaskItem) => {
    if (item.status === "blocked") return 0;
    if (item.overrun) return 1;
    if (item.status === "in_progress") return 2;
    return 3; // not_started
  };

  return items.sort((a, b) => {
    const p = priority(a) - priority(b);
    if (p !== 0) return p;
    if (a.status === "blocked" && b.status === "blocked") {
      return (b.daysBlocked ?? 0) - (a.daysBlocked ?? 0);
    }
    return 0;
  });
}
