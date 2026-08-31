import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus, revertStep, syncGlassPOStepStatus } from "@/lib/step-actions";
import { checkDependencyGate } from "@/lib/dependency-gate";
import {
  createTestProject,
  ensureTestUsers,
  getStep,
  getProject,
  cleanupTestProjects,
  prisma,
} from "../helpers/db";
import { advanceThroughPhase1, advanceThroughPhase2, completeGlassPO, completeGlassDelivery } from "../helpers/scenarios";
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

    await updateStepStatus(threeE.id, "completed", users.project_engineer);

    const projectAfter = await getProject(project.id);
    expect(projectAfter.currentPhase).toBe("completed");
    expect(projectAfter.overallStatus).toBe("completed");
    expect(projectAfter.actualEndDate).not.toBeNull();
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
