import { describe, it, expect } from "vitest";
import {
  buildPhase1Steps,
  buildPhase1And2Steps,
  buildPhase2Steps,
  buildPhase3Steps,
  computePlannedDates,
  deriveVisitDurationDays,
  PHASE_GATE_STEP_CODE,
} from "@/lib/step-template";

describe("deriveVisitDurationDays", () => {
  it("emergency = 2 days", () => {
    expect(deriveVisitDurationDays("emergency")).toBe(2);
  });
  it("hot = 5 days", () => {
    expect(deriveVisitDurationDays("hot")).toBe(5);
  });
  it("cold = 15 days", () => {
    expect(deriveVisitDurationDays("cold")).toBe(15);
  });
  it("site_not_ready = null (no duration assigned)", () => {
    expect(deriveVisitDurationDays("site_not_ready")).toBeNull();
  });
});

describe("buildPhase1Steps", () => {
  const steps = buildPhase1Steps();
  const byCode = Object.fromEntries(steps.map((s) => [s.stepCode, s]));

  it("has exactly 1A, 1B, 1C, 1D in order", () => {
    expect(steps.map((s) => s.stepCode)).toEqual(["1A", "1B", "1C", "1D"]);
  });

  it("1A: joint HR & Admin / Project Engineer, no dependencies, 1 day", () => {
    expect(byCode["1A"].owningDepartment).toBe("hr_admin");
    expect(byCode["1A"].secondaryDepartment).toBe("project_engineer");
    expect(byCode["1A"].dependsOn).toEqual([]);
    expect(byCode["1A"].plannedDurationDays).toBe(1);
  });

  it("1B: Design Engineer, depends on 1A, duration null until visit_urgency is set", () => {
    expect(byCode["1B"].owningDepartment).toBe("design_engineer");
    expect(byCode["1B"].dependsOn).toEqual(["1A"]);
    expect(byCode["1B"].plannedDurationDays).toBeNull();
  });

  it("1C: Design Engineer, depends on 1B, 2 days", () => {
    expect(byCode["1C"].owningDepartment).toBe("design_engineer");
    expect(byCode["1C"].dependsOn).toEqual(["1B"]);
    expect(byCode["1C"].plannedDurationDays).toBe(2);
  });

  it("1D: Accounts, depends on 1C, 2 days", () => {
    expect(byCode["1D"].owningDepartment).toBe("accounts");
    expect(byCode["1D"].dependsOn).toEqual(["1C"]);
    expect(byCode["1D"].plannedDurationDays).toBe(2);
  });
});

describe("buildPhase2Steps", () => {
  const steps = buildPhase2Steps();
  const byCode = Object.fromEntries(steps.map((s) => [s.stepCode, s]));

  it("2A: Design Engineer, depends on 1D, 1 day", () => {
    expect(byCode["2A"].owningDepartment).toBe("design_engineer");
    expect(byCode["2A"].dependsOn).toEqual(["1D"]);
    expect(byCode["2A"].plannedDurationDays).toBe(1);
  });

  it("2D1 (materials arrived, derived): depends on 2A", () => {
    expect(byCode["2D1"].dependsOn).toEqual(["2A"]);
  });

  it("2D2 (final tight measurement): Design Engineer, 18 days, depends on 2A — independent of 2D1/2F", () => {
    expect(byCode["2D2"].owningDepartment).toBe("design_engineer");
    expect(byCode["2D2"].plannedDurationDays).toBe(18);
    expect(byCode["2D2"].dependsOn).toEqual(["2A"]);
  });

  it("2F (material QC) depends only on 2D1, NOT 2D2", () => {
    expect(byCode["2F"].dependsOn).toEqual(["2D1"]);
    expect(byCode["2F"].dependsOn).not.toContain("2D2");
  });
});

describe("buildPhase3Steps", () => {
  it("3B duration is 7 days for normal glass, 10 days for laminated", () => {
    const normal = Object.fromEntries(buildPhase3Steps("normal").map((s) => [s.stepCode, s]));
    const laminated = Object.fromEntries(buildPhase3Steps("laminated").map((s) => [s.stepCode, s]));
    expect(normal["3B"].plannedDurationDays).toBe(7);
    expect(laminated["3B"].plannedDurationDays).toBe(10);
  });

  it("3A: Purchase, 3 days total, depends on 2F", () => {
    const byCode = Object.fromEntries(buildPhase3Steps("normal").map((s) => [s.stepCode, s]));
    expect(byCode["3A"].owningDepartment).toBe("purchase");
    expect(byCode["3A"].plannedDurationDays).toBe(3);
    expect(byCode["3A"].dependsOn).toEqual(["2F"]);
  });

  it("3C1 depends directly on 2F, not on 3A/3B", () => {
    const byCode = Object.fromEntries(buildPhase3Steps("normal").map((s) => [s.stepCode, s]));
    expect(byCode["3C1"].dependsOn).toEqual(["2F"]);
  });

  it("3C2 depends on 3C1, 7 days", () => {
    const byCode = Object.fromEntries(buildPhase3Steps("normal").map((s) => [s.stepCode, s]));
    expect(byCode["3C2"].dependsOn).toEqual(["3C1"]);
    expect(byCode["3C2"].plannedDurationDays).toBe(7);
  });

  it("3E depends on BOTH 3B and 3C2 (parallel gate), 5 days", () => {
    const byCode = Object.fromEntries(buildPhase3Steps("normal").map((s) => [s.stepCode, s]));
    expect(byCode["3E"].dependsOn.sort()).toEqual(["3B", "3C2"]);
    expect(byCode["3E"].plannedDurationDays).toBe(5);
  });
});

describe("buildPhase1And2Steps", () => {
  it("has all 8 Phase 1+2 steps, topologically ordered, with 1B's duration resolved", () => {
    const steps = buildPhase1And2Steps("hot");
    expect(steps.map((s) => s.stepCode)).toEqual(["1A", "1B", "1C", "1D", "2A", "2D1", "2D2", "2F"]);
    expect(steps.find((s) => s.stepCode === "1B")!.plannedDurationDays).toBe(5);
  });

  it("site_not_ready leaves 1B's duration null (unresolved chain), same as deriveVisitDurationDays", () => {
    const steps = buildPhase1And2Steps("site_not_ready");
    expect(steps.find((s) => s.stepCode === "1B")!.plannedDurationDays).toBeNull();
  });

  it("computePlannedDates resolves every Phase 1+2 date in one pass for a known urgency", () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const dates = computePlannedDates(buildPhase1And2Steps("emergency"), anchor);

    for (const code of ["1A", "1B", "1C", "1D", "2A", "2D1", "2D2", "2F"]) {
      expect(dates.get(code)!.plannedStartDate).not.toBeNull();
      expect(dates.get(code)!.plannedEndDate).not.toBeNull();
    }
    // 2A starts when 1D ends: 1A(1d)+1B(2d emergency)+1C(2d)+1D(2d) = day 7 from anchor
    expect(dates.get("2A")!.plannedStartDate).toEqual(new Date("2026-01-08T00:00:00.000Z"));
  });

  it("computePlannedDates leaves every Phase 1+2 date unresolved when urgency is site_not_ready", () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const dates = computePlannedDates(buildPhase1And2Steps("site_not_ready"), anchor);

    expect(dates.get("1B")!.plannedEndDate).toBeNull();
    for (const code of ["1C", "1D", "2A", "2D1", "2D2", "2F"]) {
      expect(dates.get(code)!.plannedStartDate).toBeNull();
      expect(dates.get(code)!.plannedEndDate).toBeNull();
    }
  });
});

describe("PHASE_GATE_STEP_CODE", () => {
  it("phase 2 gates on 1D, phase 3 gates on 2F", () => {
    expect(PHASE_GATE_STEP_CODE.phase_2).toBe("1D");
    expect(PHASE_GATE_STEP_CODE.phase_3).toBe("2F");
  });
});

describe("computePlannedDates", () => {
  it("chains sequential durations from the anchor date", () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const dates = computePlannedDates(buildPhase1Steps().map((s) => ({ ...s, plannedDurationDays: s.plannedDurationDays ?? 5 })), anchor);

    expect(dates.get("1A")!.plannedStartDate).toEqual(anchor);
    expect(dates.get("1A")!.plannedEndDate).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    // 1B starts when 1A ends
    expect(dates.get("1B")!.plannedStartDate).toEqual(new Date("2026-01-02T00:00:00.000Z"));
  });

  it("propagates an unresolved (null-duration) dependency forward instead of falling back to anchorDate", () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    // 1B keeps its real null duration (visit_urgency not yet known) — 1C/1D depend on it.
    const dates = computePlannedDates(buildPhase1Steps(), anchor);

    // 1B's start IS resolved (1A has a real end date) — only its own end is unknown.
    expect(dates.get("1B")!.plannedStartDate).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect(dates.get("1B")!.plannedEndDate).toBeNull(); // duration unknown
    expect(dates.get("1C")!.plannedStartDate).toBeNull(); // must NOT silently use anchorDate
    expect(dates.get("1C")!.plannedEndDate).toBeNull();
    expect(dates.get("1D")!.plannedStartDate).toBeNull();
    expect(dates.get("1D")!.plannedEndDate).toBeNull();
  });

  it("a step with no dependencies starts at anchorDate", () => {
    const anchor = new Date("2026-03-15T00:00:00.000Z");
    const dates = computePlannedDates(buildPhase1Steps(), anchor);
    expect(dates.get("1A")!.plannedStartDate).toEqual(anchor);
  });

  it("uses resolvedDates for dependencies outside the batch", () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const phase2 = buildPhase2Steps();
    const dates = computePlannedDates(phase2, anchor, new Map([["1D", anchor]]));
    expect(dates.get("2A")!.plannedStartDate).toEqual(anchor);
    expect(dates.get("2A")!.plannedEndDate).toEqual(new Date("2026-01-02T00:00:00.000Z"));
  });
});
