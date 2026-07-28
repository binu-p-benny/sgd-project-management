import { describe, it, expect } from "vitest";
import {
  isStepOverrun,
  isProcurementItemOverrun,
  daysBlocked,
  projectHasOverrun,
  getEffectiveOverallStatus,
} from "@/lib/overrun";

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

describe("isStepOverrun", () => {
  it("true when today is past planned_end_date and step is incomplete", () => {
    expect(isStepOverrun(yesterday, "in_progress")).toBe(true);
    expect(isStepOverrun(yesterday, "not_started")).toBe(true);
    expect(isStepOverrun(yesterday, "blocked")).toBe(true);
  });
  it("false when step is completed, regardless of date", () => {
    expect(isStepOverrun(yesterday, "completed")).toBe(false);
  });
  it("false when planned_end_date hasn't passed yet", () => {
    expect(isStepOverrun(tomorrow, "in_progress")).toBe(false);
  });
  it("false when planned_end_date is null", () => {
    expect(isStepOverrun(null, "in_progress")).toBe(false);
  });
});

describe("isProcurementItemOverrun", () => {
  it("true when today is past expected_arrival_date and nothing has arrived", () => {
    expect(isProcurementItemOverrun(yesterday, null)).toBe(true);
  });
  it("false once actual_arrival_date is set, regardless of date", () => {
    expect(isProcurementItemOverrun(yesterday, new Date())).toBe(false);
  });
  it("false when expected_arrival_date is null", () => {
    expect(isProcurementItemOverrun(null, null)).toBe(false);
  });
  it("false when expected_arrival_date is still in the future", () => {
    expect(isProcurementItemOverrun(tomorrow, null)).toBe(false);
  });
});

describe("daysBlocked", () => {
  it("computes whole days elapsed since updatedAt", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000);
    expect(daysBlocked(threeDaysAgo)).toBe(3);
  });
});

describe("projectHasOverrun", () => {
  it("true if any step is overrun", () => {
    expect(
      projectHasOverrun([{ plannedEndDate: yesterday, status: "in_progress" }], [])
    ).toBe(true);
  });
  it("true if any procurement item is overrun", () => {
    expect(
      projectHasOverrun([], [{ expectedArrivalDate: yesterday, actualArrivalDate: null }])
    ).toBe(true);
  });
  it("false if nothing is overrun", () => {
    expect(
      projectHasOverrun(
        [{ plannedEndDate: tomorrow, status: "in_progress" }],
        [{ expectedArrivalDate: tomorrow, actualArrivalDate: null }]
      )
    ).toBe(false);
  });
});

describe("getEffectiveOverallStatus", () => {
  it("completed and blocked pass through unchanged, ignoring overrun", () => {
    expect(getEffectiveOverallStatus("completed", true)).toBe("completed");
    expect(getEffectiveOverallStatus("blocked", true)).toBe("blocked");
    expect(getEffectiveOverallStatus("blocked", false)).toBe("blocked");
  });
  it("on_track becomes delayed when overrun is present", () => {
    expect(getEffectiveOverallStatus("on_track", true)).toBe("delayed");
  });
  it("on_track stays on_track when nothing is overrun", () => {
    expect(getEffectiveOverallStatus("on_track", false)).toBe("on_track");
  });
});
