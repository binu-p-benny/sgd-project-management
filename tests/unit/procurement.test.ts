import { describe, it, expect } from "vitest";
import {
  computeExpectedArrivalDate,
  computeExpectedQuoteDate,
  computeExpectedOrderDate,
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

describe("hardware/gasket track: quote day 13 -> order day 15 -> arrival before day 21", () => {
  it("hardware: quote requested day 13", () => {
    expect(computeExpectedQuoteDate("hardware", requirementCreatedAt)).toEqual(daysLater(13));
  });
  it("hardware: order confirmed day 15", () => {
    expect(computeExpectedOrderDate("hardware", requirementCreatedAt)).toEqual(daysLater(15));
  });
  it("hardware: arrival before day 21 (day 20)", () => {
    expect(computeExpectedArrivalDate("hardware", requirementCreatedAt)).toEqual(daysLater(20));
  });
  it("gasket follows the same timing pattern as hardware", () => {
    expect(computeExpectedQuoteDate("gasket", requirementCreatedAt)).toEqual(daysLater(13));
    expect(computeExpectedOrderDate("gasket", requirementCreatedAt)).toEqual(daysLater(15));
    expect(computeExpectedArrivalDate("gasket", requirementCreatedAt)).toEqual(daysLater(20));
  });
});
