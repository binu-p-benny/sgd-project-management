import type { ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Phase 2's shared planned-date anchor — 1D's ground-truth end date + 1 day, the day Phase 2
 * begins. Null until 1D actually completes (`actualEndDate` unset): the plan can't show until
 * the field it heads off has actually happened. Once it has, an in_house delay anchors off
 * 1D's *planned* end date instead of its late actual one — the same ground-truth rule
 * rescheduleProjectDates' endDates map already applies to every phase step (see reschedule.ts)
 * — so procurement's own planned dates freeze in step with 2A/2D1/2D2/2F's phase-step planned
 * dates rather than drifting out on their own. A client_side delay, or no delay at all, still
 * anchors off the real actual end.
 */
export function computePhase2PlanAnchor(
  oneDPlannedEndDate: Date | null,
  oneDActualEndDate: Date | null,
  oneDDelayCategory: string | null
): Date | null {
  if (!oneDActualEndDate) return null;
  const groundTruth = oneDDelayCategory === "in_house" ? oneDPlannedEndDate : oneDActualEndDate;
  return groundTruth ? addDays(groundTruth, 1) : null;
}

/**
 * Expected arrival date, computed from requirement_created_at. Neither branch drives what the
 * procurement tracker *displays* any more — Section uses computeSectionChainDates and
 * hardware/gasket use computeHardwareGasketChainDates instead. This function survives purely to
 * compute the legacy stored expected_arrival_date column (see applyRequirementCreated below and
 * the PATCH route), which dashboard.ts/overrun.ts still read for overdue detection — neither
 * item-type family's offset here has been revisited since that stored field stopped being what's
 * shown on screen, so don't assume it matches the current display formula for either.
 */
export function computeExpectedArrivalDate(itemType: ItemType, requirementCreatedAt: Date): Date {
  if (itemType === "section") {
    return addDays(requirementCreatedAt, 21);
  }
  return addDays(requirementCreatedAt, 25);
}

/** Feeds computeProcurementPlannedDates only — still load-bearing for Section's displayed Quote,
 *  but dead for hardware/gasket, whose displayed Quote comes from
 *  computeExpectedHardwareGasketQuoteDate/computeHardwareGasketChainDates instead. */
export function computeExpectedQuoteDate(itemType: ItemType, requirementCreatedAt: Date): Date {
  if (itemType === "section") {
    return addDays(requirementCreatedAt, 2);
  }
  return addDays(requirementCreatedAt, 13);
}

/** Payment is expected 2 days after the quote. Same "Section only, dead for hardware/gasket
 *  display" caveat as computeExpectedQuoteDate. */
export function computeExpectedPaymentDate(itemType: ItemType, requirementCreatedAt: Date): Date {
  return addDays(computeExpectedQuoteDate(itemType, requirementCreatedAt), 2);
}

/** Order confirmation is expected the same day as payment. Same "Section only, dead for
 *  hardware/gasket display" caveat as computeExpectedQuoteDate. */
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

/** Feeds computeProcurementPlannedDates only, purely so it has a complete 6-stage offset table to
 *  work with — the result is discarded by both item-type families now: Section's displayed QC
 *  comes from computeSectionChainDates, hardware/gasket's from computeHardwareGasketChainDates.
 *  There's no stored column riding on this one the way computeExpectedArrivalDate's is. */
export function computeExpectedQCDate(itemType: ItemType, phase2PlanAnchor: Date): Date {
  const arrival = computeExpectedArrivalDate(itemType, phase2PlanAnchor);
  return addDays(arrival, itemType === "section" ? 3 : 2);
}

/** The corrective action plan (only relevant once QC fails) is expected 2 days after the QC
 *  check itself — the one date this stage plans from, since a plan can't predate the failure
 *  that triggered it. */
export function computeExpectedActionPlanDate(qcCheckedAt: Date): Date {
  return addDays(qcCheckedAt, 2);
}

/** Advances `date` by `days` working days, treating every day except Sunday as one. Walks
 *  forward a calendar day at a time and only counts a day toward `days` when it isn't a Sunday —
 *  so a Sunday inside the span costs an extra calendar day rather than shortening the count. */
function addWorkingDays(date: Date, days: number): Date {
  let result = date;
  let remaining = days;
  while (remaining > 0) {
    result = addDays(result, 1);
    if (result.getDay() !== 0) {
      remaining -= 1;
    }
  }
  return result;
}

/** Section only: material despatch is expected 7 working days after Order confirmed's own
 *  ground-truth date (see computeSectionChainDates) — chains off the previous stage rather than
 *  the shared anchor every stage before it uses. */
export function computeExpectedMaterialDespatchDate(orderConfirmedAt: Date): Date {
  return addWorkingDays(orderConfirmedAt, 7);
}

/** Section only: arrival for powder coating is expected 7 working days after Material
 *  despatch's own ground-truth date — same reasoning as computeExpectedMaterialDespatchDate. */
export function computeExpectedPowderCoatingArrivalDate(materialDespatchAt: Date): Date {
  return addWorkingDays(materialDespatchAt, 7);
}

/** Section only: Actual arrival is expected 7 working days after Arrived-for-powder-coating's
 *  own ground-truth date. This replaces computeExpectedArrivalDate's anchor-based formula for
 *  this item type only, for *displayed* dates — that function still computes the legacy stored
 *  expected_arrival_date column for every item type unchanged (see dashboard.ts/overrun.ts). */
export function computeExpectedSectionArrivalDate(arrivedForPowderCoatingAt: Date): Date {
  return addWorkingDays(arrivedForPowderCoatingAt, 7);
}

export interface SectionChainDates {
  materialDespatch: Date | null;
  powderCoatingArrival: Date | null;
  arrival: Date | null;
  qc: Date | null;
}

/**
 * Section-only planned-date chain for the 3 stages from Material despatch through QC. Each one
 * plans 7 working days (Sundays skipped) after the previous stage's own *ground truth* date —
 * its actual date once that's happened, else its own (possibly manually overridden) planned
 * date as a forecast in the meantime. Same "actual if known, else planned" rule
 * rescheduleProjectDates already uses for phase steps (see reschedule.ts) — it's what prefills
 * the whole chain from Order confirmed's planned date the moment that exists, rather than
 * leaving every stage blank until Order is actually confirmed, and then lets each stage firm up
 * in turn as its own actual date lands.
 *
 * All 4 stages have a manual override, same "shift every later stage in the chain" principle as
 * every other stage in computeProcurementPlannedDates — an override always wins for that stage's
 * own displayed planned date and for what the *next* stage forecasts from. A stage's actual date,
 * once it exists, still wins over its own override for that propagation, the same way an
 * un-overridden forecast would have: an override is a better guess before the real date is
 * known, not a correction to a fact that has already happened.
 */
export function computeSectionChainDates(
  orderConfirmedPlanned: Date | null,
  orderConfirmedAt: Date | null,
  materialDespatchAt: Date | null,
  arrivedForPowderCoatingAt: Date | null,
  overrides: {
    materialDespatch?: Date | null;
    powderCoatingArrival?: Date | null;
    arrival?: Date | null;
    qc?: Date | null;
  }
): SectionChainDates {
  const orderGroundTruth = orderConfirmedAt ?? orderConfirmedPlanned;
  const materialDespatchForecast = orderGroundTruth ? computeExpectedMaterialDespatchDate(orderGroundTruth) : null;
  const materialDespatch = overrides.materialDespatch ?? materialDespatchForecast;

  const materialDespatchGroundTruth = materialDespatchAt ?? materialDespatch;
  const powderCoatingArrivalForecast = materialDespatchGroundTruth
    ? computeExpectedPowderCoatingArrivalDate(materialDespatchGroundTruth)
    : null;
  const powderCoatingArrival = overrides.powderCoatingArrival ?? powderCoatingArrivalForecast;

  const powderCoatingGroundTruth = arrivedForPowderCoatingAt ?? powderCoatingArrival;
  const computedArrival = powderCoatingGroundTruth ? computeExpectedSectionArrivalDate(powderCoatingGroundTruth) : null;
  const arrival = overrides.arrival ?? computedArrival;

  // QC is expected 2 days after Actual arrival's own planned date — plain calendar days, not
  // working days like the 3 stages above (only those were specified as working-day spans).
  const computedQC = arrival ? addDays(arrival, 2) : null;
  const qc = overrides.qc ?? computedQC;

  return { materialDespatch, powderCoatingArrival, arrival, qc };
}

/** Hardware/gasket only: Quote is expected 14 working days (Sundays skipped) after Requirement's
 *  own planned date. */
export function computeExpectedHardwareGasketQuoteDate(requirementPlanned: Date): Date {
  return addWorkingDays(requirementPlanned, 14);
}

/** Hardware/gasket only: Payment is expected 2 working days after Quote's own planned date. */
export function computeExpectedHardwareGasketPaymentDate(quotePlanned: Date): Date {
  return addWorkingDays(quotePlanned, 2);
}

/** Hardware/gasket only: Actual arrival is expected 10 working days after Payment's own planned
 *  date. This is a *different* formula from computeExpectedArrivalDate, which still anchors
 *  hardware/gasket's legacy stored expected_arrival_date column (dashboard overdue detection)
 *  off Requirement directly — this one only drives what the procurement tracker displays. */
export function computeExpectedHardwareGasketArrivalDate(paymentPlanned: Date): Date {
  return addWorkingDays(paymentPlanned, 10);
}

export interface HardwareGasketChainDates {
  quote: Date | null;
  payment: Date | null;
  order: Date | null;
  arrival: Date | null;
  qc: Date | null;
}

/**
 * Hardware/gasket-only planned-date chain for Quote through Arrival — each stage plans a
 * working-day span (Sundays skipped) after the *previous stage's own planned date*, unlike
 * Section's chain (which plans off ground-truth actual-or-planned dates) or the flat "everything
 * offset from Requirement" model computeProcurementPlannedDates still uses for Section's own
 * quote/payment/order. There's no actual-date awareness here at all — purely a forecast chain,
 * matching how hardware/gasket has always behaved (a plan independent of what's actually
 * happened), just chained stage-to-stage now instead of everything anchored to one shared
 * reference.
 *
 * QC is the one stage that *isn't* its own forecast: hardware and gasket get QC-checked
 * alongside Section, in the same pass, so their planned QC date is simply Section's own QC
 * planned date (see sectionQCPlanned) — not an offset from their own Arrival at all. A manual
 * override on this item's own QC still wins outright, same as every other stage.
 *
 * Every other stage has a manual override too, same "shift every later stage in the chain"
 * principle as everywhere else — an override always wins for that stage's own displayed date and
 * for what the next stage forecasts from. Order confirmed tracks Payment's *effective*
 * (post-override) date by default, same relationship it's always had, but keeps its own
 * independent override on top.
 */
export function computeHardwareGasketChainDates(
  requirementPlanned: Date | null,
  sectionQCPlanned: Date | null,
  overrides: {
    quote?: Date | null;
    payment?: Date | null;
    order?: Date | null;
    arrival?: Date | null;
    qc?: Date | null;
  }
): HardwareGasketChainDates {
  const quoteForecast = requirementPlanned ? computeExpectedHardwareGasketQuoteDate(requirementPlanned) : null;
  const quote = overrides.quote ?? quoteForecast;

  const paymentForecast = quote ? computeExpectedHardwareGasketPaymentDate(quote) : null;
  const payment = overrides.payment ?? paymentForecast;

  const order = overrides.order ?? payment;

  const arrivalForecast = payment ? computeExpectedHardwareGasketArrivalDate(payment) : null;
  const arrival = overrides.arrival ?? arrivalForecast;

  const qc = overrides.qc ?? sectionQCPlanned;

  return { quote, payment, order, arrival, qc };
}

export interface ProcurementItemArrivalInputs {
  itemType: ItemType;
  planAnchorOverride: Date | null;
  requirementPlannedOverride: Date | null;
  quotePlannedOverride: Date | null;
  paymentPlannedOverride: Date | null;
  orderPlannedOverride: Date | null;
  arrivalPlannedOverride: Date | null;
  qcPlannedOverride: Date | null;
  orderConfirmedAt: Date | null;
  materialDespatchAt: Date | null;
  materialDespatchPlannedOverride: Date | null;
  arrivedForPowderCoatingAt: Date | null;
  arrivedForPowderCoatingPlannedOverride: Date | null;
}

/** Section's full planned-date chain, resolved from one item's raw stored fields — shared by
 *  computeItemArrivalPlanned (needs .arrival) and computeSectionQCPlanned (needs .qc) so both
 *  read off exactly the same computation rather than two copies that could drift apart. Only
 *  meaningful for a section item; callers are expected to have already checked itemType. */
function resolveSectionChain(item: ProcurementItemArrivalInputs, phase2PlanAnchor: Date | null): SectionChainDates {
  const itemPlanAnchor = item.planAnchorOverride ?? phase2PlanAnchor;
  const planned = computeProcurementPlannedDates("section", itemPlanAnchor, {
    requirement: item.requirementPlannedOverride,
    quote: item.quotePlannedOverride,
    payment: item.paymentPlannedOverride,
    order: item.orderPlannedOverride,
    arrival: item.arrivalPlannedOverride,
    qc: item.qcPlannedOverride,
  });
  return computeSectionChainDates(
    planned.order,
    item.orderConfirmedAt,
    item.materialDespatchAt,
    item.arrivedForPowderCoatingAt,
    {
      materialDespatch: item.materialDespatchPlannedOverride,
      powderCoatingArrival: item.arrivedForPowderCoatingPlannedOverride,
      arrival: item.arrivalPlannedOverride,
      qc: item.qcPlannedOverride,
    }
  );
}

/**
 * One procurement item's "Actual arrival" planned date, computed exactly the way the
 * procurement tracker itself displays it — Section via computeSectionChainDates, hardware/
 * gasket via computeHardwareGasketChainDates. Pulled out as its own function, rather than left
 * inline in the page component, so 2D1's own planned date (see rescheduleProjectDates) computes
 * the *same* value for the same item instead of re-deriving it and risking drift from what's
 * actually displayed.
 */
export function computeItemArrivalPlanned(
  item: ProcurementItemArrivalInputs,
  phase2PlanAnchor: Date | null
): Date | null {
  if (item.itemType === "section") {
    return resolveSectionChain(item, phase2PlanAnchor).arrival;
  }

  const itemPlanAnchor = item.planAnchorOverride ?? phase2PlanAnchor;
  const planned = computeProcurementPlannedDates(item.itemType, itemPlanAnchor, {
    requirement: item.requirementPlannedOverride,
    quote: item.quotePlannedOverride,
    payment: item.paymentPlannedOverride,
    order: item.orderPlannedOverride,
    arrival: item.arrivalPlannedOverride,
    qc: null,
  });

  // Only .arrival is read below — hardware/gasket's own .qc needs Section's QC planned date
  // (see computeSectionQCPlanned), which is irrelevant to .arrival, so null is fine here.
  return computeHardwareGasketChainDates(planned.requirement, null, {
    quote: item.quotePlannedOverride,
    payment: item.paymentPlannedOverride,
    order: item.orderPlannedOverride,
    arrival: item.arrivalPlannedOverride,
    qc: null,
  }).arrival;
}

/**
 * Section's own QC checked planned date — pulled out on its own because hardware and gasket's
 * own QC planned date is *this exact value*, not an offset from their own Arrival (see
 * computeHardwareGasketChainDates): all three item types get QC-checked together, in the same
 * pass. Null for anything other than a section item, or before the shared anchor resolves.
 */
export function computeSectionQCPlanned(item: ProcurementItemArrivalInputs, phase2PlanAnchor: Date | null): Date | null {
  if (item.itemType !== "section") return null;
  return resolveSectionChain(item, phase2PlanAnchor).qc;
}

/**
 * Section's own "Order confirmed" planned date, resolved the same ground-truth way every other
 * procurement planned date is — the item's own restart anchor if set, else the shared phase-2
 * anchor, with each stage's own manual override layered on top (see computeProcurementPlannedDates).
 * Feeds 2D2's planned date (see rescheduleProjectDates) — 2D2 plans off Section's Order confirmed
 * specifically, not the generic dependsOn+duration formula every other Phase 1/2 step uses.
 * Null for hardware/gasket (2D2 only ever reads this for the section item) and whenever the
 * anchor itself isn't resolvable yet.
 */
export function computeSectionOrderConfirmedPlanned(
  item: Pick<
    ProcurementItemArrivalInputs,
    "itemType" | "planAnchorOverride" | "requirementPlannedOverride" | "quotePlannedOverride" | "paymentPlannedOverride" | "orderPlannedOverride"
  >,
  phase2PlanAnchor: Date | null
): Date | null {
  if (item.itemType !== "section") return null;
  const itemPlanAnchor = item.planAnchorOverride ?? phase2PlanAnchor;
  return computeProcurementPlannedDates("section", itemPlanAnchor, {
    requirement: item.requirementPlannedOverride,
    quote: item.quotePlannedOverride,
    payment: item.paymentPlannedOverride,
    order: item.orderPlannedOverride,
  }).order;
}

/** 2D2 ("Final tight measurement at site") is expected 18 working days after Section's own Order
 *  confirmed planned date — see computeSectionOrderConfirmedPlanned. */
export function computeExpectedFinalMeasurementDate(sectionOrderConfirmedPlanned: Date): Date {
  return addWorkingDays(sectionOrderConfirmedPlanned, 18);
}

export interface ProcurementPlannedOverrides {
  requirement?: Date | null;
  quote?: Date | null;
  payment?: Date | null;
  order?: Date | null;
  arrival?: Date | null;
  qc?: Date | null;
}

export interface ProcurementPlannedDates {
  requirement: Date | null;
  quote: Date | null;
  payment: Date | null;
  order: Date | null;
  arrival: Date | null;
  qc: Date | null;
}

const PLANNED_STAGE_ORDER = ["requirement", "quote", "payment", "order", "arrival", "qc"] as const;

/** Each stage's day offset from the anchor, read off the computeExpectedXDate functions above
 *  themselves (evaluated against a fixed reference point) rather than re-stated as separate
 *  magic numbers — so this can never drift out of sync with the formulas it's meant to match. */
function stageOffsetDays(itemType: ItemType): Record<(typeof PLANNED_STAGE_ORDER)[number], number> {
  const reference = new Date(0);
  const daysFromReference = (d: Date) => Math.round((d.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24));
  return {
    requirement: 0,
    quote: daysFromReference(computeExpectedQuoteDate(itemType, reference)),
    payment: daysFromReference(computeExpectedPaymentDate(itemType, reference)),
    order: daysFromReference(computeExpectedOrderDate(itemType, reference)),
    arrival: daysFromReference(computeExpectedArrivalDate(itemType, reference)),
    qc: daysFromReference(computeExpectedQCDate(itemType, reference)),
  };
}

/**
 * Every stage's effective Planned date for one item, with manual per-stage overrides layered on
 * top of the usual anchor+offset formulas above. Setting an override re-anchors every stage
 * after it in this same list, in order — the same "shift together" principle planAnchorOverride
 * already applies at the whole-item level, just scoped to one stage onward instead of the whole
 * item. A stage before the override, or a later stage with its own separate override, is
 * unaffected. With no overrides at all, this reproduces exactly what calling each
 * computeExpectedXDate function individually would — see the unit tests — since it's purely an
 * additive layer, not a replacement for them.
 */
export function computeProcurementPlannedDates(
  itemType: ItemType,
  anchor: Date | null,
  overrides: ProcurementPlannedOverrides
): ProcurementPlannedDates {
  const offsets = stageOffsetDays(itemType);
  const result = {} as ProcurementPlannedDates;

  let effectiveDate = anchor;
  let effectiveOffset = 0;

  for (const stage of PLANNED_STAGE_ORDER) {
    const override = overrides[stage];
    if (override) {
      result[stage] = override;
      effectiveDate = override;
      effectiveOffset = offsets[stage];
    } else if (effectiveDate === null) {
      result[stage] = null;
    } else {
      result[stage] = addDays(effectiveDate, offsets[stage] - effectiveOffset);
      effectiveDate = result[stage];
      effectiveOffset = offsets[stage];
    }
  }

  return result;
}

export interface ProcurementStagePlannedDates {
  requirement: Date | null;
  quote: Date | null;
  payment: Date | null;
  order: Date | null;
  materialDespatch: Date | null; // section only, null otherwise
  arrivedForPowderCoating: Date | null; // section only, null otherwise
  arrival: Date | null;
  qc: Date | null;
}

/**
 * Every stage's Planned date for one item, resolved exactly the way ProcurementTracker's own
 * columns compute them — section via computeSectionChainDates layered on computeProcurementPlannedDates'
 * requirement/quote/payment/order, hardware/gasket via computeHardwareGasketChainDates. Consolidates
 * what the project detail page (page.tsx) currently computes inline, stage by stage, into one call
 * — pulled out so other consumers (the /my-tasks table's own aggregation) get the identical values
 * without re-deriving this chain a second, possibly-drifting way.
 *
 * `sectionQCPlanned` is Section's own QC planned date (computeSectionQCPlanned on the project's
 * section item) — hardware/gasket's own QC date *is* that value (all three item types get
 * QC-checked together, in the same pass), so callers computing more than one item for the same
 * project should compute it once and pass it to every item, same as page.tsx does. Irrelevant
 * (and safe to pass null) when `item` itself is the section item.
 */
export function computeAllProcurementPlannedDates(
  item: ProcurementItemArrivalInputs & { requirementPlannedOverride: Date | null },
  phase2PlanAnchor: Date | null,
  sectionQCPlanned: Date | null
): ProcurementStagePlannedDates {
  const itemPlanAnchor = item.planAnchorOverride ?? phase2PlanAnchor;
  const planned = computeProcurementPlannedDates(item.itemType, itemPlanAnchor, {
    requirement: item.requirementPlannedOverride,
    quote: item.quotePlannedOverride,
    payment: item.paymentPlannedOverride,
    order: item.orderPlannedOverride,
    arrival: item.itemType === "section" ? item.arrivalPlannedOverride : null,
    qc: item.itemType === "section" ? item.qcPlannedOverride : null,
  });

  if (item.itemType === "section") {
    const chain = computeSectionChainDates(planned.order, item.orderConfirmedAt, item.materialDespatchAt, item.arrivedForPowderCoatingAt, {
      materialDespatch: item.materialDespatchPlannedOverride,
      powderCoatingArrival: item.arrivedForPowderCoatingPlannedOverride,
      arrival: item.arrivalPlannedOverride,
      qc: item.qcPlannedOverride,
    });
    return {
      requirement: planned.requirement,
      quote: planned.quote,
      payment: planned.payment,
      order: planned.order,
      materialDespatch: chain.materialDespatch,
      arrivedForPowderCoating: chain.powderCoatingArrival,
      arrival: chain.arrival,
      qc: chain.qc,
    };
  }

  const hwGasket = computeHardwareGasketChainDates(planned.requirement, sectionQCPlanned, {
    quote: item.quotePlannedOverride,
    payment: item.paymentPlannedOverride,
    order: item.orderPlannedOverride,
    arrival: item.arrivalPlannedOverride,
    qc: item.qcPlannedOverride,
  });
  return {
    requirement: planned.requirement,
    quote: hwGasket.quote,
    payment: hwGasket.payment,
    order: hwGasket.order,
    materialDespatch: null,
    arrivedForPowderCoating: null,
    arrival: hwGasket.arrival,
    qc: hwGasket.qc,
  };
}

// One item's full lifecycle, live-planned-date-vs-actual, in the same {label, planned, actual}
// shape overdueGlassPOStage already uses for the Glass PO's own 6 stages — so overrun.ts can
// check a ProcurementItem's *entire* chain the same cheap way, not just its Actual arrival.
// Requirement/Quote/Payment/Order are every item's; despatch/powder-coating are section-only
// (hardware/gasket skip straight from Order to Arrival, same as PROCUREMENT_STAGES elsewhere).
export interface ProcurementItemStage {
  label: string;
  planned: Date | null;
  actual: Date | null;
}

function procurementItemStages(
  item: ProcurementItemArrivalInputs & {
    requirementPlannedOverride: Date | null;
    requirementCreatedAt: Date | null;
    quoteCreatedAt: Date | null;
    paymentSettledAt: Date | null;
    actualArrivalDate: Date | null;
    qcCheckedAt: Date | null;
  },
  phase2PlanAnchor: Date | null,
  sectionQCPlanned: Date | null
): ProcurementItemStage[] {
  const planned = computeAllProcurementPlannedDates(item, phase2PlanAnchor, sectionQCPlanned);
  const stages: ProcurementItemStage[] = [
    { label: "Requirement created", planned: planned.requirement, actual: item.requirementCreatedAt },
    { label: "Quote created", planned: planned.quote, actual: item.quoteCreatedAt },
    { label: "Payment done", planned: planned.payment, actual: item.paymentSettledAt },
    { label: "Order confirmed", planned: planned.order, actual: item.orderConfirmedAt },
  ];
  if (item.itemType === "section") {
    stages.push(
      { label: "Material despatch", planned: planned.materialDespatch, actual: item.materialDespatchAt },
      { label: "Arrived for powder coating", planned: planned.arrivedForPowderCoating, actual: item.arrivedForPowderCoatingAt }
    );
  }
  stages.push(
    { label: "Actual arrival", planned: planned.arrival, actual: item.actualArrivalDate },
    { label: "QC checked", planned: planned.qc, actual: item.qcCheckedAt }
  );
  return stages;
}

/**
 * Every field overrun.ts's procurement-item overdue checks need, computed *live* (the same
 * computeAllProcurementPlannedDates chain ProcurementTracker actually displays) rather than off
 * the frozen legacy expected_arrival_date column those checks used to read exclusively. That
 * column is set once, off requirementCreatedAt, at the moment Requirement is first filled in
 * (see computeExpectedArrivalDate's own doc comment) — it never moves again even as the item's
 * real stage-by-stage progress pushes its true dates earlier or later, so overdue detection
 * built on it can drift out of sync with what the tracker (and everything else keyed off this
 * same live chain — /my-tasks, the KPI report) actually shows for the same item.
 *
 * `expectedArrivalDate` (arrival only, for callers like getProcurementDelayBreakdown that are
 * specifically about arrival-date performance) and `stages` (the item's *entire* lifecycle, for
 * projectHasOverrun/getProjectDelayReason's general "is anything on this project overdue" check
 * — previously scoped to arrival alone because redoing this whole chain per project was assumed
 * too expensive for a list/dashboard page; now that every caller here already pays that cost for
 * `expectedArrivalDate`, checking the rest of the chain too is free) both come off one shared
 * computation. Callers (dashboard.ts, /projects/page.tsx) fetch the *full* procurement item
 * (every column ProcurementItemArrivalInputs plus the raw stage-actual dates need) plus the
 * project's own 1D step, and use this in place of passing `procurementItems` straight from a
 * narrow expectedArrivalDate select.
 */
export function withLiveExpectedArrivalDates<
  T extends ProcurementItemArrivalInputs & {
    requirementPlannedOverride: Date | null;
    requirementCreatedAt: Date | null;
    quoteCreatedAt: Date | null;
    paymentSettledAt: Date | null;
    actualArrivalDate: Date | null;
    qcCheckedAt: Date | null;
  },
>(
  items: T[],
  oneD: { plannedEndDate: Date | null; actualEndDate: Date | null; delayCategory: string | null } | undefined
): (T & { expectedArrivalDate: Date | null; stages: ProcurementItemStage[] })[] {
  const phase2PlanAnchor = oneD
    ? computePhase2PlanAnchor(oneD.plannedEndDate, oneD.actualEndDate, oneD.delayCategory)
    : null;
  const sectionItem = items.find((i) => i.itemType === "section");
  const sectionQCPlanned = sectionItem ? computeSectionQCPlanned(sectionItem, phase2PlanAnchor) : null;
  // Spread first so this overrides whatever expectedArrivalDate a caller's own select happened
  // to include (the legacy column, if it's still there) — every other field on T (qcPassed,
  // the raw stage-actual dates getProjectActiveDepartments reads, etc.) passes through untouched.
  return items.map((item) => {
    const stages = procurementItemStages(item, phase2PlanAnchor, sectionQCPlanned);
    return {
      ...item,
      expectedArrivalDate: stages.find((s) => s.label === "Actual arrival")!.planned,
      stages,
    };
  });
}

/** Installation is planned to open this many days after procurement's QC checked planned date, and
 *  to wrap up this many days after it. Sundays don't count toward either span — the same
 *  working-day rule as the chains above (see addWorkingDays), so neither date can land on one. */
export const INSTALLATION_WINDOW_START_OFFSET_DAYS = 10;
export const INSTALLATION_WINDOW_END_OFFSET_DAYS = 22;

export interface InstallationPlannedWindow {
  /** The QC checked planned date both ends below are measured from. */
  qcPlanned: Date;
  start: Date;
  end: Date;
}

/**
 * Forecast of when installation will run, purely off procurement's own QC checked planned dates —
 * one per item, from computeAllProcurementPlannedDates(...).qc. Installation can't begin until
 * every item has been QC-checked, so the window keys off the *latest* of them; that is the same
 * value for all three items unless hardware or gasket carries its own manual QC override (see
 * computeHardwareGasketChainDates), and this is what makes the override count.
 *
 * Null when no item has a QC planned date yet — i.e. before 1D completes and the shared plan
 * anchor exists (see computePhase2PlanAnchor).
 */
export function computeInstallationPlannedWindow(itemQCPlannedDates: (Date | null)[]): InstallationPlannedWindow | null {
  const known = itemQCPlannedDates.filter((d): d is Date => d !== null);
  if (known.length === 0) return null;

  const qcPlanned = new Date(Math.max(...known.map((d) => d.getTime())));
  return {
    qcPlanned,
    start: addWorkingDays(qcPlanned, INSTALLATION_WINDOW_START_OFFSET_DAYS),
    end: addWorkingDays(qcPlanned, INSTALLATION_WINDOW_END_OFFSET_DAYS),
  };
}

/**
 * A project's Installation planned window, resolved from its raw procurement items + 1D step —
 * the same phase2PlanAnchor → sectionQCPlanned → computeAllProcurementPlannedDates(...).qc chain
 * InstallationWindowCard and reschedule.ts's own 3C2 default already run, pulled out here as one
 * shared function so every caller that needs "when will this project's installation likely run" —
 * including before 3C2 exists as a real step, same as the project detail page's forecast card —
 * derives it identically and can never drift apart.
 */
export function computeProjectInstallationForecast(
  procurementItems: ProcurementItemArrivalInputs[],
  oneD: { plannedEndDate: Date | null; actualEndDate: Date | null; delayCategory: string | null } | undefined
): InstallationPlannedWindow | null {
  const phase2PlanAnchor = oneD
    ? computePhase2PlanAnchor(oneD.plannedEndDate, oneD.actualEndDate, oneD.delayCategory)
    : null;
  const sectionItem = procurementItems.find((i) => i.itemType === "section");
  const sectionQCPlanned = sectionItem ? computeSectionQCPlanned(sectionItem, phase2PlanAnchor) : null;
  const itemQCPlannedDates = procurementItems.map(
    (item) => computeAllProcurementPlannedDates(item, phase2PlanAnchor, sectionQCPlanned).qc
  );
  return computeInstallationPlannedWindow(itemQCPlannedDates);
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
    // when the item is being taken back to the state it was created in. Each stage's own
    // manual Planned-date override goes with it too — a stale override from a since-cleared
    // attempt has nothing left to anchor.
    fields: {
      requirementCreatedAt: null,
      requirementNote: null,
      expectedArrivalDate: null,
      notes: null,
      requirementPlannedOverride: null,
    },
  },
  { label: "quote dates", fields: { quoteCreatedAt: null, quoteNote: null, quotePlannedOverride: null } },
  {
    label: "payment records",
    fields: { paymentSettledAt: null, paymentNote: null, paymentDetails: null, paymentPlannedOverride: null },
  },
  { label: "order confirmations", fields: { orderConfirmedAt: null, orderNote: null, orderPlannedOverride: null } },
  // Section only — always null already for hardware/gasket, so clearing these here on a
  // project-wide reset is a no-op for those two item types.
  {
    label: "material despatch",
    fields: { materialDespatchAt: null, materialDespatchNote: null, materialDespatchPlannedOverride: null },
  },
  {
    label: "arrived for powder coating",
    fields: {
      arrivedForPowderCoatingAt: null,
      arrivedForPowderCoatingNote: null,
      arrivedForPowderCoatingPlannedOverride: null,
    },
  },
  { label: "arrival dates", fields: { actualArrivalDate: null, arrivalNote: null, arrivalPlannedOverride: null } },
  {
    label: "QC checks",
    fields: {
      qcChecked: false,
      qcCheckedAt: null,
      qcCheckedBy: null,
      qcPassed: null,
      qcNote: null,
      qcPlannedOverride: null,
    },
  },
  // Only ever holds data once QC has failed, so wiping it alongside everything from an earlier
  // stage (including a full QC restart, which always starts from stage 0) is always correct —
  // a stale action plan shouldn't survive whatever cleared the failure it was written for.
  { label: "action plan", fields: { actionPlanAt: null, actionPlanNote: null } },
] as const;

/** Which lifecycle stage each derived step's status is computed from. Indices shift whenever
 *  PROCUREMENT_LIFECYCLE gains a stage before "arrival dates"/"QC checks" — kept as literals
 *  rather than looked up by label so a typo'd label fails loudly (TS literal narrowing) instead
 *  of silently resolving to -1. */
export const DERIVED_STEP_STAGE: Record<string, number> = { "2A": 0, "2D1": 6, "2F": 7 };

// Found by label rather than assumed to be PROCUREMENT_LIFECYCLE.length - 1, so this stays
// correct even if a stage is ever appended after "action plan". A clear/reset that reaches
// this stage or anything earlier also takes the item's custom follow-up tasks with it (see
// clearProcurementFromStage and resetProcurementItem below), since those only ever exist to
// explain a failure this same operation is wiping out.
const ACTION_PLAN_STAGE_INDEX = PROCUREMENT_LIFECYCLE.findIndex((s) => s.label === "action plan");

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

  if (fromStage <= ACTION_PLAN_STAGE_INDEX) {
    await prisma.procurementActionItem.deleteMany({ where: { procurementItem: { projectId } } });
  }
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
  await prisma.procurementActionItem.deleteMany({ where: { procurementItemId: itemId } });
}

/**
 * A pass/fail custom action-item row is how a failed item gets re-tested without wiping it and
 * starting over (see the removed "Restart from Requirement created" — this replaces it) — so a
 * genuine Pass on one of those rows *is* the item's real recheck outcome, not just a note about
 * one. Called from the action-item PATCH route right after that row is saved. Returns true if it
 * actually resolved the item (so the caller knows to also re-sync 2A/2D1/2F and reschedule);
 * false when there was nothing to resolve — not a pass/fail row, not a Pass, or the item wasn't
 * sitting failed in the first place. Only ever fires once: the moment this flips qc_passed to
 * true, canAddActionItem (which requires qc_passed === false) goes false, so there's no second
 * pass/fail row left to race with.
 */
export async function resolveProcurementItemFromActionItem(
  procurementItemId: string,
  isPassFail: boolean,
  newQcPassed: boolean | null,
  resolvedAt: Date | null
): Promise<boolean> {
  if (!isPassFail || newQcPassed !== true) return false;
  const item = await prisma.procurementItem.findUniqueOrThrow({ where: { id: procurementItemId } });
  if (item.qcPassed !== false) return false;
  await prisma.procurementItem.update({
    where: { id: procurementItemId },
    data: { qcPassed: true, qcCheckedAt: resolvedAt ?? item.qcCheckedAt ?? new Date() },
  });
  return true;
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
