import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus, StepActionError } from "@/lib/step-actions";
import { checkDependencyGate } from "@/lib/dependency-gate";
import {
  createTestProject,
  ensureTestUsers,
  getStep,
  findStep,
  getProject,
  getStatusLogs,
  cleanupTestProjects,
} from "../helpers/db";
import type { Department, VisitUrgency } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

describe("Phase 1 — server-side dependency gate", () => {
  it("blocks 1B from starting until 1A is completed", async () => {
    const project = await createTestProject();
    const oneB = await getStep(project.id, "1B");

    const gate = await checkDependencyGate(oneB.id);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toContain("1A");

    await expect(
      updateStepStatus(oneB.id, "in_progress", users.project_engineer)
    ).rejects.toMatchObject({ status: 409, detail: { blockedBy: ["1A"] } });
  });

  it("writes a step_status_log entry (who/when) for every status change", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");

    await updateStepStatus(oneA.id, "in_progress", users.hr_admin);
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "hot" });

    const logs = await getStatusLogs(oneA.id);
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs[0]).toMatchObject({ oldStatus: "not_started", newStatus: "in_progress", changedByUserId: users.hr_admin });
    expect(logs[1]).toMatchObject({ oldStatus: "in_progress", newStatus: "completed", changedByUserId: users.hr_admin });
    expect(logs[0].changedAt).toBeInstanceOf(Date);
  });
});

describe("Phase 1 — 1A completion requires visit_urgency", () => {
  it("rejects completing 1A without a visitUrgency", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");

    await expect(
      updateStepStatus(oneA.id, "completed", users.hr_admin)
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("Phase 1 — 1B duration auto-derived from visit_urgency", () => {
  const cases: { urgency: VisitUrgency; expectedDays: number }[] = [
    { urgency: "emergency", expectedDays: 2 },
    { urgency: "hot", expectedDays: 5 },
    { urgency: "cold", expectedDays: 15 },
  ];

  for (const { urgency, expectedDays } of cases) {
    it(`${urgency} => 1B gets a ${expectedDays}-day duration`, async () => {
      const project = await createTestProject();
      const oneA = await getStep(project.id, "1A");

      await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: urgency });

      const oneB = await getStep(project.id, "1B");
      expect(oneB.plannedDurationDays).toBe(expectedDays);
      expect(oneB.status).toBe("not_started");
      expect(oneB.plannedStartDate).not.toBeNull();
      expect(oneB.plannedEndDate).toEqual(
        new Date(oneB.plannedStartDate!.getTime() + expectedDays * 24 * 60 * 60 * 1000)
      );

      const project2 = await getProject(project.id);
      expect(project2.visitUrgency).toBe(urgency);
    });
  }

  it("site_not_ready sends 1B straight to blocked with no duration, and the project shows blocked", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");

    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "site_not_ready" });

    const oneB = await getStep(project.id, "1B");
    expect(oneB.status).toBe("blocked");
    expect(oneB.blockedReason).toBe("site_not_ready");
    expect(oneB.plannedDurationDays).toBeNull();
    expect(oneB.plannedEndDate).toBeNull();

    const logs = await getStatusLogs(oneB.id);
    expect(logs.some((l) => l.newStatus === "blocked")).toBe(true);

    const refreshedProject = await getProject(project.id);
    expect(refreshedProject.overallStatus).toBe("blocked");
  });
});

describe("Phase 1 — full 1A->1B->1C->1D walk, phase 2 gated on 1D", () => {
  it("phase 2 steps do not exist until 1D is completed, and are created immediately once it is", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "emergency" });

    const oneC = await getStep(project.id, "1C");
    await expect(
      updateStepStatus(oneC.id, "in_progress", users.design_engineer)
    ).rejects.toMatchObject({ status: 409, detail: { blockedBy: ["1B"] } });

    const oneB = await getStep(project.id, "1B");
    await updateStepStatus(oneB.id, "completed", users.project_engineer);
    await updateStepStatus(oneC.id, "completed", users.design_engineer);

    // Nothing in phase 2 exists yet — not just hidden, the rows genuinely don't exist server-side.
    expect(await findStep(project.id, "2A")).toBeNull();
    expect(await findStep(project.id, "2D1")).toBeNull();
    expect(await findStep(project.id, "2D2")).toBeNull();
    expect(await findStep(project.id, "2F")).toBeNull();

    const oneD = await getStep(project.id, "1D");
    await updateStepStatus(oneD.id, "completed", users.accounts);

    const twoA = await getStep(project.id, "2A");
    expect(twoA.dependsOn).toEqual(["1D"]);
    const gate = await checkDependencyGate(twoA.id);
    expect(gate.allowed).toBe(true);

    const projectAfter = await getProject(project.id);
    expect(projectAfter.currentPhase).toBe("phase_2");
  });

  it("blocking 1D with client_payment_hold blocks the step and the whole project, and still withholds phase 2", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "emergency" });
    const oneB = await getStep(project.id, "1B");
    await updateStepStatus(oneB.id, "completed", users.project_engineer);
    const oneC = await getStep(project.id, "1C");
    await updateStepStatus(oneC.id, "completed", users.design_engineer);

    const oneD = await getStep(project.id, "1D");
    await updateStepStatus(oneD.id, "blocked", users.accounts, { blockedReason: "client_payment_hold" });

    const oneDAfter = await getStep(project.id, "1D");
    expect(oneDAfter.status).toBe("blocked");
    expect(oneDAfter.blockedReason).toBe("client_payment_hold");

    const projectAfter = await getProject(project.id);
    expect(projectAfter.overallStatus).toBe("blocked");
    expect(projectAfter.currentPhase).toBe("phase_1");
    expect(await findStep(project.id, "2A")).toBeNull();
  });

  it("client_hold is a distinct reason from client_payment_hold and works the same way structurally", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "blocked", users.hr_admin, { blockedReason: "client_hold" });
    const step = await getStep(project.id, "1A");
    expect(step.blockedReason).toBe("client_hold");
    expect(step.blockedReason).not.toBe("client_payment_hold");
  });
});
