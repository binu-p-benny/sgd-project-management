import { describe, it, expect } from "vitest";
import {
  isStepOverrun,
  isProcurementItemOverrun,
  isProcurementStageOverrun,
  isContractorSelectionOverdue,
  isDueToday,
  isSameCalendarDay,
  daysBlocked,
  projectHasOverrun,
  getEffectiveOverallStatus,
  getProjectBlockedStep,
  getProjectDelayReason,
  getProjectQcFailureReason,
  type GlassPurchaseOrderOverrunFields,
} from "@/lib/overrun";

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
// Midnight today — how every planned date in this app is actually stored (a date input, not a
// time). Regressing to a raw "now > expected" comparison would make this read as overdue the
// moment the clock ticks past 00:00:00, which is the exact bug this whole file guards against.
const todayAtMidnight = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
// The other extreme — planned for today but not until the very end of the day. Still due today,
// never overdue, right up until the day actually rolls over.
const todayLastMinute = new Date(
  new Date().getFullYear(),
  new Date().getMonth(),
  new Date().getDate(),
  23,
  59,
  0
);

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
  it("false all day today — not overdue just because midnight has passed", () => {
    expect(isContractorSelectionOverdue(todayAtMidnight, null)).toBe(false);
    expect(isContractorSelectionOverdue(todayLastMinute, null)).toBe(false);
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
  it("false all day today, even at 00:00 — a step due today isn't overdue until tomorrow", () => {
    expect(isStepOverrun(todayAtMidnight, "in_progress")).toBe(false);
    expect(isStepOverrun(todayLastMinute, "in_progress")).toBe(false);
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
  it("false all day today — same calendar-day carve-out isProcurementStageOverrun applies", () => {
    expect(isProcurementItemOverrun(todayAtMidnight, null)).toBe(false);
  });
});

describe("isDueToday", () => {
  it("true for any time today, midnight through the last minute", () => {
    expect(isDueToday(todayAtMidnight)).toBe(true);
    expect(isDueToday(todayLastMinute)).toBe(true);
    expect(isDueToday(new Date())).toBe(true);
  });
  it("true given an ISO string for today, not just a Date", () => {
    expect(isDueToday(todayAtMidnight.toISOString())).toBe(true);
  });
  it("false for yesterday or tomorrow", () => {
    expect(isDueToday(yesterday)).toBe(false);
    expect(isDueToday(tomorrow)).toBe(false);
  });
  it("false when there's no date at all", () => {
    expect(isDueToday(null)).toBe(false);
  });
});

describe("isSameCalendarDay", () => {
  it("true for two timestamps on the same local day regardless of time-of-day", () => {
    expect(isSameCalendarDay(todayAtMidnight, todayLastMinute)).toBe(true);
  });
  it("false across a day boundary, even by one millisecond", () => {
    expect(isSameCalendarDay(todayAtMidnight, yesterday)).toBe(false);
  });
});

describe("isProcurementStageOverrun — due-today carve-out", () => {
  it("a stage planned for today, at any time of day, is due today rather than overdue", () => {
    expect(isProcurementStageOverrun(todayAtMidnight, null)).toBe(false);
    expect(isProcurementStageOverrun(todayLastMinute, null)).toBe(false);
    expect(isDueToday(todayAtMidnight)).toBe(true);
  });
});

describe("daysBlocked", () => {
  it("computes whole days elapsed since updatedAt", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000);
    expect(daysBlocked(threeDaysAgo)).toBe(3);
  });
});

// A Glass PO row with every stage empty except the one under test — a shorthand so each test
// below only has to spell out the one field it actually cares about.
function emptyGlassPO(overrides: Partial<GlassPurchaseOrderOverrunFields> = {}): GlassPurchaseOrderOverrunFields {
  return {
    requirementCreatedAt: null,
    requirementPlannedDate: null,
    quoteCreatedAt: null,
    quotePlannedDate: null,
    paymentSettledAt: null,
    paymentPlannedDate: null,
    orderConfirmedAt: null,
    orderPlannedDate: null,
    actualArrivalDate: null,
    arrivalPlannedDate: null,
    qcCheckedAt: null,
    qcPlannedDate: null,
    ...overrides,
  };
}

describe("projectHasOverrun", () => {
  it("true if any step is overrun", () => {
    expect(
      projectHasOverrun([{ plannedEndDate: yesterday, status: "in_progress" }], [], null)
    ).toBe(true);
  });
  it("true if any procurement item is overrun", () => {
    expect(
      projectHasOverrun([], [{ expectedArrivalDate: yesterday, actualArrivalDate: null }], null)
    ).toBe(true);
  });
  it("false if nothing is overrun", () => {
    expect(
      projectHasOverrun(
        [{ plannedEndDate: tomorrow, status: "in_progress" }],
        [{ expectedArrivalDate: tomorrow, actualArrivalDate: null }],
        null
      )
    ).toBe(false);
  });
  it("false when there's no Glass PO row at all", () => {
    expect(projectHasOverrun([], [], null)).toBe(false);
  });
  it("true if any Glass PO stage is overrun — the exact gap this project's own live report caught: a project reading On track while its Glass PO's Requirement created sat overdue", () => {
    expect(
      projectHasOverrun(
        [{ plannedEndDate: tomorrow, status: "in_progress" }],
        [],
        emptyGlassPO({ requirementPlannedDate: yesterday })
      )
    ).toBe(true);
  });
  it("false when every Glass PO stage that's due has already been filled in", () => {
    expect(
      projectHasOverrun([], [], emptyGlassPO({ requirementPlannedDate: yesterday, requirementCreatedAt: yesterday }))
    ).toBe(false);
  });
  it("false when the Glass PO's next stage isn't due yet", () => {
    expect(projectHasOverrun([], [], emptyGlassPO({ quotePlannedDate: tomorrow }))).toBe(false);
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
        [{ itemType: "hardware", expectedArrivalDate: tomorrow, actualArrivalDate: null }],
        null
      )
    ).toBeNull();
  });
  it("an overdue step wins, earliest by step_code", () => {
    const reason = getProjectDelayReason(
      [
        { stepCode: "2F", stepName: "Material QC", plannedEndDate: yesterday, status: "in_progress" },
        { stepCode: "1B", stepName: "Site visit", plannedEndDate: yesterday, status: "in_progress" },
      ],
      [],
      null
    );
    expect(reason).toEqual({ kind: "step", stepCode: "1B", stepName: "Site visit", plannedEndDate: yesterday });
  });
  it("falls back to an overdue procurement item's arrival once no step is overrun", () => {
    const reason = getProjectDelayReason(
      [{ stepCode: "1B", stepName: "Site visit", plannedEndDate: tomorrow, status: "in_progress" }],
      [{ itemType: "hardware", expectedArrivalDate: yesterday, actualArrivalDate: null }],
      null
    );
    expect(reason).toEqual({ kind: "item", itemType: "hardware", expectedArrivalDate: yesterday });
  });
  it("falls back to an overdue Glass PO stage once no step or procurement item is overrun", () => {
    const reason = getProjectDelayReason(
      [{ stepCode: "1B", stepName: "Site visit", plannedEndDate: tomorrow, status: "in_progress" }],
      [{ itemType: "hardware", expectedArrivalDate: tomorrow, actualArrivalDate: null }],
      emptyGlassPO({ requirementPlannedDate: yesterday })
    );
    expect(reason).toEqual({ kind: "glass_po", stageLabel: "Requirement created", plannedDate: yesterday });
  });
  it("names the earliest overdue Glass PO stage in its own fixed order, not just the first one checked", () => {
    const reason = getProjectDelayReason(
      [],
      [],
      emptyGlassPO({ requirementPlannedDate: yesterday, requirementCreatedAt: yesterday, quotePlannedDate: yesterday })
    );
    expect(reason).toEqual({ kind: "glass_po", stageLabel: "Quote created", plannedDate: yesterday });
  });
});

describe("getProjectQcFailureReason", () => {
  it("null when nothing has failed QC", () => {
    expect(
      getProjectQcFailureReason([{ stepCode: "3E", stepName: "Final QC on site", qcPassed: true }], [], null)
    ).toBeNull();
  });
  it("a failed procurement item wins over 3E", () => {
    const reason = getProjectQcFailureReason(
      [{ stepCode: "3E", stepName: "Final QC on site", qcPassed: false }],
      [{ itemType: "gasket", qcPassed: false }],
      null
    );
    expect(reason).toEqual({ kind: "item", itemType: "gasket" });
  });
  it("falls back to 3E once no procurement item has failed", () => {
    const reason = getProjectQcFailureReason(
      [{ stepCode: "3E", stepName: "Final QC on site", qcPassed: false }],
      [{ itemType: "gasket", qcPassed: true }],
      null
    );
    expect(reason).toEqual({ kind: "step", stepCode: "3E", stepName: "Final QC on site" });
  });
  it("falls back to the Glass PO once no step or procurement item has failed", () => {
    const reason = getProjectQcFailureReason([], [], { qcPassed: false });
    expect(reason).toEqual({ kind: "glass_po" });
  });
});
