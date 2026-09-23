/**
 * Overrun is computed at query time (today > planned_end_date / expected_arrival_date
 * and the record isn't complete) rather than via a cron job, per the build spec —
 * a background job can be added later if computing this on every read gets expensive.
 *
 * "Today" is compared as a whole calendar day, not an exact instant: a date due at any point
 * today isn't overdue *yet* just because the clock has ticked past whatever time-of-day its own
 * timestamp happens to carry (usually midnight, an artifact of how it was originally computed,
 * not a real deadline hour) — see endOfDay/isSameCalendarDay below, and isDueToday, the sibling
 * check every "Overdue" badge in the app pairs with to show a distinct "Due today" one instead.
 */

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** Same calendar day in local time, regardless of either value's own time-of-day — the
 *  building block behind isDueToday below. */
export function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * True once `date`'s calendar day is today — the sibling every overdue check below pairs with,
 * so a badge can read "Due today" instead of "Overdue" for the one day that's neither yet late
 * nor genuinely upcoming. Takes a plain Date or an ISO string so client components (which only
 * ever have the server-serialized string — ProcurementTracker's stage.plannedDate, TaskCard's
 * item.contractorPlannedDate, etc.) can call it directly rather than re-parsing first. Doesn't
 * take a "done yet" argument the way isStepOverrun/isProcurementStageOverrun do — every call site
 * already gates its own badge on "not done" first (isDone, !contractorId, etc.), so there's
 * nothing this needs to check that isn't already handled there.
 */
export function isDueToday(date: Date | string | null): boolean {
  if (!date) return false;
  return isSameCalendarDay(typeof date === "string" ? new Date(date) : date, new Date());
}

export function isStepOverrun(
  plannedEndDate: Date | null,
  status: "not_started" | "in_progress" | "blocked" | "completed"
): boolean {
  if (!plannedEndDate || status === "completed") return false;
  return new Date() > endOfDay(plannedEndDate);
}

/** Generic form behind isProcurementItemOverrun — true once `expected` has passed with
 *  nothing recorded against `actual` yet. Reused for the quote/payment due-date checks in
 *  the procurement tracker, which follow the same "expected but not done" shape as arrival. */
export function isProcurementStageOverrun(expected: Date | null, actual: Date | null): boolean {
  if (!expected || actual) return false;
  return new Date() > endOfDay(expected);
}

export function isProcurementItemOverrun(
  expectedArrivalDate: Date | null,
  actualArrivalDate: Date | null
): boolean {
  return isProcurementStageOverrun(expectedArrivalDate, actualArrivalDate);
}

/** True once a manual-contractor step's target date (see MANUAL_CONTRACTOR_STEP_CODES in
 *  step-actions.ts) has passed with no contractor chosen yet — same "expected but not done"
 *  shape as isProcurementStageOverrun, just keyed on the presence of an id rather than a date. */
export function isContractorSelectionOverdue(plannedDate: Date | null, contractorId: string | null): boolean {
  if (!plannedDate || contractorId) return false;
  return new Date() > endOfDay(plannedDate);
}

export function daysBlocked(updatedAt: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((Date.now() - updatedAt.getTime()) / msPerDay);
}

/** The 6 stored planned/actual date-column pairs on a Glass PO row (see GlassPurchaseOrder in
 *  schema.prisma) — duplicated here rather than imported from GLASS_PO_FULL_STAGES
 *  (unified-tasks.ts), which already imports the overrun checks below and would make this a
 *  circular import. Unlike a ProcurementItem's non-arrival stages, every one of these has its
 *  own real stored planned-date column (not a computed anchor chain), so checking them here is
 *  cheap — no extra query or per-item computation needed beyond selecting the columns. */
export interface GlassPurchaseOrderOverrunFields {
  requirementCreatedAt: Date | null;
  requirementPlannedDate: Date | null;
  quoteCreatedAt: Date | null;
  quotePlannedDate: Date | null;
  paymentSettledAt: Date | null;
  paymentPlannedDate: Date | null;
  orderConfirmedAt: Date | null;
  orderPlannedDate: Date | null;
  actualArrivalDate: Date | null;
  arrivalPlannedDate: Date | null;
  qcCheckedAt: Date | null;
  qcPlannedDate: Date | null;
}

/** The first of the Glass PO's 6 stages (in its fixed order) that's overdue — null once none
 *  are. Shared by projectHasOverrun (just needs the boolean) and getProjectDelayReason (needs
 *  which one, and since when) so the stage list itself is only ever written out once. */
function overdueGlassPOStage(
  glassPO: GlassPurchaseOrderOverrunFields
): { label: string; plannedDate: Date } | null {
  const stages: { label: string; planned: Date | null; actual: Date | null }[] = [
    { label: "Requirement created", planned: glassPO.requirementPlannedDate, actual: glassPO.requirementCreatedAt },
    { label: "Quote created", planned: glassPO.quotePlannedDate, actual: glassPO.quoteCreatedAt },
    { label: "Payment done", planned: glassPO.paymentPlannedDate, actual: glassPO.paymentSettledAt },
    { label: "Order confirmed", planned: glassPO.orderPlannedDate, actual: glassPO.orderConfirmedAt },
    { label: "Actual arrival", planned: glassPO.arrivalPlannedDate, actual: glassPO.actualArrivalDate },
    { label: "QC checked", planned: glassPO.qcPlannedDate, actual: glassPO.qcCheckedAt },
  ];
  const found = stages.find((s) => isProcurementStageOverrun(s.planned, s.actual));
  return found ? { label: found.label, plannedDate: found.planned! } : null;
}

/** Same idea as overdueGlassPOStage, for one ProcurementItem's own stage list (see
 *  procurement.ts's procurementItemStages, embedded on each item as `.stages` by
 *  withLiveExpectedArrivalDates) — the first of *any* of its stages that's overdue, not just
 *  Actual arrival. */
function overdueProcurementItemStage(
  stages: { label: string; planned: Date | null; actual: Date | null }[]
): { label: string; plannedDate: Date } | null {
  const found = stages.find((s) => isProcurementStageOverrun(s.planned, s.actual));
  return found ? { label: found.label, plannedDate: found.planned! } : null;
}

/**
 * Whether anything on this project is currently overdue — a phase step past its planned end, any
 * stage of a procurement item's own lifecycle past its (live-computed) planned date, or (see
 * overdueGlassPOStage) any of the Glass PO's own 6 stages past its own planned date. The Glass PO
 * check used to be missed entirely — a project could sit at "On track" while its Requirement
 * created (say) was genuinely overdue, since this function never looked at glassPurchaseOrder at
 * all — and a ProcurementItem's own non-arrival stages (Quote/Payment/Order/etc.) were left out
 * on purpose for the same reason a while after that: unlike the Glass PO, they have no stored
 * planned-date column of their own, and redoing the live anchor+chain computation for every item
 * on every project was assumed too expensive for a list/dashboard page to check just for this.
 * That's no longer true — every caller already runs that computation to get a live (not frozen)
 * arrival date via withLiveExpectedArrivalDates, so checking the item's other stages costs
 * nothing extra; `.stages` is that same call's by-product (see procurement.ts).
 */
export function projectHasOverrun(
  steps: { plannedEndDate: Date | null; status: "not_started" | "in_progress" | "blocked" | "completed" }[],
  procurementItems: { stages: { label: string; planned: Date | null; actual: Date | null }[] }[],
  glassPurchaseOrder: GlassPurchaseOrderOverrunFields | null
): boolean {
  return (
    steps.some((s) => isStepOverrun(s.plannedEndDate, s.status)) ||
    procurementItems.some((i) => overdueProcurementItemStage(i.stages) !== null) ||
    (!!glassPurchaseOrder && overdueGlassPOStage(glassPurchaseOrder) !== null)
  );
}

/** The step currently blocking a project — project.overall_status only tracks *that* something's
 *  blocked (see refreshProjectOverallStatus in step-actions.ts), the actual reason lives on the
 *  step itself. Earliest by step_code if more than one is somehow blocked at once, same "earliest
 *  in workflow order" convention /projects' own getCurrentStep uses. Null once nothing's blocked. */
export function getProjectBlockedStep<
  S extends { stepCode: string; status: "not_started" | "in_progress" | "blocked" | "completed" }
>(steps: S[]): S | null {
  return [...steps].sort((a, b) => a.stepCode.localeCompare(b.stepCode)).find((s) => s.status === "blocked") ?? null;
}

/** Every concrete cause behind a "delayed" effective status — the exact same signals
 *  projectHasOverrun checks (a step past its planned end, a procurement item's own stage past
 *  its planned date, or a Glass PO stage past its own planned date), except this collects *all*
 *  of them rather than stopping at the first: two procurement items (say Hardware and Gasket)
 *  can genuinely be overdue on different stages at the same time, and a project reading only one
 *  of them under-reports what's actually holding it up. Steps first, earliest by step_code; then
 *  one entry per procurement item (its own earliest overdue stage — an item can only ever be
 *  stuck at one stage at a time, since each depends on the one before it), in itemType order;
 *  then the Glass PO if its own earliest stage is overdue. Raw data only — no label text — so
 *  callers stay free to word it however their screen wants (see /projects' getStatusReasonText).
 */
export type ProjectDelayReason =
  | { kind: "step"; stepCode: string; stepName: string; plannedEndDate: Date }
  | { kind: "item"; itemType: string; stageLabel: string; plannedDate: Date }
  | { kind: "glass_po"; stageLabel: string; plannedDate: Date };

export function getProjectDelayReasons(
  steps: {
    stepCode: string;
    stepName: string;
    plannedEndDate: Date | null;
    status: "not_started" | "in_progress" | "blocked" | "completed";
  }[],
  procurementItems: { itemType: string; stages: { label: string; planned: Date | null; actual: Date | null }[] }[],
  glassPurchaseOrder: GlassPurchaseOrderOverrunFields | null
): ProjectDelayReason[] {
  const reasons: ProjectDelayReason[] = [];

  const overdueSteps = [...steps]
    .sort((a, b) => a.stepCode.localeCompare(b.stepCode))
    .filter((s) => isStepOverrun(s.plannedEndDate, s.status));
  for (const step of overdueSteps) {
    reasons.push({ kind: "step", stepCode: step.stepCode, stepName: step.stepName, plannedEndDate: step.plannedEndDate! });
  }

  for (const item of procurementItems) {
    const stage = overdueProcurementItemStage(item.stages);
    if (stage) {
      reasons.push({ kind: "item", itemType: item.itemType, stageLabel: stage.label, plannedDate: stage.plannedDate });
    }
  }

  const glassStage = glassPurchaseOrder ? overdueGlassPOStage(glassPurchaseOrder) : null;
  if (glassStage) {
    reasons.push({ kind: "glass_po", stageLabel: glassStage.label, plannedDate: glassStage.plannedDate });
  }

  return reasons;
}

/** The single highest-priority reason — same priority order getProjectDelayReasons already
 *  returns them in (steps, then procurement items, then Glass PO), just the first one. Kept
 *  alongside the plural version for a caller that only needs "the" reason, not every one. */
export function getProjectDelayReason(
  steps: Parameters<typeof getProjectDelayReasons>[0],
  procurementItems: Parameters<typeof getProjectDelayReasons>[1],
  glassPurchaseOrder: Parameters<typeof getProjectDelayReasons>[2]
): ProjectDelayReason | null {
  return getProjectDelayReasons(steps, procurementItems, glassPurchaseOrder)[0] ?? null;
}

/** The first concrete cause behind a "qc_failed" effective status — same signals
 *  getEffectiveOverallStatus's hasQcFailure argument is already built from (see /projects and
 *  the project detail page). Items checked first since there are normally 3 of them vs. one 3E;
 *  the Glass PO (at most one per project) checked last. */
export type ProjectQcFailureReason =
  | { kind: "item"; itemType: string }
  | { kind: "step"; stepCode: string; stepName: string }
  | { kind: "glass_po" };

export function getProjectQcFailureReason(
  steps: { stepCode: string; stepName: string; qcPassed: boolean | null }[],
  procurementItems: { itemType: string; qcPassed: boolean | null }[],
  glassPurchaseOrder: { qcPassed: boolean | null } | null
): ProjectQcFailureReason | null {
  const failedItem = procurementItems.find((i) => i.qcPassed === false);
  if (failedItem) return { kind: "item", itemType: failedItem.itemType };
  const failedStep = steps.find((s) => s.stepCode === "3E" && s.qcPassed === false);
  if (failedStep) return { kind: "step", stepCode: failedStep.stepCode, stepName: failedStep.stepName };
  if (glassPurchaseOrder?.qcPassed === false) return { kind: "glass_po" };
  return null;
}

/** Not a real `overall_status` value — never written to the column, only ever computed here,
 *  the same way `delayed` is date-driven rather than stored. Kept out of the Prisma enum since
 *  nothing needs to persist it; widening this one TS-level type is enough for it to flow
 *  through the label/color lookups and any page that wants to show it. */
export type EffectiveOverallStatus = "on_track" | "delayed" | "blocked" | "completed" | "qc_failed";

/**
 * `overall_status`'s stored value only tracks blocked/on_track/completed — those are
 * event-driven (something explicit happened) and kept in sync by step-actions.ts on
 * every mutation. `delayed` is date-driven: a project can *become* delayed with no one
 * touching it, so persisting it the same way would go stale. Compute it at read time
 * instead — this is the single place "what should the badge say" gets decided.
 *
 * `hasQcFailure` slots in between an explicit `blocked` (a human said so, which still wins)
 * and the date-driven `delayed` — a failed QC check is a specific, actionable reason a
 * project isn't moving, worth naming rather than folding into a generic "delayed". It's an
 * opt-in third argument (via overload) rather than always widening the return type: most
 * existing callers group/compare by the narrower stored `OverallStatus` and have no reason
 * to suddenly account for a 5th value they never asked for.
 */
export function getEffectiveOverallStatus(
  storedStatus: "on_track" | "delayed" | "blocked" | "completed",
  hasOverrun: boolean
): "on_track" | "delayed" | "blocked" | "completed";
export function getEffectiveOverallStatus(
  storedStatus: "on_track" | "delayed" | "blocked" | "completed",
  hasOverrun: boolean,
  hasQcFailure: boolean
): EffectiveOverallStatus;
export function getEffectiveOverallStatus(
  storedStatus: "on_track" | "delayed" | "blocked" | "completed",
  hasOverrun: boolean,
  hasQcFailure = false
): EffectiveOverallStatus {
  if (storedStatus === "completed" || storedStatus === "blocked") return storedStatus;
  if (hasQcFailure) return "qc_failed";
  return hasOverrun ? "delayed" : "on_track";
}
