import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus, revertStep, syncGlassPOStepStatus, maybeEarlyUnlockPhase3 } from "@/lib/step-actions";
import { checkDependencyGate } from "@/lib/dependency-gate";
import {
  createTestProject,
  ensureTestUsers,
  getStep,
  getProject,
  cleanupTestProjects,
  prisma,
} from "../helpers/db";
import {
  advanceThroughPhase1,
  advanceThroughPhase2,
  completeGlassPO,
  completeGlassDelivery,
  markAllRequirementsCreated,
  patchProcurementItem,
} from "../helpers/scenarios";
import type { Department, GlassType, ItemType } from "@prisma/client";

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
    await completeGlassPO(project.id, users.purchase);
    await completeGlassDelivery(project.id, users.purchase);

    const threeE = await getStep(project.id, "3E");
    const gate = await checkDependencyGate(threeE.id);
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toContain("3C2");
    expect(gate.blockedBy).not.toContain("3B");
  });

  it("becomes allowed only once both branches complete, and completing it finishes the project", async () => {
    const project = await projectAtPhase3();

    await completeGlassPO(project.id, users.purchase);
    await completeGlassDelivery(project.id, users.purchase);
    const threeC1 = await getStep(project.id, "3C1");
    await updateStepStatus(threeC1.id, "completed", users.project_engineer);
    const threeC2 = await getStep(project.id, "3C2");
    await updateStepStatus(threeC2.id, "completed", users.project_engineer);

    const threeE = await getStep(project.id, "3E");
    const gate = await checkDependencyGate(threeE.id);
    expect(gate.allowed).toBe(true);

    await updateStepStatus(threeE.id, "completed", users.project_engineer, { qcPassed: true });

    const projectAfter = await getProject(project.id);
    expect(projectAfter.currentPhase).toBe("completed");
    expect(projectAfter.overallStatus).toBe("completed");
    expect(projectAfter.actualEndDate).not.toBeNull();
  });
});

describe("3E's final QC — a fail leaves the step (and project) open, only a pass finishes both", () => {
  async function readyThreeE(project: { id: string }) {
    await completeGlassPO(project.id, users.purchase);
    await completeGlassDelivery(project.id, users.purchase);
    const threeC1 = await getStep(project.id, "3C1");
    await updateStepStatus(threeC1.id, "completed", users.project_engineer);
    const threeC2 = await getStep(project.id, "3C2");
    await updateStepStatus(threeC2.id, "completed", users.project_engineer);
    const threeE = await getStep(project.id, "3E");
    await updateStepStatus(threeE.id, "in_progress", users.project_engineer);
    return getStep(project.id, "3E");
  }

  it("completing 3E without qcPassed: true is rejected", async () => {
    const project = await projectAtPhase3();
    const threeE = await readyThreeE(project);
    await expect(
      updateStepStatus(threeE.id, "completed", users.project_engineer)
    ).rejects.toThrow("3E can only be completed once QC has passed");
  });

  it("a failed QC check (recorded without a status transition) leaves 3E in_progress and the project not completed", async () => {
    const project = await projectAtPhase3();
    const threeE = await readyThreeE(project);

    await prisma.phaseStep.update({
      where: { id: threeE.id },
      data: { qcPassed: false, qcCheckedAt: new Date(), notes: "Cracked pane at the corner" },
    });

    const after = await getStep(project.id, "3E");
    expect(after.status).toBe("in_progress");
    expect(after.qcPassed).toBe(false);

    const projectAfter = await getProject(project.id);
    expect(projectAfter.currentPhase).toBe("phase_3");
    expect(projectAfter.overallStatus).not.toBe("completed");
  });

  it("passing QC after a prior failure completes 3E and finishes the project", async () => {
    const project = await projectAtPhase3();
    const threeE = await readyThreeE(project);
    await prisma.phaseStep.update({
      where: { id: threeE.id },
      data: { qcPassed: false, qcCheckedAt: new Date() },
    });

    await updateStepStatus(threeE.id, "completed", users.project_engineer, { qcPassed: true });

    const after = await getStep(project.id, "3E");
    expect(after.status).toBe("completed");
    expect(after.qcPassed).toBe(true);

    const projectAfter = await getProject(project.id);
    expect(projectAfter.currentPhase).toBe("completed");
    expect(projectAfter.overallStatus).toBe("completed");
  });

  it("a custom follow-up row can be created once QC has failed and an action plan is recorded", async () => {
    const project = await projectAtPhase3();
    const threeE = await readyThreeE(project);
    await prisma.phaseStep.update({
      where: { id: threeE.id },
      data: {
        qcPassed: false,
        qcCheckedAt: new Date(),
        actionPlanAt: new Date(),
        actionPlanNote: "Replace the cracked pane and re-inspect",
      },
    });

    const item = await prisma.phaseStepActionItem.create({
      data: {
        phaseStepId: threeE.id,
        taskLabel: "Replace cracked pane",
        department: "project_engineer",
        plannedDate: new Date(),
      },
    });
    expect(item.phaseStepId).toBe(threeE.id);

    const withItems = await prisma.phaseStep.findUniqueOrThrow({
      where: { id: threeE.id },
      include: { actionItems: true },
    });
    expect(withItems.actionItems).toHaveLength(1);
  });
});

describe("Phase 3 seeding creates the glass PO tracker row (3A's Requirement/Quote/Payment/Order table)", () => {
  it("the row exists, empty, right after 2F completes", async () => {
    const project = await projectAtPhase3();
    expect((await getProject(project.id)).currentPhase).toBe("phase_3");

    const glassPO = await prisma.glassPurchaseOrder.findUnique({ where: { projectId: project.id } });
    expect(glassPO).not.toBeNull();
    expect(glassPO!.requirementCreatedAt).toBeNull();
    expect(glassPO!.quoteCreatedAt).toBeNull();
    expect(glassPO!.paymentSettledAt).toBeNull();
    expect(glassPO!.orderConfirmedAt).toBeNull();
  });

  it("3A's status can't be set manually — it's derived from the glass PO row", async () => {
    const project = await projectAtPhase3();
    const threeA = await getStep(project.id, "3A");
    await expect(updateStepStatus(threeA.id, "completed", users.purchase)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("3A tracks the glass PO row live: not_started -> in_progress (Requirement created) -> completed (Order confirmed)", async () => {
    const project = await projectAtPhase3();
    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });

    const requirementDate = new Date("2026-09-01T00:00:00.000Z");
    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: { requirementCreatedAt: requirementDate },
    });
    await syncGlassPOStepStatus(project.id, users.purchase);

    const threeAInProgress = await getStep(project.id, "3A");
    expect(threeAInProgress.status).toBe("in_progress");
    expect(threeAInProgress.actualStartDate).toEqual(requirementDate);
    expect(threeAInProgress.actualEndDate).toBeNull();

    const orderDate = new Date("2026-09-10T00:00:00.000Z");
    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: { orderConfirmedAt: orderDate },
    });
    await syncGlassPOStepStatus(project.id, users.purchase);

    const threeACompleted = await getStep(project.id, "3A");
    expect(threeACompleted.status).toBe("completed");
    expect(threeACompleted.actualStartDate).toEqual(requirementDate);
    expect(threeACompleted.actualEndDate).toEqual(orderDate);
  });

  it("reverting 3A directly clears the glass PO row and lands it back at not_started", async () => {
    const project = await projectAtPhase3();
    await completeGlassPO(project.id, users.purchase);
    const threeA = await getStep(project.id, "3A");
    expect(threeA.status).toBe("completed");

    // A payment record, same as 1D's — discarding it needs explicit consent.
    await expect(revertStep(threeA.id, users.owner_admin, { reason: "test revert" })).rejects.toMatchObject({
      status: 409,
    });

    await revertStep(threeA.id, users.owner_admin, { reason: "test revert", clearDerivedProcurement: true });

    expect((await getStep(project.id, "3A")).status).toBe("not_started");
    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(glassPO.requirementCreatedAt).toBeNull();
    expect(glassPO.quoteCreatedAt).toBeNull();
    expect(glassPO.paymentSettledAt).toBeNull();
    expect(glassPO.orderConfirmedAt).toBeNull();
  });

  it("re-completing 2F after a revert does not wipe existing glass PO data or duplicate the row", async () => {
    const project = await projectAtPhase3();
    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });
    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: { requirementCreatedAt: new Date(), requirementNote: "already filled in" },
    });

    const twoF = await getStep(project.id, "2F");
    await revertStep(twoF.id, users.owner_admin, { reason: "test revert", clearDerivedProcurement: true });
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");

    // Re-derive 2F back to completed the same way advanceThroughPhase2 originally did.
    await advanceThroughPhase2(project.id, users);
    expect((await getProject(project.id)).currentPhase).toBe("phase_3");

    const rows = await prisma.glassPurchaseOrder.findMany({ where: { projectId: project.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].requirementCreatedAt).not.toBeNull();
    expect(rows[0].requirementNote).toBe("already filled in");
  });
});

describe("3B (Glass delivery) is derived from the glass PO row's Actual arrival stage", () => {
  it("3B's status can't be set manually — it's derived from the glass PO row", async () => {
    const project = await projectAtPhase3();
    const threeB = await getStep(project.id, "3B");
    await expect(updateStepStatus(threeB.id, "completed", users.purchase)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("3B tracks the glass PO row live: not_started -> in_progress (planned arrival) -> completed (actual arrival), planned end mirrored too", async () => {
    const project = await projectAtPhase3();
    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });

    const plannedArrival = new Date("2026-09-15T00:00:00.000Z");
    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: { arrivalPlannedDate: plannedArrival },
    });
    await syncGlassPOStepStatus(project.id, users.purchase);

    const threeBPlanned = await getStep(project.id, "3B");
    expect(threeBPlanned.status).toBe("in_progress");
    expect(threeBPlanned.plannedEndDate).toEqual(plannedArrival);
    expect(threeBPlanned.actualStartDate).toBeNull(); // 3B has no start concept, only Actual arrival
    expect(threeBPlanned.actualEndDate).toBeNull();

    const actualArrival = new Date("2026-09-18T00:00:00.000Z");
    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: { actualArrivalDate: actualArrival },
    });
    await syncGlassPOStepStatus(project.id, users.purchase);

    const threeBCompleted = await getStep(project.id, "3B");
    expect(threeBCompleted.status).toBe("completed");
    expect(threeBCompleted.plannedEndDate).toEqual(plannedArrival);
    expect(threeBCompleted.actualEndDate).toEqual(actualArrival);
  });

  it("3B's own status is independent of 3A — it can track Actual arrival before 3A's Order confirmed is even set", async () => {
    const project = await projectAtPhase3();
    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });

    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: { actualArrivalDate: new Date("2026-09-18T00:00:00.000Z") },
    });
    await syncGlassPOStepStatus(project.id, users.purchase);

    expect((await getStep(project.id, "3B")).status).toBe("completed");
    expect((await getStep(project.id, "3A")).status).toBe("not_started");
  });

  it("reverting 3B directly clears just the actual arrival date, leaving 3A's own glass PO data intact", async () => {
    const project = await projectAtPhase3();
    await completeGlassPO(project.id, users.purchase); // fills requirement/quote/payment/order (3A)
    await completeGlassDelivery(project.id, users.purchase); // fills actual arrival (3B)

    const threeB = await getStep(project.id, "3B");
    expect(threeB.status).toBe("completed");

    await revertStep(threeB.id, users.owner_admin, { reason: "test revert", clearDerivedProcurement: true });

    expect((await getStep(project.id, "3B")).status).toBe("not_started");
    expect((await getStep(project.id, "3A")).status).toBe("completed"); // untouched

    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(glassPO.actualArrivalDate).toBeNull();
    expect(glassPO.requirementCreatedAt).not.toBeNull();
    expect(glassPO.orderConfirmedAt).not.toBeNull();
  });
});

describe("Glass PO's Actual arrival / QC checked rows, and the action plan a QC failure unlocks", () => {
  it("Actual arrival and QC checked can be recorded, independently of 3A's own derived status", async () => {
    const project = await projectAtPhase3();
    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });

    const arrival = new Date("2026-09-01T00:00:00.000Z");
    const qc = new Date("2026-09-05T00:00:00.000Z");
    const updated = await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: { actualArrivalDate: arrival, qcCheckedAt: qc, qcPassed: true },
    });

    expect(updated.actualArrivalDate).toEqual(arrival);
    expect(updated.qcCheckedAt).toEqual(qc);
  });

  it("3A's status stays derived from Requirement/Order alone — Arrival and QC don't gate it, matching the earlier explicit spec for 3A", async () => {
    const project = await projectAtPhase3();
    await completeGlassPO(project.id, users.purchase); // fills requirement/quote/payment/order

    const threeA = await getStep(project.id, "3A");
    expect(threeA.status).toBe("completed"); // already true before Arrival/QC are ever touched

    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(glassPO.actualArrivalDate).toBeNull();
    expect(glassPO.qcCheckedAt).toBeNull();
  });

  it("a custom action-plan follow-up row can be created once QC has failed and the action plan is marked", async () => {
    const project = await projectAtPhase3();
    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });

    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: {
        qcCheckedAt: new Date(),
        qcPassed: false,
        qcNote: "cracked pane",
        actionPlanAt: new Date(),
        actionPlanNote: "reorder from backup supplier",
      },
    });

    const actionItem = await prisma.glassActionItem.create({
      data: {
        glassPurchaseOrderId: glassPO.id,
        taskLabel: "Reorder from alternate vendor",
        plannedDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });

    const items = await prisma.glassActionItem.findMany({ where: { glassPurchaseOrderId: glassPO.id } });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(actionItem.id);
  });

  it("reverting 3A clears Arrival/QC/action-plan data too, and deletes any custom action-plan rows", async () => {
    const project = await projectAtPhase3();
    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });

    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: {
        requirementCreatedAt: new Date(),
        orderConfirmedAt: new Date(),
        actualArrivalDate: new Date(),
        qcCheckedAt: new Date(),
        qcPassed: false,
        qcNote: "cracked pane",
        actionPlanAt: new Date(),
        actionPlanNote: "reorder",
      },
    });
    await syncGlassPOStepStatus(project.id, users.purchase);
    await prisma.glassActionItem.create({
      data: {
        glassPurchaseOrderId: glassPO.id,
        taskLabel: "Reorder from alternate vendor",
        plannedDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });

    const threeA = await getStep(project.id, "3A");
    await revertStep(threeA.id, users.owner_admin, { reason: "test revert", clearDerivedProcurement: true });

    const cleared = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(cleared.actualArrivalDate).toBeNull();
    expect(cleared.qcCheckedAt).toBeNull();
    expect(cleared.qcPassed).toBeNull();
    expect(cleared.actionPlanAt).toBeNull();

    const remainingActionItems = await prisma.glassActionItem.findMany({
      where: { glassPurchaseOrderId: glassPO.id },
    });
    expect(remainingActionItems).toHaveLength(0);
  });
});

describe("maybeEarlyUnlockPhase3 — every item arriving 2+ days ago unlocks phase 3 ahead of 2F itself completing", () => {
  const ALL_ITEM_TYPES: ItemType[] = ["section", "hardware", "gasket"];
  const DAY = 24 * 60 * 60 * 1000;

  async function projectWithAllArrived(daysAgo: number) {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await markAllRequirementsCreated(project.id, users.design_engineer);
    const arrivedAt = new Date(Date.now() - daysAgo * DAY);
    for (const itemType of ALL_ITEM_TYPES) {
      await patchProcurementItem(project.id, itemType, users.purchase, { actualArrivalDate: arrivedAt });
    }
    return project;
  }

  it("does nothing while an item hasn't arrived yet", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await markAllRequirementsCreated(project.id, users.design_engineer);
    await patchProcurementItem(project.id, "section", users.purchase, { actualArrivalDate: new Date() });
    await patchProcurementItem(project.id, "hardware", users.purchase, { actualArrivalDate: new Date() });

    await maybeEarlyUnlockPhase3(project.id);

    expect(await prisma.phaseStep.count({ where: { projectId: project.id, phase: "phase_3" } })).toBe(0);
  });

  it("does nothing until 2 days have passed since the last arrival", async () => {
    const project = await projectWithAllArrived(1);

    await maybeEarlyUnlockPhase3(project.id);

    expect(await prisma.phaseStep.count({ where: { projectId: project.id, phase: "phase_3" } })).toBe(0);
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");
  });

  it("unlocks phase 3 (steps + glass PO) once 2 days have passed, even though 2F hasn't completed", async () => {
    const project = await projectWithAllArrived(2);

    await maybeEarlyUnlockPhase3(project.id);

    const phase3Steps = await prisma.phaseStep.findMany({ where: { projectId: project.id, phase: "phase_3" } });
    expect(phase3Steps.length).toBeGreaterThan(0);
    expect(await prisma.glassPurchaseOrder.findUnique({ where: { projectId: project.id } })).not.toBeNull();

    const twoF = await getStep(project.id, "2F");
    expect(twoF.status).not.toBe("completed");
    // currentPhase stays accurate to 2F's real state — only the steps/tracker are unlocked early.
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");
  });

  it("is a no-op once already unlocked, and 2F completing for real afterward doesn't duplicate anything", async () => {
    const project = await projectWithAllArrived(3);
    await maybeEarlyUnlockPhase3(project.id);
    await maybeEarlyUnlockPhase3(project.id);

    const stepsBefore = await prisma.phaseStep.count({ where: { projectId: project.id, phase: "phase_3" } });

    for (const itemType of ALL_ITEM_TYPES) {
      await patchProcurementItem(project.id, itemType, users.purchase, { qcCheckedAt: new Date() });
    }

    expect(await prisma.phaseStep.count({ where: { projectId: project.id, phase: "phase_3" } })).toBe(stepsBefore);
    expect(await prisma.glassPurchaseOrder.count({ where: { projectId: project.id } })).toBe(1);
    expect((await getProject(project.id)).currentPhase).toBe("phase_3");
  });
});
