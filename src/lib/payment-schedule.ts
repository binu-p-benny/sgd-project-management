/**
 * The Payment schedule modal's 6 fixed rows — Token (a flat advance, not a percentage of the
 * final cost) plus 5 milestones expressed as a percentage of it. This list is the template only
 * (label, percentage, display order); each project's own state — whether a row has been marked
 * received, and when — lives on its own PaymentSchedule row (schema.prisma), one nullable
 * receivedAt column per key here. Two milestones both happen to be 25% (milestone1, milestone3)
 * — they're still separate, independently-trackable rows, just with the same percentage.
 */
export type PaymentMilestoneKey =
  | "token"
  | "milestone1"
  | "milestone2"
  | "milestone3"
  | "milestone4"
  | "milestone5";

export interface PaymentMilestoneTemplate {
  key: PaymentMilestoneKey;
  /** null for Token — it isn't computed from the final cost, see computeMilestoneAmount. */
  percentage: number | null;
}

export const PAYMENT_MILESTONES: PaymentMilestoneTemplate[] = [
  { key: "token", percentage: null },
  { key: "milestone1", percentage: 25 },
  { key: "milestone2", percentage: 50 },
  { key: "milestone3", percentage: 25 },
  { key: "milestone4", percentage: 20 },
  { key: "milestone5", percentage: 5 },
];

/** null when there's no percentage to compute from (the Token row). */
export function computeMilestoneAmount(percentage: number | null, finalCost: number): number | null {
  if (percentage === null) return null;
  return Math.round((finalCost * percentage) / 100);
}
