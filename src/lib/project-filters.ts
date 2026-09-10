import type { Department, ItemType, StepPhase } from "@prisma/client";

export interface StageSpec<T> {
  field: keyof T;
  department: Department;
  /** Purchase owns every other stage in this lifecycle and needs visibility on Payment too —
   *  mirrors PhaseStep's owningDepartment + secondaryDepartment (see 1A). Only set on Payment. */
  secondaryDepartment?: Department;
}

/** Exported for /my-tasks' unified task aggregator (unified-tasks.ts), which needs the *whole*
 *  matched stage (not just its department) to build a task row — field name, both departments. */
export function firstUnfilledStage<T>(record: T, stages: StageSpec<T>[]): StageSpec<T> | null {
  return stages.find((s) => record[s.field] === null) ?? null;
}

function firstUnfilledDepartment<T>(record: T, stages: StageSpec<T>[]): Department | null {
  return firstUnfilledStage(record, stages)?.department ?? null;
}

export interface ProcurementItemFields {
  requirementCreatedAt: Date | null;
  quoteCreatedAt: Date | null;
  paymentSettledAt: Date | null;
  orderConfirmedAt: Date | null;
  materialDespatchAt: Date | null;
  arrivedForPowderCoatingAt: Date | null;
  actualArrivalDate: Date | null;
  qcCheckedAt: Date | null;
}

// Mirrors the fixed lifecycle order the Procurement tracker displays (see the department tags
// added there) — section alone carries 2 extra stages (despatch, powder coating) between Order
// confirmed and Actual arrival; hardware/gasket skip straight from Order confirmed to Arrival.
export const PROCUREMENT_STAGES: Record<ItemType, StageSpec<ProcurementItemFields>[]> = {
  section: [
    { field: "requirementCreatedAt", department: "design_engineer" },
    { field: "quoteCreatedAt", department: "purchase" },
    { field: "paymentSettledAt", department: "accounts", secondaryDepartment: "purchase" },
    { field: "orderConfirmedAt", department: "purchase" },
    { field: "materialDespatchAt", department: "purchase" },
    { field: "arrivedForPowderCoatingAt", department: "purchase" },
    { field: "actualArrivalDate", department: "purchase" },
    { field: "qcCheckedAt", department: "purchase" },
  ],
  hardware: [
    { field: "requirementCreatedAt", department: "design_engineer" },
    { field: "quoteCreatedAt", department: "purchase" },
    { field: "paymentSettledAt", department: "accounts", secondaryDepartment: "purchase" },
    { field: "orderConfirmedAt", department: "purchase" },
    { field: "actualArrivalDate", department: "purchase" },
    { field: "qcCheckedAt", department: "purchase" },
  ],
  gasket: [
    { field: "requirementCreatedAt", department: "design_engineer" },
    { field: "quoteCreatedAt", department: "purchase" },
    { field: "paymentSettledAt", department: "accounts", secondaryDepartment: "purchase" },
    { field: "orderConfirmedAt", department: "purchase" },
    { field: "actualArrivalDate", department: "purchase" },
    { field: "qcCheckedAt", department: "purchase" },
  ],
};

/** The department that owns this item's *next* unfilled stage — null once every stage is done.
 *  Not just "any unfilled field": a stage further down the list (e.g. Payment) isn't really
 *  "with" its department yet if an earlier one (Requirement created) hasn't happened either —
 *  the earlier department still holds the ball. */
export function currentProcurementItemDepartment(
  item: { itemType: ItemType } & ProcurementItemFields
): Department | null {
  return firstUnfilledDepartment(item, PROCUREMENT_STAGES[item.itemType]);
}

export interface GlassPurchaseOrderFields {
  requirementCreatedAt: Date | null;
  quoteCreatedAt: Date | null;
  paymentSettledAt: Date | null;
  orderConfirmedAt: Date | null;
}

export const GLASS_PO_STAGES: StageSpec<GlassPurchaseOrderFields>[] = [
  { field: "requirementCreatedAt", department: "design_engineer" },
  { field: "quoteCreatedAt", department: "purchase" },
  { field: "paymentSettledAt", department: "accounts", secondaryDepartment: "purchase" },
  { field: "orderConfirmedAt", department: "purchase" },
];

/** Same "next unfilled stage" rule as currentProcurementItemDepartment, for 3A's glass PO row.
 *  Null when there's no row yet (project hasn't reached phase 3) or every stage is done. */
export function currentGlassPODepartment(glassPurchaseOrder: GlassPurchaseOrderFields | null): Department | null {
  return glassPurchaseOrder ? firstUnfilledDepartment(glassPurchaseOrder, GLASS_PO_STAGES) : null;
}

export interface CurrentStepDepartments {
  owningDepartment: Department;
  secondaryDepartment: Department | null;
}

/** Owning + secondary department of a project's current step (see /projects' getCurrentStep) —
 *  empty once the project has none (every phase_step completed). */
export function currentStepDepartments(currentStep: CurrentStepDepartments | null): Department[] {
  if (!currentStep) return [];
  return currentStep.secondaryDepartment
    ? [currentStep.owningDepartment, currentStep.secondaryDepartment]
    : [currentStep.owningDepartment];
}

/**
 * Every department that currently has the ball on this project — the union of:
 *
 * 1. The current phase_step's department(s) — 1A through 3E, whatever status it's in
 *    (not_started, in_progress, or blocked all count; only "completed" doesn't).
 * 2. Independently, whichever department owns the first unfilled stage of each procurement item
 *    and the glass PO. These run in parallel to the phase_step timeline, not gated by it — 2D2
 *    and Payment in particular don't block anything downstream, so they can stay open long after
 *    the phase_step "current step" has moved on to something else entirely.
 *
 * #2 only counts once the project has actually reached Phase 2 (1D complete). Every project's 3
 * procurement_items rows exist from day one — created up front for planned-date scheduling, same
 * as every Phase 1+2 phase_step (see the day-one-scheduling feature) — so a brand-new project
 * sitting at 1A already technically "has" 3 empty items whose first unfilled stage is Requirement
 * created (Design Engineer). That's not actually current work yet: nobody can act on it before
 * 1D anyway, so counting it would falsely flag Design Engineer on every single project regardless
 * of phase. The glass PO row doesn't have this problem — it's only ever created once Phase 3
 * actually starts (2F complete), so a null `glassPurchaseOrder` already means "not reached yet".
 *
 * This is what /projects' department filter matches against — "is the current work on this
 * project with department X", not "has X ever touched it, whether or not it's still open".
 */
export function getProjectActiveDepartments(
  currentStep: CurrentStepDepartments | null,
  hasReachedPhase2: boolean,
  procurementItems: ({ itemType: ItemType } & ProcurementItemFields)[],
  glassPurchaseOrder: GlassPurchaseOrderFields | null
): Set<Department> {
  const departments = new Set<Department>(currentStepDepartments(currentStep));
  if (hasReachedPhase2) {
    for (const item of procurementItems) {
      const stage = firstUnfilledStage(item, PROCUREMENT_STAGES[item.itemType]);
      if (stage) {
        departments.add(stage.department);
        if (stage.secondaryDepartment) departments.add(stage.secondaryDepartment);
      }
    }
  }
  if (glassPurchaseOrder) {
    const glassStage = firstUnfilledStage(glassPurchaseOrder, GLASS_PO_STAGES);
    if (glassStage) {
      departments.add(glassStage.department);
      if (glassStage.secondaryDepartment) departments.add(glassStage.secondaryDepartment);
    }
  }
  return departments;
}

export type PhaseProgress = "not_started" | "in_progress" | "completed";

const PHASE_ORDER = ["phase_1", "phase_2", "phase_3"] as const satisfies readonly StepPhase[];

function previousPhase(phase: StepPhase): StepPhase | null {
  const index = PHASE_ORDER.indexOf(phase);
  return index > 0 ? PHASE_ORDER[index - 1] : null;
}

/**
 * Where a single phase's own steps stand — deliberately independent of project.current_phase,
 * which only tracks the project's furthest-reached phase, not each phase's own state.
 *
 * "not_started" specifically means *reached but idle* — the phase before it is fully completed
 * (phase_1 has none, so it's always eligible), yet nothing in this phase has been touched.
 * A phase a project hasn't gotten anywhere near yet (e.g. Phase 3 on a project still on 1B) has
 * no rows either and would otherwise look identical to that — returning null instead keeps such
 * a project out of every one of this phase's 3 buckets, so "Phase 3 · Not started" only ever
 * lists projects that just arrived at Phase 3 and haven't started it, per the /projects filter
 * (see matchesPhaseProgressFilter) — not everyone who simply isn't there yet.
 *
 * The exception is maybeEarlyUnlockPhase3: Phase 3 rows can be seeded, and even worked on,
 * before Phase 2's own gate step (2F) completes. Real touched work always counts as in_progress
 * or completed regardless of the phase before it — the previous-phase check only ever applies
 * while this phase itself still looks untouched.
 */
export function getPhaseProgress(
  steps: { phase: StepPhase; status: "not_started" | "in_progress" | "blocked" | "completed" }[],
  targetPhase: StepPhase
): PhaseProgress | null {
  const phaseSteps = steps.filter((s) => s.phase === targetPhase);
  const isUntouched = phaseSteps.length === 0 || phaseSteps.every((s) => s.status === "not_started");

  if (isUntouched) {
    const prev = previousPhase(targetPhase);
    if (prev) {
      const prevSteps = steps.filter((s) => s.phase === prev);
      const prevCompleted = prevSteps.length > 0 && prevSteps.every((s) => s.status === "completed");
      if (!prevCompleted) return null;
    }
    return "not_started";
  }

  if (phaseSteps.every((s) => s.status === "completed")) return "completed";
  return "in_progress";
}

const PHASE_PROGRESS_SHORT_LABEL: Record<StepPhase, string> = {
  phase_1: "Phase 1",
  phase_2: "Phase 2",
  phase_3: "Phase 3",
};

const PROGRESS_LABEL: Record<PhaseProgress, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

const PHASE_PROGRESS_PHASES = ["phase_1", "phase_2", "phase_3"] as const satisfies readonly StepPhase[];
const PHASE_PROGRESS_STATES = ["not_started", "in_progress", "completed"] as const satisfies readonly PhaseProgress[];

export interface PhaseProgressFilterOption {
  /** Goes straight into the /projects `phase` query param and <option value>. */
  value: string;
  label: string;
  phase: StepPhase;
  progress: PhaseProgress;
}

/** The /projects phase filter's full option list — every (phase, progress) pair, in phase then
 *  workflow order. "Phase 3 · Completed" and the project being fully `completed` are the same
 *  moment in practice (3E is the last step in the last phase), so there's no separate "overall
 *  completed" bucket here — it'd just be a second name for this one. */
export const PHASE_PROGRESS_FILTER_OPTIONS: PhaseProgressFilterOption[] = PHASE_PROGRESS_PHASES.flatMap((phase) =>
  PHASE_PROGRESS_STATES.map((progress) => ({
    value: `${phase}.${progress}`,
    label: `${PHASE_PROGRESS_SHORT_LABEL[phase]} · ${PROGRESS_LABEL[progress]}`,
    phase,
    progress,
  }))
);

/** True when a project's steps match the given /projects phase-filter value (one of
 *  PHASE_PROGRESS_FILTER_OPTIONS's own values). An unrecognized value matches nothing — same as
 *  a stale/bogus currentStep code in page.tsx's own filter — since the UI itself only ever sets
 *  one of the fixed option values. */
export function matchesPhaseProgressFilter(
  filterValue: string,
  steps: { phase: StepPhase; status: "not_started" | "in_progress" | "blocked" | "completed" }[]
): boolean {
  const option = PHASE_PROGRESS_FILTER_OPTIONS.find((o) => o.value === filterValue);
  if (!option) return false;
  return getPhaseProgress(steps, option.phase) === option.progress;
}
