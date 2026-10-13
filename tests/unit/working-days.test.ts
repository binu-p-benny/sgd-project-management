import { describe, it, expect } from "vitest";
import { addWorkingDays, isSunday, rollToWorkingDay, subtractWorkingDays } from "@/lib/working-days";

const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe("isSunday — asked in IST, whatever timezone the server runs in", () => {
  it("a date-only value (UTC midnight) reads as its own calendar day", () => {
    expect(isSunday(utc("2026-10-11"))).toBe(true); // Sunday
    expect(isSunday(utc("2026-10-10"))).toBe(false); // Saturday
    expect(isSunday(utc("2026-10-12"))).toBe(false); // Monday
  });

  it("a timestamp just after midnight IST belongs to the IST day, not the UTC one", () => {
    // 00:30 IST Monday 12 Oct is still 19:00 UTC on Sunday the 11th.
    expect(isSunday(new Date("2026-10-11T19:00:00.000Z"))).toBe(false);
    // 00:30 IST Sunday 11 Oct is still 19:00 UTC on Saturday the 10th.
    expect(isSunday(new Date("2026-10-10T19:00:00.000Z"))).toBe(true);
  });
});

describe("addWorkingDays", () => {
  it("doesn't count a Sunday inside the span", () => {
    expect(addWorkingDays(utc("2026-10-10"), 1)).toEqual(utc("2026-10-12")); // Sat + 1 = Mon
    expect(addWorkingDays(utc("2026-10-09"), 2)).toEqual(utc("2026-10-12")); // Fri + 2 = Mon
    expect(addWorkingDays(utc("2026-10-07"), 7)).toEqual(utc("2026-10-15")); // Wed + 7, one Sunday skipped
  });

  it("counting from a Sunday starts on the Monday", () => {
    expect(addWorkingDays(utc("2026-10-11"), 1)).toEqual(utc("2026-10-12"));
  });

  it("0 days is the date itself, untouched", () => {
    const sunday = utc("2026-10-11");
    expect(addWorkingDays(sunday, 0)).toBe(sunday);
  });

  it("keeps the time of day", () => {
    expect(addWorkingDays(new Date("2026-10-10T09:15:00.000Z"), 1)).toEqual(new Date("2026-10-12T09:15:00.000Z"));
  });

  it("stepping in parts lands on the same day as one jump of the total", () => {
    const start = utc("2026-01-01");
    expect(addWorkingDays(addWorkingDays(start, 4), 17)).toEqual(addWorkingDays(start, 21));
  });
});

describe("subtractWorkingDays", () => {
  it("doesn't count a Sunday inside the span, and never lands on one", () => {
    expect(subtractWorkingDays(utc("2026-10-12"), 1)).toEqual(utc("2026-10-10")); // Mon - 1 = Sat
    expect(subtractWorkingDays(utc("2026-10-13"), 2)).toEqual(utc("2026-10-10")); // Tue - 2 = Sat
  });
});

describe("rollToWorkingDay", () => {
  it("moves a Sunday to the Monday and leaves every other day alone", () => {
    expect(rollToWorkingDay(utc("2026-10-11"))).toEqual(utc("2026-10-12"));
    const saturday = utc("2026-10-10");
    expect(rollToWorkingDay(saturday)).toBe(saturday);
  });
});
