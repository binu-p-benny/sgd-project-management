import { describe, it, expect } from "vitest";
import { getServiceStatus, getServiceReviewPlannedDate, type ServiceItemLike } from "@/lib/service";

const DAY = 24 * 60 * 60 * 1000;
const YESTERDAY = new Date(Date.now() - DAY);
const TOMORROW = new Date(Date.now() + DAY);
const ONE_DAY_AGO = new Date(Date.now() - DAY); // completed within the 2-working-day review grace window
// Comfortably past the review's planned date whatever weekday the suite runs on: 2 working days
// span at most 3 calendar days (one Sunday), and a review due *today* isn't overdue yet.
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * DAY);

function item(overrides: Partial<ServiceItemLike> = {}): ServiceItemLike {
  return { plannedDate: TOMORROW, actualDate: null, ...overrides };
}

describe("getServiceStatus: item-driven, except completion and review — those are manual-only", () => {
  it("not_started when there are no rows yet", () => {
    expect(getServiceStatus([], null, null)).toBe("not_started");
  });

  it("in_progress once some (but not all) plain rows are done, none of them overdue", () => {
    const items = [item({ actualDate: new Date() }), item()];
    expect(getServiceStatus(items, null, null)).toBe("in_progress");
  });

  it("stays in_progress even once every row is done — completion is never inferred from items", () => {
    const items = [item({ actualDate: new Date() }), item({ actualDate: new Date() })];
    expect(getServiceStatus(items, null, null)).toBe("in_progress");
  });

  it("delayed once an undone row's planned date has passed", () => {
    const items = [item({ plannedDate: YESTERDAY })];
    expect(getServiceStatus(items, null, null)).toBe("delayed");
  });

  it("not delayed while every undone row's planned date is still in the future", () => {
    const items = [item({ plannedDate: TOMORROW }), item({ actualDate: new Date(), plannedDate: YESTERDAY })];
    expect(getServiceStatus(items, null, null)).toBe("in_progress");
  });

  it("completed once completedAt is set, even with rows still open", () => {
    const items = [item(), item({ plannedDate: YESTERDAY })];
    expect(getServiceStatus(items, new Date(), null)).toBe("completed");
  });

  it("completed with zero items — nothing to do isn't the same as closed out", () => {
    expect(getServiceStatus([], new Date(), null)).toBe("completed");
  });

  it("a manually completed service is never delayed, even with an overdue row", () => {
    const items = [item({ plannedDate: YESTERDAY })];
    expect(getServiceStatus(items, new Date(), null)).toBe("completed");
  });

  it("still reads completed while the review is within its 2-working-day grace window", () => {
    expect(getServiceStatus([], ONE_DAY_AGO, null)).toBe("completed");
  });

  it("review_not_completed once 2 working days have passed since completion with no review recorded", () => {
    expect(getServiceStatus([], FIVE_DAYS_AGO, null)).toBe("review_not_completed");
  });

  it("review_not_completed wins even with zero items open", () => {
    const items = [item({ actualDate: new Date() })];
    expect(getServiceStatus(items, FIVE_DAYS_AGO, null)).toBe("review_not_completed");
  });

  it("back to completed once the review is actually recorded, even past its planned date", () => {
    expect(getServiceStatus([], FIVE_DAYS_AGO, new Date())).toBe("completed");
  });
});

describe("getServiceReviewPlannedDate: 2 working days after completion, Sundays excluded", () => {
  it("a Thursday completion is due the Saturday", () => {
    expect(getServiceReviewPlannedDate(new Date("2026-10-08T00:00:00.000Z"))).toEqual(new Date("2026-10-10T00:00:00.000Z"));
  });

  it("a Saturday completion skips the Sunday and is due the Tuesday", () => {
    expect(getServiceReviewPlannedDate(new Date("2026-10-10T00:00:00.000Z"))).toEqual(new Date("2026-10-13T00:00:00.000Z"));
  });
});
