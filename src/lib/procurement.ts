import type { ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Expected arrival date, computed from requirement_created_at — day 21, the same for every
 * item type (hardware/gasket arrive alongside section rather than a day ahead of it).
 * `itemType` stays in the signature for consistency with the other computeExpectedXDate
 * functions and their call sites, even though arrival no longer varies by it.
 */
export function computeExpectedArrivalDate(_itemType: ItemType, requirementCreatedAt: Date): Date {
  return addDays(requirementCreatedAt, 21);
}

export function computeExpectedQuoteDate(itemType: ItemType, requirementCreatedAt: Date): Date {
  if (itemType === "section") {
    return addDays(requirementCreatedAt, 2);
  }
  return addDays(requirementCreatedAt, 13);
}

/** Payment is expected 2 days after the quote, same for every item type. */
export function computeExpectedPaymentDate(itemType: ItemType, requirementCreatedAt: Date): Date {
  return addDays(computeExpectedQuoteDate(itemType, requirementCreatedAt), 2);
}

/** Order confirmation is expected the same day as payment — the two happen together. */
export function computeExpectedOrderDate(itemType: ItemType, requirementCreatedAt: Date): Date {
  return computeExpectedPaymentDate(itemType, requirementCreatedAt);
}

/**
 * Planned date for "Requirement created" itself — 1D's actual end + 1 day (i.e.
 * `phase2PlanAnchor` unchanged), the same for every item type. Unlike quote/order/arrival/QC,
 * raising the requirement doesn't depend on each item's own supplier lead time — it's a same
 * internal step expected within 24 hours of 1D closing out, full stop.
 *
 * `phase2PlanAnchor` is 1D's actual end + 1 day, not requirement_created_at itself: that field
 * is what this date is a *plan for*, is filled in manually, and may never happen on the
 * planned day — the plan has to be anchored to something that's fixed the moment 1D closes
 * out, not to the very field it's meant to be compared against.
 */
export function computeExpectedRequirementDate(phase2PlanAnchor: Date): Date {
  return phase2PlanAnchor;
}

/** QC is expected 3 days after arrival — there's no separate QC-day rule of its own. */
export function computeExpectedQCDate(itemType: ItemType, phase2PlanAnchor: Date): Date {
  return addDays(computeExpectedArrivalDate(itemType, phase2PlanAnchor), 3);
}

/** 2A is derived: complete only when all 3 procurement_items rows have requirement_created_at set. */
export async function getRequirementCreatedStatus(
  projectId: string
): Promise<{
  complete: boolean;
  items: { itemType: ItemType; created: boolean; requirementCreatedAt: Date | null }[];
}> {
  const items = await prisma.procurementItem.findMany({
    where: { projectId },
    select: { itemType: true, requirementCreatedAt: true },
  });

  const withStatus = items.map((item) => ({
    itemType: item.itemType,
    created: item.requirementCreatedAt !== null,
    requirementCreatedAt: item.requirementCreatedAt,
  }));

  return {
    complete: items.length === 3 && withStatus.every((item) => item.created),
    items: withStatus,
  };
}

/** 2D1 is derived: complete only when all 3 procurement_items rows have actual_arrival_date set. */
export async function getMaterialsArrivedStatus(
  projectId: string
): Promise<{
  complete: boolean;
  items: {
    itemType: ItemType;
    arrived: boolean;
    actualArrivalDate: Date | null;
    orderConfirmedAt: Date | null;
  }[];
}> {
  const items = await prisma.procurementItem.findMany({
    where: { projectId },
    select: { itemType: true, actualArrivalDate: true, orderConfirmedAt: true },
  });

  const withStatus = items.map((item) => ({
    itemType: item.itemType,
    arrived: item.actualArrivalDate !== null,
    actualArrivalDate: item.actualArrivalDate,
    orderConfirmedAt: item.orderConfirmedAt,
  }));

  return {
    complete: items.length === 3 && withStatus.every((item) => item.arrived),
    items: withStatus,
  };
}

/**
 * 2F is derived: complete only when all 3 procurement_items rows are checked AND passed.
 * A failed item counts toward `anyProgress` (2F still shows in_progress, same as a pending
 * one) but not toward `complete` — it blocks 2F, and therefore phase 3, until corrected and
 * re-checked as passed.
 */
export async function getMaterialQCStatus(
  projectId: string
): Promise<{
  complete: boolean;
  items: { itemType: ItemType; qcChecked: boolean; qcPassed: boolean | null }[];
}> {
  const items = await prisma.procurementItem.findMany({
    where: { projectId },
    select: { itemType: true, qcChecked: true, qcPassed: true },
  });

  const withStatus = items.map((item) => ({
    itemType: item.itemType,
    qcChecked: item.qcChecked,
    qcPassed: item.qcPassed,
  }));

  return {
    complete: items.length === 3 && withStatus.every((item) => item.qcChecked && item.qcPassed === true),
    items: withStatus,
  };
}

const PROCUREMENT_ITEM_TYPES: ItemType[] = ["section", "hardware", "gasket"];

/**
 * Side effect of 1D completing (phase 2 seeding): create the 3 procurement_items rows,
 * empty — requirement_created_at is set later, per item, when that item's "Requirement
 * created" checkbox is checked (see applyRequirementCreated below). 2A derives its own
 * status from those checkboxes the same way 2D1 derives from actual_arrival_date.
 *
 * Only creates the item_types that are missing, so re-completing 1D after a revert tops up
 * rather than inserting a duplicate set — the existing rows are the ones holding real data.
 */
export async function createEmptyProcurementItemsForProject(projectId: string) {
  const existing = await prisma.procurementItem.findMany({
    where: { projectId },
    select: { itemType: true },
  });
  const have = new Set(existing.map((i) => i.itemType));
  const missing = PROCUREMENT_ITEM_TYPES.filter((itemType) => !have.has(itemType));

  return prisma.$transaction(
    missing.map((itemType) =>
      prisma.procurementItem.create({
        data: { projectId, itemType },
      })
    )
  );
}

/**
 * One procurement item's lifecycle, in the order the tracker records it: requirement -> quote
 * -> payment -> order -> arrival -> QC (see ProcurementTracker's own ordering comment).
 *
 * The order is what makes resetting meaningful. Discarding a stage discards every later stage
 * with it, because each one only exists on the strength of the ones before: a quote answers a
 * requirement, a payment settles that quote, goods arrive against that order. Undoing the
 * requirement and leaving the payment behind would leave the row describing a purchase that,
 * as far as the record now goes, was never asked for.
 */
export const PROCUREMENT_LIFECYCLE = [
  {
    label: "requirement dates",
    // notes belong to the earliest stage: they annotate the item as a whole, so they only go
    // when the item is being taken back to the state it was created in.
    fields: { requirementCreatedAt: null, requirementNote: null, expectedArrivalDate: null, notes: null },
  },
  { label: "quote dates", fields: { quoteCreatedAt: null, quoteNote: null } },
  { label: "payment records", fields: { paymentSettledAt: null, paymentNote: null, paymentDetails: null } },
  { label: "order confirmations", fields: { orderConfirmedAt: null, orderNote: null } },
  { label: "arrival dates", fields: { actualArrivalDate: null, arrivalNote: null } },
  {
    label: "QC checks",
    fields: { qcChecked: false, qcCheckedAt: null, qcCheckedBy: null, qcPassed: null, qcNote: null },
  },
] as const;

/** Which lifecycle stage each derived step's status is computed from. */
export const DERIVED_STEP_STAGE: Record<string, number> = { "2A": 0, "2D1": 4, "2F": 5 };

/** The stage labels a reset from `fromStage` onward would discard. */
export function describeProcurementReset(fromStage: number): string[] {
  return PROCUREMENT_LIFECYCLE.slice(fromStage).map((s) => s.label);
}

/**
 * Clears every procurement_item field from `fromStage` onward, across all 3 item types.
 *
 * This is the one path in the app that discards procurement entries, so callers must have
 * explicit user consent. A reset from stage 0 returns the rows to the state
 * createEmptyProcurementItemsForProject left them in — the rows themselves are kept, since 2A
 * derives its status from their existence.
 */
export async function clearProcurementFromStage(projectId: string, fromStage: number) {
  const data = PROCUREMENT_LIFECYCLE.slice(fromStage).reduce<Record<string, unknown>>(
    (acc, stage) => ({ ...acc, ...stage.fields }),
    {}
  );
  if (Object.keys(data).length === 0) return;

  await prisma.procurementItem.updateMany({ where: { projectId }, data });
}

/**
 * Resets a single procurement_item's entire lifecycle back to empty — the state
 * createEmptyProcurementItemsForProject left it in — without touching the other two items.
 * Used to restart one item from "Requirement created" after it fails QC: the row itself is
 * kept (2A/2D1/2F still derive from its existence), only its data is cleared. Reuses the same
 * PROCUREMENT_LIFECYCLE field shape as clearProcurementFromStage, just scoped to one row and
 * always from stage 0 — a QC failure means every earlier stage needs redoing too.
 *
 * `newPlanAnchor` sets planAnchorOverride at the same time — the client gives a fresh planned
 * date for this item's redo, which stops matching the rest of the project's default schedule
 * (1D's actual end + 1 day) the moment it's failed and restarted.
 */
export async function resetProcurementItem(itemId: string, newPlanAnchor: Date) {
  const data = PROCUREMENT_LIFECYCLE.reduce<Record<string, unknown>>((acc, stage) => ({ ...acc, ...stage.fields }), {});
  await prisma.procurementItem.update({
    where: { id: itemId },
    data: { ...data, planAnchorOverride: newPlanAnchor },
  });
}

/**
 * Toggles a procurement_item's "Requirement created" checkbox (the 2A gate for that
 * item). Checking it stamps requirement_created_at and derives expected_arrival_date
 * from that item's own date, per the section/hardware/gasket timing rules above.
 * Unchecking clears both — there's no requirement date to derive an arrival estimate from.
 */
export async function applyRequirementCreated(itemId: string, itemType: ItemType, checked: boolean) {
  const now = new Date();
  await prisma.procurementItem.update({
    where: { id: itemId },
    data: {
      requirementCreatedAt: checked ? now : null,
      expectedArrivalDate: checked ? computeExpectedArrivalDate(itemType, now) : null,
    },
  });
}
