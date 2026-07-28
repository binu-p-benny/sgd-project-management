import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus } from "@/lib/step-actions";
import { checkDependencyGate } from "@/lib/dependency-gate";
import {
  createTestProject,
  ensureTestUsers,
  getStep,
  getProject,
  cleanupTestProjects,
} from "../helpers/db";
import { advanceThroughPhase1, advanceThroughPhase2 } from "../helpers/scenarios";
import type { Department, GlassType } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

async function projectAtPhase3(glassType: GlassType = "normal") {
  const project = await createTestProject({ glassType });
  await advanceThroughPhase1(project.id, users, "emergency");
  await advanceThroughPhase2(project.id, users);
  return project;
}

describe("3B glass delivery duration pulls from project.glass_type", () => {
  it("normal glass => 7 days", async () => {
    const project = await projectAtPhase3("normal");
    const threeB = await getStep(project.id, "3B");
    expect(threeB.plannedDurationDays).toBe(7);
  });

  it("laminated glass => 10 days", async () => {
    const project = await projectAtPhase3("laminated");
    const threeB = await getStep(project.id, "3B");
    expect(threeB.plannedDurationDays).toBe(10);
  });
});

describe("3C1 depends directly on 2F, independent of 3A/3B", () => {
  it("3C1 (and 3A) are both immediately startable once phase 3 is seeded, before either touches the other", async () => {
    const project = await projectAtPhase3();

    const threeC1 = await getStep(project.id, "3C1");
    const gateC1 = await checkDependencyGate(threeC1.id);
    expect(gateC1.allowed).toBe(true);

    const threeA = await getStep(project.id, "3A");
    const gateA = await checkDependencyGate(threeA.id);
    expect(gateA.allowed).toBe(true);

    // Start 3C1 without ever touching 3A/3B.
    await updateStepStatus(threeC1.id, "in_progress", users.project_engineer);
    const threeC1After = await getStep(project.id, "3C1");
    expect(threeC1After.status).toBe("in_progress");

    const threeAAfter = await getStep(project.id, "3A");
    expect(threeAAfter.status).toBe("not_started"); // untouched, proving independence
  });
});

describe("3C2 depends on 3C1", () => {
  it("blocks until 3C1 is completed", async () => {
    const project = await projectAtPhase3();
    const threeC2 = await getStep(project.id, "3C2");

    await expect(
      updateStepStatus(threeC2.id, "in_progress", users.project_engineer)
    ).rejects.toMatchObject({ status: 409, detail: { blockedBy: ["3C1"] } });

    const threeC1 = await getStep(project.id, "3C1");
    await updateStepStatus(threeC1.id, "completed", users.project_engineer);

    const gate = await checkDependencyGate(threeC2.id);
    expect(gate.allowed).toBe(true);
  });
});

describe("3E is a parallel gate on BOTH 3B and 3C2", () => {
  it("does not become allowed with only the installation branch (3C1->3C2) done", async () => {
    const project = await projectAtPhase3();
    const threeC1 = await getStep(project.id, "3C1");
    await updateStepStatus(threeC1.id, "completed", users.project_engineer);
    const threeC2 = await getStep(project.id, "3C2");
    await updateStepStatus(threeC2.id, "completed", users.project_engineer);

    const threeE = await getStep(project.id, "3E");
    const gate = await checkDependencyGate(threeE.id);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toContain("3B");
    expect(gate.blockedBy).not.toContain("3C2");
  });

  it("does not become allowed with only the glass branch (3A->3B) done", async () => {
    const project = await projectAtPhase3();
    const threeA = await getStep(project.id, "3A");
    await updateStepStatus(threeA.id, "completed", users.purchase);
    const threeB = await getStep(project.id, "3B");
    await updateStepStatus(threeB.id, "completed", users.purchase);

    const threeE = await getStep(project.id, "3E");
    const gate = await checkDependencyGate(threeE.id);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toContain("3C2");
    expect(gate.blockedBy).not.toContain("3B");
  });

  it("becomes allowed only once both branches complete, and completing it finishes the project", async () => {
    const project = await projectAtPhase3();

    const threeA = await getStep(project.id, "3A");
    await updateStepStatus(threeA.id, "completed", users.purchase);
    const threeB = await getStep(project.id, "3B");
    await updateStepStatus(threeB.id, "completed", users.purchase);
    const threeC1 = await getStep(project.id, "3C1");
    await updateStepStatus(threeC1.id, "completed", users.project_engineer);
    const threeC2 = await getStep(project.id, "3C2");
    await updateStepStatus(threeC2.id, "completed", users.project_engineer);

    const threeE = await getStep(project.id, "3E");
    const gate = await checkDependencyGate(threeE.id);
    expect(gate.allowed).toBe(true);

    await updateStepStatus(threeE.id, "completed", users.project_engineer);

    const projectAfter = await getProject(project.id);
    expect(projectAfter.currentPhase).toBe("completed");
    expect(projectAfter.overallStatus).toBe("completed");
    expect(projectAfter.actualEndDate).not.toBeNull();
  });
});
