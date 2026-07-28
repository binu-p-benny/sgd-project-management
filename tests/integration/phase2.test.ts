import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus } from "@/lib/step-actions";
import { checkDependencyGate } from "@/lib/dependency-gate";
import { computeExpectedArrivalDate } from "@/lib/procurement";
import {
  createTestProject,
  ensureTestUsers,
  getStep,
  findStep,
  getProject,
  getProcurementItems,
  getStatusLogs,
  cleanupTestProjects,
} from "../helpers/db";
import { advanceThroughPhase1, patchProcurementItem, markAllRequirementsCreated } from "../helpers/scenarios";
import type { Department } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

async function projectAtPhase2() {
  const project = await createTestProject();
  await advanceThroughPhase1(project.id, users, "emergency");
  return project;
}

describe("procurement_items are created (empty) as soon as phase 2 is seeded", () => {
  it("all 3 rows exist right after 1D completes — before 2A has any requirement checked", async () => {
    const project = await projectAtPhase2();

    const items = await getProcurementItems(project.id);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.itemType).sort()).toEqual(["gasket", "hardware", "section"]);
    for (const item of items) {
      expect(item.requirementCreatedAt).toBeNull();
      expect(item.expectedArrivalDate).toBeNull();
    }

    const twoA = await getStep(project.id, "2A");
    expect(twoA.status).toBe("not_started");
  });
});

describe("2A, 2D1 and 2F are derived — none can be set manually", () => {
  it("rejects a manual status update on 2A", async () => {
    const project = await projectAtPhase2();
    const twoA = await getStep(project.id, "2A");
    await expect(
      updateStepStatus(twoA.id, "in_progress", users.design_engineer)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a manual status update on 2D1", async () => {
    const project = await projectAtPhase2();
    const twoD1 = await getStep(project.id, "2D1");
    await expect(
      updateStepStatus(twoD1.id, "in_progress", users.purchase)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a manual status update on 2F", async () => {
    const project = await projectAtPhase2();
    const twoF = await getStep(project.id, "2F");
    await expect(
      updateStepStatus(twoF.id, "completed", users.purchase)
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("2A (purchase requirement) is derived from each item's requirement-created checkbox", () => {
  it("not_started -> in_progress (partial) -> completed (all 3 checked), each transition logged", async () => {
    const project = await projectAtPhase2();

    let twoA = await getStep(project.id, "2A");
    expect(twoA.status).toBe("not_started");

    await patchProcurementItem(project.id, "section", users.design_engineer, { requirementCreatedAt: new Date() });
    twoA = await getStep(project.id, "2A");
    expect(twoA.status).toBe("in_progress");

    await patchProcurementItem(project.id, "hardware", users.design_engineer, { requirementCreatedAt: new Date() });
    twoA = await getStep(project.id, "2A");
    expect(twoA.status).toBe("in_progress"); // still 1 short

    await patchProcurementItem(project.id, "gasket", users.design_engineer, { requirementCreatedAt: new Date() });
    twoA = await getStep(project.id, "2A");
    expect(twoA.status).toBe("completed");

    const logs = await getStatusLogs(twoA.id);
    expect(logs.some((l) => l.newStatus === "completed" && l.reason?.includes("Auto-derived"))).toBe(true);
  });

  it("checking the box stamps requirement_created_at and derives that item's own expected_arrival_date", async () => {
    const project = await projectAtPhase2();
    const before = new Date();
    await patchProcurementItem(project.id, "section", users.design_engineer, { requirementCreatedAt: new Date() });
    const after = new Date();

    const items = await getProcurementItems(project.id);
    const section = items.find((i) => i.itemType === "section")!;
    expect(section.requirementCreatedAt).not.toBeNull();
    expect(section.requirementCreatedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(section.requirementCreatedAt!.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    expect(section.expectedArrivalDate).toEqual(
      computeExpectedArrivalDate("section", section.requirementCreatedAt!)
    );

    // hardware/gasket untouched
    const hardware = items.find((i) => i.itemType === "hardware")!;
    expect(hardware.requirementCreatedAt).toBeNull();
    expect(hardware.expectedArrivalDate).toBeNull();
  });

  it("unchecking the box clears both requirement_created_at and expected_arrival_date", async () => {
    const project = await projectAtPhase2();
    await patchProcurementItem(project.id, "section", users.design_engineer, { requirementCreatedAt: new Date() });
    await patchProcurementItem(project.id, "section", users.design_engineer, { requirementCreatedAt: null });

    const items = await getProcurementItems(project.id);
    const section = items.find((i) => i.itemType === "section")!;
    expect(section.requirementCreatedAt).toBeNull();
    expect(section.expectedArrivalDate).toBeNull();

    const twoA = await getStep(project.id, "2A");
    expect(twoA.status).toBe("not_started");
  });
});

describe("2D1/2D2 are gated on 2A (all 3 requirements checked), same as any other depends_on", () => {
  it("2D2 cannot start until all 3 requirement boxes are checked", async () => {
    const project = await projectAtPhase2();
    const twoD2 = await getStep(project.id, "2D2");

    await expect(
      updateStepStatus(twoD2.id, "in_progress", users.design_engineer)
    ).rejects.toMatchObject({ status: 409, detail: { blockedBy: ["2A"] } });

    // only 2 of 3 checked — still blocked
    await patchProcurementItem(project.id, "section", users.design_engineer, { requirementCreatedAt: new Date() });
    await patchProcurementItem(project.id, "hardware", users.design_engineer, { requirementCreatedAt: new Date() });
    const gateStillBlocked = await checkDependencyGate(twoD2.id);
    expect(gateStillBlocked.allowed).toBe(false);

    await patchProcurementItem(project.id, "gasket", users.design_engineer, { requirementCreatedAt: new Date() });
    const gate = await checkDependencyGate(twoD2.id);
    expect(gate.allowed).toBe(true);
  });
});

describe("2D2 (final tight measurement) runs independently of 2D1/2F", () => {
  it("2D2 can be completed manually without touching arrival/QC, and does not affect 2F", async () => {
    const project = await projectAtPhase2();
    await markAllRequirementsCreated(project.id, users.design_engineer);

    const twoD2 = await getStep(project.id, "2D2");
    await updateStepStatus(twoD2.id, "in_progress", users.design_engineer);
    await updateStepStatus(twoD2.id, "completed", users.design_engineer);

    const twoD2After = await getStep(project.id, "2D2");
    expect(twoD2After.status).toBe("completed");

    // 2F must still be gated on 2D1 / materials-arrived, completely unmoved by 2D2.
    const twoF = await getStep(project.id, "2F");
    const gate = await checkDependencyGate(twoF.id);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toContain("2D1");
  });

  it("2F becomes complete from materials + QC alone, even if 2D2 was never touched", async () => {
    const project = await projectAtPhase2();
    await markAllRequirementsCreated(project.id, users.design_engineer);

    for (const itemType of ["section", "hardware", "gasket"] as const) {
      await patchProcurementItem(project.id, itemType, users.purchase, { actualArrivalDate: new Date() });
    }
    for (const itemType of ["section", "hardware", "gasket"] as const) {
      await patchProcurementItem(project.id, itemType, users.purchase, { qcCheckedAt: new Date() });
    }

    const twoD2 = await getStep(project.id, "2D2");
    expect(twoD2.status).toBe("not_started"); // never touched

    const twoF = await getStep(project.id, "2F");
    expect(twoF.status).toBe("completed");

    const projectAfter = await getProject(project.id);
    expect(projectAfter.currentPhase).toBe("phase_3"); // phase 3 seeded off 2F, not 2D2
  });
});

describe("2F requires all 3 QC checkboxes (section, hardware, gasket)", () => {
  it("stays incomplete with only 2 of 3 checked, even after materials arrived", async () => {
    const project = await projectAtPhase2();
    await markAllRequirementsCreated(project.id, users.design_engineer);

    for (const itemType of ["section", "hardware", "gasket"] as const) {
      await patchProcurementItem(project.id, itemType, users.purchase, { actualArrivalDate: new Date() });
    }
    await patchProcurementItem(project.id, "section", users.purchase, { qcCheckedAt: new Date() });
    await patchProcurementItem(project.id, "hardware", users.purchase, { qcCheckedAt: new Date() });

    const twoF = await getStep(project.id, "2F");
    expect(twoF.status).toBe("in_progress");

    await patchProcurementItem(project.id, "gasket", users.purchase, { qcCheckedAt: new Date() });
    const twoFAfter = await getStep(project.id, "2F");
    expect(twoFAfter.status).toBe("completed");
  });
});

describe("Phase 3 is only seeded once 2F completes", () => {
  it("no phase 3 steps exist before 2F completes", async () => {
    const project = await projectAtPhase2();
    await markAllRequirementsCreated(project.id, users.design_engineer);

    expect(await findStep(project.id, "3A")).toBeNull();
    expect(await findStep(project.id, "3C1")).toBeNull();
  });
});
