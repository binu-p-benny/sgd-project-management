import { describe, it, expect } from "vitest";
import {
  currentProcurementItemDepartment,
  currentGlassPODepartment,
  currentStepDepartments,
  getProjectActiveDepartments,
  getPhaseProgress,
  matchesPhaseProgressFilter,
  matchesInstallationWindowFilter,
  PHASE_PROGRESS_FILTER_OPTIONS,
  type ProcurementItemFields,
  type GlassPurchaseOrderFields,
} from "@/lib/project-filters";

const EMPTY_ITEM_FIELDS: ProcurementItemFields = {
  requirementCreatedAt: null,
  quoteCreatedAt: null,
  paymentSettledAt: null,
  orderConfirmedAt: null,
  materialDespatchAt: null,
  arrivedForPowderCoatingAt: null,
  actualArrivalDate: null,
  qcCheckedAt: null,
};

const EMPTY_GLASS_FIELDS: GlassPurchaseOrderFields = {
  requirementCreatedAt: null,
  quoteCreatedAt: null,
  paymentSettledAt: null,
  orderConfirmedAt: null,
};

describe("currentProcurementItemDepartment: the department owning an item's next unfilled stage", () => {
  it("a brand new item is with Design Engineer (Requirement created)", () => {
    expect(currentProcurementItemDepartment({ itemType: "hardware", ...EMPTY_ITEM_FIELDS })).toBe("design_engineer");
  });

  it("once Requirement created is done, it's with Purchase (Quote created) — not Accounts, even though Payment is also unfilled", () => {
    expect(
      currentProcurementItemDepartment({
        itemType: "hardware",
        ...EMPTY_ITEM_FIELDS,
        requirementCreatedAt: new Date(),
      })
    ).toBe("purchase");
  });

  it("once Requirement and Quote are done, it's with Accounts (Payment done)", () => {
    expect(
      currentProcurementItemDepartment({
        itemType: "hardware",
        ...EMPTY_ITEM_FIELDS,
        requirementCreatedAt: new Date(),
        quoteCreatedAt: new Date(),
      })
    ).toBe("accounts");
  });

  it("section stops at Purchase for despatch/powder-coating, which hardware and gasket don't have", () => {
    const upToOrder: ProcurementItemFields = {
      ...EMPTY_ITEM_FIELDS,
      requirementCreatedAt: new Date(),
      quoteCreatedAt: new Date(),
      paymentSettledAt: new Date(),
      orderConfirmedAt: new Date(),
    };
    expect(currentProcurementItemDepartment({ itemType: "section", ...upToOrder })).toBe("purchase"); // material despatch
    expect(currentProcurementItemDepartment({ itemType: "hardware", ...upToOrder })).toBe("purchase"); // actual arrival
  });

  it("null once every stage is filled", () => {
    const done: ProcurementItemFields = {
      requirementCreatedAt: new Date(),
      quoteCreatedAt: new Date(),
      paymentSettledAt: new Date(),
      orderConfirmedAt: new Date(),
      materialDespatchAt: null,
      arrivedForPowderCoatingAt: null,
      actualArrivalDate: new Date(),
      qcCheckedAt: new Date(),
    };
    expect(currentProcurementItemDepartment({ itemType: "hardware", ...done })).toBeNull();
  });
});

describe("currentGlassPODepartment: same rule, for 3A's glass PO row", () => {
  it("null when there's no row yet (project hasn't reached phase 3)", () => {
    expect(currentGlassPODepartment(null)).toBeNull();
  });

  it("Design Engineer on a fresh row, Accounts once Requirement/Quote are done, null once fully done", () => {
    expect(currentGlassPODepartment(EMPTY_GLASS_FIELDS)).toBe("design_engineer");
    expect(
      currentGlassPODepartment({
        ...EMPTY_GLASS_FIELDS,
        requirementCreatedAt: new Date(),
        quoteCreatedAt: new Date(),
      })
    ).toBe("accounts");
    expect(
      currentGlassPODepartment({
        requirementCreatedAt: new Date(),
        quoteCreatedAt: new Date(),
        paymentSettledAt: new Date(),
        orderConfirmedAt: new Date(),
      })
    ).toBeNull();
  });
});

describe("currentStepDepartments", () => {
  it("empty once there's no current step (project fully completed)", () => {
    expect(currentStepDepartments(null)).toEqual([]);
  });

  it("just the owning department when there's no secondary", () => {
    expect(currentStepDepartments({ owningDepartment: "purchase", secondaryDepartment: null })).toEqual(["purchase"]);
  });

  it("both, when there's a secondary (1A: HR & Admin + Project Engineer)", () => {
    expect(
      currentStepDepartments({ owningDepartment: "hr_admin", secondaryDepartment: "project_engineer" })
    ).toEqual(["hr_admin", "project_engineer"]);
  });
});

describe("getProjectActiveDepartments: the union /projects' department filter matches against", () => {
  it("combines the current step's department with any procurement/glass item still mid-lifecycle", () => {
    const currentStep = { owningDepartment: "project_engineer" as const, secondaryDepartment: null };
    const items = [
      { itemType: "hardware" as const, ...EMPTY_ITEM_FIELDS }, // pending on design_engineer
    ];
    const departments = getProjectActiveDepartments(currentStep, true, items, null);
    expect(departments).toEqual(new Set(["project_engineer", "design_engineer"]));
  });

  it("still flags Accounts for an unpaid item even once the project's current step has moved past it entirely", () => {
    // 2D2, say, is the current step — nothing to do with procurement — but Payment is still open.
    const currentStep = { owningDepartment: "design_engineer" as const, secondaryDepartment: null };
    const items = [
      {
        itemType: "hardware" as const,
        ...EMPTY_ITEM_FIELDS,
        requirementCreatedAt: new Date(),
        quoteCreatedAt: new Date(),
      },
    ];
    const departments = getProjectActiveDepartments(currentStep, true, items, null);
    expect(departments.has("accounts")).toBe(true);
  });

  it("flags Purchase alongside Accounts for an unpaid item — Purchase owns everything else in the chain and needs visibility on Payment too", () => {
    const items = [
      {
        itemType: "hardware" as const,
        ...EMPTY_ITEM_FIELDS,
        requirementCreatedAt: new Date(),
        quoteCreatedAt: new Date(),
      },
    ];
    const departments = getProjectActiveDepartments(null, true, items, null);
    expect(departments).toEqual(new Set(["accounts", "purchase"]));
  });

  it("flags Purchase alongside Accounts for an unpaid glass PO too", () => {
    const glassPurchaseOrder = {
      ...EMPTY_GLASS_FIELDS,
      requirementCreatedAt: new Date(),
      quoteCreatedAt: new Date(),
    };
    const departments = getProjectActiveDepartments(null, false, [], glassPurchaseOrder);
    expect(departments).toEqual(new Set(["accounts", "purchase"]));
  });

  it("a fully-completed project with every item fully paid has no active departments", () => {
    const done: ProcurementItemFields = {
      requirementCreatedAt: new Date(),
      quoteCreatedAt: new Date(),
      paymentSettledAt: new Date(),
      orderConfirmedAt: new Date(),
      materialDespatchAt: new Date(),
      arrivedForPowderCoatingAt: new Date(),
      actualArrivalDate: new Date(),
      qcCheckedAt: new Date(),
    };
    const departments = getProjectActiveDepartments(
      null,
      true,
      [{ itemType: "section", ...done }],
      { ...EMPTY_GLASS_FIELDS, requirementCreatedAt: new Date(), quoteCreatedAt: new Date(), paymentSettledAt: new Date(), orderConfirmedAt: new Date() }
    );
    expect(departments.size).toBe(0);
  });

  it("ignores procurement items entirely before Phase 2 is reached — every project's 3 empty rows exist from day one, but nobody can act on them before 1D", () => {
    const currentStep = { owningDepartment: "hr_admin" as const, secondaryDepartment: "project_engineer" as const };
    const dayOneEmptyItems = [
      { itemType: "section" as const, ...EMPTY_ITEM_FIELDS },
      { itemType: "hardware" as const, ...EMPTY_ITEM_FIELDS },
      { itemType: "gasket" as const, ...EMPTY_ITEM_FIELDS },
    ];
    const departments = getProjectActiveDepartments(currentStep, false, dayOneEmptyItems, null);
    expect(departments).toEqual(new Set(["hr_admin", "project_engineer"])); // no design_engineer
  });
});

describe("getPhaseProgress: where a single phase's own steps stand", () => {
  it("phase_1 (no phase before it) is not_started when it has no rows yet", () => {
    expect(getPhaseProgress([], "phase_1")).toBe("not_started");
  });
  it("not_started when every step in the phase is still not_started", () => {
    expect(
      getPhaseProgress(
        [
          { phase: "phase_1", status: "not_started" },
          { phase: "phase_1", status: "not_started" },
        ],
        "phase_1"
      )
    ).toBe("not_started");
  });
  it("completed only once every step in the phase is completed", () => {
    expect(
      getPhaseProgress(
        [
          { phase: "phase_1", status: "completed" },
          { phase: "phase_1", status: "completed" },
        ],
        "phase_1"
      )
    ).toBe("completed");
  });
  it("in_progress once some but not all steps are touched", () => {
    expect(
      getPhaseProgress(
        [
          { phase: "phase_1", status: "completed" },
          { phase: "phase_1", status: "not_started" },
        ],
        "phase_1"
      )
    ).toBe("in_progress");
  });
  it("in_progress for a blocked step too, even if nothing else has started", () => {
    expect(
      getPhaseProgress(
        [
          { phase: "phase_1", status: "blocked" },
          { phase: "phase_1", status: "not_started" },
        ],
        "phase_1"
      )
    ).toBe("in_progress");
  });
  it("only looks at the target phase's own steps, ignoring the others", () => {
    expect(
      getPhaseProgress(
        [
          { phase: "phase_1", status: "completed" },
          { phase: "phase_2", status: "not_started" },
        ],
        "phase_2"
      )
    ).toBe("not_started");
  });

  describe("not_started requires the phase before it to be fully completed", () => {
    it("null (not this phase's 3 buckets at all) when the phase before it isn't done yet", () => {
      // Still on 1B — Phase 2 has no rows at all, same shape as "reached but idle" would look.
      expect(getPhaseProgress([{ phase: "phase_1", status: "in_progress" }], "phase_2")).toBeNull();
    });
    it("null even once the phase before it is only in_progress, not completed", () => {
      expect(
        getPhaseProgress(
          [
            { phase: "phase_1", status: "completed" },
            { phase: "phase_2", status: "in_progress" },
          ],
          "phase_3"
        )
      ).toBeNull();
    });
    it("not_started once the phase before it is genuinely, fully completed — the reached-but-idle case", () => {
      expect(
        getPhaseProgress(
          [
            { phase: "phase_1", status: "completed" },
            { phase: "phase_2", status: "completed" },
            { phase: "phase_2", status: "completed" },
            { phase: "phase_3", status: "not_started" },
          ],
          "phase_3"
        )
      ).toBe("not_started");
    });
    it("in_progress/completed pass through regardless — maybeEarlyUnlockPhase3 can start Phase 3 before 2F completes", () => {
      const steps = [
        { phase: "phase_1" as const, status: "completed" as const },
        { phase: "phase_2" as const, status: "in_progress" as const }, // 2F still pending
        { phase: "phase_3" as const, status: "in_progress" as const }, // 3A already started early
      ];
      expect(getPhaseProgress(steps, "phase_3")).toBe("in_progress");
    });
  });
});

describe("PHASE_PROGRESS_FILTER_OPTIONS: the /projects phase filter's full option list", () => {
  it("has one option per (phase, progress) pair, 9 total, in phase then workflow order", () => {
    expect(PHASE_PROGRESS_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      "phase_1.not_started",
      "phase_1.in_progress",
      "phase_1.completed",
      "phase_2.not_started",
      "phase_2.in_progress",
      "phase_2.completed",
      "phase_3.not_started",
      "phase_3.in_progress",
      "phase_3.completed",
    ]);
  });
  it("labels read like 'Phase 1 · Not started'", () => {
    expect(PHASE_PROGRESS_FILTER_OPTIONS.find((o) => o.value === "phase_2.in_progress")?.label).toBe(
      "Phase 2 · In progress"
    );
  });
});

describe("matchesPhaseProgressFilter", () => {
  // Phase 2 genuinely, fully completed, Phase 3 not yet touched — the "just arrived, hasn't
  // started" case "Phase 3 · Not started" is meant to surface (see getPhaseProgress).
  const steps = [
    { phase: "phase_1" as const, status: "completed" as const },
    { phase: "phase_2" as const, status: "completed" as const },
    { phase: "phase_3" as const, status: "not_started" as const },
  ];
  it("matches a project whose named phase is at the given progress", () => {
    expect(matchesPhaseProgressFilter("phase_1.completed", steps)).toBe(true);
    expect(matchesPhaseProgressFilter("phase_2.completed", steps)).toBe(true);
    expect(matchesPhaseProgressFilter("phase_3.not_started", steps)).toBe(true);
  });
  it("false for every other (phase, progress) combination", () => {
    expect(matchesPhaseProgressFilter("phase_1.not_started", steps)).toBe(false);
    expect(matchesPhaseProgressFilter("phase_2.not_started", steps)).toBe(false);
    expect(matchesPhaseProgressFilter("phase_3.in_progress", steps)).toBe(false);
    expect(matchesPhaseProgressFilter("phase_3.completed", steps)).toBe(false);
  });
  it("a project still mid Phase 2 never matches any Phase 3 option — not just 'not_started'", () => {
    const midPhase2 = [
      { phase: "phase_1" as const, status: "completed" as const },
      { phase: "phase_2" as const, status: "in_progress" as const },
    ];
    expect(matchesPhaseProgressFilter("phase_3.not_started", midPhase2)).toBe(false);
    expect(matchesPhaseProgressFilter("phase_3.in_progress", midPhase2)).toBe(false);
    expect(matchesPhaseProgressFilter("phase_3.completed", midPhase2)).toBe(false);
  });
  it("false for an unrecognized filter value, same as a bogus currentStep code", () => {
    expect(matchesPhaseProgressFilter("not_a_real_value", steps)).toBe(false);
  });
});

describe("matchesInstallationWindowFilter: /projects' 3C2 planned-window date-range filter", () => {
  const withInstallWindow = (start: string, end: string) => [
    { stepCode: "3A", plannedStartDate: null, plannedEndDate: null },
    { stepCode: "3C2", plannedStartDate: new Date(start), plannedEndDate: new Date(end) },
  ];

  it("false when the project hasn't reached 3C2 yet (no row at all)", () => {
    const steps = [{ stepCode: "1A", plannedStartDate: new Date("2026-01-01"), plannedEndDate: new Date("2026-01-02") }];
    expect(matchesInstallationWindowFilter(steps, new Date("2026-01-01"), new Date("2026-01-31"))).toBe(false);
  });

  it("false when 3C2 exists but has no planned dates recorded", () => {
    const steps = [{ stepCode: "3C2", plannedStartDate: null, plannedEndDate: null }];
    expect(matchesInstallationWindowFilter(steps, null, null)).toBe(false);
  });

  it("true when the range fully contains the install window", () => {
    const steps = withInstallWindow("2026-06-10", "2026-06-15");
    expect(matchesInstallationWindowFilter(steps, new Date("2026-06-01"), new Date("2026-06-30"))).toBe(true);
  });

  it("true on partial overlap at either edge of the range", () => {
    const steps = withInstallWindow("2026-06-10", "2026-06-15");
    expect(matchesInstallationWindowFilter(steps, new Date("2026-06-14"), new Date("2026-06-20"))).toBe(true);
    expect(matchesInstallationWindowFilter(steps, new Date("2026-06-01"), new Date("2026-06-11"))).toBe(true);
  });

  it("false when the range is entirely before or entirely after the install window", () => {
    const steps = withInstallWindow("2026-06-10", "2026-06-15");
    expect(matchesInstallationWindowFilter(steps, new Date("2026-05-01"), new Date("2026-06-09"))).toBe(false);
    expect(matchesInstallationWindowFilter(steps, new Date("2026-06-16"), new Date("2026-06-30"))).toBe(false);
  });

  it("an open-ended range (only `from`) matches a window that ends on or after it", () => {
    const steps = withInstallWindow("2026-06-10", "2026-06-15");
    expect(matchesInstallationWindowFilter(steps, new Date("2026-06-15"), null)).toBe(true);
    expect(matchesInstallationWindowFilter(steps, new Date("2026-06-16"), null)).toBe(false);
  });

  it("an open-ended range (only `to`) matches a window that starts on or before it", () => {
    const steps = withInstallWindow("2026-06-10", "2026-06-15");
    expect(matchesInstallationWindowFilter(steps, null, new Date("2026-06-10"))).toBe(true);
    expect(matchesInstallationWindowFilter(steps, null, new Date("2026-06-09"))).toBe(false);
  });
});
