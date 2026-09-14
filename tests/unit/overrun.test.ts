import { describe, it, expect } from "vitest";
import {
  isStepOverrun,
  isProcurementItemOverrun,
  isContractorSelectionOverdue,
  daysBlocked,
  projectHasOverrun,
  getEffectiveOverallStatus,
  getProjectBlockedStep,
  getProjectDelayReason,
  getProjectQcFailureReason,
} from "@/lib/overrun";

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

describe("isContractorSelectionOverdue", () => {
  it("true once the target date has passed with no contractor chosen yet", () => {
    expect(isContractorSelectionOverdue(yesterday, null)).toBe(true);
  });
  it("false once a contractor is set, regardless of date", () => {
    expect(isContractorSelectionOverdue(yesterday, "contractor-1")).toBe(false);
  });
  it("false when the target date hasn't passed yet", () => {
    expect(isContractorSelectionOverdue(tomorrow, null)).toBe(false);
  });
  it("false when there's no target date at all", () => {
    expect(isContractorSelectionOverdue(null, null)).toBe(false);
  });
});

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
  it("a QC failure becomes its own status, ranked above delayed", () => {
    expect(getEffectiveOverallStatus("on_track", false, true)).toBe("qc_failed");
    expect(getEffectiveOverallStatus("on_track", true, true)).toBe("qc_failed");
  });
  it("completed and blocked still win over a QC failure", () => {
    expect(getEffectiveOverallStatus("completed", false, true)).toBe("completed");
    expect(getEffectiveOverallStatus("blocked", false, true)).toBe("blocked");
  });
  it("defaults to no QC failure when the third argument is omitted", () => {
    expect(getEffectiveOverallStatus("on_track", false)).toBe("on_track");
  });
});

describe("getProjectBlockedStep", () => {
  it("null when nothing is blocked", () => {
    expect(getProjectBlockedStep([{ stepCode: "1A", status: "in_progress" }])).toBeNull();
  });
  it("finds the blocked step among not-blocked ones", () => {
    expect(
      getProjectBlockedStep([
        { stepCode: "1A", status: "completed" },
        { stepCode: "1B", status: "blocked" },
        { stepCode: "1C", status: "not_started" },
      ])
    ).toEqual({ stepCode: "1B", status: "blocked" });
  });
  it("earliest by step_code if more than one is somehow blocked", () => {
    expect(
      getProjectBlockedStep([
        { stepCode: "2F", status: "blocked" },
        { stepCode: "1B", status: "blocked" },
      ])
    ).toEqual({ stepCode: "1B", status: "blocked" });
  });
});

describe("getProjectDelayReason", () => {
  it("null when nothing is overrun", () => {
    expect(
      getProjectDelayReason(
        [{ stepCode: "1B", stepName: "Site visit", plannedEndDate: tomorrow, status: "in_progress" }],
        [{ itemType: "hardware", expectedArrivalDate: tomorrow, actualArrivalDate: null }]
      )
    ).toBeNull();
  });
  it("an overdue step wins, earliest by step_code", () => {
    const reason = getProjectDelayReason(
      [
        { stepCode: "2F", stepName: "Material QC", plannedEndDate: yesterday, status: "in_progress" },
        { stepCode: "1B", stepName: "Site visit", plannedEndDate: yesterday, status: "in_progress" },
      ],
      []
    );
    expect(reason).toEqual({ kind: "step", stepCode: "1B", stepName: "Site visit", plannedEndDate: yesterday });
  });
  it("falls back to an overdue procurement item's arrival once no step is overrun", () => {
    const reason = getProjectDelayReason(
      [{ stepCode: "1B", stepName: "Site visit", plannedEndDate: tomorrow, status: "in_progress" }],
      [{ itemType: "hardware", expectedArrivalDate: yesterday, actualArrivalDate: null }]
    );
    expect(reason).toEqual({ kind: "item", itemType: "hardware", expectedArrivalDate: yesterday });
  });
});

describe("getProjectQcFailureReason", () => {
  it("null when nothing has failed QC", () => {
    expect(getProjectQcFailureReason([{ stepCode: "3E", stepName: "Final QC on site", qcPassed: true }], [])).toBeNull();
  });
  it("a failed procurement item wins over 3E", () => {
    const reason = getProjectQcFailureReason(
      [{ stepCode: "3E", stepName: "Final QC on site", qcPassed: false }],
      [{ itemType: "gasket", qcPassed: false }]
    );
    expect(reason).toEqual({ kind: "item", itemType: "gasket" });
  });
  it("falls back to 3E once no procurement item has failed", () => {
    const reason = getProjectQcFailureReason(
      [{ stepCode: "3E", stepName: "Final QC on site", qcPassed: false }],
      [{ itemType: "gasket", qcPassed: true }]
    );
    expect(reason).toEqual({ kind: "step", stepCode: "3E", stepName: "Final QC on site" });
  });
});
