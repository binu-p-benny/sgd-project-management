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
