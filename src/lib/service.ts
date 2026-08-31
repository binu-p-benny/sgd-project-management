import { isProcurementStageOverrun } from "@/lib/overrun";

// Not a stored value — same "date-driven, computed at read time" reasoning as
// EffectiveOverallStatus's own `delayed` in overrun.ts: a service can *become* delayed with no
// one touching it (today just passes a row's planned date), so persisting it would go stale.
export type ServiceStatus = "not_started" | "in_progress" | "delayed" | "completed";

export interface ServiceItemLike {
  plannedDate: Date;
  actualDate: Date | null;
  isPassFail: boolean;
  qcPassed: boolean | null;
}

/**
 * A service has no fixed stage list the way a Project's phase_steps do — its status is purely a
 * function of its own item rows (see ServiceItem). "Completed" requires every row to actually be
 * done, and — for a row opted into Pass/Fail — to have passed; a failed pass/fail row keeps the
 * service short of "completed" indefinitely until it's corrected, since there's no action-plan/
 * restart flow here the way ProcurementItem has for a failed QC check. "Delayed" wins over a
 * plain "in_progress" the moment any not-yet-done row's planned date has passed — same
 * isProcurementStageOverrun check the row's own "Overdue" pill uses (see ServiceTracker.tsx),
 * just rolled up to the whole service. A completed service is never "delayed", even if some row
 * finished late — same "completed always wins" rule projectHasOverrun/getEffectiveOverallStatus
 * already applies to a Project.
 */
export function getServiceStatus(items: ServiceItemLike[]): ServiceStatus {
  if (items.length === 0) return "not_started";
  const allDone = items.every((i) => i.actualDate !== null && (!i.isPassFail || i.qcPassed !== false));
  if (allDone) return "completed";
  const hasOverdueItem = items.some((i) => isProcurementStageOverrun(i.plannedDate, i.actualDate));
  return hasOverdueItem ? "delayed" : "in_progress";
}
