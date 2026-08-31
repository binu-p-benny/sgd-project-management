import { describe, it, expect } from "vitest";
import { getServiceStatus, type ServiceItemLike } from "@/lib/service";

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000);

function item(overrides: Partial<ServiceItemLike> = {}): ServiceItemLike {
  return { plannedDate: TOMORROW, actualDate: null, isPassFail: false, qcPassed: null, ...overrides };
}

describe("getServiceStatus: a service's status is purely a function of its own item rows", () => {
  it("not_started when there are no rows yet", () => {
    expect(getServiceStatus([])).toBe("not_started");
  });

  it("in_progress once some (but not all) plain rows are done, none of them overdue", () => {
    const items = [item({ actualDate: new Date() }), item()];
    expect(getServiceStatus(items)).toBe("in_progress");
  });

  it("completed once every plain row has an actual date", () => {
    const items = [item({ actualDate: new Date() }), item({ actualDate: new Date() })];
    expect(getServiceStatus(items)).toBe("completed");
  });

  it("a pass/fail row that hasn't been checked yet keeps the service in_progress even with a date on every other row", () => {
    const items = [item({ actualDate: new Date() }), item({ isPassFail: true, actualDate: null, qcPassed: null })];
    expect(getServiceStatus(items)).toBe("in_progress");
  });

  it("a failed pass/fail row keeps the service short of completed indefinitely — there's no restart flow", () => {
    const items = [item({ isPassFail: true, actualDate: new Date(), qcPassed: false })];
    expect(getServiceStatus(items)).toBe("in_progress");
  });

  it("completed once a pass/fail row has actually passed", () => {
    const items = [item({ actualDate: new Date() }), item({ isPassFail: true, actualDate: new Date(), qcPassed: true })];
    expect(getServiceStatus(items)).toBe("completed");
  });

  it("delayed once an undone row's planned date has passed", () => {
    const items = [item({ plannedDate: YESTERDAY })];
    expect(getServiceStatus(items)).toBe("delayed");
  });

  it("not delayed while every undone row's planned date is still in the future", () => {
    const items = [item({ plannedDate: TOMORROW }), item({ actualDate: new Date(), plannedDate: YESTERDAY })];
    expect(getServiceStatus(items)).toBe("in_progress");
  });

  it("a completed service is never delayed, even if a row finished late", () => {
    const items = [item({ plannedDate: YESTERDAY, actualDate: new Date() })];
    expect(getServiceStatus(items)).toBe("completed");
  });
});
