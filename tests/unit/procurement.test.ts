import { describe, it, expect } from "vitest";
import {
  computeExpectedArrivalDate,
  computeExpectedQuoteDate,
  computeExpectedPaymentDate,
  computeExpectedOrderDate,
  computeExpectedQCDate,
  computeExpectedActionPlanDate,
  computeProcurementPlannedDates,
  computeExpectedMaterialDespatchDate,
  computeExpectedPowderCoatingArrivalDate,
  computeExpectedSectionArrivalDate,
  computeSectionChainDates,
  computeExpectedHardwareGasketQuoteDate,
  computeExpectedHardwareGasketPaymentDate,
  computeExpectedHardwareGasketArrivalDate,
  computeHardwareGasketChainDates,
  computePhase2PlanAnchor,
  computeItemArrivalPlanned,
  computeSectionQCPlanned,
  computeAllProcurementPlannedDates,
  computeInstallationPlannedWindow,
  INSTALLATION_WINDOW_START_OFFSET_DAYS,
  INSTALLATION_WINDOW_END_OFFSET_DAYS,
  type ProcurementItemArrivalInputs,
} from "@/lib/procurement";

const requirementCreatedAt = new Date("2026-01-01T00:00:00.000Z");
function daysLater(n: number): Date {
  const d = new Date(requirementCreatedAt);
  d.setDate(d.getDate() + n);
  return d;
}

describe("section track: quote (2d) -> order+payment (2d) -> arrival (~21d)", () => {
  it("quote requested day 2", () => {
    expect(computeExpectedQuoteDate("section", requirementCreatedAt)).toEqual(daysLater(2));
  });
  it("order confirmed day 4 (2 days after quote)", () => {
    expect(computeExpectedOrderDate("section", requirementCreatedAt)).toEqual(daysLater(4));
  });
  it("arrival ~21 days from requirement", () => {
    expect(computeExpectedArrivalDate("section", requirementCreatedAt)).toEqual(daysLater(21));
  });
});

describe("hardware/gasket track: quote day 13 -> order day 15 -> arrival day 25 -> QC day 27 (client-given timeline)", () => {
  it("hardware: quote requested day 13", () => {
    expect(computeExpectedQuoteDate("hardware", requirementCreatedAt)).toEqual(daysLater(13));
  });
  it("hardware: order confirmed day 15", () => {
    expect(computeExpectedOrderDate("hardware", requirementCreatedAt)).toEqual(daysLater(15));
  });
  it("hardware: arrival day 25", () => {
    expect(computeExpectedArrivalDate("hardware", requirementCreatedAt)).toEqual(daysLater(25));
  });
  it("hardware: QC day 27 (arrival + 2, not + 3 like section)", () => {
    expect(computeExpectedQCDate("hardware", requirementCreatedAt)).toEqual(daysLater(27));
  });
  it("gasket follows the same timing pattern as hardware", () => {
    expect(computeExpectedQuoteDate("gasket", requirementCreatedAt)).toEqual(daysLater(13));
    expect(computeExpectedOrderDate("gasket", requirementCreatedAt)).toEqual(daysLater(15));
    expect(computeExpectedArrivalDate("gasket", requirementCreatedAt)).toEqual(daysLater(25));
    expect(computeExpectedQCDate("gasket", requirementCreatedAt)).toEqual(daysLater(27));
  });
  it("section keeps its own day-21 arrival / arrival+3 QC — unaffected by hardware/gasket's new offsets", () => {
    expect(computeExpectedArrivalDate("section", requirementCreatedAt)).toEqual(daysLater(21));
    expect(computeExpectedQCDate("section", requirementCreatedAt)).toEqual(daysLater(24));
  });
});

describe("action plan (only relevant once QC fails): 2 days after the QC check itself", () => {
  it("plans off qc_checked_at directly, not the shared requirement anchor", () => {
    const qcCheckedAt = new Date("2026-03-10T00:00:00.000Z");
    const expected = new Date(qcCheckedAt);
    expected.setDate(expected.getDate() + 2);
    expect(computeExpectedActionPlanDate(qcCheckedAt)).toEqual(expected);
  });
});

describe("computeProcurementPlannedDates", () => {
  it("with no overrides, reproduces exactly what the individual compute*Date functions give — for every item type", () => {
    for (const itemType of ["section", "hardware", "gasket"] as const) {
      const result = computeProcurementPlannedDates(itemType, requirementCreatedAt, {});
      expect(result).toEqual({
        requirement: requirementCreatedAt,
        quote: computeExpectedQuoteDate(itemType, requirementCreatedAt),
        payment: computeExpectedPaymentDate(itemType, requirementCreatedAt),
        order: computeExpectedOrderDate(itemType, requirementCreatedAt),
        arrival: computeExpectedArrivalDate(itemType, requirementCreatedAt),
        qc: computeExpectedQCDate(itemType, requirementCreatedAt),
      });
    }
  });

  it("everything is null when the anchor itself is unresolved and nothing is overridden", () => {
    expect(computeProcurementPlannedDates("section", null, {})).toEqual({
      requirement: null,
      quote: null,
      payment: null,
      order: null,
      arrival: null,
      qc: null,
    });
  });

  it("overriding one stage shifts every stage after it by the same delta, leaving earlier stages untouched", () => {
    const originalQuote = computeExpectedQuoteDate("section", requirementCreatedAt);
    const newQuote = daysLater(10); // 8 days later than the original day-2 quote
    const shiftDays = (newQuote.getTime() - originalQuote.getTime()) / (1000 * 60 * 60 * 24);

    const result = computeProcurementPlannedDates("section", requirementCreatedAt, { quote: newQuote });

    expect(result.requirement).toEqual(requirementCreatedAt); // before the override — unaffected
    expect(result.quote).toEqual(newQuote);
    const shift = (d: Date) => new Date(d.getTime() + shiftDays * 24 * 60 * 60 * 1000);
    expect(result.payment).toEqual(shift(computeExpectedPaymentDate("section", requirementCreatedAt)));
    expect(result.order).toEqual(shift(computeExpectedOrderDate("section", requirementCreatedAt)));
    expect(result.arrival).toEqual(shift(computeExpectedArrivalDate("section", requirementCreatedAt)));
    expect(result.qc).toEqual(shift(computeExpectedQCDate("section", requirementCreatedAt)));
  });

  it("overriding the last stage only changes that one stage", () => {
    const newQC = daysLater(100);
    const result = computeProcurementPlannedDates("section", requirementCreatedAt, { qc: newQC });

    expect(result.qc).toEqual(newQC);
    expect(result.requirement).toEqual(requirementCreatedAt);
    expect(result.quote).toEqual(computeExpectedQuoteDate("section", requirementCreatedAt));
    expect(result.payment).toEqual(computeExpectedPaymentDate("section", requirementCreatedAt));
    expect(result.order).toEqual(computeExpectedOrderDate("section", requirementCreatedAt));
    expect(result.arrival).toEqual(computeExpectedArrivalDate("section", requirementCreatedAt));
  });

  it("a later override takes precedence over an earlier one's shift, and re-anchors everything after itself in turn", () => {
    const newQuote = daysLater(10);
    const newArrival = daysLater(50);

    const result = computeProcurementPlannedDates("section", requirementCreatedAt, {
      quote: newQuote,
      arrival: newArrival,
    });

    expect(result.quote).toEqual(newQuote);
    expect(result.arrival).toEqual(newArrival); // its own override, not shifted by quote's
    expect(result.qc).toEqual(new Date(newArrival.getTime() + 3 * 24 * 60 * 60 * 1000)); // qc = arrival + 3, off arrival's override
  });

  it("an override still anchors downstream stages even when the base anchor itself is unresolved", () => {
    const newQuote = daysLater(10);
    const result = computeProcurementPlannedDates("section", null, { quote: newQuote });

    expect(result.requirement).toBeNull(); // before the override, and the anchor is null
    expect(result.quote).toEqual(newQuote);
    expect(result.payment).toEqual(new Date(newQuote.getTime() + 2 * 24 * 60 * 60 * 1000));
  });
});

describe("Section-only despatch chain: 7 working days after the previous stage's own actual date, Sundays skipped", () => {
  it("skips exactly one Sunday for a span that only crosses one week boundary", () => {
    const orderConfirmedAt = new Date("2026-08-24T00:00:00.000Z"); // Monday
    expect(computeExpectedMaterialDespatchDate(orderConfirmedAt)).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("skips two Sundays when the 7-working-day span starts on a Saturday", () => {
    const orderConfirmedAt = new Date("2026-08-22T00:00:00.000Z"); // Saturday
    expect(computeExpectedMaterialDespatchDate(orderConfirmedAt)).toEqual(new Date("2026-08-31T00:00:00.000Z"));
  });

  it("applies the identical rule for arrived-for-powder-coating and section arrival", () => {
    const monday = new Date("2026-08-24T00:00:00.000Z");
    expect(computeExpectedPowderCoatingArrivalDate(monday)).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(computeExpectedSectionArrivalDate(monday)).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });
});

describe("computeSectionChainDates", () => {
  const orderConfirmedPlanned = new Date("2026-08-24T00:00:00.000Z"); // Monday

  it("everything is null when Order confirmed itself has no planned date yet (anchor unresolved)", () => {
    expect(computeSectionChainDates(null, null, null, null, {})).toEqual({
      materialDespatch: null,
      powderCoatingArrival: null,
      arrival: null,
      qc: null,
    });
  });

  it("prefills the whole chain as a forecast from Order confirmed's planned date, with no actuals at all yet", () => {
    const result = computeSectionChainDates(orderConfirmedPlanned, null, null, null, {});

    // Each forecast stage becomes the "ground truth" the next one plans off, same as reality
    // would once actuals start landing — see the sequential re-derivation below.
    expect(result.materialDespatch).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(result.powderCoatingArrival).toEqual(new Date("2026-09-09T00:00:00.000Z"));
    expect(result.arrival).toEqual(new Date("2026-09-17T00:00:00.000Z"));
    expect(result.qc).toEqual(new Date("2026-09-19T00:00:00.000Z")); // arrival + 2 calendar days
  });

  it("Order confirmed's own actual date, once set, is used instead of its planned date", () => {
    const orderConfirmedAt = new Date("2026-08-29T00:00:00.000Z"); // later than planned, Saturday
    const result = computeSectionChainDates(orderConfirmedPlanned, orderConfirmedAt, null, null, {});

    expect(result.materialDespatch).toEqual(new Date("2026-09-07T00:00:00.000Z")); // off the actual, not the planned
  });

  it("once a stage's own actual date lands, it replaces the forecast as the ground truth for the next stage — even when it differs from what was forecast", () => {
    const actualMaterialDespatch = new Date("2026-09-05T00:00:00.000Z"); // later than the 09-01 forecast
    const result = computeSectionChainDates(orderConfirmedPlanned, null, actualMaterialDespatch, null, {});

    expect(result.materialDespatch).toEqual(new Date("2026-09-01T00:00:00.000Z")); // still the forecast — nothing overrides this stage's own display
    expect(result.powderCoatingArrival).toEqual(new Date("2026-09-14T00:00:00.000Z")); // but chains off the actual, not the stale forecast
  });

  it("arrival plans off arrived-for-powder-coating's ground truth, and QC stays 2 calendar days after arrival", () => {
    const arrivedForPowderCoatingAt = new Date("2026-08-24T00:00:00.000Z"); // Monday
    const result = computeSectionChainDates(orderConfirmedPlanned, null, null, arrivedForPowderCoatingAt, {});

    expect(result.arrival).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(result.qc).toEqual(new Date("2026-09-03T00:00:00.000Z")); // arrival + 2 calendar days, not working days
  });

  it("a manual arrival override wins over the chained value, and QC re-anchors off the override — same as the other stages' overrides", () => {
    const arrivedForPowderCoatingAt = new Date("2026-08-24T00:00:00.000Z");
    const overrideArrival = new Date("2026-09-10T00:00:00.000Z");
    const result = computeSectionChainDates(orderConfirmedPlanned, null, null, arrivedForPowderCoatingAt, {
      arrival: overrideArrival,
    });

    expect(result.arrival).toEqual(overrideArrival);
    expect(result.qc).toEqual(new Date("2026-09-12T00:00:00.000Z")); // override + 2 calendar days
  });

  it("a manual QC override wins outright, independent of arrival", () => {
    const overrideQC = new Date("2026-10-01T00:00:00.000Z");
    const result = computeSectionChainDates(orderConfirmedPlanned, null, null, null, { qc: overrideQC });

    expect(result.qc).toEqual(overrideQC);
    expect(result.arrival).not.toBeNull();
  });

  it("a manual material-despatch override wins for its own display and re-anchors arrived-for-powder-coating onward", () => {
    const overrideMaterialDespatch = new Date("2026-09-10T00:00:00.000Z"); // Thursday
    const result = computeSectionChainDates(orderConfirmedPlanned, null, null, null, {
      materialDespatch: overrideMaterialDespatch,
    });

    expect(result.materialDespatch).toEqual(overrideMaterialDespatch);
    expect(result.powderCoatingArrival).toEqual(new Date("2026-09-18T00:00:00.000Z")); // override + 7 working days
  });

  it("once material despatch's own actual date lands, it wins over its own override for what the next stage plans from", () => {
    const overrideMaterialDespatch = new Date("2026-09-10T00:00:00.000Z");
    const actualMaterialDespatch = new Date("2026-09-05T00:00:00.000Z"); // earlier than the override
    const result = computeSectionChainDates(orderConfirmedPlanned, null, actualMaterialDespatch, null, {
      materialDespatch: overrideMaterialDespatch,
    });

    expect(result.materialDespatch).toEqual(overrideMaterialDespatch); // still shown — an override always wins for its own display
    expect(result.powderCoatingArrival).toEqual(new Date("2026-09-14T00:00:00.000Z")); // but chains off the actual, not the override
  });

  it("a manual arrived-for-powder-coating override re-anchors arrival and QC onward, same as overriding arrival directly does", () => {
    const overridePowderCoatingArrival = new Date("2026-09-15T00:00:00.000Z");
    const result = computeSectionChainDates(orderConfirmedPlanned, null, null, null, {
      powderCoatingArrival: overridePowderCoatingArrival,
    });

    expect(result.powderCoatingArrival).toEqual(overridePowderCoatingArrival);
    expect(result.arrival).toEqual(new Date("2026-09-23T00:00:00.000Z")); // override + 7 working days
    expect(result.qc).toEqual(new Date("2026-09-25T00:00:00.000Z")); // that arrival + 2 calendar days
  });
});

describe("computePhase2PlanAnchor", () => {
  const oneDPlanned = new Date("2026-08-20T00:00:00.000Z");

  it("is null until 1D actually completes, regardless of its planned date", () => {
    expect(computePhase2PlanAnchor(oneDPlanned, null, null)).toBeNull();
  });

  it("anchors off 1D's actual end + 1 day when there's no delay category", () => {
    const oneDActual = new Date("2026-08-22T00:00:00.000Z");
    expect(computePhase2PlanAnchor(oneDPlanned, oneDActual, null)).toEqual(new Date("2026-08-23T00:00:00.000Z"));
  });

  it("still anchors off the (late) actual end for a client_side delay — same as no delay", () => {
    const oneDActual = new Date("2026-08-25T00:00:00.000Z");
    expect(computePhase2PlanAnchor(oneDPlanned, oneDActual, "client_side")).toEqual(
      new Date("2026-08-26T00:00:00.000Z")
    );
  });

  it("anchors off 1D's planned end + 1 day instead for an in_house delay, ignoring the late actual end", () => {
    const oneDActual = new Date("2026-08-25T00:00:00.000Z"); // later than planned
    expect(computePhase2PlanAnchor(oneDPlanned, oneDActual, "in_house")).toEqual(
      new Date("2026-08-21T00:00:00.000Z") // planned + 1, not actual + 1
    );
  });
});

describe("Hardware/gasket chain: Quote/Payment/Arrival each plan a working-day span (Sundays skipped) after the previous stage's own planned date; QC is not its own forecast at all — see computeHardwareGasketChainDates", () => {
  const requirementPlanned = new Date("2026-08-24T00:00:00.000Z"); // Monday

  it("computeExpectedHardwareGasketQuoteDate: 14 working days after Requirement, skipping 2 Sundays", () => {
    expect(computeExpectedHardwareGasketQuoteDate(requirementPlanned)).toEqual(new Date("2026-09-09T00:00:00.000Z"));
  });

  it("chains Payment and Arrival by working days off each previous stage's own date", () => {
    const quote = computeExpectedHardwareGasketQuoteDate(requirementPlanned);
    const payment = computeExpectedHardwareGasketPaymentDate(quote);
    const arrival = computeExpectedHardwareGasketArrivalDate(payment);

    expect(payment).toEqual(new Date("2026-09-11T00:00:00.000Z")); // quote + 2 working days
    expect(arrival).toEqual(new Date("2026-09-23T00:00:00.000Z")); // payment + 10 working days
  });
});

describe("computeHardwareGasketChainDates", () => {
  const requirementPlanned = new Date("2026-08-24T00:00:00.000Z"); // Monday
  const sectionQCPlanned = new Date("2026-10-15T00:00:00.000Z"); // arbitrary — unrelated to requirementPlanned

  it("everything is null when Requirement and Section's QC planned date are both null", () => {
    expect(computeHardwareGasketChainDates(null, null, {})).toEqual({
      quote: null,
      payment: null,
      order: null,
      arrival: null,
      qc: null,
    });
  });

  it("prefills Quote/Payment/Order/Arrival as a forecast from Requirement's planned date, with no overrides — QC is Section's own QC planned date, not a forecast off Arrival at all", () => {
    const result = computeHardwareGasketChainDates(requirementPlanned, sectionQCPlanned, {});

    expect(result.quote).toEqual(new Date("2026-09-09T00:00:00.000Z"));
    expect(result.payment).toEqual(new Date("2026-09-11T00:00:00.000Z"));
    expect(result.order).toEqual(result.payment); // Order tracks Payment's date by default
    expect(result.arrival).toEqual(new Date("2026-09-23T00:00:00.000Z"));
    expect(result.qc).toEqual(sectionQCPlanned);
  });

  it("QC tracks Section's QC planned date exactly, regardless of what this item's own Arrival is — a manual arrival override doesn't touch QC at all", () => {
    const overrideArrival = new Date("2026-10-01T00:00:00.000Z");
    const result = computeHardwareGasketChainDates(requirementPlanned, sectionQCPlanned, { arrival: overrideArrival });

    expect(result.arrival).toEqual(overrideArrival);
    expect(result.qc).toEqual(sectionQCPlanned); // unaffected by the arrival override
  });

  it("a change to Section's own QC planned date carries straight through, with no override on this item", () => {
    const laterSectionQC = new Date("2026-11-01T00:00:00.000Z");
    const result = computeHardwareGasketChainDates(requirementPlanned, laterSectionQC, {});
    expect(result.qc).toEqual(laterSectionQC);
  });

  it("a manual quote override wins for its own display and re-anchors payment, order and arrival onward — QC is unaffected either way", () => {
    const overrideQuote = new Date("2026-09-15T00:00:00.000Z");
    const result = computeHardwareGasketChainDates(requirementPlanned, sectionQCPlanned, { quote: overrideQuote });

    expect(result.quote).toEqual(overrideQuote);
    expect(result.payment).toEqual(new Date("2026-09-17T00:00:00.000Z")); // override + 2 working days
    expect(result.order).toEqual(result.payment);
    expect(result.arrival).toEqual(computeExpectedHardwareGasketArrivalDate(result.payment!));
    expect(result.qc).toEqual(sectionQCPlanned);
  });

  it("a manual payment override leaves quote untouched but re-anchors order and arrival", () => {
    const overridePayment = new Date("2026-09-20T00:00:00.000Z");
    const result = computeHardwareGasketChainDates(requirementPlanned, sectionQCPlanned, { payment: overridePayment });

    expect(result.quote).toEqual(new Date("2026-09-09T00:00:00.000Z")); // unaffected — before the override
    expect(result.payment).toEqual(overridePayment);
    expect(result.order).toEqual(overridePayment);
    expect(result.arrival).toEqual(new Date("2026-10-01T00:00:00.000Z")); // override + 10 working days
  });

  it("order's own override wins independently of payment's date", () => {
    const overrideOrder = new Date("2026-12-25T00:00:00.000Z");
    const result = computeHardwareGasketChainDates(requirementPlanned, sectionQCPlanned, { order: overrideOrder });

    expect(result.order).toEqual(overrideOrder);
    // Nothing downstream reads Order — arrival still chains off Payment, unaffected.
    expect(result.arrival).toEqual(new Date("2026-09-23T00:00:00.000Z"));
  });

  it("a manual QC override wins outright, independent of both Arrival and Section's own QC planned date", () => {
    const overrideQC = new Date("2027-01-01T00:00:00.000Z");
    const result = computeHardwareGasketChainDates(requirementPlanned, sectionQCPlanned, { qc: overrideQC });

    expect(result.qc).toEqual(overrideQC);
    expect(result.arrival).not.toBeNull();
  });
});

describe("computeItemArrivalPlanned: one item's Actual arrival planned date, the same way the tracker itself computes it", () => {
  const phase2PlanAnchor = new Date("2026-08-24T00:00:00.000Z"); // Monday
  const emptyFields: Omit<ProcurementItemArrivalInputs, "itemType"> = {
    planAnchorOverride: null,
    requirementPlannedOverride: null,
    quotePlannedOverride: null,
    paymentPlannedOverride: null,
    orderPlannedOverride: null,
    arrivalPlannedOverride: null,
    qcPlannedOverride: null,
    orderConfirmedAt: null,
    materialDespatchAt: null,
    materialDespatchPlannedOverride: null,
    arrivedForPowderCoatingAt: null,
    arrivedForPowderCoatingPlannedOverride: null,
  };

  it("section: matches computeSectionChainDates's own arrival, chained off the shared anchor", () => {
    const result = computeItemArrivalPlanned({ itemType: "section", ...emptyFields }, phase2PlanAnchor);
    expect(result).toEqual(new Date("2026-09-22T00:00:00.000Z"));
  });

  it("hardware/gasket: matches computeHardwareGasketChainDates's own arrival, and lands later than section with identical inputs", () => {
    const hardware = computeItemArrivalPlanned({ itemType: "hardware", ...emptyFields }, phase2PlanAnchor);
    const gasket = computeItemArrivalPlanned({ itemType: "gasket", ...emptyFields }, phase2PlanAnchor);
    const section = computeItemArrivalPlanned({ itemType: "section", ...emptyFields }, phase2PlanAnchor);

    expect(hardware).toEqual(new Date("2026-09-23T00:00:00.000Z"));
    expect(gasket).toEqual(hardware);
    expect(hardware!.getTime()).toBeGreaterThan(section!.getTime());
  });

  it("null when the shared anchor is unresolved and the item has no anchor override of its own", () => {
    expect(computeItemArrivalPlanned({ itemType: "hardware", ...emptyFields }, null)).toBeNull();
  });

  it("a restarted item's own plan anchor override is used instead of the (even unresolved) shared anchor", () => {
    const ownAnchor = new Date("2027-01-04T00:00:00.000Z"); // Monday
    const result = computeItemArrivalPlanned(
      { itemType: "hardware", ...emptyFields, planAnchorOverride: ownAnchor },
      null
    );
    expect(result).toEqual(new Date("2027-02-03T00:00:00.000Z")); // 14+2+10 working days, off its own anchor
  });
});

describe("computeSectionQCPlanned: hardware/gasket's own QC planned date comes from this — see computeHardwareGasketChainDates", () => {
  const phase2PlanAnchor = new Date("2026-08-24T00:00:00.000Z"); // Monday
  const emptyFields: Omit<ProcurementItemArrivalInputs, "itemType"> = {
    planAnchorOverride: null,
    requirementPlannedOverride: null,
    quotePlannedOverride: null,
    paymentPlannedOverride: null,
    orderPlannedOverride: null,
    arrivalPlannedOverride: null,
    qcPlannedOverride: null,
    orderConfirmedAt: null,
    materialDespatchAt: null,
    materialDespatchPlannedOverride: null,
    arrivedForPowderCoatingAt: null,
    arrivedForPowderCoatingPlannedOverride: null,
  };

  it("null for hardware/gasket — this is Section-only", () => {
    expect(computeSectionQCPlanned({ itemType: "hardware", ...emptyFields }, phase2PlanAnchor)).toBeNull();
    expect(computeSectionQCPlanned({ itemType: "gasket", ...emptyFields }, phase2PlanAnchor)).toBeNull();
  });

  it("matches computeSectionChainDates's own QC for the same section item — no drift between the two", () => {
    const item = { itemType: "section" as const, ...emptyFields };
    const arrival = computeItemArrivalPlanned(item, phase2PlanAnchor)!;
    expect(computeSectionQCPlanned(item, phase2PlanAnchor)).toEqual(
      new Date(arrival.getTime() + 2 * 24 * 60 * 60 * 1000) // arrival + 2 calendar days
    );
  });

  it("a manual override on Section's own QC row carries straight through", () => {
    const overrideQC = new Date("2027-03-01T00:00:00.000Z");
    const item = { itemType: "section" as const, ...emptyFields, qcPlannedOverride: overrideQC };
    expect(computeSectionQCPlanned(item, phase2PlanAnchor)).toEqual(overrideQC);
  });
});

describe("computeAllProcurementPlannedDates: every stage's Planned date for one item, the same way page.tsx computes them inline", () => {
  const phase2PlanAnchor = new Date("2026-08-24T00:00:00.000Z"); // Monday
  const emptyFields: Omit<ProcurementItemArrivalInputs, "itemType"> = {
    planAnchorOverride: null,
    requirementPlannedOverride: null,
    quotePlannedOverride: null,
    paymentPlannedOverride: null,
    orderPlannedOverride: null,
    arrivalPlannedOverride: null,
    qcPlannedOverride: null,
    orderConfirmedAt: null,
    materialDespatchAt: null,
    materialDespatchPlannedOverride: null,
    arrivedForPowderCoatingAt: null,
    arrivedForPowderCoatingPlannedOverride: null,
  };

  it("section: arrival/qc match computeItemArrivalPlanned/computeSectionQCPlanned, plus despatch/powder-coating", () => {
    const item = { itemType: "section" as const, ...emptyFields };
    const result = computeAllProcurementPlannedDates(item, phase2PlanAnchor, null);
    expect(result.arrival).toEqual(computeItemArrivalPlanned(item, phase2PlanAnchor));
    expect(result.qc).toEqual(computeSectionQCPlanned(item, phase2PlanAnchor));
    expect(result.materialDespatch).not.toBeNull();
    expect(result.arrivedForPowderCoating).not.toBeNull();
  });

  it("hardware/gasket: arrival matches computeItemArrivalPlanned, qc matches the section item's own qc when passed through", () => {
    const sectionItem = { itemType: "section" as const, ...emptyFields };
    const sectionQCPlanned = computeSectionQCPlanned(sectionItem, phase2PlanAnchor);
    const hardwareItem = { itemType: "hardware" as const, ...emptyFields };
    const result = computeAllProcurementPlannedDates(hardwareItem, phase2PlanAnchor, sectionQCPlanned);
    expect(result.arrival).toEqual(computeItemArrivalPlanned(hardwareItem, phase2PlanAnchor));
    expect(result.qc).toEqual(sectionQCPlanned);
    expect(result.materialDespatch).toBeNull();
    expect(result.arrivedForPowderCoating).toBeNull();
  });

  it("hardware/gasket's own qc override still wins over the section's qc", () => {
    const overrideQC = new Date("2027-03-01T00:00:00.000Z");
    const hardwareItem = { itemType: "hardware" as const, ...emptyFields, qcPlannedOverride: overrideQC };
    const result = computeAllProcurementPlannedDates(hardwareItem, phase2PlanAnchor, new Date("2026-01-01T00:00:00.000Z"));
    expect(result.qc).toEqual(overrideQC);
  });
});

describe("computeInstallationPlannedWindow: QC checked planned date + 10 days (start) / + 22 days (end), Sundays not counted", () => {
  const phase2PlanAnchor = new Date("2026-08-24T00:00:00.000Z"); // Monday
  const emptyFields: Omit<ProcurementItemArrivalInputs, "itemType"> = {
    planAnchorOverride: null,
    requirementPlannedOverride: null,
    quotePlannedOverride: null,
    paymentPlannedOverride: null,
    orderPlannedOverride: null,
    arrivalPlannedOverride: null,
    qcPlannedOverride: null,
    orderConfirmedAt: null,
    materialDespatchAt: null,
    materialDespatchPlannedOverride: null,
    arrivedForPowderCoatingAt: null,
    arrivedForPowderCoatingPlannedOverride: null,
  };

  it("uses the offsets the spec names", () => {
    expect(INSTALLATION_WINDOW_START_OFFSET_DAYS).toBe(10);
    expect(INSTALLATION_WINDOW_END_OFFSET_DAYS).toBe(22);
  });

  it("start is QC planned + 10 days, end is QC planned + 22, skipping Sundays — across a month/year boundary too", () => {
    const qc = new Date("2026-12-10T00:00:00.000Z"); // Thursday
    const result = computeInstallationPlannedWindow([qc])!;

    expect(result.qcPlanned).toEqual(qc);
    expect(result.start).toEqual(new Date("2026-12-22T00:00:00.000Z")); // Tuesday; 13th and 20th are Sundays
    expect(result.end).toEqual(new Date("2027-01-05T00:00:00.000Z")); // Tuesday; 13th, 20th, 27th, 3rd are Sundays
  });

  it("Sundays don't count: +10 plain calendar days would have landed on Sunday 20 Dec, but the start skips past it — and neither date can ever land on a Sunday", () => {
    const qc = new Date("2026-12-10T00:00:00.000Z");
    const result = computeInstallationPlannedWindow([qc])!;

    expect(result.start.getTime()).toBeGreaterThan(new Date("2026-12-20T00:00:00.000Z").getTime());
    expect(result.start.getDay()).not.toBe(0);
    expect(result.end.getDay()).not.toBe(0);
  });

  it("a QC planned date that itself falls on a Sunday is just the starting point — counting begins the next day", () => {
    const qc = new Date("2026-12-13T00:00:00.000Z"); // Sunday
    const result = computeInstallationPlannedWindow([qc])!;

    expect(result.qcPlanned).toEqual(qc);
    expect(result.start).toEqual(new Date("2026-12-24T00:00:00.000Z")); // Thursday
    expect(result.end).toEqual(new Date("2027-01-07T00:00:00.000Z")); // Thursday
  });

  it("null when no item has a QC planned date yet (shared anchor not resolved)", () => {
    expect(computeInstallationPlannedWindow([])).toBeNull();
    expect(computeInstallationPlannedWindow([null, null, null])).toBeNull();
  });

  it("ignores items with no QC planned date and still computes off the ones that have one", () => {
    const qc = new Date("2026-12-10T00:00:00.000Z");
    const result = computeInstallationPlannedWindow([null, qc, null])!;
    expect(result.qcPlanned).toEqual(qc);
  });

  it("keys off the latest QC planned date when items differ — installation can't start until every item is checked", () => {
    const earlier = new Date("2026-12-10T00:00:00.000Z");
    const later = new Date("2026-12-15T00:00:00.000Z"); // Tuesday
    const result = computeInstallationPlannedWindow([earlier, later, earlier])!;

    expect(result.qcPlanned).toEqual(later);
    expect(result.start).toEqual(new Date("2026-12-26T00:00:00.000Z")); // Saturday; 20th is a Sunday
    expect(result.end).toEqual(new Date("2027-01-09T00:00:00.000Z")); // Saturday; 20th, 27th, 3rd are Sundays
  });

  it("fed the real per-item chain (section + hardware + gasket, no overrides), all three share Section's QC date, so the window is Section's QC + 10/+22 days without Sundays", () => {
    const items = (["section", "hardware", "gasket"] as const).map((itemType) => ({ itemType, ...emptyFields }));
    const sectionQCPlanned = computeSectionQCPlanned(items[0], phase2PlanAnchor)!;

    const result = computeInstallationPlannedWindow(
      items.map((item) => computeAllProcurementPlannedDates(item, phase2PlanAnchor, sectionQCPlanned).qc)
    )!;

    expect(sectionQCPlanned).toEqual(new Date("2026-09-24T00:00:00.000Z")); // Thursday — anchors the two dates below
    expect(result.qcPlanned).toEqual(sectionQCPlanned);
    expect(result.start).toEqual(new Date("2026-10-06T00:00:00.000Z")); // Tuesday; 27 Sep and 4 Oct are Sundays
    expect(result.end).toEqual(new Date("2026-10-20T00:00:00.000Z")); // Tuesday; 27 Sep, 4, 11, 18 Oct are Sundays
  });

  it("a hardware QC override later than Section's pulls the whole window out to it", () => {
    const overrideQC = new Date("2027-03-01T00:00:00.000Z");
    const section = { itemType: "section" as const, ...emptyFields };
    const hardware = { itemType: "hardware" as const, ...emptyFields, qcPlannedOverride: overrideQC };
    const sectionQCPlanned = computeSectionQCPlanned(section, phase2PlanAnchor);

    const result = computeInstallationPlannedWindow([
      computeAllProcurementPlannedDates(section, phase2PlanAnchor, sectionQCPlanned).qc,
      computeAllProcurementPlannedDates(hardware, phase2PlanAnchor, sectionQCPlanned).qc,
    ])!;

    expect(result.qcPlanned).toEqual(overrideQC);
  });
});
