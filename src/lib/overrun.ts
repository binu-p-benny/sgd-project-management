/**
 * Overrun is computed at query time (today > planned_end_date / expected_arrival_date
 * and the record isn't complete) rather than via a cron job, per the build spec —
 * a background job can be added later if computing this on every read gets expensive.
 */

export function isStepOverrun(
  plannedEndDate: Date | null,
  status: "not_started" | "in_progress" | "blocked" | "completed"
): boolean {
  if (!plannedEndDate || status === "completed") return false;
  return new Date() > plannedEndDate;
}

/** Generic form behind isProcurementItemOverrun — true once `expected` has passed with
 *  nothing recorded against `actual` yet. Reused for the quote/payment due-date checks in
 *  the procurement tracker, which follow the same "expected but not done" shape as arrival. */
export function isProcurementStageOverrun(expected: Date | null, actual: Date | null): boolean {
  if (!expected || actual) return false;
  return new Date() > expected;
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
  return new Date() > plannedDate;
}

export function daysBlocked(updatedAt: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((Date.now() - updatedAt.getTime()) / msPerDay);
}

export function projectHasOverrun(
  steps: { plannedEndDate: Date | null; status: "not_started" | "in_progress" | "blocked" | "completed" }[],
  procurementItems: { expectedArrivalDate: Date | null; actualArrivalDate: Date | null }[]
): boolean {
  return (
    steps.some((s) => isStepOverrun(s.plannedEndDate, s.status)) ||
    procurementItems.some((i) => isProcurementItemOverrun(i.expectedArrivalDate, i.actualArrivalDate))
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

/** The first concrete cause behind a "delayed" effective status — the exact same two signals
 *  projectHasOverrun checks (a step past its planned end, or an item's arrival past its expected
 *  date), so this only ever needs calling once that's already true. Steps checked first, earliest
 *  by step_code, so the earliest hold-up in workflow order wins over a procurement item's own
 *  arrival slip. Raw data only — no label text — so callers stay free to word it however their
 *  screen wants (see /projects' getStatusReasonText). */
export type ProjectDelayReason =
  | { kind: "step"; stepCode: string; stepName: string; plannedEndDate: Date }
  | { kind: "item"; itemType: string; expectedArrivalDate: Date };

export function getProjectDelayReason(
  steps: {
    stepCode: string;
    stepName: string;
    plannedEndDate: Date | null;
    status: "not_started" | "in_progress" | "blocked" | "completed";
  }[],
  procurementItems: { itemType: string; expectedArrivalDate: Date | null; actualArrivalDate: Date | null }[]
): ProjectDelayReason | null {
  const overdueStep = [...steps]
    .sort((a, b) => a.stepCode.localeCompare(b.stepCode))
    .find((s) => isStepOverrun(s.plannedEndDate, s.status));
  if (overdueStep) {
    return {
      kind: "step",
      stepCode: overdueStep.stepCode,
      stepName: overdueStep.stepName,
      plannedEndDate: overdueStep.plannedEndDate!,
    };
  }
  const overdueItem = procurementItems.find((i) => isProcurementItemOverrun(i.expectedArrivalDate, i.actualArrivalDate));
  if (overdueItem) {
    return { kind: "item", itemType: overdueItem.itemType, expectedArrivalDate: overdueItem.expectedArrivalDate! };
  }
  return null;
}

/** The first concrete cause behind a "qc_failed" effective status — same two signals
 *  getEffectiveOverallStatus's hasQcFailure argument is already built from (see /projects and
 *  the project detail page). Items checked first since there are normally 3 of them vs. one 3E. */
export type ProjectQcFailureReason = { kind: "item"; itemType: string } | { kind: "step"; stepCode: string; stepName: string };

export function getProjectQcFailureReason(
  steps: { stepCode: string; stepName: string; qcPassed: boolean | null }[],
  procurementItems: { itemType: string; qcPassed: boolean | null }[]
): ProjectQcFailureReason | null {
  const failedItem = procurementItems.find((i) => i.qcPassed === false);
  if (failedItem) return { kind: "item", itemType: failedItem.itemType };
  const failedStep = steps.find((s) => s.stepCode === "3E" && s.qcPassed === false);
  if (failedStep) return { kind: "step", stepCode: failedStep.stepCode, stepName: failedStep.stepName };
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
