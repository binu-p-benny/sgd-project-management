import type { BlockedReason, StepStatus, VisitUrgency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkDependencyGate } from "@/lib/dependency-gate";
import { BLOCKED_REASON_LABELS } from "@/lib/labels";
import {
  buildPhase2Steps,
  buildPhase3Steps,
  computePlannedDates,
  deriveVisitDurationDays,
} from "@/lib/step-template";
import {
  createEmptyProcurementItemsForProject,
  getRequirementCreatedStatus,
  getMaterialsArrivedStatus,
  getMaterialQCStatus,
} from "@/lib/procurement";
import { rescheduleProjectDates } from "@/lib/reschedule";

// 2A, 2D1 and 2F are derived from procurement_items — never manually settable.
export const DERIVED_STEP_CODES = new Set(["2A", "2D1", "2F"]);

export class StepActionError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export interface UpdateStepStatusOptions {
  blockedReason?: BlockedReason;
  blockedNote?: string;
  notes?: string;
  visitUrgency?: VisitUrgency; // only meaningful when completing 1A
}

/** Recomputes 1B/1C/1D's planned dates after 1A completes and visit_urgency is known. */
async function applyVisitUrgency(projectId: string, visitUrgency: VisitUrgency, actorId: string) {
  const oneA = await prisma.phaseStep.findFirstOrThrow({
    where: { projectId, stepCode: "1A" },
  });
  const anchor = oneA.actualEndDate ?? new Date();

  await prisma.project.update({ where: { id: projectId }, data: { visitUrgency } });

  const oneB = await prisma.phaseStep.findFirstOrThrow({
    where: { projectId, stepCode: "1B" },
  });

  if (visitUrgency === "site_not_ready") {
    await prisma.phaseStep.update({
      where: { id: oneB.id },
      data: {
        status: "blocked",
        blockedReason: "site_not_ready",
        plannedDurationDays: null,
        plannedStartDate: anchor,
        plannedEndDate: null,
      },
    });
    await prisma.stepStatusLog.create({
      data: {
        phaseStepId: oneB.id,
        changedByUserId: actorId,
        oldStatus: oneB.status,
        newStatus: "blocked",
        reason: "Auto-blocked: site not ready (from visit_urgency on 1A)",
      },
    });
    return;
  }

  const duration = deriveVisitDurationDays(visitUrgency);
  const remainingTemplate = [
    { stepCode: "1B", dependsOn: [] as string[], plannedDurationDays: duration },
    { stepCode: "1C", dependsOn: ["1B"], plannedDurationDays: 2 },
    { stepCode: "1D", dependsOn: ["1C"], plannedDurationDays: 2 },
  ];
  const dates = computePlannedDates(
    remainingTemplate.map((s) => ({ ...s, phase: "phase_1" as const, stepName: "", owningDepartment: "purchase" as const })),
    anchor
  );

  for (const stepCode of ["1B", "1C", "1D"]) {
    const d = dates.get(stepCode)!;
    const extra = stepCode === "1B" ? { plannedDurationDays: duration } : {};
    await prisma.phaseStep.updateMany({
      where: { projectId, stepCode },
      data: { plannedStartDate: d.plannedStartDate, plannedEndDate: d.plannedEndDate, ...extra },
    });
  }
}

async function seedNextPhaseIfNeeded(
  projectId: string,
  completedStepCode: string,
  completedAt: Date,
  glassType: "normal" | "laminated"
) {
  if (completedStepCode === "1D") {
    const phase2 = buildPhase2Steps();
    const dates = computePlannedDates(phase2, completedAt, new Map([["1D", completedAt]]));
    await prisma.phaseStep.createMany({
      data: phase2.map((s) => ({
        projectId,
        phase: s.phase,
        stepCode: s.stepCode,
        stepName: s.stepName,
        owningDepartment: s.owningDepartment,
        secondaryDepartment: s.secondaryDepartment,
        plannedDurationDays: s.plannedDurationDays,
        dependsOn: s.dependsOn,
        plannedStartDate: dates.get(s.stepCode)!.plannedStartDate,
        plannedEndDate: dates.get(s.stepCode)!.plannedEndDate,
      })),
    });
    await prisma.project.update({ where: { id: projectId }, data: { currentPhase: "phase_2" } });
    // 2A is derived from these rows' requirement checkboxes — create them empty now,
    // rather than waiting for 2A to "complete" (that's backwards once 2A is derived).
    await createEmptyProcurementItemsForProject(projectId);
  }

  if (completedStepCode === "2F") {
    const phase3 = buildPhase3Steps(glassType);
    const dates = computePlannedDates(phase3, completedAt, new Map([["2F", completedAt]]));
    await prisma.phaseStep.createMany({
      data: phase3.map((s) => ({
        projectId,
        phase: s.phase,
        stepCode: s.stepCode,
        stepName: s.stepName,
        owningDepartment: s.owningDepartment,
        secondaryDepartment: s.secondaryDepartment,
        plannedDurationDays: s.plannedDurationDays,
        dependsOn: s.dependsOn,
        plannedStartDate: dates.get(s.stepCode)!.plannedStartDate,
        plannedEndDate: dates.get(s.stepCode)!.plannedEndDate,
      })),
    });
    await prisma.project.update({ where: { id: projectId }, data: { currentPhase: "phase_3" } });
  }
}

/** Recomputes project.overallStatus from the current state of its steps. Never overrides a completed project. */
async function refreshProjectOverallStatus(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.overallStatus === "completed" || project.currentPhase === "completed") return;

  const hasBlockedStep = await prisma.phaseStep.count({
    where: { projectId, status: "blocked" },
  });

  const nextStatus = hasBlockedStep > 0 ? "blocked" : "on_track";
  if (nextStatus !== project.overallStatus) {
    await prisma.project.update({ where: { id: projectId }, data: { overallStatus: nextStatus } });
  }
}

/**
 * Recomputes 2A/2D1/2F's status from the current state of the project's procurement_items
 * and writes it if it changed. Call this after any procurement_item mutation. One-directional
 * by design: once derived-complete (which can cascade into seeding the next phase), it won't
 * revert to an earlier status even if a procurement_item is later edited backwards — unwinding
 * a phase seed that already happened is out of scope for this build.
 */
export async function syncDerivedStepStatus(
  projectId: string,
  stepCode: "2A" | "2D1" | "2F",
  actorId: string
) {
  const step = await prisma.phaseStep.findFirst({
    where: { projectId, stepCode },
    include: { project: true },
  });
  if (!step || step.status === "completed") return;

  let complete: boolean;
  let anyProgress: boolean;
  if (stepCode === "2A") {
    const s = await getRequirementCreatedStatus(projectId);
    complete = s.complete;
    anyProgress = s.items.some((i) => i.created);
  } else if (stepCode === "2D1") {
    const s = await getMaterialsArrivedStatus(projectId);
    complete = s.complete;
    anyProgress = s.items.some((i) => i.arrived);
  } else {
    const s = await getMaterialQCStatus(projectId);
    complete = s.complete;
    anyProgress = s.items.some((i) => i.qcChecked);
  }

  const newStatus: StepStatus = complete ? "completed" : anyProgress ? "in_progress" : "not_started";
  if (newStatus === step.status) return;

  const now = new Date();
  await prisma.phaseStep.update({
    where: { id: step.id },
    data: {
      status: newStatus,
      blockedReason: null,
      blockedNote: null,
      actualStartDate: newStatus !== "not_started" && !step.actualStartDate ? now : undefined,
      actualEndDate: newStatus === "completed" ? now : undefined,
    },
  });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: step.id,
      changedByUserId: actorId,
      oldStatus: step.status,
      newStatus,
      reason: "Auto-derived from procurement_items",
    },
  });

  if (newStatus === "completed") {
    await seedNextPhaseIfNeeded(projectId, stepCode, now, step.project.glassType);
  }

  await rescheduleProjectDates(projectId);
  await refreshProjectOverallStatus(projectId);
}

export async function updateStepStatus(
  stepId: string,
  newStatus: StepStatus,
  actorId: string,
  options: UpdateStepStatusOptions = {}
) {
  const step = await prisma.phaseStep.findUnique({
    where: { id: stepId },
    include: { project: true },
  });
  if (!step) throw new StepActionError(404, "Step not found");

  if (DERIVED_STEP_CODES.has(step.stepCode)) {
    throw new StepActionError(
      400,
      `${step.stepCode}'s status is derived from procurement_items and can't be set manually`
    );
  }

  if (newStatus === "in_progress" || newStatus === "completed") {
    const gate = await checkDependencyGate(stepId);
    if (!gate.allowed) {
      throw new StepActionError(409, "Dependencies not yet complete", { blockedBy: gate.blockedBy });
    }
  }

  if (newStatus === "blocked") {
    if (!options.blockedReason) {
      throw new StepActionError(400, "blockedReason is required to block a step");
    }
    if (options.blockedReason === "other" && !options.blockedNote?.trim()) {
      throw new StepActionError(400, "blockedNote is required when blockedReason is 'other'");
    }
  }

  if (step.stepCode === "1A" && newStatus === "completed" && !options.visitUrgency) {
    throw new StepActionError(400, "visitUrgency is required to complete 1A");
  }

  const now = new Date();
  const oldStatus = step.status;

  const updated = await prisma.phaseStep.update({
    where: { id: stepId },
    data: {
      status: newStatus,
      blockedReason: newStatus === "blocked" ? options.blockedReason : null,
      blockedNote: newStatus === "blocked" ? options.blockedNote ?? null : null,
      notes: options.notes !== undefined ? options.notes : undefined,
      actualStartDate: newStatus === "in_progress" && !step.actualStartDate ? now : undefined,
      actualEndDate: newStatus === "completed" ? now : undefined,
    },
  });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: stepId,
      changedByUserId: actorId,
      oldStatus,
      newStatus,
      reason:
        newStatus === "blocked" && options.blockedReason
          ? BLOCKED_REASON_LABELS[options.blockedReason] + (options.blockedNote ? ` — ${options.blockedNote}` : "")
          : options.notes ?? null,
    },
  });

  if (newStatus === "completed") {
    if (step.stepCode === "1A" && options.visitUrgency) {
      await applyVisitUrgency(step.projectId, options.visitUrgency, actorId);
    }

    await seedNextPhaseIfNeeded(step.projectId, step.stepCode, now, step.project.glassType);

    if (step.stepCode === "3E") {
      await prisma.project.update({
        where: { id: step.projectId },
        data: { currentPhase: "completed", overallStatus: "completed", actualEndDate: now },
      });
    }
  }

  await rescheduleProjectDates(step.projectId);
  await refreshProjectOverallStatus(step.projectId);

  return updated;
}
