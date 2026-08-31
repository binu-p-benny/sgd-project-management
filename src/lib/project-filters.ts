import type { Department, ItemType } from "@prisma/client";

interface StageSpec<T> {
  field: keyof T;
  department: Department;
}

function firstUnfilledDepartment<T>(record: T, stages: StageSpec<T>[]): Department | null {
  return stages.find((s) => record[s.field] === null)?.department ?? null;
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
const PROCUREMENT_STAGES: Record<ItemType, StageSpec<ProcurementItemFields>[]> = {
  section: [
    { field: "requirementCreatedAt", department: "design_engineer" },
    { field: "quoteCreatedAt", department: "purchase" },
    { field: "paymentSettledAt", department: "accounts" },
    { field: "orderConfirmedAt", department: "purchase" },
    { field: "materialDespatchAt", department: "purchase" },
    { field: "arrivedForPowderCoatingAt", department: "purchase" },
    { field: "actualArrivalDate", department: "purchase" },
    { field: "qcCheckedAt", department: "purchase" },
  ],
  hardware: [
    { field: "requirementCreatedAt", department: "design_engineer" },
    { field: "quoteCreatedAt", department: "purchase" },
    { field: "paymentSettledAt", department: "accounts" },
    { field: "orderConfirmedAt", department: "purchase" },
    { field: "actualArrivalDate", department: "purchase" },
    { field: "qcCheckedAt", department: "purchase" },
  ],
  gasket: [
    { field: "requirementCreatedAt", department: "design_engineer" },
    { field: "quoteCreatedAt", department: "purchase" },
    { field: "paymentSettledAt", department: "accounts" },
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

const GLASS_PO_STAGES: StageSpec<GlassPurchaseOrderFields>[] = [
  { field: "requirementCreatedAt", department: "design_engineer" },
  { field: "quoteCreatedAt", department: "purchase" },
  { field: "paymentSettledAt", department: "accounts" },
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
      const d = currentProcurementItemDepartment(item);
      if (d) departments.add(d);
    }
  }
  const glassDept = currentGlassPODepartment(glassPurchaseOrder);
  if (glassDept) departments.add(glassDept);
  return departments;
}
