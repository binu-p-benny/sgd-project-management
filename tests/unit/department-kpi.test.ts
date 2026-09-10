import { describe, it, expect } from "vitest";
import {
  classifyCompletion,
  scoreDepartment,
  resolvePeriodRange,
  resolveKpiRange,
  parseKpiPeriod,
} from "@/lib/department-kpi";

describe("classifyCompletion", () => {
  // Local-time constructors — "the planned day" is judged in server-local time (the app is
  // single-timezone), so dates here are built the same way to stay machine-independent.
  const planned = new Date(2026, 5, 10, 9, 0, 0);

  it("on time when completed any time on or before the planned day", () => {
    expect(classifyCompletion(planned, new Date(2026, 5, 10, 23, 0, 0), null).outcome).toBe("on_time");
    expect(classifyCompletion(planned, new Date(2026, 5, 8, 0, 0, 0), null).outcome).toBe("on_time");
  });

  it("late (rounded up in whole days) when completed after the planned day", () => {
    const res = classifyCompletion(planned, new Date(2026, 5, 13, 9, 0, 0), null);
    expect(res.outcome).toBe("late");
    expect(res.daysLate).toBe(3);
  });

  it("client-caused (not late) when the slip is logged client_side", () => {
    const res = classifyCompletion(planned, new Date(2026, 5, 20, 9, 0, 0), "client_side");
    expect(res.outcome).toBe("client_caused");
    expect(res.daysLate).toBe(10);
  });

  it("on time (not assessable) when there is no planned date", () => {
    expect(classifyCompletion(null, new Date(2026, 5, 20, 9, 0, 0), null)).toEqual({ outcome: "on_time", daysLate: 0 });
  });
});

describe("scoreDepartment", () => {
  it("blends on-time (60%), QC (20%), backlog (20%)", () => {
    // 1.0 * .6 + 0.5 * .2 + 0.0 * .2 = 0.7
    expect(scoreDepartment({ onTimeRate: 1, qcPassRate: 0.5, backlogHealth: 0 })).toBe(70);
  });

  it("drops a component with no data and renormalises the rest", () => {
    // no QC, no backlog -> score is just the on-time rate
    expect(scoreDepartment({ onTimeRate: 0.8, qcPassRate: null, backlogHealth: null })).toBe(80);
    // no QC -> on-time gets 0.75 weight, backlog 0.25
    // 1.0 * .6 + 0.0 * .2, over .8 total = 0.75
    expect(scoreDepartment({ onTimeRate: 1, qcPassRate: null, backlogHealth: 0 })).toBe(75);
  });

  it("scores 0 when nothing is assessable at all", () => {
    expect(scoreDepartment({ onTimeRate: null, qcPassRate: null, backlogHealth: null })).toBe(0);
  });
});

describe("resolvePeriodRange", () => {
  const now = new Date("2026-06-15T12:00:00");

  it("this_month starts on the 1st", () => {
    const r = resolvePeriodRange("this_month", now);
    expect(r.start?.getMonth()).toBe(5);
    expect(r.start?.getDate()).toBe(1);
    expect(r.end).toEqual(now);
  });

  it("last_month is the whole previous calendar month", () => {
    const r = resolvePeriodRange("last_month", now);
    expect(r.start).toEqual(new Date(2026, 4, 1));
    expect(r.end).toEqual(new Date(2026, 5, 1));
  });

  it("this_year starts on Jan 1; last_year is the whole previous year", () => {
    expect(resolvePeriodRange("this_year", now).start).toEqual(new Date(2026, 0, 1));
    const ly = resolvePeriodRange("last_year", now);
    expect(ly.start).toEqual(new Date(2025, 0, 1));
    expect(ly.end).toEqual(new Date(2026, 0, 1));
  });

  it("all_time has no lower bound", () => {
    expect(resolvePeriodRange("all_time", now).start).toBeNull();
  });
});

describe("parseKpiPeriod", () => {
  it("accepts known values (incl. custom), falls back to this_month otherwise", () => {
    expect(parseKpiPeriod("last_3_months")).toBe("last_3_months");
    expect(parseKpiPeriod("custom")).toBe("custom");
    expect(parseKpiPeriod(undefined)).toBe("this_month");
    expect(parseKpiPeriod("garbage")).toBe("this_month");
  });
});

describe("resolveKpiRange", () => {
  const now = new Date("2026-06-15T12:00:00");

  it("defers to the preset resolver for a non-custom period", () => {
    expect(resolveKpiRange({ period: "this_year" }, now).start).toEqual(new Date(2026, 0, 1));
  });

  it("reads a custom from/to as local start-of-day … end-of-day", () => {
    const r = resolveKpiRange({ period: "custom", from: "2026-03-01", to: "2026-03-31" }, now);
    expect(r.start).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
    expect(r.end).toEqual(new Date(2026, 2, 31, 23, 59, 59, 999));
    expect(r.fromInput).toBe("2026-03-01");
    expect(r.toInput).toBe("2026-03-31");
  });

  it("swaps a reversed custom range", () => {
    const r = resolveKpiRange({ period: "custom", from: "2026-03-31", to: "2026-03-01" }, now);
    expect(r.start).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
    expect(r.end).toEqual(new Date(2026, 2, 31, 23, 59, 59, 999));
  });

  it("a custom range with no start has no lower bound; missing end falls back to now", () => {
    const r = resolveKpiRange({ period: "custom", to: "2026-04-30" }, now);
    expect(r.start).toBeNull();
    const r2 = resolveKpiRange({ period: "custom", from: "2026-01-01" }, now);
    expect(r2.end).toEqual(now);
  });
});
