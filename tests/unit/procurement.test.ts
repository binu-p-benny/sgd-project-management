import { describe, it, expect } from "vitest";
import {
  computeExpectedArrivalDate,
  computeExpectedQuoteDate,
  computeExpectedPaymentDate,
  computeExpectedOrderDate,
  computeExpectedQCDate,
  computeExpectedActionPlanDate,
  computeProcurementPlannedDates,
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
