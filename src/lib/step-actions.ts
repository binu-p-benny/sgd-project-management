import type { BlockedReason, DelayCategory, ProjectPhase, StepStatus, VisitUrgency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkDependencyGate } from "@/lib/dependency-gate";
import { BLOCKED_REASON_LABELS } from "@/lib/labels";
import {
  addDays,
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
import { createEmptyGlassPurchaseOrderForProject } from "@/lib/glass";
import { PROCUREMENT_STAGES } from "@/lib/project-filters";

// 2A, 2D1 and 2F are derived from procurement_items — never manually settable.
export const DERIVED_STEP_CODES = new Set(["2A", "2D1", "2F"]);

// Steps whose late completion must record whether the client or the team caused the slip —
// reschedule.ts reads delay_category off *any* completed step generically (not just these), but
// only these are ever asked for one: they're the steps most likely to have a client- or
// team-caused reason worth distinguishing, rather than a purely internal derived/auto-stamped one.
export const DELAY_CATEGORY_STEP_CODES = new Set(["1A", "1B", "1C", "1D", "2D2"]);

// Phase 3 never gets a computed planned date (rescheduleProjectDates excludes the whole phase).
// 3C1 gets a manual planned start+end, and 3E a manual planned end only (see
// MANUAL_PLANNED_END_ONLY_STEP_CODES below — a single on-site QC check has no planned start
// worth tracking), each starting out empty and filled in by hand via their own small Save CTA —
// normally admin-only (see /api/phase-steps/[id]/dates), or by one delegated department once
// granted (see plannedDateEditDepartment, /api/phase-steps/[id]/planned-date(s|-permission), and
// buildPlannedDateEditTasks in unified-tasks.ts). 3C2 ("Installation") is its own third case —
// see INSTALLATION_OVERRIDE_STEP_CODE just below — not part of this set: unlike 3C1/3E it never
// starts empty (it's prefilled from the Installation planned window) and never locks, so neither
// the "starts empty, needs delegating" framing nor the once-both-are-set lock this set drives
// actually fits it. Every OTHER step's planned_start_date/planned_end_date stays fully
// system-computed and /dates rejects direct writes to them, same as always.
export const MANUAL_PLANNED_DATE_STEP_CODES = new Set(["3C1", "3E"]);

// Of those, 3E only ever gets a Planned *end* — see the comment above. Mirrored locally as its own
// copy in TaskCard.tsx/TaskTable.tsx for the usual reason ("use client" files can't import this
// Prisma-touching module) — keep both in sync with this one by hand.
export const MANUAL_PLANNED_END_ONLY_STEP_CODES = new Set(["3E"]);

// 3C2 ("Installation") — the one step whose planned start/end is a computed default (the
// Installation planned window, see computeInstallationPlannedWindow) that an admin can also
// override at any time, rather than either purely computed (like 2D1/2D2) or purely hand-typed
// (like 3C1/3E — see MANUAL_PLANNED_DATE_STEP_CODES above). POST /api/phase-steps/[id]/dates
// checks this alongside that set, but writes to plannedStartDateOverride/plannedEndDateOverride
// instead of the plain columns — rescheduleProjectDates is what actually keeps
// plannedStartDate/plannedEndDate in sync with whichever of override-or-window currently wins
// (see its own 3C2 handling). No delegation for this one: it's always admin-only.
export const INSTALLATION_OVERRIDE_STEP_CODE = "3C2";

// 3C1 ("Aluminum framework") only, for now — which crew is fabricating it. Its own separate
// task from that step's manual Planned start/end, with its own Save CTA (see
// POST /api/phase-steps/[id]/contractor and TaskCard.tsx/TaskTable.tsx) — not bundled into the
// same submit. A subset of MANUAL_PLANNED_DATE_STEP_CODES, not every step in it: 3E is a QC
// check the project engineer does themselves, not contracted-out work, so it has no contractor
// field to fill.
export const MANUAL_CONTRACTOR_STEP_CODES = new Set(["3C1"]);

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
  delayCategory?: DelayCategory; // only meaningful when completing a DELAY_CATEGORY_STEP_CODES step after its planned finish
  // Only meaningful when completing 3E, and must be true to do so — a Fail is recorded through
  // the plain field-edit branch in /api/phase-steps/[id] instead, without a status transition
  // (see that route), since 3E should only ever reach "completed" once QC has actually passed.
  qcPassed?: boolean;
  // Lets whoever's actually doing the work say when it happened, right from the same action that
  // changes status — "I finished this yesterday", not "rewrite history after the fact" (that's
  // what the separate, admin-only /api/phase-steps/[id]/dates escape hatch is for). Only applied
  // the moment status first reaches in_progress/completed respectively; defaults to now when
  // omitted, exactly as before this option existed. Authorized the same way the status change
  // itself is — the step's own owning/secondary department, or an admin.
  actualStartDate?: Date;
  actualEndDate?: Date;
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
        notifiedOverdueAt: null,
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
    // owningDepartment is a placeholder here — computePlannedDates never reads it, this
    // array only exists to satisfy StepTemplateItem's shape for the date computation below.
    remainingTemplate.map((s) => ({ ...s, phase: "phase_1" as const, stepName: "", owningDepartment: "accounts" as const })),
    anchor
  );

  for (const stepCode of ["1B", "1C", "1D"]) {
    const d = dates.get(stepCode)!;
    // 1B is next in line with nothing left to gate it once 1A's welcome call wraps up, so
    // there's no "not started" limbo for the department to notice and act on — it moves
    // straight to in_progress instead of waiting on a manual Start. Its actual start is the
    // day after 1A's actual end, not the same day: the two are separate visits in practice,
    // even though nothing blocks 1B from being picked up immediately.
    const extra: { plannedDurationDays?: number | null; status?: StepStatus; actualStartDate?: Date } =
      stepCode === "1B"
        ? { plannedDurationDays: duration, status: "in_progress", actualStartDate: addDays(anchor, 1) }
        : {};
    await prisma.phaseStep.updateMany({
      where: { projectId, stepCode },
      data: {
        plannedStartDate: d.plannedStartDate,
        plannedEndDate: d.plannedEndDate,
        notifiedOverdueAt: null,
        ...extra,
      },
    });
  }

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: oneB.id,
      changedByUserId: actorId,
      oldStatus: oneB.status,
      newStatus: "in_progress",
      reason: "Auto-started: welcome call (1A) completed",
    },
  });
}

/**
 * Flips a step straight to in_progress with its actual start stamped, the same treatment
 * 1B gets in applyVisitUrgency once 1A wraps up: the step immediately after a just-completed
 * one has nothing left to gate it, so there's no "not started" limbo for the department to
 * notice and act on. `anchor` is expected to already be the day after the dependency's actual
 * end (see the 1B/1C/1D call sites) rather than "now" — the actual start is a function of when
 * the prior step's work finished, not of when someone happened to click the button. No-ops if
 * the step isn't sitting at not_started (already touched, or blocked) — this only ever fires
 * the moment its sole dependency completes.
 */
async function autoStartStep(projectId: string, stepCode: string, actorId: string, anchor: Date, reason: string) {
  const step = await prisma.phaseStep.findFirst({ where: { projectId, stepCode } });
  if (!step || step.status !== "not_started") return;

  await prisma.phaseStep.update({
    where: { id: step.id },
    data: { status: "in_progress", actualStartDate: anchor },
  });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: step.id,
      changedByUserId: actorId,
      oldStatus: step.status,
      newStatus: "in_progress",
      reason,
    },
  });
}

// The phase-1 chain this auto-fill runs along — kept separate from `dependsOn` since it's
// only ever these three hops, not a general graph walk.
const PHASE1_NEXT_STEP: Record<string, string> = { "1A": "1B", "1B": "1C", "1C": "1D" };

/**
 * Keeps the next phase-1 step's actual start following its dependency's actual end, any time
 * that end date changes — not just at the moment autoStartStep/applyVisitUrgency first stamps
 * it. Without this, editing a completed step's actual end later (the standalone date-save on
 * an already-completed TaskCard) leaves the next step's actual start stale. No-ops once the
 * next step is itself completed — a finished step's own history isn't rewritten by an edit
 * further up the chain.
 */
export async function cascadeActualStart(
  projectId: string,
  stepCode: string,
  actualEndDate: Date,
  actorId: string
) {
  const nextCode = PHASE1_NEXT_STEP[stepCode];
  if (!nextCode) return;

  const next = await prisma.phaseStep.findFirst({ where: { projectId, stepCode: nextCode } });
  if (!next || next.status === "completed") return;

  const newStart = addDays(actualEndDate, 1);
  if (next.actualStartDate?.getTime() === newStart.getTime()) return;

  await prisma.phaseStep.update({ where: { id: next.id }, data: { actualStartDate: newStart } });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: next.id,
      changedByUserId: actorId,
      oldStatus: next.status,
      newStatus: next.status,
      reason: `Actual start recalculated — ${stepCode}'s actual end changed`,
    },
  });
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
    // Phase 3 seeds with every planned date null — only Phase 1/2 get a real one here. 3C2 is the
    // one exception (see MANUAL_PLANNED_DATE_STEP_CODES), but its date comes from the Installation
    // planned window, not from this seeding pass: both callers of seedPhaseSteps run
    // rescheduleProjectDates right after, which backfills it the moment the row exists. Phase 2
    // rows only reach here for projects created before day-one seeding existed (see the
    // existing-rows check above), so this still computes real dates for that legacy path.
    const dates =
      phase === "phase_3" ? null : computePlannedDates(template, anchor, new Map([[anchorStepCode, anchor]]));
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
        plannedStartDate: dates?.get(s.stepCode)?.plannedStartDate ?? null,
        plannedEndDate: dates?.get(s.stepCode)?.plannedEndDate ?? null,
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
    // Requirement created stays a manual checkbox — Design Engineer ticks each of the 3
    // items themselves; only the planned dates shown alongside them are computed up front.
    await createEmptyProcurementItemsForProject(projectId);
  }

  if (completedStepCode === "2F") {
    // seedPhaseSteps' own existing-rows guard makes this a no-op if maybeEarlyUnlockPhase3
    // (below) already seeded phase 3 ahead of 2F actually completing — whichever of the two
    // happens first is what unlocks it, and the other is then just confirming what's already
    // there.
    await seedPhaseSteps(projectId, "phase_3", buildPhase3Steps(glassType), completedAt, "2F");
    // 3A's own TaskCard stays a plain manually-completed step (see DERIVED_STEP_CODES —
    // unlike 2A/2D1/2F, nothing derives its status). This just seeds the row the glass tracker
    // table sits on, so Requirement/Quote/Payment/Order have somewhere to be filled in by hand.
    await createEmptyGlassPurchaseOrderForProject(projectId);
  }
}

/**
 * Phase 3 normally only appears once 2F ("Material QC") actually completes — but by the time
 * every procurement item has physically arrived, there's often enough certainty to let
 * installation prep (the glass PO, 3A onward) start in parallel with QC still being finished up.
 * A 2-day grace period past the last arrival covers something turning up damaged on a closer
 * look. Whichever of the two — this date-driven check, or 2F genuinely completing (see
 * seedNextPhaseIfNeeded above) — happens first is what actually unlocks phase 3; the other is
 * then just a no-op confirming what's already there, via seedPhaseSteps' own existing-rows guard.
 *
 * Checked opportunistically (on loading the project page) rather than on a cron — this can only
 * ever become newly true by the calendar advancing, with no user action to hang a sync off of,
 * and a page view is the one moment that already needs fresh data anyway.
 */
export async function maybeEarlyUnlockPhase3(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      glassType: true,
      procurementItems: { select: { actualArrivalDate: true } },
      phaseSteps: { where: { phase: "phase_3" }, select: { id: true }, take: 1 },
    },
  });
  // Already unlocked (early or via 2F), or phase 2 hasn't even been seeded yet.
  if (!project || project.phaseSteps.length > 0 || project.procurementItems.length === 0) return;

  const arrivalDates = project.procurementItems.map((i) => i.actualArrivalDate);
  if (arrivalDates.some((d) => d === null)) return;

  const lastArrival = new Date(Math.max(...arrivalDates.map((d) => d!.getTime())));
  if (new Date() < addDays(lastArrival, 2)) return;

  await seedPhaseSteps(projectId, "phase_3", buildPhase3Steps(project.glassType), lastArrival, "2F");
  await createEmptyGlassPurchaseOrderForProject(projectId);
  await recomputeProjectPhase(projectId);
  // Unlike the other seedNextPhaseIfNeeded call sites, nothing downstream of this opportunistic
  // page-load check already runs rescheduleProjectDates — without this, the newly-seeded 3C2 would
  // sit at null planned dates until some unrelated procurement edit happened to trigger one.
  await rescheduleProjectDates(projectId);
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

const PHASE_ORDER: Record<ProjectPhase, number> = { phase_1: 0, phase_2: 1, phase_3: 2, completed: 3 };
export type SkipTargetPhase = "phase_2" | "phase_3";

/**
 * Owner-only shortcut for a project that's already live in the real world past Phase 1 (or
 * Phase 2) by the time it's entered here — bulk-marks every step before `targetPhase` completed,
 * all dated `asOfDate`, instead of walking each one by hand for history nobody needs day-to-day
 * tracking on. Phase 3's own steps (3A onward) are left untouched either way — the whole point is
 * resuming *live* tracking from wherever the project actually is, not backfilling that too.
 *
 * Note 2D2 ("Final tight measurement at site") is a Phase 2 step but isn't in DERIVED_STEP_CODES
 * and nothing downstream gates on it (see buildPhase2Steps) — so it's deliberately left untouched
 * here even when skipping to phase_3. Unlike 1A-1D and the procurement stages, it's a real site
 * visit the project engineer still has to make; reaching Phase 3 administratively doesn't mean
 * that visit already happened.
 *
 * Deliberately bypasses updateStepStatus's normal validation (dependency gates, the
 * visitUrgency/delayCategory prompts, late-reason requirements) — those exist to keep a *live*
 * completion honest, which doesn't apply to backfilling something that already happened. Reuses
 * the same seeding/derivation the rest of the app already trusts (seedNextPhaseIfNeeded,
 * syncDerivedStepStatus, recomputeProjectPhase) rather than a parallel "fake complete" path, so
 * nothing here can later get self-corrected back out from under the owner the next time real
 * procurement data changes.
 */
export async function skipToPhase(
  projectId: string,
  targetPhase: SkipTargetPhase,
  asOfDate: Date,
  actorId: string
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { phaseSteps: { where: { stepCode: { in: ["1A", "1B", "1C", "1D"] } } } },
  });
  if (!project) throw new StepActionError(404, "Project not found");
  if (PHASE_ORDER[project.currentPhase] >= PHASE_ORDER[targetPhase]) {
    throw new StepActionError(
      400,
      `Project is already at or past ${targetPhase === "phase_2" ? "Phase 2" : "Phase 3"}`
    );
  }

  const completeStepBackfilled = async (step: { id: string; status: StepStatus; actualStartDate: Date | null }) => {
    await prisma.phaseStep.update({
      where: { id: step.id },
      data: {
        status: "completed",
        actualStartDate: step.actualStartDate ?? asOfDate,
        actualEndDate: asOfDate,
        blockedReason: null,
        blockedNote: null,
      },
    });
    await prisma.stepStatusLog.create({
      data: {
        phaseStepId: step.id,
        changedByUserId: actorId,
        oldStatus: step.status,
        newStatus: "completed",
        reason: `Phase skipped by owner — backfilled as of ${asOfDate.toDateString()}`,
      },
    });
  };

  if (project.currentPhase === "phase_1") {
    for (const code of ["1A", "1B", "1C", "1D"] as const) {
      const step = project.phaseSteps.find((s) => s.stepCode === code);
      if (!step || step.status === "completed") continue;
      await completeStepBackfilled(step);
    }
    // 1A's visitUrgency only exists to size 1B's own planned window (see step-template.ts) —
    // moot here since every date above was just set directly, but the column still needs
    // *something* valid in it.
    await prisma.project.update({ where: { id: projectId }, data: { visitUrgency: "hot" } });
    await seedNextPhaseIfNeeded(projectId, "1D", asOfDate, project.glassType);
  }

  if (targetPhase === "phase_3") {
    const items = await prisma.procurementItem.findMany({ where: { projectId } });
    for (const item of items) {
      const data: Record<string, unknown> = { qcChecked: true, qcPassed: true };
      for (const stage of PROCUREMENT_STAGES[item.itemType]) {
        data[stage.field as string] = asOfDate;
      }
      await prisma.procurementItem.update({ where: { id: item.id }, data });
    }
    for (const code of ["2A", "2D1", "2F"] as const) {
      await syncDerivedStepStatus(projectId, code, actorId);
    }
    // syncDerivedStepStatus stamps 2F's own actual_end_date as "now" — only 2A/2D1 derive a
    // completedAt from the procurement dates that drove them (see its own comment) — corrected
    // here so every backfilled step reads asOfDate, not the moment this skip happened to run.
    await prisma.phaseStep.updateMany({
      where: { projectId, stepCode: "2F" },
      data: { actualEndDate: asOfDate },
    });
  }

  await recomputeProjectPhase(projectId);
  await rescheduleProjectDates(projectId);
  await refreshProjectOverallStatus(projectId);
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
    /** Fields this step writes onto its glass_purchase_orders row (3A and 3B, currently). */
    glassPurchaseOrderFields?: Record<string, unknown>;
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
  // 3A's requirement/quote/payment/order/arrival/QC dates live on its own glass_purchase_orders
  // row (see GlassPurchaseOrder in schema.prisma) rather than fields on the project or another
  // step — the same "output that has to go with a revert" idea as 1A/1D above, just a third
  // table. No direct `fields`/`stepFields` here; glassPurchaseOrderFields is handled by its own
  // branch below, and its action-plan follow-up rows (GlassActionItem) by clearProjectOutputs
  // directly, since a bare field-clear can't cascade the way deleting the parent row would.
  "3A": {
    fields: {},
    label: "the glass PO tracker's dates, notes and action plan",
    needsConsent: true,
    glassPurchaseOrderFields: {
      requirementCreatedAt: null,
      requirementNote: null,
      requirementPlannedDate: null,
      quoteCreatedAt: null,
      quoteNote: null,
      quotePlannedDate: null,
      paymentSettledAt: null,
      paymentNote: null,
      paymentPlannedDate: null,
      orderConfirmedAt: null,
      orderNote: null,
      orderPlannedDate: null,
      actualArrivalDate: null,
      arrivalNote: null,
      arrivalPlannedDate: null,
      qcCheckedAt: null,
      qcCheckedBy: null,
      qcPassed: null,
      qcNote: null,
      qcPlannedDate: null,
      actionPlanAt: null,
      actionPlanNote: null,
    },
  },
  // 3B ("Glass delivery") is derived from the same glass_purchase_orders row's Actual arrival
  // stage (see syncGlassPOStepStatus) — reverting it clears just that stage, not the whole row
  // (3A's own entry above already owns clearing everything, including these same two fields, for
  // when 3A itself is reverted). Planned stays: an arrival date someone already scheduled isn't
  // discarded just because the actual outcome is being corrected.
  "3B": {
    fields: {},
    label: "the glass PO tracker's actual arrival date",
    needsConsent: true,
    glassPurchaseOrderFields: {
      actualArrivalDate: null,
      arrivalNote: null,
    },
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

  const glassPurchaseOrderFields = outputs.find((o) => o.glassPurchaseOrderFields)?.glassPurchaseOrderFields;
  if (glassPurchaseOrderFields) {
    await prisma.glassPurchaseOrder.updateMany({ where: { projectId }, data: glassPurchaseOrderFields });
    // A field-clear on the parent row doesn't cascade the way deleting it would — its action-plan
    // follow-up rows (only ever created after a QC failure that's now being wiped away) need to
    // go explicitly.
    await prisma.glassActionItem.deleteMany({ where: { glassPurchaseOrder: { projectId } } });
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
 *
 * 3A/3B are swept up here like any other non-derived step (neither is in DERIVED_STEP_CODES —
 * see syncGlassPOStepStatus for why), so this also clears their glass_purchase_orders fields via
 * clearProjectOutputs — otherwise a downgrade reached through syncDerivedStepStatus (e.g. 2F
 * un-completing because a QC checkbox got unchecked) would reset their status here but leave the
 * underlying glass PO data sitting there unrecorded-but-still-present, ready to fight the status
 * back to completed the next time that row is edited.
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
          delayCategory: null,
          notes: null,
          // 3E only — its QC outcome and action plan describe work being reset here, same as
          // any other cleared field above; its action-item follow-up rows go separately below,
          // since a field-clear on this row doesn't cascade the way deleting it would.
          ...(s.stepCode === "3E" ? { qcCheckedAt: null, qcPassed: null, actionPlanAt: null, actionPlanNote: null } : {}),
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

  const revertedCodes = toRevert.map((s) => s.stepCode);
  if (revertedCodes.includes("3E")) {
    await prisma.phaseStepActionItem.deleteMany({ where: { phaseStep: { projectId, stepCode: "3E" } } });
  }
  await clearProjectOutputs(projectId, revertedCodes);
  return revertedCodes;
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
  // Derived steps stamp their actual start/end from the procurement data that drives them,
  // not from "now" (the moment this sync happens to run) — real dates can be backdated or
  // simply lag behind when the sync actually fires. `derivedStartAnchor` covers the first
  // progress made (only 2D1 uses it — 2A's own case is handled separately below, off its own
  // planned finish); `derivedCompletedAt` covers full completion, for both 2A and 2D1.
  let derivedStartAnchor: Date | null = null;
  let derivedCompletedAt: Date | null = null;
  if (stepCode === "2A") {
    const s = await getRequirementCreatedStatus(projectId);
    complete = s.complete;
    anyProgress = s.items.some((i) => i.created);
    if (complete) {
      const dates = s.items
        .map((i) => i.requirementCreatedAt)
        .filter((d): d is Date => d !== null);
      derivedCompletedAt = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    }
  } else if (stepCode === "2D1") {
    const s = await getMaterialsArrivedStatus(projectId);
    complete = s.complete;
    anyProgress = s.items.some((i) => i.arrived);

    // Once any item has actually arrived, 2D1 is treated as having started the moment the
    // last order was confirmed — that's the point goods were fully in transit, not whatever
    // instant the first arrival happened to get checked.
    const orderDates = s.items.map((i) => i.orderConfirmedAt).filter((d): d is Date => d !== null);
    derivedStartAnchor = orderDates.length > 0 ? new Date(Math.max(...orderDates.map((d) => d.getTime()))) : null;

    if (complete) {
      const arrivalDates = s.items.map((i) => i.actualArrivalDate).filter((d): d is Date => d !== null);
      derivedCompletedAt = arrivalDates.length > 0 ? new Date(Math.max(...arrivalDates.map((d) => d.getTime()))) : null;
    }
  } else {
    const s = await getMaterialQCStatus(projectId);
    complete = s.complete;
    anyProgress = s.items.some((i) => i.qcChecked);
  }

  const newStatus: StepStatus = complete ? "completed" : anyProgress ? "in_progress" : "not_started";
  if (newStatus === step.status) return;

  const isDowngrade = STATUS_RANK[newStatus] < STATUS_RANK[step.status];
  const now = new Date();

  // 2A's actual start, the first time real progress is made, is set to 2A's own planned
  // finish (same day) rather than whatever moment the first requirement box happened to get
  // checked. plannedEndDate is 2A's single source of truth for "when it was expected to
  // begin" — already 1D's actual end + 1 day by construction (1 day duration, dependsOn 1D —
  // see step-template.ts), so this stays in sync with the schedule automatically rather than
  // re-deriving the same anchor by hand. 2D1 uses derivedStartAnchor instead (see above).
  let actualStartAnchor = now;
  if (newStatus !== "not_started" && !step.actualStartDate) {
    if (stepCode === "2A" && step.plannedEndDate) {
      actualStartAnchor = step.plannedEndDate;
    } else if (derivedStartAnchor) {
      actualStartAnchor = derivedStartAnchor;
    }
  }

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
        newStatus === "not_started" ? null : !step.actualStartDate ? actualStartAnchor : undefined,
      actualEndDate: newStatus === "completed" ? (derivedCompletedAt ?? now) : null,
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

/**
 * Keeps 3A ("Glass PO: requirement, quote, payment") and 3B ("Glass delivery") in sync with the
 * glass_purchase_orders row that now drives both — same spirit as syncDerivedStepStatus above,
 * but deliberately a separate, smaller function rather than a third branch there: that one is
 * shaped around procurement_items' 3-items-per-project, multi-stage lifecycle
 * (PROCUREMENT_LIFECYCLE, DERIVED_STEP_STAGE), none of which fits a single glass-PO row. Kept out
 * of DERIVED_STEP_CODES for the same reason — that set feeds planStepRevert's procurement-reset
 * math (fromStage/DERIVED_STEP_STAGE), which is hard-wired to the section/hardware/gasket chain;
 * folding either in there would make reverting it alone wipe out unrelated procurement data.
 * Instead 3A/3B revert as ordinary steps (see STEP_PROJECT_OUTPUTS above), and this function is
 * what re-derives their status afterward once the glass PO row is cleared.
 *
 * Unlike syncDerivedStepStatus, this always writes the current dates onto each step (not just
 * once, the first time progress is made) — a correction in the glass PO tracker has to show up
 * here too, not just the initial value. 3A tracks "Requirement created" (start) / "Order
 * confirmed" (end), same as always. 3B tracks only "Actual arrival" — there's no separate start
 * to it, just a planned date and an actual one (and unlike 3A, that planned date does get written
 * onto the step — see syncOneGlassPODerivedStep's newPlannedEnd). 3B has no Start/Mark complete
 * CTA either — see GLASS_PO_STEP_CODES in TaskCard.tsx.
 */
export async function syncGlassPOStepStatus(projectId: string, actorId: string) {
  const glassPO = await prisma.glassPurchaseOrder.findUnique({ where: { projectId } });
  if (!glassPO) return;

  await syncOneGlassPODerivedStep(projectId, "3A", actorId, {
    complete: glassPO.orderConfirmedAt !== null,
    anyProgress: glassPO.requirementCreatedAt !== null,
    newStart: glassPO.requirementCreatedAt,
    newEnd: glassPO.orderConfirmedAt,
  });

  await syncOneGlassPODerivedStep(projectId, "3B", actorId, {
    complete: glassPO.actualArrivalDate !== null,
    anyProgress: glassPO.arrivalPlannedDate !== null,
    newStart: null,
    newEnd: glassPO.actualArrivalDate,
    newPlannedEnd: glassPO.arrivalPlannedDate,
  });
}

async function syncOneGlassPODerivedStep(
  projectId: string,
  stepCode: "3A" | "3B",
  actorId: string,
  derived: {
    complete: boolean;
    anyProgress: boolean;
    newStart: Date | null;
    newEnd: Date | null;
    /** Omitted (3A's case) = this step's planned_end_date is left alone entirely — Phase 3 stays
     *  unplanned by default (see rescheduleProjectDates's phase_3 exclusion). */
    newPlannedEnd?: Date | null;
  }
) {
  const step = await prisma.phaseStep.findFirst({ where: { projectId, stepCode } });
  if (!step) return;

  const { complete, anyProgress, newStart, newEnd, newPlannedEnd } = derived;
  const newStatus: StepStatus = complete ? "completed" : anyProgress ? "in_progress" : "not_started";

  const statusChanged = newStatus !== step.status;
  const startChanged = (newStart?.getTime() ?? null) !== (step.actualStartDate?.getTime() ?? null);
  const endChanged = (newEnd?.getTime() ?? null) !== (step.actualEndDate?.getTime() ?? null);
  const plannedEndChanged =
    newPlannedEnd !== undefined && (newPlannedEnd?.getTime() ?? null) !== (step.plannedEndDate?.getTime() ?? null);
  if (!statusChanged && !startChanged && !endChanged && !plannedEndChanged) return;

  const isDowngrade = STATUS_RANK[newStatus] < STATUS_RANK[step.status];

  await prisma.phaseStep.update({
    where: { id: step.id },
    data: {
      status: newStatus,
      blockedReason: null,
      blockedNote: null,
      actualStartDate: newStart,
      actualEndDate: newEnd,
      ...(newPlannedEnd !== undefined ? { plannedEndDate: newPlannedEnd } : {}),
    },
  });

  if (statusChanged) {
    await prisma.stepStatusLog.create({
      data: {
        phaseStepId: step.id,
        changedByUserId: actorId,
        oldStatus: step.status,
        newStatus,
        reason: isDowngrade
          ? "Auto-derived from the glass PO tracker — reverted as its data was cleared"
          : "Auto-derived from the glass PO tracker",
      },
    });
  }

  if (isDowngrade) {
    await cascadeRevertLaterSteps(
      projectId,
      stepCode,
      actorId,
      `Reverted with upstream ${stepCode} (glass PO data cleared)`
    );
  }

  await recomputeProjectPhase(projectId);
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

  // Deliberately not folded into DERIVED_STEP_CODES — see syncGlassPOStepStatus for why.
  if (step.stepCode === "3A" || step.stepCode === "3B") {
    throw new StepActionError(
      400,
      `${step.stepCode}'s status is derived from the glass PO tracker and can't be set manually`
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

  // 3E can only reach "completed" once QC has actually passed — a Fail is recorded without a
  // status transition at all (see /api/phase-steps/[id]), so reaching this point with newStatus
  // "completed" for 3E should always carry qcPassed: true. Guards against a stray direct call
  // (or a future caller) completing 3E some other way and slipping past the check that keeps
  // recomputeProjectPhase from ever calling the project done off a failed final QC.
  if (step.stepCode === "3E" && newStatus === "completed" && options.qcPassed !== true) {
    throw new StepActionError(400, "3E can only be completed once QC has passed");
  }

  // A late completion of one of DELAY_CATEGORY_STEP_CODES needs to say whether the client or
  // the team caused the slip — reschedule.ts reads it, generically, to decide whether the next
  // step's planned finish should move with the late actual end (client_side) or stay put
  // (in_house). Reachable two ways: the actual end was already set to a late date before this
  // call (the admin canEditDates flow bundles the dates PATCH first — see submitWithDates in
  // TaskCard.tsx), or this same call is supplying a late actualEndDate directly via options
  // (the /my-tasks table's own date input, open to every department — see UpdateStepStatusOptions).
  // The plain "defaults to now" completion path has neither, so it's never blocked by this.
  const effectiveActualEndDate = step.actualEndDate ?? options.actualEndDate;
  const needsDelayCategory =
    DELAY_CATEGORY_STEP_CODES.has(step.stepCode) &&
    newStatus === "completed" &&
    !!effectiveActualEndDate &&
    !!step.plannedEndDate &&
    effectiveActualEndDate.getTime() > step.plannedEndDate.getTime();
  if (needsDelayCategory && !options.delayCategory) {
    throw new StepActionError(400, `delayCategory is required when ${step.stepCode} completes late`);
  }

  const now = new Date();
  const oldStatus = step.status;

  const updated = await prisma.phaseStep.update({
    where: { id: stepId },
    data: {
      status: newStatus,
      blockedReason: newStatus === "blocked" ? options.blockedReason : null,
      blockedNote: newStatus === "blocked" ? options.blockedNote ?? null : null,
      delayCategory: needsDelayCategory ? options.delayCategory : null,
      notes: options.notes !== undefined ? options.notes : undefined,
      actualStartDate: newStatus === "in_progress" && !step.actualStartDate ? (options.actualStartDate ?? now) : undefined,
      // Mirrors the actualStartDate guard just above: don't clobber an actual_end_date the
      // caller already set (e.g. via the dates PATCH bundled into the same "Mark complete"
      // click — see submitWithDates in TaskCard.tsx) by defaulting it to "now" a moment later.
      actualEndDate: newStatus === "completed" && !step.actualEndDate ? (options.actualEndDate ?? now) : undefined,
      // Guarded above to always be true by the time newStatus is "completed" for 3E.
      ...(step.stepCode === "3E" && newStatus === "completed" ? { qcPassed: true, qcCheckedAt: now } : {}),
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

    if (step.stepCode === "1B") {
      await autoStartStep(
        step.projectId,
        "1C",
        actorId,
        addDays(updated.actualEndDate ?? now, 1),
        "Auto-started: site visit (1B) completed"
      );
    }

    if (step.stepCode === "1C") {
      await autoStartStep(
        step.projectId,
        "1D",
        actorId,
        addDays(updated.actualEndDate ?? now, 1),
        "Auto-started: revised drawing confirmation (1C) completed"
      );
    }

    await seedNextPhaseIfNeeded(step.projectId, step.stepCode, updated.actualEndDate ?? now, step.project.glassType);

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
          delayCategory: null,
          notes: null,
          actualStartDate: toStatus === "not_started" ? null : undefined,
          actualEndDate: null,
          ...(plan.step.stepCode === "3E"
            ? { qcCheckedAt: null, qcPassed: null, actionPlanAt: null, actionPlanNote: null }
            : {}),
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
    if (plan.step.stepCode === "3E") {
      await prisma.phaseStepActionItem.deleteMany({ where: { phaseStepId: stepId } });
    }
  }

  const cascaded = await cascadeRevertLaterSteps(
    projectId,
    plan.step.stepCode,
    actorId,
    `Reverted with upstream ${plan.step.stepCode} — ${reason}`
  );

  // Data these steps wrote onto the project itself goes with them, same as their own rows.
  // `cascaded` already had its own outputs cleared inside cascadeRevertLaterSteps — this only
  // needs to cover the revert target itself and whatever procurementReset separately reset.
  await clearProjectOutputs(projectId, [plan.step.stepCode, ...(plan.procurementReset?.stepCodes ?? [])]);

  // Neither 3A nor 3B is derived in the DERIVED_STEP_CODES sense (see syncGlassPOStepStatus for
  // why), so when either is the direct target the block above just gave it a plain manual-step
  // revert (status -> in_progress, dates left as they were) — this corrects that to whatever the
  // now-cleared glass PO row actually implies (not_started). A no-op when they only appear via
  // `cascaded`, since cascadeRevertLaterSteps already wrote the correct not_started status and
  // cleared dates for that case directly.
  const revertedStepCodes = [plan.step.stepCode, ...cascaded];
  if (revertedStepCodes.includes("3A") || revertedStepCodes.includes("3B")) {
    await syncGlassPOStepStatus(projectId, actorId);
  }

  await recomputeProjectPhase(projectId);
  await rescheduleProjectDates(projectId);
  await refreshProjectOverallStatus(projectId);

  return { plan, step: await prisma.phaseStep.findUnique({ where: { id: stepId } }) };
}
