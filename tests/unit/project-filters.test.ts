import { describe, it, expect } from "vitest";
import {
  currentProcurementItemDepartment,
  currentGlassPODepartment,
  currentStepDepartments,
  getProjectActiveDepartments,
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
