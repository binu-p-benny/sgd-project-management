import { describe, it, expect } from "vitest";
import { portalStepNote, portalStepTitle } from "@/lib/portal-labels";

describe("portalStepNote", () => {
  it("names the reason once a step is blocked", () => {
    const note = portalStepNote({
      status: "blocked",
      plannedStartDate: null,
      plannedEndDate: null,
      actualEndDate: null,
      blockedReason: "site_not_ready",
    });
    expect(note).toBe("Currently blocked due to Site not ready — team will contact you");
  });

  it("still reads sensibly when a blocked step somehow has no reason recorded", () => {
    const note = portalStepNote({
      status: "blocked",
      plannedStartDate: null,
      plannedEndDate: null,
      actualEndDate: null,
      blockedReason: null,
    });
    expect(note).toBe("Currently blocked — team will contact you");
  });

  it("marks a not-started estimate step's date as approximate", () => {
    const note = portalStepNote({
      status: "not_started",
      plannedStartDate: "2026-10-05T00:00:00.000Z",
      plannedEndDate: null,
      actualEndDate: null,
      datesAreEstimates: true,
    });
    expect(note).toBe("Approximate: 5 Oct");
  });

  it("marks an in-progress estimate step's date as approximate", () => {
    const note = portalStepNote({
      status: "in_progress",
      plannedStartDate: null,
      plannedEndDate: "2026-10-05T00:00:00.000Z",
      actualEndDate: null,
      datesAreEstimates: true,
    });
    expect(note).toBe("Approximate: 5 Oct");
  });

  it("leaves a non-estimate step's wording alone", () => {
    const note = portalStepNote({
      status: "in_progress",
      plannedStartDate: null,
      plannedEndDate: "2026-10-05T00:00:00.000Z",
      actualEndDate: null,
    });
    expect(note).toBe("by 5 Oct");
  });
});

describe("portalStepTitle", () => {
  it("includes the reason in the hover title too", () => {
    const title = portalStepTitle("Installation start", {
      status: "blocked",
      plannedStartDate: null,
      plannedEndDate: null,
      actualEndDate: null,
      blockedReason: "vendor_issue_section",
    });
    expect(title).toContain("Vendor issue — section");
    expect(title).toContain("team will contact you");
  });
});
