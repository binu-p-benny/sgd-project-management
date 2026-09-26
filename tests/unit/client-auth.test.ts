import { describe, it, expect } from "vitest";
import {
  derivePortalPassword,
  normalizePhone,
  phoneMatches,
  portalPasswordMatches,
} from "@/lib/client-auth";

describe("derivePortalPassword", () => {
  it("is the first 3 name characters plus the first 4 phone digits, 7 in all", () => {
    expect(derivePortalPassword("Priya Menon", "9876500002")).toBe("PRI9876");
    expect(derivePortalPassword("SAM KOLLAM", "8891234567")).toBe("SAM8891");
    expect(derivePortalPassword("Priya Menon", "9876500002")).toHaveLength(7);
  });

  it("skips spaces in the name and non-digits in the phone", () => {
    // "S A M" would otherwise give "S A", and "+91 98765" a password with a plus in it.
    expect(derivePortalPassword("S A M Kollam", "+91 98765 00002")).toBe("SAM9198");
  });

  it("returns null when the record can't produce 7 characters", () => {
    expect(derivePortalPassword("Al", "9876500002")).toBeNull();
    expect(derivePortalPassword("Alex", "888")).toBeNull();
    // Several live records have junk in the phone column; no digits means no password at all.
    expect(derivePortalPassword("Alex", "ASDSAD")).toBeNull();
  });
});

describe("portalPasswordMatches", () => {
  it("ignores case and stray spaces in what was typed", () => {
    expect(portalPasswordMatches("Priya Menon", "9876500002", "PRI9876")).toBe(true);
    expect(portalPasswordMatches("Priya Menon", "9876500002", "pri9876")).toBe(true);
    expect(portalPasswordMatches("Priya Menon", "9876500002", " pri 9876 ")).toBe(true);
  });

  it("rejects anything else, and every attempt against an underivable record", () => {
    expect(portalPasswordMatches("Priya Menon", "9876500002", "PRI9877")).toBe(false);
    expect(portalPasswordMatches("Priya Menon", "9876500002", "")).toBe(false);
    expect(portalPasswordMatches("Alex", "888", "ALE888")).toBe(false);
  });
});

describe("phoneMatches", () => {
  it("matches the same number typed in different shapes", () => {
    expect(phoneMatches("9876500002", "98765 00002")).toBe(true);
    expect(phoneMatches("9876500002", "+91 9876500002")).toBe(true);
    expect(phoneMatches("919876500002", "9876500002")).toBe(true);
    expect(phoneMatches("+91-98765-00002", "919876500002")).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(phoneMatches("9876500002", "9876500003")).toBe(false);
    expect(phoneMatches("9876500002", "")).toBe(false);
  });

  it("requires an exact match for the short junk numbers in the live data", () => {
    // Suffix matching a 3-digit record would collide with a great many real numbers.
    expect(phoneMatches("888", "888")).toBe(true);
    expect(phoneMatches("888", "9876500888")).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("keeps digits only", () => {
    expect(normalizePhone("+91 (98765) 00002")).toBe("919876500002");
    expect(normalizePhone("ASDSAD")).toBe("");
  });
});
