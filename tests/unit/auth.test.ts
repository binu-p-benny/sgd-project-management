import { describe, it, expect } from "vitest";
import type { Department } from "@prisma/client";
import {
  canViewDashboard,
  hasOwnerAccess,
  isAdminEditor,
  isOperationsManager,
  isOwnerAdmin,
  type SessionPayload,
} from "@/lib/auth";

function sessionFor(department: Department): SessionPayload {
  return { userId: "user-id", email: "user@test.local", name: "Test User", department };
}

// Record<Department, ...> on purpose: adding a department without deciding what it may do fails
// type-checking right here, instead of silently getting whatever the helpers default to.
const EXPECTED: Record<Department, { ownerAdmin: boolean; ownerAccess: boolean; adminEditor: boolean }> = {
  owner_admin: { ownerAdmin: true, ownerAccess: true, adminEditor: true },
  operations_manager: { ownerAdmin: false, ownerAccess: true, adminEditor: true },
  hr_admin: { ownerAdmin: false, ownerAccess: false, adminEditor: true },
  project_engineer: { ownerAdmin: false, ownerAccess: false, adminEditor: false },
  design_engineer: { ownerAdmin: false, ownerAccess: false, adminEditor: false },
  purchase: { ownerAdmin: false, ownerAccess: false, adminEditor: false },
  accounts: { ownerAdmin: false, ownerAccess: false, adminEditor: false },
};

describe("access helpers, per department", () => {
  for (const [department, expected] of Object.entries(EXPECTED) as [Department, (typeof EXPECTED)[Department]][]) {
    it(`${department}: isOwnerAdmin=${expected.ownerAdmin}, hasOwnerAccess=${expected.ownerAccess}, isAdminEditor=${expected.adminEditor}`, () => {
      const session = sessionFor(department);
      expect(isOwnerAdmin(session)).toBe(expected.ownerAdmin);
      expect(hasOwnerAccess(session)).toBe(expected.ownerAccess);
      expect(isAdminEditor(session)).toBe(expected.adminEditor);
      // /dashboard follows owner-level access exactly.
      expect(canViewDashboard(session)).toBe(expected.ownerAccess);
    });
  }
});

describe("Operations Manager has everything the owner has, except the owner-only /performance gate", () => {
  const owner = sessionFor("owner_admin");
  const opsManager = sessionFor("operations_manager");

  it("passes every access check the owner passes, other than isOwnerAdmin", () => {
    expect(hasOwnerAccess(opsManager)).toBe(hasOwnerAccess(owner));
    expect(isAdminEditor(opsManager)).toBe(isAdminEditor(owner));
    expect(canViewDashboard(opsManager)).toBe(canViewDashboard(owner));
  });

  it("is not isOwnerAdmin — the one check /performance is gated on", () => {
    expect(isOwnerAdmin(owner)).toBe(true);
    expect(isOwnerAdmin(opsManager)).toBe(false);
    expect(isOperationsManager(opsManager)).toBe(true);
  });
});
