import { isProcurementStageOverrun } from "@/lib/overrun";
import { addDays } from "@/lib/step-template";

// Not a stored value — same "date-driven, computed at read time" reasoning as
// EffectiveOverallStatus's own `delayed` in overrun.ts: a service can *become* delayed (or, once
// completed, become review_not_completed) with no one touching it, so persisting either would
// go stale.
export type ServiceStatus = "not_started" | "in_progress" | "delayed" | "completed" | "review_not_completed";

export interface ServiceItemLike {
  plannedDate: Date;
  actualDate: Date | null;
}

/** completedAt + this many days is when the customer review is due — see getServiceStatus and
 *  the read-only "Planned date" field on ServiceReviewCard, which both derive it the same way. */
export const SERVICE_REVIEW_DUE_DAYS = 2;

export function getServiceReviewPlannedDate(completedAt: Date): Date {
  return addDays(completedAt, SERVICE_REVIEW_DUE_DAYS);
}

/**
 * A service has no fixed stage list the way a Project's phase_steps do, and unlike a Project,
 * "completed" is never inferred from item rows — finishing every row still just reads
 * "in_progress". Service.completedAt (set only by the explicit "mark as completed" action — see
 * the completion dropdown in the services list) is the sole path to "completed"; every item
 * could be done and this would still read in_progress until someone closes it out that way.
 * "Delayed" wins over a plain "in_progress" the moment any not-yet-done row's planned date has
 * passed — same isProcurementStageOverrun check the row's own "Overdue" pill uses (see
 * ServiceTracker.tsx).
 *
 * Once completed, a customer review is due SERVICE_REVIEW_DUE_DAYS later (see
 * ServiceReviewCard) — reusing the same "expected but nothing recorded yet" overrun check items
 * use, just against reviewCompletedAt instead of an item's actualDate. Left unfilled past that
 * date and the service reads "review_not_completed" instead of "completed" until it is — the
 * one and only way back to a plain "completed" read is to actually fill the review in.
 */
export function getServiceStatus(
  items: ServiceItemLike[],
  completedAt: Date | null,
  reviewCompletedAt: Date | null
): ServiceStatus {
  if (completedAt) {
    const reviewPlannedDate = getServiceReviewPlannedDate(completedAt);
    if (isProcurementStageOverrun(reviewPlannedDate, reviewCompletedAt)) {
      return "review_not_completed";
    }
    return "completed";
  }
  if (items.length === 0) return "not_started";
  const hasOverdueItem = items.some((i) => isProcurementStageOverrun(i.plannedDate, i.actualDate));
  return hasOverdueItem ? "delayed" : "in_progress";
}
