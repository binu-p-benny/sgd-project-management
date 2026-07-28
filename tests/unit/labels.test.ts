import { describe, it, expect } from "vitest";
import { BLOCKED_REASON_OPTIONS } from "@/lib/labels";

// The exact 24-value flat list from the spec (not filtered/grouped per step).
const EXPECTED_REASONS = [
  "client_payment_hold",
  "client_hold",
  "site_not_ready",
  "section_damage",
  "powder_coating_damage",
  "section_and_powder_coating_damage",
  "hardware_damage",
  "glass_damage",
  "requirement_wrong_section",
  "requirement_wrong_hardware",
  "requirement_wrong_gasket",
  "requirement_wrong_glass",
  "vendor_issue_section",
  "vendor_issue_hardware",
  "vendor_issue_gasket",
  "vendor_issue_glass",
  "fabrication_damage_section",
  "fabrication_damage_hardware",
  "fabrication_damage_glass",
  "transportation_damage_section",
  "transportation_damage_hardware",
  "transportation_damage_glass",
  "wrong_tight_measurement",
  "other",
];

describe("BLOCKED_REASON_OPTIONS", () => {
  it("has exactly 24 values", () => {
    expect(BLOCKED_REASON_OPTIONS).toHaveLength(24);
  });

  it("matches the spec's flat list exactly (same set, one flat list — not filtered per step)", () => {
    expect(new Set(BLOCKED_REASON_OPTIONS)).toEqual(new Set(EXPECTED_REASONS));
  });

  it("keeps client_payment_hold and client_hold as two distinct options", () => {
    expect(BLOCKED_REASON_OPTIONS).toContain("client_payment_hold");
    expect(BLOCKED_REASON_OPTIONS).toContain("client_hold");
  });

  it("fabrication_damage and transportation_damage only have section/hardware/glass (no gasket variant)", () => {
    expect(BLOCKED_REASON_OPTIONS).not.toContain("fabrication_damage_gasket");
    expect(BLOCKED_REASON_OPTIONS).not.toContain("transportation_damage_gasket");
  });

  it("requirement_wrong and vendor_issue have all 4 variants (section/hardware/gasket/glass)", () => {
    for (const suffix of ["section", "hardware", "gasket", "glass"]) {
      expect(BLOCKED_REASON_OPTIONS).toContain(`requirement_wrong_${suffix}`);
      expect(BLOCKED_REASON_OPTIONS).toContain(`vendor_issue_${suffix}`);
    }
  });

  it("includes 'other'", () => {
    expect(BLOCKED_REASON_OPTIONS).toContain("other");
  });
});
