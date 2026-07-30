import type { BlockedReason, ProjectPhase, StepStatus, VisitUrgency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkDependencyGate } from "@/lib/dependency-gate";
import { BLOCKED_REASON_LABELS } from "@/lib/labels";
import {
  buildPhase2Steps,
  buildPhase3Steps,
  computePlannedDates,
  deriveVisitDurationDays,
  type StepTemplateItem,
} from "@/lib/step-template";
import {
  createEmptyProcurementItemsForProject,
  clearProcurementFromStage,
  describeProcurementReset,
  getRequirementCreatedStatus,
  getMaterialsArrivedStatus,
  getMaterialQCStatus,
  DERIVED_STEP_STAGE,
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

/**
 * Seeds a phase's steps, unless they already exist. The existence check matters because
 * a gate step can be completed more than once over a project's life: reverting 1D or 2F
 * (see revertStep) intentionally leaves the already-seeded rows in place — they may hold
 * real procurement data — so re-completing the gate must not insert a second copy.
 */
async function seedPhaseSteps(
  projectId: string,
  phase: "phase_2" | "phase_3",
  template: StepTemplateItem[],
  anchor: Date,
  anchorStepCode: string
) {
  const existing = await prisma.phaseStep.count({ where: { projectId, phase } });
  if (existing === 0) {
    const dates = computePlannedDates(template, anchor, new Map([[anchorStepCode, anchor]]));
    await prisma.phaseStep.createMany({
      data: template.map((s) => ({
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
  }
  await prisma.project.update({ where: { id: projectId }, data: { currentPhase: phase } });
}

async function seedNextPhaseIfNeeded(
  projectId: string,
  completedStepCode: string,
  completedAt: Date,
  glassType: "normal" | "laminated"
) {
  if (completedStepCode === "1D") {
    await seedPhaseSteps(projectId, "phase_2", buildPhase2Steps(), completedAt, "1D");
    // 2A is derived from these rows' requirement checkboxes — create them empty now,
    // rather than waiting for 2A to "complete" (that's backwards once 2A is derived).
    await createEmptyProcurementItemsForProject(projectId);
  }

  if (completedStepCode === "2F") {
    await seedPhaseSteps(projectId, "phase_3", buildPhase3Steps(glassType), completedAt, "2F");
  }
}

/**
 * Recomputes project.current_phase from which gate steps are currently completed —
 * the inverse of the forward seeding above, so it stays correct when a gate step is
 * reverted as well as when one completes. project.actual_end_date is cleared alongside
 * it if the project is no longer finished.
 */
async function recomputeProjectPhase(projectId: string) {
  const gates = await prisma.phaseStep.findMany({
    where: { projectId, stepCode: { in: ["1D", "2F", "3E"] } },
    select: { stepCode: true, status: true },
  });
  const done = new Set(gates.filter((g) => g.status === "completed").map((g) => g.stepCode));

  const phase: ProjectPhase = done.has("3E")
    ? "completed"
    : done.has("2F")
      ? "phase_3"
      : done.has("1D")
        ? "phase_2"
        : "phase_1";

  await prisma.project.update({
    where: { id: projectId },
    data: {
      currentPhase: phase,
      ...(phase === "completed" ? {} : { actualEndDate: null }),
    },
  });
}

/**
 * Recomputes project.overallStatus from the current state of its steps. Never overrides a
 * project that is still in the completed phase. Deliberately keyed on current_phase alone
 * rather than also on overall_status: after 3E is reverted, recomputeProjectPhase has already
 * moved the project back to phase_3 while overall_status is still the stale "completed", and
 * that is exactly the case this needs to recompute rather than skip.
 */
async function refreshProjectOverallStatus(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.currentPhase === "completed") return;

  const hasBlockedStep = await prisma.phaseStep.count({
    where: { projectId, status: "blocked" },
  });

  const nextStatus = hasBlockedStep > 0 ? "blocked" : "on_track";
  if (nextStatus !== project.overallStatus) {
    await prisma.project.update({ where: { id: projectId }, data: { overallStatus: nextStatus } });
  }
}

// How far along a step is, for deciding whether a recomputed status is a step forward or a
// step backwards. blocked sits alongside in_progress: both mean "started, not finished".
const STATUS_RANK: Record<StepStatus, number> = {
  not_started: 0,
  in_progress: 1,
  blocked: 1,
  completed: 2,
};

/**
 * Every step that comes after `rootStepCode` in the workflow — reverting is "roll the project
 * back to this point", so what follows on the timeline goes with it.
 *
 * Deliberately positional rather than a depends_on traversal. The dependency graph is narrower
 * than the timeline: 2D2 ("Final tight measurement at site"), for one, is a leaf that nothing
 * declares a dependency on, so a graph walk from it finds nothing and reverting it would leave
 * the whole of phase 3 sitting there as though the measurement had never been in question.
 * Position is also a superset of the graph — every step sorts after everything it depends on —
 * so the dependency-gate invariant a graph walk protected still holds.
 *
 * Ordering is lexicographic on step_code, which matches the intended sequence for every code in
 * this schema (1A<1B<1C<1D, 2A<2D1<2D2<2F, 3A<3B<3C1<3C2<3E) — the same property the project
 * timeline already sorts on.
 */
function collectStepsAfter(steps: { stepCode: string }[], rootStepCode: string): Set<string> {
  return new Set(
    steps.filter((s) => s.stepCode.localeCompare(rootStepCode) > 0).map((s) => s.stepCode)
  );
}

/**
 * Data a step writes outside its own row, which therefore has to go when that step is reverted.
 * Everything a step records lives either here, on the step itself (dates, blocker, notes), or in
 * procurement_items (see PROCUREMENT_LIFECYCLE) — between the three, a revert leaves nothing
 * behind from work that, as far as the record now goes, hasn't happened yet.
 *
 * `needsConsent` marks the ones worth stopping a user over: a payment record is a claim about
 * money and shouldn't evaporate as a side effect of a status fix, whereas re-picking the visit
 * urgency is part of completing 1A again anyway.
 */
const STEP_PROJECT_OUTPUTS: Record<
  string,
  {
    fields: Record<string, unknown>;
    label: string;
    needsConsent: boolean;
    /** Fields this step writes onto *other* steps' rows, which go back to their template value. */
    stepFields?: { stepCode: string; fields: Record<string, unknown> }[];
  }
> = {
  // 1A's completion is what sets visit urgency, which in turn is the only thing that gives 1B a
  // duration (see applyVisitUrgency). Retracting the one has to retract the other, or 1B keeps a
  // schedule derived from an answer the project no longer holds.
  "1A": {
    fields: { visitUrgency: null },
    label: "the visit urgency",
    needsConsent: false,
    stepFields: [{ stepCode: "1B", fields: { plannedDurationDays: null } }],
  },
  // 1D is "Revised quote and payment" — the project's payment fields are its output.
  "1D": {
    fields: { paymentStatus: "pending", amountReceived: 0, notes: null },
    label: "the payment status, amount received and payment note",
    needsConsent: true,
  },
};

/** Applies STEP_PROJECT_OUTPUTS for every reverted step code that has any. */
async function clearProjectOutputs(projectId: string, stepCodes: string[]) {
  const outputs = stepCodes.map((code) => STEP_PROJECT_OUTPUTS[code]).filter((o) => !!o);

  const data = outputs.reduce<Record<string, unknown>>((acc, o) => ({ ...acc, ...o.fields }), {});
  if (Object.keys(data).length > 0) {
    await prisma.project.update({ where: { id: projectId }, data });
  }

  for (const { stepCode, fields } of outputs.flatMap((o) => o.stepFields ?? [])) {
    await prisma.phaseStep.updateMany({ where: { projectId, stepCode }, data: fields });
  }
}

/**
 * Walks every non-derived step after `rootStepCode` back to not_started, clearing its actual
 * dates, any blocker, and its notes — those describe work that is no longer recorded as having
 * happened. Derived steps (2A/2D1/2F) are skipped on purpose — their status is a pure function
 * of procurement_items, so forcing a value here would just be overwritten by the next
 * syncDerivedStepStatus call, and clearing the underlying procurement data to match would
 * destroy records the user never asked to discard. The two callers handle that gap differently:
 * revertStep clears that data up front once the user has consented, while syncDerivedStepStatus
 * is already re-deriving each of 2A/2D1/2F in turn.
 */
async function cascadeRevertLaterSteps(
  projectId: string,
  rootStepCode: string,
  actorId: string,
  reason: string
): Promise<string[]> {
  const steps = await prisma.phaseStep.findMany({
    where: { projectId },
    select: { id: true, stepCode: true, status: true },
  });

  const later = collectStepsAfter(steps, rootStepCode);
  const toRevert = steps.filter(
    (s) => later.has(s.stepCode) && s.status !== "not_started" && !DERIVED_STEP_CODES.has(s.stepCode)
  );
  if (toRevert.length === 0) return [];

  await prisma.$transaction([
    ...toRevert.map((s) =>
      prisma.phaseStep.update({
        where: { id: s.id },
        data: {
          status: "not_started" as const,
          actualStartDate: null,
          actualEndDate: null,
          blockedReason: null,
          blockedNote: null,
          notes: null,
        },
      })
    ),
    ...toRevert.map((s) =>
      prisma.stepStatusLog.create({
        data: {
          phaseStepId: s.id,
          changedByUserId: actorId,
          oldStatus: s.status,
          newStatus: "not_started" as const,
          reason,
        },
      })
    ),
  ]);

  return toRevert.map((s) => s.stepCode);
}

/**
 * Recomputes 2A/2D1/2F's status from the current state of the project's procurement_items
 * and writes it if it changed. Call this after any procurement_item mutation. Runs in both
 * directions: unchecking a procurement box walks the derived step back, which also walks back
 * any non-derived step downstream of it (2D2, or all of phase 3 if 2F stops being complete)
 * and re-derives the project's phase. The phase's already-seeded rows are kept either way —
 * only their statuses move — so nothing entered against them is lost.
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
  if (!step) return;

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

  const isDowngrade = STATUS_RANK[newStatus] < STATUS_RANK[step.status];
  const now = new Date();

  await prisma.phaseStep.update({
    where: { id: step.id },
    data: {
      status: newStatus,
      blockedReason: null,
      blockedNote: null,
      // `undefined` (leave alone) vs `null` (clear) matters on the way down: a step that is
      // no longer complete must not keep advertising an actual_end_date, and one back at
      // not_started must not keep an actual_start_date either.
      actualStartDate:
        newStatus === "not_started" ? null : !step.actualStartDate ? now : undefined,
      actualEndDate: newStatus === "completed" ? now : null,
    },
  });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: step.id,
      changedByUserId: actorId,
      oldStatus: step.status,
      newStatus,
      reason: isDowngrade
        ? "Auto-derived from procurement_items — reverted as procurement data was cleared"
        : "Auto-derived from procurement_items",
    },
  });

  if (newStatus === "completed") {
    await seedNextPhaseIfNeeded(projectId, stepCode, now, step.project.glassType);
  }

  if (isDowngrade) {
    await cascadeRevertLaterSteps(
      projectId,
      stepCode,
      actorId,
      `Reverted with upstream ${stepCode} (procurement data cleared)`
    );
  }

  await recomputeProjectPhase(projectId);
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

  await recomputeProjectPhase(step.projectId);
  await rescheduleProjectDates(step.projectId);
  await refreshProjectOverallStatus(step.projectId);

  return updated;
}

/** "2A", "2A and 2D1", "2A, 2D1 and 2F" — for messages that name a set of steps. */
function formatStepList(codes: string[]): string {
  if (codes.length <= 1) return codes.join("");
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

/** Where a revert lands by default: completed reopens for editing, anything started resets. */
function defaultRevertTarget(from: StepStatus): StepStatus {
  return from === "completed" ? "in_progress" : "not_started";
}

/** True if any procurement_item currently carries the data that drives this derived step. */
async function derivedStepHasProgress(projectId: string, stepCode: string): Promise<boolean> {
  if (stepCode === "2A") {
    return (await getRequirementCreatedStatus(projectId)).items.some((i) => i.created);
  }
  if (stepCode === "2D1") {
    return (await getMaterialsArrivedStatus(projectId)).items.some((i) => i.arrived);
  }
  if (stepCode === "2F") {
    return (await getMaterialQCStatus(projectId)).items.some((i) => i.qcChecked);
  }
  return false;
}

export interface RevertPlan {
  step: { id: string; projectId: string; stepCode: string; stepName: string; status: StepStatus };
  toStatus: StepStatus;
  /** Non-derived steps downstream of this one that will be reset to not_started alongside it. */
  cascade: { stepCode: string; stepName: string; status: StepStatus }[];
  /**
   * Set when the revert can only happen by discarding procurement entries — either the target is
   * a derived step, or a derived step downstream is holding data. Non-null means the caller must
   * opt in via `clearDerivedProcurement`; nothing is discarded without it.
   */
  procurementReset: {
    /** Derived steps whose status this resets. */
    stepCodes: string[];
    /** Lifecycle stage labels that get discarded, earliest first. */
    clears: string[];
    /** True when the items go all the way back to empty (notes included). */
    fullReset: boolean;
    fromStage: number;
  } | null;
  /** Project-level data produced by the reverted steps that gets cleared with them. */
  projectDataClears: string[];
  /** True when any reverted step is carrying a note that gets discarded. */
  clearsStepNotes: boolean;
  /** Whether the caller must pass clearDerivedProcurement — set by procurement or payment data. */
  needsConsent: boolean;
  /** Set when this step gates a phase, so the UI can warn that the project moves back a phase. */
  phaseChange: { from: ProjectPhase; to: ProjectPhase } | null;
}

/**
 * Works out everything a revert of `stepId` would touch, without writing anything — the
 * preview the confirmation UI shows, and the same check revertStep runs before committing.
 */
export async function planStepRevert(stepId: string, toStatus?: StepStatus): Promise<RevertPlan> {
  const step = await prisma.phaseStep.findUnique({
    where: { id: stepId },
    include: { project: { select: { currentPhase: true } } },
  });
  if (!step) throw new StepActionError(404, "Step not found");

  const targetIsDerived = DERIVED_STEP_CODES.has(step.stepCode);

  if (step.status === "not_started") {
    throw new StepActionError(400, "This step is already at not started — there is nothing to revert");
  }

  // A derived step has no status of its own to land on: clearing the procurement data behind it
  // is the revert, and the derivation then puts it at not_started. So there is no "reopen as
  // in_progress" for these — asking for one would promise a state the next sync would overwrite.
  if (targetIsDerived && toStatus && toStatus !== "not_started") {
    throw new StepActionError(
      400,
      `${step.stepCode} is derived from procurement data — reverting it can only reset it to not started`
    );
  }

  const target = targetIsDerived ? "not_started" : toStatus ?? defaultRevertTarget(step.status);
  if (STATUS_RANK[target] >= STATUS_RANK[step.status]) {
    throw new StepActionError(400, "A revert has to move the step backwards");
  }

  const siblings = await prisma.phaseStep.findMany({
    where: { projectId: step.projectId },
    select: { stepCode: true, stepName: true, status: true, notes: true },
  });
  const later = collectStepsAfter(siblings, step.stepCode);
  const affected = siblings.filter((s) => later.has(s.stepCode) && s.status !== "not_started");

  // Which derived steps this revert has to reset: the target itself if it is one, plus any
  // derived step after it that is currently holding procurement data.
  const derivedToReset = targetIsDerived ? [step.stepCode] : [];
  for (const s of affected.filter((s) => DERIVED_STEP_CODES.has(s.stepCode))) {
    if (await derivedStepHasProgress(step.projectId, s.stepCode)) {
      derivedToReset.push(s.stepCode);
    }
  }
  derivedToReset.sort((a, b) => a.localeCompare(b));

  // Clearing runs from the earliest stage involved, and takes everything after it — so resetting
  // 2A necessarily also resets 2D1 and 2F, whose data sits later in the same lifecycle.
  const fromStage = derivedToReset.length
    ? Math.min(...derivedToReset.map((code) => DERIVED_STEP_STAGE[code] ?? 0))
    : -1;
  const procurementReset: RevertPlan["procurementReset"] =
    fromStage < 0
      ? null
      : {
          stepCodes: Object.keys(DERIVED_STEP_STAGE)
            .filter((code) => DERIVED_STEP_STAGE[code] >= fromStage)
            .sort((a, b) => a.localeCompare(b)),
          clears: describeProcurementReset(fromStage),
          fullReset: fromStage === 0,
          fromStage,
        };

  // What current_phase would become once this step and its dependents are no longer complete.
  // Derived blockers count as reset here: the only way this revert proceeds is by clearing the
  // procurement data behind them, so projecting them as still-complete would under-report the
  // phase move (e.g. hiding that reverting 1B while 2F is complete drops the project to phase 1).
  const gateStatus = new Map(siblings.map((s) => [s.stepCode, s.status]));
  gateStatus.set(step.stepCode, target);
  const resetCodes = new Set(procurementReset?.stepCodes ?? []);
  for (const s of affected) {
    if (!DERIVED_STEP_CODES.has(s.stepCode) || resetCodes.has(s.stepCode)) {
      gateStatus.set(s.stepCode, "not_started");
    }
  }
  // Everything this revert touches, for working out what data goes with it.
  const revertedCodes = [
    step.stepCode,
    ...affected.filter((s) => !DERIVED_STEP_CODES.has(s.stepCode)).map((s) => s.stepCode),
    ...(procurementReset?.stepCodes ?? []),
  ];
  const projectOutputs = revertedCodes
    .map((code) => STEP_PROJECT_OUTPUTS[code])
    .filter((o): o is (typeof STEP_PROJECT_OUTPUTS)[string] => !!o);
  const clearsStepNotes = siblings.some(
    (s) => revertedCodes.includes(s.stepCode) && !!s.notes
  );

  const isDone = (code: string) => gateStatus.get(code) === "completed";
  const nextPhase: ProjectPhase = isDone("3E")
    ? "completed"
    : isDone("2F")
      ? "phase_3"
      : isDone("1D")
        ? "phase_2"
        : "phase_1";

  return {
    step: {
      id: step.id,
      projectId: step.projectId,
      stepCode: step.stepCode,
      stepName: step.stepName,
      status: step.status,
    },
    toStatus: target,
    cascade: affected
      .filter((s) => !DERIVED_STEP_CODES.has(s.stepCode))
      .map((s) => ({ stepCode: s.stepCode, stepName: s.stepName, status: s.status }))
      // Workflow order, so the list reads the way the timeline does rather than in row order.
      .sort((a, b) => a.stepCode.localeCompare(b.stepCode)),
    procurementReset,
    projectDataClears: projectOutputs.map((o) => o.label),
    clearsStepNotes,
    needsConsent: !!procurementReset || projectOutputs.some((o) => o.needsConsent),
    phaseChange:
      nextPhase === step.project.currentPhase
        ? null
        : { from: step.project.currentPhase, to: nextPhase },
  };
}

/**
 * Moves a step backwards so its information can be corrected and it can be worked again —
 * the way out of a status set by mistake, which the forward-only transitions in
 * updateStepStatus leave no route back from.
 *
 * A completed step reopens as in_progress; a started or blocked one resets to not_started.
 * Every non-derived step downstream is reset to not_started in the same transaction, because
 * the dependency gate only ever let them start on the strength of this step being complete —
 * leaving them alone would mean completed steps whose dependencies are not complete. Rows
 * seeded by a phase gate are kept, not deleted, so no procurement or date entry is lost; the
 * project simply moves back to the phase its gate steps now justify.
 *
 * Derived steps (2A/2D1/2F) can be the target too, but they have no status of their own to set:
 * clearing the procurement data behind them *is* the revert, after which the derivation puts them
 * at not_started. Either way — derived target, or a derived step downstream holding data — the
 * call needs `clearDerivedProcurement`, an explicit opt-in, because it discards procurement
 * entries. Without it the call is refused rather than discarding anything unasked. The clear runs
 * from the earliest lifecycle stage involved and takes every later stage with it, so reverting 2A
 * returns the three items to empty (see PROCUREMENT_LIFECYCLE for why a later stage can't outlive
 * an earlier one being undone).
 *
 * `reason` is required — a revert is a correction of the record, and step_status_log is where
 * that record lives.
 */
export async function revertStep(
  stepId: string,
  actorId: string,
  options: { toStatus?: StepStatus; reason: string; clearDerivedProcurement?: boolean }
) {
  const reason = options.reason.trim();
  if (!reason) {
    throw new StepActionError(400, "A reason is required to revert a step");
  }

  const plan = await planStepRevert(stepId, options.toStatus);
  const { projectId } = plan.step;
  const targetIsDerived = DERIVED_STEP_CODES.has(plan.step.stepCode);

  if (plan.needsConsent && !options.clearDerivedProcurement) {
    const discards = [
      ...(plan.procurementReset
        ? [`the ${formatStepList(plan.procurementReset.clears)} on all three procurement items`]
        : []),
      ...plan.projectDataClears,
    ];
    throw new StepActionError(
      409,
      `Reverting this step discards ${formatStepList(discards)} — confirm to revert anyway`,
      {
        procurementReset: plan.procurementReset,
        projectDataClears: plan.projectDataClears,
        needsConfirmation: "clearDerivedProcurement",
      }
    );
  }

  if (plan.procurementReset) {
    const { fromStage } = plan.procurementReset;
    await clearProcurementFromStage(projectId, fromStage);
    // Let each derived step re-derive from the now-cleared data. This is what actually moves a
    // derived target's status, and it walks back whatever those steps had unlocked downstream.
    for (const code of ["2A", "2D1", "2F"] as const) {
      await syncDerivedStepStatus(projectId, code, actorId);
    }
  }

  const { toStatus } = plan;

  if (targetIsDerived) {
    // The sync above already set the status and cascaded — that *is* the revert for a derived
    // step. All that's left is recording that a person asked for it and why, so the history
    // shows more than an "Auto-derived" line for a change someone deliberately made.
    const current = await prisma.phaseStep.findUniqueOrThrow({
      where: { id: stepId },
      select: { status: true },
    });
    if (current.status !== toStatus) {
      throw new StepActionError(
        500,
        `${plan.step.stepCode} did not reset as expected — its procurement data may not have cleared`
      );
    }
    await prisma.stepStatusLog.create({
      data: {
        phaseStepId: stepId,
        changedByUserId: actorId,
        oldStatus: plan.step.status,
        newStatus: toStatus,
        reason: `Reverted to ${toStatus} — ${reason}`,
      },
    });
  } else {
    await prisma.$transaction([
      prisma.phaseStep.update({
        where: { id: stepId },
        data: {
          status: toStatus,
          blockedReason: null,
          blockedNote: null,
          notes: null,
          actualStartDate: toStatus === "not_started" ? null : undefined,
          actualEndDate: null,
        },
      }),
      prisma.stepStatusLog.create({
        data: {
          phaseStepId: stepId,
          changedByUserId: actorId,
          oldStatus: plan.step.status,
          newStatus: toStatus,
          reason: `Reverted to ${toStatus} — ${reason}`,
        },
      }),
    ]);
  }

  const cascaded = await cascadeRevertLaterSteps(
    projectId,
    plan.step.stepCode,
    actorId,
    `Reverted with upstream ${plan.step.stepCode} — ${reason}`
  );

  // Data these steps wrote onto the project itself goes with them, same as their own rows.
  await clearProjectOutputs(projectId, [
    plan.step.stepCode,
    ...cascaded,
    ...(plan.procurementReset?.stepCodes ?? []),
  ]);

  await recomputeProjectPhase(projectId);
  await rescheduleProjectDates(projectId);
  await refreshProjectOverallStatus(projectId);

  return { plan, step: await prisma.phaseStep.findUnique({ where: { id: stepId } }) };
}
