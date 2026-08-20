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

describe("hardware/gasket track: quote day 13 -> order day 15 -> arrival day 21 (same as section)", () => {
  it("hardware: quote requested day 13", () => {
    expect(computeExpectedQuoteDate("hardware", requirementCreatedAt)).toEqual(daysLater(13));
  });
  it("hardware: order confirmed day 15", () => {
    expect(computeExpectedOrderDate("hardware", requirementCreatedAt)).toEqual(daysLater(15));
  });
  it("hardware: arrival day 21, same as section — no longer a day ahead of it", () => {
    expect(computeExpectedArrivalDate("hardware", requirementCreatedAt)).toEqual(daysLater(21));
  });
  it("gasket follows the same timing pattern as hardware", () => {
    expect(computeExpectedQuoteDate("gasket", requirementCreatedAt)).toEqual(daysLater(13));
    expect(computeExpectedOrderDate("gasket", requirementCreatedAt)).toEqual(daysLater(15));
    expect(computeExpectedArrivalDate("gasket", requirementCreatedAt)).toEqual(daysLater(21));
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
    expect(result.qc).toEqual(new Date("2026-09-20T00:00:00.000Z")); // arrival + 3 calendar days
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

  it("arrival plans off arrived-for-powder-coating's ground truth, and QC stays 3 calendar days after arrival — same relationship as before", () => {
    const arrivedForPowderCoatingAt = new Date("2026-08-24T00:00:00.000Z"); // Monday
    const result = computeSectionChainDates(orderConfirmedPlanned, null, null, arrivedForPowderCoatingAt, {});

    expect(result.arrival).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(result.qc).toEqual(new Date("2026-09-04T00:00:00.000Z")); // arrival + 3 calendar days, not working days
  });

  it("a manual arrival override wins over the chained value, and QC re-anchors off the override — same as the other stages' overrides", () => {
    const arrivedForPowderCoatingAt = new Date("2026-08-24T00:00:00.000Z");
    const overrideArrival = new Date("2026-09-10T00:00:00.000Z");
    const result = computeSectionChainDates(orderConfirmedPlanned, null, null, arrivedForPowderCoatingAt, {
      arrival: overrideArrival,
    });

    expect(result.arrival).toEqual(overrideArrival);
    expect(result.qc).toEqual(new Date("2026-09-13T00:00:00.000Z")); // override + 3 calendar days
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
    expect(result.qc).toEqual(new Date("2026-09-26T00:00:00.000Z")); // that arrival + 3 calendar days
  });
});
