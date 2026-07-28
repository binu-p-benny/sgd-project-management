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

export function isProcurementItemOverrun(
  expectedArrivalDate: Date | null,
  actualArrivalDate: Date | null
): boolean {
  if (!expectedArrivalDate || actualArrivalDate) return false;
  return new Date() > expectedArrivalDate;
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

/**
 * `overall_status`'s stored value only tracks blocked/on_track/completed — those are
 * event-driven (something explicit happened) and kept in sync by step-actions.ts on
 * every mutation. `delayed` is date-driven: a project can *become* delayed with no one
 * touching it, so persisting it the same way would go stale. Compute it at read time
 * instead — this is the single place "what should the badge say" gets decided.
 */
export function getEffectiveOverallStatus(
  storedStatus: "on_track" | "delayed" | "blocked" | "completed",
  hasOverrun: boolean
): "on_track" | "delayed" | "blocked" | "completed" {
  if (storedStatus === "completed" || storedStatus === "blocked") return storedStatus;
  return hasOverrun ? "delayed" : "on_track";
}
