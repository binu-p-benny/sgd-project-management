import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getProjectSituationCounts } from "@/lib/dashboard";
import { updateStepStatus } from "@/lib/step-actions";
import { createTestProject, ensureTestUsers, getStep, cleanupTestProjects } from "../helpers/db";
import { advanceThroughPhase1 } from "../helpers/scenarios";
import type { Department } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

/**
 * The dashboard's two blocked tiles. They split on the blocked *step's* phase, the same rule
 * stepStatusLabel words the badges from — Phase 1 is a dead stop, later phases get worked
 * around — so the counts have to follow the block, not the project's own currentPhase.
 */
describe("getProjectSituationCounts — blocked vs temporarily blocked", () => {
  it("counts a Phase 1 block under blocked, not temporarily blocked", async () => {
    const before = await getProjectSituationCounts();

    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "blocked", users.hr_admin, { blockedReason: "site_not_ready" });

    const after = await getProjectSituationCounts();
    expect(after.blocked).toBe(before.blocked + 1);
    expect(after.temporarilyBlocked).toBe(before.temporarilyBlocked);
  });

  it("counts a Phase 2 block under temporarily blocked", async () => {
    const before = await getProjectSituationCounts();

    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    const twoD2 = await getStep(project.id, "2D2");
    await updateStepStatus(twoD2.id, "blocked", users.design_engineer, { blockedReason: "vendor_issue_section" });

    const after = await getProjectSituationCounts();
    expect(after.temporarilyBlocked).toBe(before.temporarilyBlocked + 1);
    expect(after.blocked).toBe(before.blocked);
  });

  it("puts every blocked project in exactly one of the two", async () => {
    const before = await getProjectSituationCounts();
    const beforeTotal = before.blocked + before.temporarilyBlocked;

    const phase1 = await createTestProject();
    const oneA = await getStep(phase1.id, "1A");
    await updateStepStatus(oneA.id, "blocked", users.hr_admin, { blockedReason: "client_hold" });

    const phase2 = await createTestProject();
    await advanceThroughPhase1(phase2.id, users, "emergency");
    const twoD2 = await getStep(phase2.id, "2D2");
    await updateStepStatus(twoD2.id, "blocked", users.design_engineer, { blockedReason: "site_not_ready" });

    const after = await getProjectSituationCounts();
    expect(after.blocked + after.temporarilyBlocked).toBe(beforeTotal + 2);
  });

  it("stops counting a project once its block is lifted", async () => {
    const before = await getProjectSituationCounts();

    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    const twoD2 = await getStep(project.id, "2D2");
    await updateStepStatus(twoD2.id, "blocked", users.design_engineer, { blockedReason: "site_not_ready" });
    expect((await getProjectSituationCounts()).temporarilyBlocked).toBe(before.temporarilyBlocked + 1);

    // Back to not_started rather than in_progress: 2D2's own dependencies aren't complete on a
    // project that has only just left Phase 1, and starting it would be refused by the gate.
    await updateStepStatus(twoD2.id, "not_started", users.design_engineer);

    const after = await getProjectSituationCounts();
    expect(after.temporarilyBlocked).toBe(before.temporarilyBlocked);
    expect(after.blocked).toBe(before.blocked);
  });
});
