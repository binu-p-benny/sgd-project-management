import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Department } from "@prisma/client";

// Only getSession is faked (there's no request cookie to read in a test) — the real
// hasOwnerAccess/isAdminEditor the routes call next to it are exactly what's under test.
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

import { getSession } from "@/lib/auth";
import { POST as skipPhase } from "@/app/api/projects/[id]/skip-phase/route";
import { GET as listPhaseSteps } from "@/app/api/phase-steps/route";
import { createTestProject, ensureTestUsers, cleanupTestProjects, getProject } from "../helpers/db";

let users: Record<Department, string>;
const mockedGetSession = vi.mocked(getSession);

beforeAll(async () => {
  users = await ensureTestUsers();
});

beforeEach(() => {
  mockedGetSession.mockReset();
});

afterAll(async () => {
  await cleanupTestProjects();
});

function actAs(department: Department | null) {
  mockedGetSession.mockResolvedValue(
    department
      ? { userId: users[department], email: `${department}@test.local`, name: `Test ${department}`, department }
      : null
  );
}

async function callSkipPhase(projectId: string) {
  const request = new NextRequest(`http://localhost/api/projects/${projectId}/skip-phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPhase: "phase_2", asOfDate: "2026-01-15T00:00:00.000Z" }),
  });
  return skipPhase(request, { params: Promise.resolve({ id: projectId }) });
}

interface ListedStep {
  stepCode: string;
  owningDepartment: Department;
  secondaryDepartment: Department | null;
}

async function listSteps(projectId: string, departmentParam?: Department): Promise<ListedStep[]> {
  const query = new URLSearchParams({ project_id: projectId, ...(departmentParam ? { department: departmentParam } : {}) });
  const response = await listPhaseSteps(new NextRequest(`http://localhost/api/phase-steps?${query}`));
  return response.json();
}

describe("POST /api/projects/[id]/skip-phase — owner-level only (owner_admin + Operations Manager)", () => {
  it("lets Operations Manager skip a project straight to phase 2", async () => {
    const project = await createTestProject();
    actAs("operations_manager");

    const response = await callSkipPhase(project.id);

    expect(response.status).toBe(200);
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");
  });

  it("still lets the owner", async () => {
    const project = await createTestProject();
    actAs("owner_admin");

    const response = await callSkipPhase(project.id);

    expect(response.status).toBe(200);
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");
  });

  it.each(["hr_admin", "accounts", "project_engineer"] as Department[])(
    "forbids %s — HR & Admin included, this is deliberately narrower than isAdminEditor — and leaves the project untouched",
    async (department) => {
      const project = await createTestProject();
      actAs(department);

      const response = await callSkipPhase(project.id);

      expect(response.status).toBe(403);
      expect((await getProject(project.id)).currentPhase).toBe("phase_1");
    }
  );

  it("401s when signed out", async () => {
    const project = await createTestProject();
    actAs(null);

    expect((await callSkipPhase(project.id)).status).toBe(401);
  });
});

describe("GET /api/phase-steps — owner-level roles see every department, everyone else stays scoped to their own", () => {
  it("Operations Manager sees the same steps the owner does, across more than one department", async () => {
    const project = await createTestProject();

    actAs("owner_admin");
    const ownerSteps = await listSteps(project.id);
    actAs("operations_manager");
    const opsManagerSteps = await listSteps(project.id);

    expect(new Set(opsManagerSteps.map((s) => s.owningDepartment)).size).toBeGreaterThan(1);
    expect(opsManagerSteps.map((s) => s.stepCode)).toEqual(ownerSteps.map((s) => s.stepCode));
  });

  it("Operations Manager can still narrow down with ?department=, the same filter the owner has", async () => {
    const project = await createTestProject();
    actAs("operations_manager");

    const steps = await listSteps(project.id, "project_engineer");
    const everyStep = await listSteps(project.id);

    expect(steps.length).toBeGreaterThan(0);
    expect(steps.length).toBeLessThan(everyStep.length);
    expect(steps.every((s) => s.owningDepartment === "project_engineer" || s.secondaryDepartment === "project_engineer")).toBe(true);
  });

  it("a plain department user is still scoped to their own department, whatever ?department= says", async () => {
    const project = await createTestProject();
    actAs("project_engineer");

    const steps = await listSteps(project.id, "hr_admin");

    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.owningDepartment === "project_engineer" || s.secondaryDepartment === "project_engineer")).toBe(true);
  });
});
