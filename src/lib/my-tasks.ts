import type { Department } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkDependencyGate } from "@/lib/dependency-gate";
import { getRequirementCreatedStatus, getMaterialsArrivedStatus, getMaterialQCStatus } from "@/lib/procurement";
import { isStepOverrun, daysBlocked } from "@/lib/overrun";
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
  notes: string | null;
  project: { id: string; name: string; clientName: string };
  overrun: boolean;
  daysBlocked: number | null;
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
      derivedSummary = s.items.map((i) => ({ itemType: i.itemType, done: i.qcChecked }));
    }

    let gateBlockedBy: string[] | null = null;
    if (!isDerived && (step.status === "not_started" || step.status === "in_progress")) {
      const gate = await checkDependencyGate(step.id);
      gateBlockedBy = gate.allowed ? [] : gate.blockedBy;
    }

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
      notes: step.notes,
      project: step.project,
      overrun: isStepOverrun(step.plannedEndDate, step.status),
      daysBlocked: step.status === "blocked" ? daysBlocked(step.updatedAt) : null,
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
